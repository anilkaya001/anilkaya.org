import assert from "node:assert/strict";
import * as R from "../shared/flows-rotation.js";
import { loadMutated } from "./truth/mutants.mjs";
import { rotationSeries, rotationCard } from "./lib/rotation-fixture.mjs";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.equal(a, b, m); checks++; };
const same = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const near = (a, b, m) => { assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)), `${m}: ${a} against ${b}`); checks++; };

function reference(series, tickers, norm, vel, k) {
  const n = series[tickers[0]].d.length;
  const s = (t, j) => {
    let m = 0;
    for (const u of tickers) m += Math.log(series[u].c[j]);
    return Math.log(series[t].c[j]) - m / tickers.length;
  };
  const gap = (t, j) => {
    const lam = 1 - 2 ** (-1 / norm);
    let num = 0, den = 0;
    for (let i = 0; i < j; i++) {
      const w = lam * (1 - lam) ** (j - 1 - i);
      num += w * s(t, i);
      den += w;
    }
    return 100 * (s(t, j) - num / den);
  };
  return (t) => ({ x: gap(t, k), y: (gap(t, k) - gap(t, k - vel)) * (5 / vel), n });
}

const detect = (m) => {
  const S = rotationSeries();
  const tickers = m.ROTATION_FUNDS.map((f) => f.t);
  const P = m.plane(S);
  if (P.status !== "ok" || P.funds.length !== 12) return "PLANE: twelve funds with full history did not all reach the plane";
  const last = S.SPY.d.length - 1;
  if (P.asOf !== S.SPY.d[last]) return "AS OF: the plane is not dated by its last close";
  for (const c of m.conventions()) {
    const ref = reference(S, tickers, c.norm, c.vel, last);
    for (const f of P.funds) {
      const got = f.tails[c.norm + "|" + c.vel][P.weeks.length - 1];
      const want = ref(f.t);
      if (Math.abs(got.x - want.x) > 1e-9) return `GAP: ${f.t} at norm ${c.norm} is ${got.x}, the direct weighted sum gives ${want.x}`;
      if (Math.abs(got.y - want.y) > 1e-9) return `VELOCITY: ${f.t} at ${c.norm}|${c.vel} is ${got.y}, the direct difference gives ${want.y}`;
    }
  }
  let sum = 0;
  const z = m.clr(m.align(S));
  for (const t of tickers) sum += z[t][last];
  if (Math.abs(sum) > 1e-9) return "CENTRED: the log-ratio coordinates of a session do not sum to zero";
  if (m.quadOf({ x: 1, y: 1 }) !== 0 || m.quadOf({ x: 1, y: -1 }) !== 1 || m.quadOf({ x: -1, y: -1 }) !== 2 || m.quadOf({ x: -1, y: 1 }) !== 3) return "QUADRANT: a sign pair is named wrongly";
  for (const f of P.funds) {
    const all = f.quads.every((q) => q === f.quads[0]);
    if (f.robust !== all) return "ROBUST: a fund is named although a window convention disagrees, or not named although all agree";
    if (f.held !== f.quads.filter((q) => q === f.quads[0]).length) return "ROBUST: the count of agreeing conventions is wrong";
  }
  const short = { ...S, SIL: { d: S.SIL.d.slice(-150), c: S.SIL.c.slice(-150) } };
  const PS = m.plane(short);
  if (PS.absent.SIL !== "short" || PS.funds.some((f) => f.t === "SIL")) return "ABSENT: a fund with too few closes is drawn";
  if (PS.funds.length !== 11) return "ABSENT: one short fund removed others";
  const holed = { ...S, GDX: { d: S.GDX.d.filter((_, i) => i !== 100), c: S.GDX.c.filter((_, i) => i !== 100) } };
  const PH = m.plane(holed);
  if (PH.absent.GDX !== "gaps") return "ALIGN: a fund missing a session the others have is not set aside";
  if (PH.sessions !== 251) return "ALIGN: one fund's missing session removed the session for every fund";
  const none = m.plane({ SPY: S.SPY, QQQ: S.QQQ });
  if (none.status !== "unavailable" || none.funds.length) return "TOO FEW: a plane of two funds was drawn";
  const w = m.weekEnds(251);
  if (w.length !== 8 || w[7] !== 250 || w[6] !== 245 || w[0] !== 215) return "WEEKS: the tail is not eight week-ends five sessions apart ending at the last close";
  if (m.weekEnds(130).some((k) => k < 126)) return "WARM-UP: a point is drawn before 126 sessions of norm";
  const c = m.closesOf({ panels: { context: { candleKeys: ["date", "open", "high", "low", "close", "volume"], candles: [["2026-01-02", 1, 2, 0, 5, 9], ["2026-01-05", 1, 2, 0, 0, 9], ["2026-01-06", 1, 2, 0, null, 9], ["2026-01-07", 1, 2, 0, 7, 9]] } } });
  if (!c || c.c.length !== 2 || c.c[1] !== 7) return "CLOSES: a zero or missing close was kept as a price";
  return null;
};

