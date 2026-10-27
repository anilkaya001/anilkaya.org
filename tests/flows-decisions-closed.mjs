import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { carryOf, datedYield, chooseForward } from "../shared/flows-quant-forward.js";
import { exCount } from "../shared/flows-premium-rank.js";
import { coherentRegression } from "./lib/sc-chain.mjs";
import { chainWorld, routes, memoryCache } from "./lib/sc-world.mjs";
import { loadMutated } from "./truth/mutants.mjs";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const base = { S: 100, r: 0.04, T: 0.5, q: 0.02 };
const plain = carryOf(base);
eq(plain.dated, false, "no dated ex-dividend: the yield-based carry stands");
const one = carryOf({ ...base, nEx: 1 });
eq(one.dated, true, "a dated ex-dividend inside the horizon is used");
ok(Math.abs(datedYield(0.02, 0.5, 1) - 0.01) < 1e-15, "one quarterly ex-date in half a year is a quarter of a year's yield over half a year");
ok(Math.abs(one.F - 100 * Math.exp((0.04 - 0.01) * 0.5)) < 1e-9, "forward carries the dated dividend");
ok(carryOf({ ...base, nEx: 2 }).F < one.F, "two ex-dates take more off the forward than one");
eq(carryOf({ ...base, nEx: 0 }).F, plain.F, "zero ex-dates in the window is not read as a zero dividend");
eq(carryOf({ ...base, nEx: null }).F, plain.F, "no calendar leaves the carry unchanged");
const unk = carryOf({ S: 100, r: 0.04, T: 0.5, q: null, nEx: 2 });
eq([unk.known, unk.dated, unk.F], [false, false, 100 * Math.exp(0.02)], "an unknown yield stays unknown with dates: never a zero, never a guess");
ok(unk.se > plain.se, "and its error stays wide");
eq(chooseForward({ quotes: [], S: 100, r: 0.04, T: 0.5, q: 0.02, nEx: 1 }).qDated, true, "the forward record says the dividend was dated");

eq(exCount(["2026-11-05", "2027-02-05", "2026-10-26"], "2026-10-26", "2026-12-18"), 1, "ex-dates strictly after today and up to the expiry");
eq(exCount(["2026-12-18"], "2026-10-26", "2026-12-18"), 1, "an ex-date on the expiry day counts");
eq(exCount(null, "2026-10-26", "2026-12-18"), null, "no calendar is null, not zero");
eq(exCount(["bad", 5], "2026-10-26", "2026-12-18"), 0, "malformed entries are ignored");

{
  const fwd = "shared/flows-quant-forward.js";
  const a = await loadMutated(fwd, [["const qUse = dated ? datedYield(q, T, nEx) : q;", "const qUse = q;"]], { salt: "a" });
  ok(a.carryOf({ ...base, nEx: 2 }).F === plain.F, "planted build caught: dated dividends ignored");
  const b = await loadMutated(fwd, [["Number.isInteger(nEx) && nEx >= 1 && fin(T)", "Number.isInteger(nEx) && nEx >= 0 && fin(T)"], ["!Number.isInteger(nEx) || nEx < 1) return q;", "!Number.isInteger(nEx) || nEx < 0) return q;"]], { salt: "b" });
  ok(b.carryOf({ ...base, nEx: 0 }).F !== plain.F, "planted build caught: an empty window read as no dividend");
  const c = await loadMutated(fwd, [["const dated = known && Number", "const dated = Number"]], { salt: "c" });
  ok(c.carryOf({ S: 100, r: 0.04, T: 0.5, q: null, nEx: 2 }).dated === true, "planted build caught: an unknown yield guessed from dates");
  const d = await loadMutated("shared/flows-premium-rank.js", [["d > asOfDay && d <= expiry", "d >= asOfDay && d <= expiry"]], { salt: "d" });
  eq(d.exCount(["2026-10-26"], "2026-10-26", "2026-12-18"), 1, "planted build caught: an ex-date of today counted");
}

const ch = coherentRegression();
const pinned = { UW_NOW: new Date(ch.readMs).toISOString() };
const path = `/api/flows/chain?t=${ch.ticker}&strategy=sc`;
const load = async (tag) => (await import(`../worker.js?decisions=${tag}`)).default;
const refreshes = () => Array.from({ length: 6 }, (_, i) => `${path}&h=0.${i + 2}&refresh=1`);
const firstPageReads = (calls) => calls.filter((c) => c.kind === "chain" && c.page === 1).length;

{
  const { world } = chainWorld(ch);
  const [off] = await routes(await load(1), [path], world, { ...pinned, FLOWS_DESK_SC_PAGES: "0" });
  eq(off.res.status, 200, "FLOWS_DESK_SC_PAGES=0 still answers");
  eq(off.body.scOff, true, "and says the server ranking is off");
  ok(!off.body.cut, "with no server ranking cut");
  ok(off.body.strategy !== "sc", "as the plain chain");
  const { world: w2 } = chainWorld(ch);
  const [on] = await routes(await load(2), [path], w2, { ...pinned, FLOWS_DESK_SC_PAGES: "12" });
  ok(on.body.cut && on.body.strategy === "sc" && !on.body.scOff, "any other value keeps the Short calls ranking on");
}

{
  const { world, calls } = chainWorld(ch);
  const out = await routes(await load(3), refreshes(), world, pinned, { cache: memoryCache() });
  eq(out.every((o) => o.res.status === 200), true, "every refresh answers");
  eq(firstPageReads(calls), 3, "a member's fourth refresh inside a minute is served from the snapshot: three vendor reads of six requests");
}

{
  const run = async (tag, tr, env) => {
    const m = (await loadMutated("worker.js", tr, { salt: tag })).default;
    const { world, calls } = chainWorld(ch);
    const res = await routes(m, refreshes(), world, { ...pinned, ...env }, { cache: memoryCache() });
    return { res, reads: firstPageReads(calls) };
  };
  const noLimit = await run("n", [["if (stamps.length >= SC_REFRESH_LIMIT) {", "if (false) {"]], {});
  ok(noLimit.reads > 3, "planted build caught: no refresh limit");
  const forever = await run("f", [["now - t < SC_REFRESH_WINDOW_MS);\n  if (stamps", "true);\n  if (stamps"]], {});
  ok(forever.reads === 3, "a limit that never expires still holds three");
  const ignored = await run("k", [['String(env && env.FLOWS_DESK_SC_PAGES).trim() === "0"', "false"]], { FLOWS_DESK_SC_PAGES: "0" });
  ok(!!ignored.res[0].body.cut, "planted build caught: kill switch ignored");
}

const doc = readFileSync(new URL("../docs/math-audit.md", import.meta.url), "utf8");
ok(!/## Open decisions/.test(doc), "no decision is left open to the owner");
const closed = doc.split("## Decisions closed")[1] || "";
for (let i = 1; i <= 6; i++) ok(new RegExp(`^${i}\\. \\*\\*`, "m").test(closed), `decision ${i} is recorded as closed`);

console.log(`flows-decisions-closed: ${checks} checks`);
