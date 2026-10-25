import assert from "node:assert/strict";
import { createLiveState, detect, detectName, LIVE_LINES } from "../shared/flows-oracle-live.js";
import { guardAnswer } from "../shared/flows-ask.js";
import { NORM } from "./lib/oracle-fixtures.mjs";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.equal(a, b, m); checks++; };

const OPEN = Date.UTC(2026, 9, 16, 13, 30);
const CLOSE = Date.UTC(2026, 9, 16, 20, 0);
const MIN = 60000;
const OPTS = { openMs: OPEN, closeMs: CLOSE, fresh: "live" };
const ctxOf = (over = {}) => ({ SYO001: { norm: NORM, earnings: null, sector: "Energy", ...over } });

let seq = 0;
const row = (t, minute, over = {}) => ({
  id: "r" + seq++, t, ts: OPEN + minute * MIN, firstAt: new Date(OPEN + minute * MIN).toISOString(), cp: "C", k: 65, exp: "2026-11-20",
  prem: 100000, askPrem: 70000, bidPrem: 30000, size: 100, sweep: false, ...over,
});

const quiet = (t = "SYO001", from = 0, to = 60, step = 12) => Array.from({ length: Math.floor((to - from) / step) }, (_, i) => row(t, from + i * step, { k: 60 + i, exp: i % 2 ? "2026-11-20" : "2026-10-23", prem: 40000, askPrem: 20000, bidPrem: 20000 }));

{
  const s = createLiveState();
  eq(detect(s, quiet(), ctxOf(), OPEN + 70 * MIN, OPTS).length, 0, "ordinary flow says nothing");
  eq(detect(createLiveState(), [], ctxOf(), OPEN + 10 * MIN, OPTS).length, 0, "no rows, no message");
}

{
  const s = createLiveState();
  const burst = [...quiet("SYO001", 0, 60), ...Array.from({ length: 5 }, (_, i) => row("SYO001", 70 + i * 4, { prem: 300000, k: 70 + i }))];
  const out = detect(s, burst, ctxOf(), OPEN + 92 * MIN, OPTS);
  const surge = out.find((m) => m.kind === "surge");
  ok(surge, "a burst over the floor is a surge");
  ok(surge.strength >= 1 && /flagged options flow across \d+ windows/.test(surge.say) && /The bar for this name is \$/.test(surge.say) && !/pace|usual|typical/.test(surge.say), "with its wording: the sum, the windows and the bar, and no claim about a pace the ledger cannot support");
  ok(surge.facts.map((f) => f.label).join("|") === "Flagged premium|Bar for this name" && !("k" in surge.f) && !("norm" in surge.f), "and its facts carry the bar and no multiple");
  ok(guardAnswer(surge.say, [{ say: surge.say }], { smallIntegers: false, modals: true }).forecast === false, "that passes the ask guard");
  eq(surge.id.split(":")[0], "SYO001", "the id leads with the ticker");
  const again = detect(s, burst, ctxOf(), OPEN + 93 * MIN, OPTS);
  eq(again.filter((m) => m.kind === "surge").length, 0, "the cooldown holds the same kind for 30 minutes");
  eq(detect(s, [row("SYO001", 94, { id: burst[0].id })], ctxOf(), OPEN + 95 * MIN, OPTS).length, 0, "a repeated alert id is deduplicated");
}

{
  const rows = [...quiet("SYO001", 0, 60), ...Array.from({ length: 4 }, (_, i) => row("SYO001", 80 + i * 3, { k: 77, prem: 120000 }))];
  const out = detect(createLiveState(), rows, ctxOf(), OPEN + 92 * MIN, OPTS);
  const rep = out.find((m) => m.kind === "repeat");
  ok(rep && /^Flow keeps returning to/.test(rep.say) && /flagged windows/.test(rep.say) && !/someone|prints?/i.test(rep.say), "four windows on one strike in 20 minutes is a repeat, said without an actor or a print");
  eq(rep.f.n, 4, "with the count");
}

{
  const early = Array.from({ length: 6 }, (_, i) => row("SYO001", i * 9, { cp: "C", prem: 150000, askPrem: 20000, bidPrem: 130000 }));
  const late = Array.from({ length: 5 }, (_, i) => row("SYO001", 70 + i * 5, { cp: "C", prem: 150000, askPrem: 130000, bidPrem: 20000 }));
  const out = detect(createLiveState(), [...early, ...late], ctxOf(), OPEN + 96 * MIN, OPTS);
  const flip = out.find((m) => m.kind === "flip");
  ok(flip && /bullish/.test(flip.say) && /bearish/.test(flip.say), "a lean that reverses names both reads");
  ok(/convention/.test(flip.say), "and repeats the convention");
  const thin = early.map((r) => ({ ...r, askPrem: 0, bidPrem: 0 }));
  eq(detect(createLiveState(), [...thin, ...late], ctxOf(), OPEN + 96 * MIN, OPTS).filter((m) => m.kind === "flip").length, 0, "sided coverage under half is silent");
}

