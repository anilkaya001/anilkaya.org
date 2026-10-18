import { world } from "./world.mjs";

const LINE = Object.freeze({ day: 60000, minute: 500 });

const pad3 = (n) => String(n % 1000).padStart(3, "0");

const nameOf = (i) => "SY" + String.fromCharCode(65 + (Math.floor(i / 1000) % 26)) + pad3(i);

function weekdays(from, count) {
  const out = [];
  let t = Date.parse(from + "T00:00:00Z");
  while (out.length < count) {
    const d = new Date(t);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10));
    t += 86400000;
  }
  return out;
}

const rank = (mod, depth) => mod.depthRank(depth);

export async function deepenScenario(seed, mod, opts = {}) {
  const w = world(seed, "deepen");
  const ok = (condition, message) => (condition ? (w.checks++, true) : w.check(false, typeof message === "function" ? message() : message));
  const D = mod.DEEPEN;
  const N = opts.names || 60 + w.int(240);
  const cap = w.pick([undefined, 80, 80, 40, 24, 120, 5000]);
  const crossCount = Math.min(N, 20 + w.int(100));
  const boardSize = 10 + w.int(30);
  const poisonRate = w.pick([0, 0.02, 0.05]);
  const landRate = w.pick([1, 0.9, 0.75]);
  const names = Array.from({ length: N }, (_, i) => nameOf(i));
  const weight = new Map(names.map((t) => [t, Math.floor(w.uniform() * 1e9)]));
  const poison = new Set(names.filter(() => w.chance(poisonRate)));
  const rows = names.map((t) => ({ t, w: weight.get(t) }));
  const universe = new Set(names);

  const store = new Map();
  const cross = new Set([...names].sort((a, b) => weight.get(b) - weight.get(a)).slice(0, crossCount));
  const start = "2026-10-05";
  const backlog = N - boardSize;
  const perNight = Math.min(cap === undefined ? D.perNightCap : cap, D.hardCap, D.perNightCap * 3);
  const nights = 3 * Math.ceil(backlog / Math.max(1, Math.min(perNight, 80))) + 30;
  const days = weekdays(start, nights);
  for (const t of cross) store.set(t, { depth: "cross-section", session: "2026-10-02" });

  let ledgerStored = null;
  let ledgerWrites = 0;
  const attempts = new Map();
  const everChosen = new Set();
  let offNights = 0;
  let maxChosen = 0;

  for (let night = 0; night < days.length; night++) {
    const sessionDate = days[night];
    const before = new Map([...store].map(([t, c]) => [t, { ...c }]));
    const skipped = w.chance(0.05);
    if (skipped) { w.log(`${sessionDate}: the run was skipped`); continue; }
    const readable = !w.chance(0.06);
    const mode = w.chance(0.03) ? "off" : "on";
    if (mode === "off") offNights++;
    const heavy = w.chance(0.06);
    const callsSoFar = heavy ? w.int(30000) : 800 + w.int(1700);
    const elapsedMs = heavy ? w.int(40 * 60 * 1000) : 60000 + w.int(60000);
    const board = new Set(names.filter((t) => !poison.has(t) && w.chance(boardSize / N)).slice(0, boardSize));
    const lost = new Set([...store.keys()].filter(() => w.chance(0.01)));
    for (const t of lost) store.delete(t);
    const rosterKnown = w.chance(0.9) ? new Map([...store].map(([t, c]) => ["card:" + t, c.session])) : null;
    const stored = ledgerStored === null ? null : JSON.parse(ledgerStored);
    const payload = mode === "off" ? null : stored;
    const env = cap === undefined ? {} : { [D.capEnv]: String(cap) };
    const capNow = mod.capFromEnv(env, D.perNightCap);
    const plan = mod.planNight({
      mode, cap: capNow, payload, readable, sessionDate, rows, board, rosterKnown,
      dayLine: LINE.day, minuteLine: LINE.minute, callsSoFar, elapsedMs,
    });
    const gov = plan.gov;
    const picked = plan.picked.picked;
    maxChosen = Math.max(maxChosen, picked.length);

    w.check(picked.length === Math.min(gov.n, plan.candidates - plan.picked.waiting), `${sessionDate}: the rotation is what the governor allowed or what was ready (${picked.length} against ${gov.n}, ${plan.picked.waiting} waiting)`);
    w.check(picked.length <= Math.min(capNow, D.hardCap), `${sessionDate}: the rotation (${picked.length}) is inside the cap ${capNow}`);
    w.check(picked.length <= plan.candidates, `${sessionDate}: the rotation is inside the backlog`);
    w.check(new Set(picked).size === picked.length, `${sessionDate}: no name is chosen twice`);
    w.check(picked.every((t) => universe.has(t) && !board.has(t)), `${sessionDate}: a chosen name is in the universe and off the board`);
    for (const [t, c] of plan.carried) {
      const b = before.get(t);
      if (rosterKnown) ok(!!b && rank(mod, b.depth) >= 3 && b.session === c.session, () => `${sessionDate}: ${t} is carried on a deep read from ${c.session} but the store holds ${b ? b.depth + " from " + b.session : "no card"}`);
    }
    if (picked.length) {
      const keyOf = (t) => plan.ledger.at.get(t) || "";
      const chosenSet = new Set(picked);
      let newestPicked = "";
      for (const t of picked) if (keyOf(t) > newestPicked) newestPicked = keyOf(t);
      let oldestLeft = null;
      for (const r of rows) {
        if (board.has(r.t) || chosenSet.has(r.t) || !mod.ready(plan.ledger, r.t, sessionDate)) continue;
        const k = keyOf(r.t);
        if (oldestLeft === null || k < oldestLeft) oldestLeft = k;
      }
      w.check(oldestLeft === null || oldestLeft >= newestPicked, `${sessionDate}: a name read deep ${oldestLeft || "never"} was passed over for one read ${newestPicked || "never"}`);
    }
    if (mode === "off") w.check(picked.length === 0, `${sessionDate}: the switch off chooses nothing`);
    if (!readable) w.check(picked.length === 0, `${sessionDate}: an unreadable ledger chooses nothing blind`);
    if (picked.length) {
      const remainingCalls = Math.max(D.baselineCalls - callsSoFar, 0);
      const projected = callsSoFar + remainingCalls * (1 + D.overrunMargin) + picked.length * D.callsPerName;
      w.check(projected <= LINE.day * D.daySharePct + 1e-6, `${sessionDate}: ${picked.length} name(s) keep the night's calls (${Math.round(projected)}) inside ${D.daySharePct} of the day line`);
      const remainingMs = Math.max(D.baselineMs - elapsedMs, 0);
      const finish = elapsedMs + remainingMs + picked.length * D.msPerName;
      w.check(finish <= D.deadlineMs * D.timeSharePct + 1e-6, `${sessionDate}: ${picked.length} name(s) finish inside the time share (${Math.round(finish / 1000)} s)`);
    }
    w.check(gov.pace.perMinute <= Math.floor(LINE.minute * D.minuteSharePct) && gov.pace.spacingMs >= Math.ceil(60000 / (LINE.minute * D.minuteSharePct)),
      `${sessionDate}: the pace ${gov.pace.spacingMs} ms keeps the rotation under ${D.minuteSharePct} of the minute line`);

    let last = Infinity;
    for (const extra of [0, 500, 1500, 4000, 9000, 20000]) {
      const g = mod.governor({ mode: "on", cap: capNow, backlog: plan.candidates, dayLine: LINE.day, minuteLine: LINE.minute, callsSoFar: callsSoFar + extra, elapsedMs });
      w.check(g.n <= last, `${sessionDate}: spending ${extra} more calls never widens the rotation (${g.n} after ${last})`);
      last = g.n;
    }
    last = Infinity;
    for (const extra of [0, 60000, 300000, 600000, 1200000, 2400000]) {
      const g = mod.governor({ mode: "on", cap: capNow, backlog: plan.candidates, dayLine: LINE.day, minuteLine: LINE.minute, callsSoFar, elapsedMs: elapsedMs + extra });
      w.check(g.n <= last, `${sessionDate}: ${extra} ms more elapsed never widens the rotation (${g.n} after ${last})`);
      last = g.n;
    }
    w.check(mod.governor({ mode: "on", cap: capNow, backlog: 500, dayLine: LINE.day, minuteLine: LINE.minute, callsSoFar: 60000, elapsedMs: 0 }).n === 0, "a day line already spent chooses nothing");
    w.check(mod.governor({ mode: "on", cap: capNow, backlog: 500, dayLine: LINE.day, minuteLine: LINE.minute, callsSoFar: 0, elapsedMs: D.deadlineMs }).n === 0, "a deadline already reached chooses nothing");

    const enrichFailed = new Set(picked.filter((t) => w.chance(0.04) || poison.has(t) && w.chance(0.5)));
    const chosen = picked.filter((t) => !enrichFailed.has(t));
    for (const t of picked) { attempts.set(t, (attempts.get(t) || 0) + 1); everChosen.add(t); }
    const pickedSet = new Set(picked);
    const crossNow = names.filter((t) => (store.has(t) || cross.has(t)) && !board.has(t) && !pickedSet.has(t));
    const keep = mod.holdSet({ carried: plan.carried, protectAll: plan.protectAll, cross: crossNow, board, chosen: pickedSet });
    const split = mod.splitCross(crossNow, keep);
    const built = new Set();
    for (const t of chosen) {
      if (poison.has(t) || !w.chance(landRate)) continue;
      built.add(t);
      store.set(t, { depth: "deepened", session: sessionDate });
    }
    for (const t of board) store.set(t, { depth: "board", session: sessionDate });
    for (const t of split.build) {
      if (store.has(t) || cross.has(t)) store.set(t, { depth: "cross-section", session: sessionDate });
    }
    const settled = mod.settleNight({
      chosen: picked, enrichFailed, cardLanded: (t) => built.has(t), cardXLanded: (t) => built.has(t),
    });
    const deepNow = new Set([...board]);
    const writes = mode !== "off" && !plan.protectAll;
    if (writes) {
      const out = mod.ledgerPayload(payload, {
        sessionDate, generatedAt: sessionDate + "T21:30:00Z",
        landed: new Set([...deepNow, ...settled.landed]), failed: settled.failed, universe,
        plan: { n: picked.length, binding: gov.binding, never: plan.picked.never },
      });
      w.check(out.fits, `${sessionDate}: the ledger (${out.bytes} bytes) fits its ${D.ledgerBudgetBytes} byte budget`);
      if (out.fits) { ledgerStored = JSON.stringify(out.payload); ledgerWrites++; }
    }
    const exempt = new Set(plan.carried.keys());
    for (const [t, c] of [...store]) {
      const rebuilt = c.session === sessionDate;
      if (rebuilt) continue;
      const age = mod.sessionsAgo(c.session, sessionDate);
      const protect = plan.protectAll;
      if (age !== null && age > 3 && !exempt.has(t) && !protect) store.delete(t);
    }

    const ledger = ledgerStored === null ? mod.parseLedger(null) : mod.parseLedger(JSON.parse(ledgerStored));
    for (const [t, c] of plan.carried) {
      const b = before.get(t);
      const a = store.get(t);
      if (!b || !a || lost.has(t)) continue;
      const tonight = board.has(t) || pickedSet.has(t);
      if (!tonight) {
        ok(a.depth === b.depth && a.session === b.session,
          () => `${sessionDate}: ${t} was carried on a deep read from ${c.session} but its card went from ${b.depth} (${b.session}) to ${a.depth} (${a.session})`);
      } else {
        ok(rank(mod, a.depth) >= rank(mod, b.depth) || !built.has(t) && !board.has(t),
          () => `${sessionDate}: ${t} was re-read tonight and came out shallower: ${b.depth} -> ${a.depth}`);
      }
    }
    if (!readable && mode !== "off") {
      for (const [t, b] of before) {
        const a = store.get(t);
        if (!a || lost.has(t) || board.has(t) || rank(mod, b.depth) < 1) continue;
        ok(a.depth === b.depth && a.session === b.session, () => `${sessionDate}: ${t} was touched on a night the ledger could not be read (${b.depth} -> ${a.depth})`);
      }
    }
    for (const [t, d] of ledger.at) {
      const c = store.get(t);
      if (!c || lost.has(t)) continue;
      ok(c.session >= d, () => `${sessionDate}: ${t} is on the ledger for ${d} but its stored card is older (${c.depth} from ${c.session})`);
    }
    w.log(`${sessionDate}: ${picked.length} chosen, ${built.size} built, ${plan.carried.size} carried, mode ${mode}${readable ? "" : " (ledger unreadable)"}${heavy ? " heavy" : ""}`);
  }

  const ledger = ledgerStored === null ? mod.parseLedger(null) : mod.parseLedger(JSON.parse(ledgerStored));
  const reachable = names.filter((t) => !poison.has(t));
  const missing = reachable.filter((t) => !ledger.at.has(t));
  w.check(ledgerWrites > 0, "the rotation wrote a ledger");
  const untried = missing.filter((t) => !attempts.has(t));
  w.check(untried.length === 0, `after ${days.length} nights (${offNights} with the switch off) ${untried.length} reachable names were never chosen: ${untried.slice(0, 6).join(", ")}`);
  const retrying = missing.filter((t) => ledger.tries.has(t));
  w.check(missing.length === retrying.length, `every reachable name still without a deep read is on the retry list: ${missing.filter((t) => !ledger.tries.has(t)).slice(0, 6).join(", ")}`);
  w.check(missing.length <= Math.ceil(reachable.length * 0.03), `after ${days.length} nights ${missing.length} of ${reachable.length} reachable names still await their deep read`);
  for (const t of poison) {
    const n = attempts.get(t) || 0;
    w.check(n <= 4 + Math.ceil(days.length / D.failBackoffMax), `poison name ${t} was tried ${n} times in ${days.length} nights — the backoff is not backing off`);
  }
  w.check(maxChosen <= D.hardCap, `no night chose more than the hard cap (${maxChosen})`);
  return { checks: w.checks, events: w.events, violations: w.violations, detail: { ledger, attempts, missing, poison } };
}
