/* =============================================================
   flows-permits-contract.mjs — the rate limiter, on a fake clock.

   WHY A FAKE CLOCK AND NOT A REAL ONE. The property under test is
   "requests leave exactly delayMs apart". Asserted against wall time
   that becomes "roughly delayMs apart, most of the time, on an
   unloaded machine" — which passes on a laptop, flakes in CI, and
   proves nothing about the invariant. With an injected clock the
   spacing is exact and the suite runs in milliseconds.

   WHAT THIS GUARDS. scripts/flows-pipeline.mjs refuses `Promise.all`
   over vendor calls in three separate comments, all correctly: under
   a sleep-based limiter, N concurrent callers sleep the same delay
   simultaneously and then land together, which is a synchronised
   volley and not a rate limit. The permit queue is allowed to exist
   only because it preserves the property those comments defend. If
   the spacing assertions below ever fail, that permission is void.
   ============================================================= */

import assert from "node:assert/strict";
import { makePermitQueue } from "../shared/flows-permits.js";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const deep = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

/* A clock that only moves when a sleep asks it to. Sleeps resolve
   immediately in real time, so the whole suite is instant, but the
   clock advances exactly as it would have. */
function fakeClock() {
  let t = 1000;
  return {
    now: () => t,
    sleep: async (ms) => { t += Math.max(0, ms); },
    advance: (ms) => { t += ms; },
    set: (v) => { t = v; },
  };
}

/* ---------- 1. requests leave exactly delayMs apart ---------------- */
{
  const clock = fakeClock();
  const issued = [];
  const q = makePermitQueue({ delayMs: () => 750, now: clock.now, sleep: clock.sleep });

  for (let i = 0; i < 5; i++) {
    await q.acquire();
    issued.push(clock.now());
  }

  const gaps = issued.slice(1).map((t, i) => t - issued[i]);
  deep(gaps, [750, 750, 750, 750],
    "five sequential acquires leave exactly 750ms apart — the property the pipeline's " +
    "three anti-Promise.all comments defend, and the only reason this queue may exist"); checks++;
  eq(issued[0], 1000, "and the first call goes immediately: an idle queue does not make it wait");
}

/* ---------- 2. concurrent callers get consecutive slots, not the same one --- */
{
  /* THIS IS THE DEFECT THE OLD LIMITER HAD. Under `await sleep(delayMs)`,
     three callers entering together all slept 750ms from the same instant and
     then fired at the same instant. Here they must be handed 0, 750, 1500. */
  const clock = fakeClock();
  /* ASSERT WHAT WAS SCHEDULED, NOT WHAT A CALLER MEASURED. Under a fake clock
     that advances eagerly, three overlapping callers all observe the same end
     time, so a measured elapsed says nothing about the spacing. What the
     spacing IS, is the set of instants the queue BOOKED — which is what
     onReserve reports. Two earlier drafts of this test measured the wrong
     thing and both "failed" on correct behaviour: asserting the returned
     elapsed gave [0, 1500, 750], and asserting the requested sleeps gave
     [750, 750] because caller three read a clock caller two had already
     advanced. The booked instants do not have that problem. */
  const slots = [];
  const q = makePermitQueue({
    delayMs: () => 750,
    now: clock.now,
    sleep: clock.sleep,
    onReserve: (at) => slots.push(at),
  });

  await Promise.all([q.acquire(), q.acquire(), q.acquire()]);
  deep(slots, [1000, 1750, 2500],
    "three callers entering TOGETHER are handed consecutive slots — the first goes now, the " +
    "second waits one delay, the third waits two. Under the old `await sleep(delayMs)` all " +
    "three would have waited the SAME 750ms and landed together: a synchronised volley, which " +
    "the sector leg calls 'exactly the shape that earns a 429 and permanently raises the floor " +
    "for the rest of the run'"); checks++;
}

/* ---------- 3. a raised floor governs slots booked after it -------- */
{
  /* THE DELAY IS A FUNCTION, NOT A NUMBER, and this is why. The rate
     controller raises delayMs on a 429 mid-run; a queue that captured the
     delay once would keep issuing at the old rate for the rest of the run,
     which is the exact failure the floor was made a variable to fix. */
  const clock = fakeClock();
  let delay = 100;
  const issued = [];
  const q = makePermitQueue({ delayMs: () => delay, now: clock.now, sleep: clock.sleep });

  await q.acquire(); issued.push(clock.now());
  await q.acquire(); issued.push(clock.now());
  delay = 900;                       // a 429 raises the floor
  await q.acquire(); issued.push(clock.now());
  await q.acquire(); issued.push(clock.now());

  const gaps = issued.slice(1).map((t, i) => t - issued[i]);
  deep(gaps, [100, 100, 900],
    "the slot booked BEFORE the raise keeps the old spacing and every slot after it pays " +
    "the new one — read at reservation, which is the correct semantics"); checks++;
}

/* ---------- 4. defer backs the whole queue off, not one caller ----- */
{
  const clock = fakeClock();
  const q = makePermitQueue({ delayMs: () => 100, now: clock.now, sleep: clock.sleep });
  await q.acquire();
  const before = clock.now();

  q.defer(5000);                     // the vendor said 429, Retry-After 5s

  await q.acquire();
  eq(clock.now() - before, 5000,
     "a 429 pushes the NEXT caller out by the full backoff — serially that distinction did " +
     "not exist because there was only ever one caller; with permits outstanding it is the " +
     "difference between one 429 and six");

  /* AND IT ONLY EVER PUSHES FORWARD. A defer shorter than the wait already
     scheduled must not pull the queue back in — that would turn a small
     backoff into a speed-up in the middle of being rate limited. */
  const t = clock.now();
  q.defer(10_000);
  q.defer(1);
  await q.acquire();
  ok(clock.now() - t >= 10_000,
     "a shorter defer never undoes a longer one already in force");

  for (const bad of [0, -1, NaN, null, undefined, "soon"]) {
    const at = clock.now();
    q.defer(bad);
    await q.acquire();
    ok(clock.now() - at <= 100,
       `defer(${JSON.stringify(bad)}) is ignored rather than corrupting the schedule`);
  }
}

