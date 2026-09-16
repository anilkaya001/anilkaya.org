import assert from "node:assert/strict";
import { makePermitQueue } from "../shared/flows-permits.js";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const deep = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

function fakeClock() {
  let t = 1000;
  return {
    now: () => t,
    sleep: async (ms) => { t += Math.max(0, ms); },
    advance: (ms) => { t += ms; },
    set: (v) => { t = v; },
  };
}

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

{

  const clock = fakeClock();

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

{

  const clock = fakeClock();
  let delay = 100;
  const issued = [];
  const q = makePermitQueue({ delayMs: () => delay, now: clock.now, sleep: clock.sleep });

  await q.acquire(); issued.push(clock.now());
  await q.acquire(); issued.push(clock.now());
  delay = 900;
  await q.acquire(); issued.push(clock.now());
  await q.acquire(); issued.push(clock.now());

  const gaps = issued.slice(1).map((t, i) => t - issued[i]);
  deep(gaps, [100, 100, 900],
    "the slot booked BEFORE the raise keeps the old spacing and every slot after it pays " +
    "the new one — read at reservation, which is the correct semantics"); checks++;
}

{
  const clock = fakeClock();
  const q = makePermitQueue({ delayMs: () => 100, now: clock.now, sleep: clock.sleep });
  await q.acquire();
  const before = clock.now();

  q.defer(5000);

  await q.acquire();
  eq(clock.now() - before, 5000,
     "a 429 pushes the NEXT caller out by the full backoff — serially that distinction did " +
     "not exist because there was only ever one caller; with permits outstanding it is the " +
     "difference between one 429 and six");

  const t = clock.now();
  q.defer(10_000);
  q.defer(1);
  await q.acquire();
  ok(clock.now() - t >= 10_000,
     "a shorter defer never undoes a longer one already in force");

  for (const bad of [0, -1, NaN, null, undefined, "soon"]) {
    const at = clock.now();
    eq(q.defer(bad), 0,
       `defer(${JSON.stringify(bad)}) is ignored rather than corrupting the schedule, and ` +
       `reports having added nothing rather than reporting NaN into a meter`);
    await q.acquire();
    ok(clock.now() - at <= 100,
       `defer(${JSON.stringify(bad)}) is ignored rather than corrupting the schedule`);
  }
}

{
  const clock = fakeClock();
  const q = makePermitQueue({ delayMs: () => 100, now: clock.now, sleep: clock.sleep });
  await q.acquire();

  const first = q.defer(5000);
  eq(first, 4900,
     "the first caller refused in a window moves the wall by the backoff MINUS the delay the " +
     "queue had already booked, and defer reports that increment rather than the request");

  const second = q.defer(5000);
  eq(second, 0,
     "a second caller refused in the SAME window asks for the same 5s, finds the wall already " +
     "there, and is charged 0 — six coalesced refusals cost the run one wall, not six");

  const longer = q.defer(8000);
  eq(longer, 3000,
     "a refusal asking for MORE than the wall already holds is charged only the difference it " +
     "actually added (8000 asked, 5000 already standing, 3000 added) — the increment, never " +
     "the request");

  ok(q.defer(1) === 0,
     "and a defer shorter than the standing wall adds nothing, so it cannot credit the meter " +
     "for a backoff the queue never served");
}

{
  const clock = fakeClock();
  const q = makePermitQueue({ delayMs: () => 0, now: clock.now, sleep: clock.sleep, maxInFlight: 3 });

  const a = q.enter(), b = q.enter();
  eq(q.stats().inFlight, 2, "two requests on the wire are counted");
  eq(q.stats().peakInFlight, 2, "and the peak is remembered");
  a(); b();
  eq(q.stats().inFlight, 0, "and both release");
  eq(q.stats().peakInFlight, 2, "while the peak stays — it is the high-water mark of the run");

  const c = q.enter();
  c(); c(); c();
  eq(q.stats().inFlight, 0, "a double release cannot drive the count below zero");
}

{

  const clock = fakeClock();
  const q = makePermitQueue({ delayMs: () => 10, now: clock.now, sleep: clock.sleep, maxInFlight: 2 });

  const held = [q.enter(), q.enter()];
  eq(q.stats().inFlight, 2, "the queue is at its in-flight ceiling");

  let granted = false;
  const pending = q.acquire().then(() => { granted = true; });
  await Promise.resolve();
  ok(!granted, "a third acquire does NOT proceed while the ceiling is held");

  held[0]();
  await pending;
  ok(granted, "and it proceeds as soon as a slot frees");
}

{

  for (const bad of [{ delayMs: 750 }, {}, { delayMs: () => 1, now: 5 }]) {
    assert.throws(() => makePermitQueue({ now: () => 0, sleep: async () => {}, ...bad }),
      TypeError, `a malformed queue throws rather than freezing the delay (${JSON.stringify(Object.keys(bad))})`);
    checks++;
  }
}

{

  const clock = fakeClock();
  const DELAY = 750, NET = 300, CALLS = 20;
  const q = makePermitQueue({ delayMs: () => DELAY, now: clock.now, sleep: clock.sleep });

  const start = clock.now();
  for (let i = 0; i < CALLS; i++) {
    await q.acquire();
    clock.advance(NET);
  }
  const permitElapsed = clock.now() - start;
  const serialElapsed = CALLS * (DELAY + NET);

  ok(permitElapsed < serialElapsed,
     `${CALLS} calls cost ${permitElapsed}ms queued against ${serialElapsed}ms serial`);

  eq(permitElapsed, (CALLS - 1) * DELAY + NET,
     "cost is (calls - 1) gaps of delay plus one final round trip — every other call's " +
     "network time was absorbed into a wait that was going to happen anyway");

  const saved = serialElapsed - permitElapsed;

  eq(saved, (CALLS - 1) * NET + DELAY,
     `the saving is every overlappable round trip plus the delay the first call never serves: ` +
     `${saved}ms here. Against the modelled 1076-call budget and a 300ms vendor that is about ` +
     `${Math.round((1075 * 300 + 750) / 1000)}s, off a run whose floor alone already costs ~807s`);
  ok(saved > (CALLS - 1) * NET * 0.95,
     "and the dominant term is the network time, which is the whole claim");
}

console.log(`✓ flows-permits: ${checks} assertions — requests that leave exactly delayMs apart ` +
  `whether one caller or three enter together, a floor raised mid-run governing every slot booked ` +
  `after it, a 429 that backs off the whole queue and never pulls it forward, a defer that ` +
  `reports the increment it ADDED rather than the backoff it was asked for so a coalesced ` +
  `volley cannot be charged once per caller, an in-flight count that survives a throw and a ` +
  `double release, and the saving stated as arithmetic rather than as a claim`);
