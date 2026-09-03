/* =============================================================
   flows-permits.js — one request leaves every `delayMs`, and the
   round trips are allowed to overlap.

   WHAT THIS REPLACES, AND WHY IT IS NOT THE THING THE PIPELINE
   ALREADY REFUSED THREE TIMES.

   scripts/flows-pipeline.mjs carries three comments refusing
   `Promise.all` over its vendor calls, and every one of them is
   right about the limiter it was written against. That limiter was

       await sleep(delayMs);      // every caller sleeps
       await fetch(url);          // then every caller arrives

   so N concurrent callers slept the SAME delayMs at the SAME moment
   and landed together — "exactly the shape that earns a 429 and
   permanently raises the floor for the rest of the run", as the
   sector leg puts it. Nothing here makes that legal, and this module
   is not a way to sneak `Promise.all` past those comments.

   What it changes is that the WAIT and the ROUND TRIP stopped being
   the same interval. Serially a call costs delayMs + networkMs,
   because the next call's delay cannot start until the previous
   body has been parsed. The vendor idles through the delay; the
   process idles through the round trip. Nobody is served by either.

     serial   |--wait--|-net-||--wait--|-net-|   (wait + net) per call
     permits  |--wait--|-net-|
                       |--wait--|-net-|          (wait) per call

   THE VENDOR CANNOT TELL THE TWO APART. Requests still leave exactly
   `delayMs` apart — that is the property the three comments defend,
   and it is preserved exactly. What disappears is only this process
   sitting on its hands.

   THE DELAY ACCOUNTING IS NOT RACED, the other thing those comments
   worried about. Reserving a slot is one synchronous read-and-advance
   of `nextAt`; JavaScript runs it to completion before any other
   caller is scheduled, so two callers can never be granted the same
   instant. `delayMs` is read AT RESERVATION TIME through a callback,
   so a floor raised by a 429 governs every slot reserved after it and
   none reserved before — which is the correct semantics and is why
   the delay is a function here rather than a number.

   CONCURRENCY IS AN OUTCOME, NOT A SETTING. In-flight count settles
   near networkMs / delayMs. At a 750ms floor against a 300ms vendor
   that is well under one, and this behaves almost exactly like the
   serial version minus the idling. It overlaps only when the vendor
   is slower than the floor — precisely when overlapping is worth
   something. `maxInFlight` is a backstop against a pathological
   stall, never a throughput dial.

   THE CLOCK AND THE SLEEP ARE INJECTED so this is testable without
   waiting in real time. The pipeline passes Date.now and a real
   sleep; the contract suite passes a fake clock and resolves
   instantly, which is the only way to assert the spacing exactly
   rather than approximately.
   ============================================================= */

/**
 * A scheduler that issues one permit every `delayMs()`.
 *
 * @param {object}   opts
 * @param {function} opts.delayMs      Called at RESERVATION time; returns the
 *                                     current inter-call delay in ms. A
 *                                     function, not a number, because the
 *                                     rate controller raises it mid-run.
 * @param {function} opts.now          Monotonic-ish clock, ms.
 * @param {function} opts.sleep        (ms) => Promise, awaited to reach a slot.
 * @param {number}   opts.maxInFlight  Stall backstop; not a throughput dial.
 * @param {function} [opts.onReserve]  Called with the instant each permit is
 *                                     scheduled FOR, at the moment it is
 *                                     booked. This is a seam, and it exists
 *                                     because the invariant — "requests leave
 *                                     exactly delayMs apart" — is a property
 *                                     of the SCHEDULE, not of any caller's
 *                                     measured elapsed. A caller that overlaps
 *                                     another sees a clock the other already
 *                                     advanced, so its own wait understates
 *                                     the spacing; the booked instants do not
 *                                     lie. The pipeline passes nothing.
 */
export function makePermitQueue({ delayMs, now, sleep, maxInFlight = 6, onReserve } = {}) {
  if (typeof delayMs !== "function") throw new TypeError("delayMs must be a function");
  if (typeof now !== "function") throw new TypeError("now must be a function");
  if (typeof sleep !== "function") throw new TypeError("sleep must be a function");

  let nextAt = 0;
  let inFlight = 0;
  let peakInFlight = 0;
  let issued = 0;

  return {
    /**
     * Wait for this call's turn. Resolves to the ms spent waiting.
     *
     * THE RESERVATION IS SYNCHRONOUS AND THE WAIT IS NOT. Everything that
     * touches `nextAt` happens in one uninterrupted step before the first
     * await, so the slot is claimed the instant this is called even though
     * the caller sits on it afterwards. Two callers entering together get
     * consecutive slots, never the same one.
     */
    async acquire() {
      const started = now();
      /* THE STALL BACKSTOP. If the vendor hangs, permits keep being issued on
         the clock and in-flight would grow without bound — one open socket per
         outstanding permit. This yields until the queue drains instead. It is
         a ceiling on damage, and reaching it is a finding worth logging, not a
         tuning opportunity. */
      while (inFlight >= maxInFlight) await sleep(25);

      const at = Math.max(now(), nextAt);
      nextAt = at + delayMs();
      issued++;
      if (onReserve) onReserve(at);
      const wait = at - now();
      if (wait > 0) await sleep(wait);
      return now() - started;
    },

    /**
     * Mark a request as on the wire. Returns a function to call when it lands.
     *
     * PAIRED RATHER THAN COUNTED BY THE CALLER, because a request that throws
     * must still decrement — and a caller that decrements in only the happy
     * path leaks in-flight slots until the backstop wedges the whole run. The
     * returned function is idempotent so a double-release cannot go negative.
     */
    enter() {
      inFlight++;
      if (inFlight > peakInFlight) peakInFlight = inFlight;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        inFlight--;
      };
    },

    /**
     * Push every future permit back — used when the vendor refuses.
     *
     * EVERYONE BACKS OFF, NOT JUST THE CALLER THAT WAS REFUSED. Serially that
     * distinction did not exist: there was only ever one caller. With permits
     * outstanding it is the difference between one 429 and six, because the
     * calls already holding a slot would otherwise walk into the same wall.
     */
    defer(ms) {
      const n = Number(ms);
      if (!Number.isFinite(n) || n <= 0) return;
      nextAt = Math.max(nextAt, now() + n);
    },

    /** What the queue did, for the run's own meter. */
    stats() {
      return { issued, inFlight, peakInFlight };
    },
  };
}