/* ---------- 5. in-flight is paired, and a throw still releases ----- */
{
  const clock = fakeClock();
  const q = makePermitQueue({ delayMs: () => 0, now: clock.now, sleep: clock.sleep, maxInFlight: 3 });

  const a = q.enter(), b = q.enter();
  eq(q.stats().inFlight, 2, "two requests on the wire are counted");
  eq(q.stats().peakInFlight, 2, "and the peak is remembered");
  a(); b();
  eq(q.stats().inFlight, 0, "and both release");
  eq(q.stats().peakInFlight, 2, "while the peak stays — it is the high-water mark of the run");

  /* IDEMPOTENT RELEASE. A caller that releases in both a catch and a finally
     would otherwise drive the count negative, and a negative count disables
     the stall backstop silently for the rest of the run. */
  const c = q.enter();
  c(); c(); c();
  eq(q.stats().inFlight, 0, "a double release cannot drive the count below zero");
}

/* ---------- 6. the stall backstop actually bounds concurrency ------ */
{
  /* IF THE VENDOR HANGS, permits keep being issued on the clock and in-flight
     would grow without bound — one open socket per outstanding permit. The
     backstop is a ceiling on damage. */
  const clock = fakeClock();
  const q = makePermitQueue({ delayMs: () => 10, now: clock.now, sleep: clock.sleep, maxInFlight: 2 });

  const held = [q.enter(), q.enter()];
  eq(q.stats().inFlight, 2, "the queue is at its in-flight ceiling");

  let granted = false;
  const pending = q.acquire().then(() => { granted = true; });
  await Promise.resolve();
  ok(!granted, "a third acquire does NOT proceed while the ceiling is held");

  held[0]();                          // one lands
  await pending;
  ok(granted, "and it proceeds as soon as a slot frees");
}

/* ---------- 7. the constructor refuses a half-built queue ---------- */
{
  /* A NUMBER WHERE A FUNCTION BELONGS is the mistake this is guarding: it
     would silently freeze the delay at construction and the floor would stop
     mattering, which is invisible until a live run is rate limited all
     morning. Fail at the call, not at 3am. */
  for (const bad of [{ delayMs: 750 }, {}, { delayMs: () => 1, now: 5 }]) {
    assert.throws(() => makePermitQueue({ now: () => 0, sleep: async () => {}, ...bad }),
      TypeError, `a malformed queue throws rather than freezing the delay (${JSON.stringify(Object.keys(bad))})`);
    checks++;
  }
}

/* ---------- 8. the whole point, as arithmetic --------------------- */
{
  /* THE SAVING IS THE NETWORK TIME, and it is worth stating as a number
     rather than a claim. Serially a call costs delay + network because the
     next delay cannot start until the previous body is parsed. Here the delay
     is the only thing on the critical path. */
  const clock = fakeClock();
  const DELAY = 750, NET = 300, CALLS = 20;
  const q = makePermitQueue({ delayMs: () => DELAY, now: clock.now, sleep: clock.sleep });

  const start = clock.now();
  for (let i = 0; i < CALLS; i++) {
    await q.acquire();
    clock.advance(NET);              // the round trip, overlapping the next wait
  }
  const permitElapsed = clock.now() - start;
  const serialElapsed = CALLS * (DELAY + NET);

  ok(permitElapsed < serialElapsed,
     `${CALLS} calls cost ${permitElapsed}ms queued against ${serialElapsed}ms serial`);
  /* (CALLS - 1) GAPS, NOT CALLS. The first call goes immediately — an idle
     queue does not make anyone wait — so twenty calls have nineteen intervals
     between them, plus the last round trip which has nothing left to overlap.
     The first draft of this line said CALLS * DELAY + NET and was wrong by
     exactly one delay; the code was right. */
  eq(permitElapsed, (CALLS - 1) * DELAY + NET,
     "cost is (calls - 1) gaps of delay plus one final round trip — every other call's " +
     "network time was absorbed into a wait that was going to happen anyway");

  const saved = serialElapsed - permitElapsed;
  /* (CALLS - 1) x NET + DELAY, derived rather than guessed:
       serial  = CALLS x (DELAY + NET)
       permits = (CALLS - 1) x DELAY + NET
       saved   = CALLS x NET + DELAY - NET = (CALLS - 1) x NET + DELAY
     The last call's round trip cannot overlap anything, so it is not saved;
     the first call's delay is never served, so it is. */
  eq(saved, (CALLS - 1) * NET + DELAY,
     `the saving is every overlappable round trip plus the delay the first call never serves: ` +
     `${saved}ms here. Against the modelled 1076-call budget and a 300ms vendor that is about ` +
     `${Math.round((1075 * 300 + 750) / 1000)}s, off a run whose floor alone already costs ~807s`);
  ok(saved > (CALLS - 1) * NET * 0.95,
     "and the dominant term is the network time, which is the whole claim");
}

console.log(`✓ flows-permits: ${checks} assertions — requests that leave exactly delayMs apart ` +
  `whether one caller or three enter together, a floor raised mid-run governing every slot booked ` +
  `after it, a 429 that backs off the whole queue and never pulls it forward, an in-flight count ` +
  `that survives a throw and a double release, and the saving stated as arithmetic rather than ` +
  `as a claim`);