eq(detect(R), null, "THE CORRECT BUILD PASSES EVERY CHECK OF THE DETECTOR");

{
  same(R.conventions(), [{ norm: 126, vel: 10 }, { norm: 126, vel: 5 }, { norm: 126, vel: 21 }, { norm: 63, vel: 10 }, { norm: 63, vel: 5 }, { norm: 63, vel: 21 }], "CONVENTIONS: six registered windows, the first the default");
  eq(R.ROTATION_QUADRANTS.length, 4, "four quadrant names");
  ok(R.ROTATION_QUADRANTS.every((q) => !/buy|sell|forecast|will/i.test(q)), "no quadrant name gives advice or a forecast");
  near(R.lambdaOf(126), 1 - 2 ** (-1 / 126), "the smoothing weight is the half-life's");
  const S = rotationSeries();
  same(R.closesOf(rotationCard(S.GLD)), S.GLD, "a card's candles read back as its dated closes");
  eq(R.closesOf({ panels: {} }), null, "a card with no candles has no closes");
  eq(R.closesOf(null), null, "no card, no closes");
  const drift = R.plane(rotationSeries({ drift: { GLD: 0.004 } }));
  const gld = drift.funds.find((f) => f.t === "GLD");
  ok(gld.quads[0] === 0 && gld.robust, "a fund that outruns the others every session is above its norm and gaining under every window");
  const P = R.plane(S);
  ok(JSON.stringify(P).length < 48 * 1024, "the plane of twelve funds stays under 48 KiB");
  ok(Object.keys(R.ROTATION_WHY).every((k) => R.ROTATION_WHY[k].endsWith(".")), "every absence reason is a sentence");
}

const MUTANTS = [
  ["not-centred", [["    m /= tickers.length;\n", "    m = 0;\n"]], /GAP|CENTRED/],
  ["norm-sees-today", [["    num = (1 - lam) * num + lam * s[k - 1];\n", "    num = (1 - lam) * num + lam * s[k];\n"]], /GAP/],
  ["no-bias-correction", [["    out[k] = 100 * (s[k] - num / den);\n", "    out[k] = 100 * (s[k] - num);\n"]], /GAP/],
  ["velocity-not-per-week", [["(gap[k] - gap[k - vel]) * (ROTATION_WEEK / vel)", "(gap[k] - gap[k - vel])"]], /VELOCITY/],
  ["quadrants-swapped", [["(p.y >= 0 ? 3 : 2)", "(p.y >= 0 ? 2 : 3)"]], /QUADRANT/],
  ["named-on-default-only", [["lastQuads[0] !== null && held === convs.length", "lastQuads[0] !== null"]], /ROBUST/],
  ["short-fund-drawn", [["if (s.d.length < ROTATION_MIN_CLOSES) { absent[f.t] = \"short\"; continue; }", ""]], /ABSENT|ALIGN|PLANE|GAP/],
  ["gap-drops-session", [["count.get(day) * 2 > ok.length", "count.get(day) === ok.length"]], /ALIGN/],
  ["zero-close-kept", [[" || px <= 0) continue;", ") continue;"]], /CLOSES/],
  ["warmup-ignored", [["for (let k = n - 1; k >= ROTATION_WARMUP && out.length", "for (let k = n - 1; k >= 0 && out.length"]], /WARM-UP/],
  ["two-fund-plane", [["export const ROTATION_MIN_FUNDS = 3;", "export const ROTATION_MIN_FUNDS = 2;"]], /TOO FEW/],
];
for (const [name, transforms, expect] of MUTANTS) {
  const m = await loadMutated("shared/flows-rotation.js", transforms);
  let why;
  try { why = detect(m); } catch (e) { why = "PLANE: threw " + e.message; }
  console.log(`  planted ${name}: ${why || "NOT CAUGHT"}`);
  ok(why !== null && expect.test(why), `THE PLANTED WRONG BUILD "${name}" FAILS ITS NAMED CHECK`);
}

console.log(`flows-rotation: ${checks} checks passed`);