{
  const rows = [...quiet("SYO001", 0, 60), ...Array.from({ length: 4 }, (_, i) => row("SYO001", 75 + i, { sweep: true, askPrem: 90000, bidPrem: 10000, prem: 100000, k: 80 + i }))];
  const out = detect(createLiveState(), rows, ctxOf(), OPEN + 80 * MIN, OPTS);
  ok(out.some((m) => m.kind === "sweeps"), "four sweep windows mostly on the ask side");
  const fewer = rows.slice(0, -1);
  eq(detect(createLiveState(), fewer, ctxOf(), OPEN + 80 * MIN, OPTS).filter((m) => m.kind === "sweeps").length, 0, "three is not enough");
}

{
  const rows = [...quiet("SYO001", 0, 60), row("SYO001", 75, { size: 4000, prem: 600000, k: 85 })];
  const out = detect(createLiveState(), rows, ctxOf(), OPEN + 76 * MIN, OPTS);
  ok(out.some((m) => m.kind === "size"), "one window far over the usual large window");
  eq(detect(createLiveState(), [...quiet("SYO001", 0, 60), row("SYO001", 75, { size: 1900, prem: 600000 })], ctxOf(), OPEN + 76 * MIN, OPTS).filter((m) => m.kind === "size").length, 0, "just under the size bar is silent");
}

{
  const rows = [...quiet("SYO001", 0, 60), ...Array.from({ length: 3 }, (_, i) => row("SYO001", 70 + i, { exp: "2026-12-18", prem: 200000, k: 90 + i })), row("SYO001", 73, { exp: "2026-10-23", prem: 40000 })];
  const out = detect(createLiveState(), rows, ctxOf(), OPEN + 75 * MIN, OPTS);
  ok(out.some((m) => m.kind === "cluster"), "most of the recent flow in one far expiry");
}

{
  const names = ["SYO011", "SYO012", "SYO013", "SYO014", "SYO015"];
  const contexts = Object.fromEntries(names.map((n) => [n, { norm: NORM, earnings: null, sector: "Energy" }]));
  const rows = names.flatMap((n) => [...quiet(n, 0, 60), ...Array.from({ length: 4 }, (_, i) => row(n, 70 + i * 3, { prem: 400000, k: 70 + i }))]);
  const out = detect(createLiveState(), rows, contexts, OPEN + 85 * MIN, OPTS);
  const sector = out.filter((m) => m.kind === "sector");
  eq(sector.length, 1, "five names surging in one sector is one sector message");
  ok(sector[0].f.n === 5, "counting each name once");
  ok(out.length <= LIVE_LINES.globalCap, "and the global cap holds");
  ok(createLiveState().more === 0, "a fresh state has nothing held back");
}

{
  const burst = [...quiet("SYO001", 0, 60), ...Array.from({ length: 5 }, (_, i) => row("SYO001", 70 + i * 4, { prem: 300000, k: 70 + i }))];
  eq(detect(createLiveState(), burst, ctxOf(), OPEN + 92 * MIN, { ...OPTS, fresh: "stale" }).length, 0, "a stale feed never fires");
  eq(detect(createLiveState(), burst, { SYO001: { norm: null } }, OPEN + 92 * MIN, OPTS).length, 0, "no norm is silent");
  const s = createLiveState();
  detect(s, burst, { SYO001: { norm: null } }, OPEN + 92 * MIN, OPTS);
  eq(s.silent.get("SYO001"), "thin-norm", "and says why");
  eq(detect(createLiveState(), burst, ctxOf(), OPEN + 10 * MIN, OPTS).length, 0, "nothing in the warm-up");
  eq(detect(createLiveState(), burst, ctxOf(), CLOSE + 10 * MIN, OPTS).length, 0, "nothing after the close");
  eq(detect(createLiveState(), burst, ctxOf(), OPEN + 92 * MIN, { fresh: "live" }).length, 0, "nothing without the session bounds");
  eq(detect(createLiveState(), burst.slice(-3), ctxOf(), OPEN + 92 * MIN, OPTS).length, 0, "nothing for a name with under five windows");
  const ev = detect(createLiveState(), burst, ctxOf({ earnings: { sessions: 3, inWindow: true } }), OPEN + 92 * MIN, OPTS).find((m) => m.kind === "surge");
  ok(!ev || /report 3 sessions away/.test(ev.say), "an earnings window carries its tag");
  eq(detectName("SYO001", [], null, OPEN).reason, "thin-norm", "no context is thin");
}

{
  let seed = 11;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  let sessions = 0, messages = 0;
  for (let d = 0; d < 40; d++) {
    const rows = [];
    for (let m = 0; m < 390; m += 6) {
      const prem = 20000 + rnd() * 60000;
      const askShare = 0.4 + rnd() * 0.2;
      rows.push(row("SYO001", m, { prem, askPrem: prem * askShare, bidPrem: prem * (1 - askShare), k: 60 + Math.floor(rnd() * 20), cp: rnd() < 0.5 ? "C" : "P", size: 20 + Math.floor(rnd() * 100), exp: rnd() < 0.5 ? "2026-10-23" : "2026-11-20" }));
    }
    const s = createLiveState();
    for (let m = 30; m <= 390; m += 30) messages += detect(s, rows.filter((r) => r.ts <= OPEN + m * MIN), ctxOf(), OPEN + m * MIN, OPTS).length;
    sessions++;
  }
  ok(messages / sessions < 0.05, `a null session with no planted burst raises ${messages} messages over ${sessions} sessions`);
}

console.log(`flows-oracle-live: ${checks} checks passed`);
