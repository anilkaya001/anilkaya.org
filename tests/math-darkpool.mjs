import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as STOCK from "../shared/flows-stock.js";
import * as PULSE from "../shared/flows-pulse.js";
import * as CARD from "../shared/flows-card.js";
import { loadMutated } from "./truth/mutants.mjs";

const HERE = new URL("./", import.meta.url);
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const FX = JSON.parse(readFileSync(new URL("fixtures-math-darkpool.json", HERE), "utf8"));
eq(FX.provenance.generatorSha256, createHash("sha256").update(readFileSync(new URL("gen-math-darkpool-fixtures.py", HERE))).digest("hex"),
  "the fixture was written by this version of the generator");

const two = (v) => (v === null || v === undefined ? null : (Math.round(v * 100) / 100).toFixed(2));

function cases(M) {
  const bad = [];
  const say = (m) => { if (bad.length < 8) bad.push(m); };
  for (const sc of FX.scenarios) {
    const raw = { data: sc.rows };
    const exp = sc.perName;
    const panel = M.STOCK.shapeStockDarkpool(raw);
    const live = panel.rows.filter((r) => r.canceled !== true), voided = panel.rows.filter((r) => r.canceled === true);
    if (JSON.stringify(live.map((r) => two(r.prem))) !== JSON.stringify(exp.live)) say(`${sc.name}: ranked live prints ${JSON.stringify(live.map((r) => two(r.prem)))} where ${JSON.stringify(exp.live)} is right`);
    if (JSON.stringify(voided.map((r) => two(r.prem))) !== JSON.stringify(exp.voided)) say(`${sc.name}: canceled prints listed ${JSON.stringify(voided.map((r) => two(r.prem)))} where ${JSON.stringify(exp.voided)} is right`);
    if (panel.rows.slice(0, live.length).some((r) => r.canceled === true)) say(`${sc.name}: a canceled print sits among the ranked ones`);
    for (const k of ["seen", "shed", "canceled", "unpriced"]) if (panel[k] !== exp[k]) say(`${sc.name}: ${k} is ${panel[k]} where ${exp[k]} is right`);
    const lead = M.CARD.darkpoolLead(panel);
    if (exp.live.length === 0) {
      if (panel.status !== "quiet" || lead !== null) say(`${sc.name}: a name with no live print is quiet and has no lead`);
      if (exp.canceled > 0 && !/canceled/.test(panel.reason || "")) say(`${sc.name}: an all-canceled name says why it is quiet`);
      continue;
    }
    if (!lead) { say(`${sc.name}: no lead for a name with live prints`); continue; }
    const total = Number(exp.total);
    if (Number(exp.total) > 0) {
      if (lead.n.topPct !== exp.topPct) say(`${sc.name}: the top print is ${lead.n.topPct}% where the exact fraction says ${exp.topPct}%`);
      if (Math.abs(lead.n.dollars - total) > 1e-9 * total) say(`${sc.name}: the dollars are ${lead.n.dollars} where ${total} is right`);
      if (!lead.say.includes(`${exp.topPct}% of it`)) say(`${sc.name}: the sentence does not print the share it pins`);
    }
    if (lead.n.canceled !== exp.canceled) say(`${sc.name}: the lead pins ${lead.n.canceled} canceled where ${exp.canceled} is right`);
    if (/canceled print/.test(lead.say) !== (exp.canceled > 0)) say(`${sc.name}: the canceled sentence is ${exp.canceled > 0 ? "missing" : "present"}`);

    const mk = M.PULSE.shapeDarkpool(raw);
    const mkTop = mk.rows.map((r) => two(r.prem));
    if (JSON.stringify(mkTop) !== JSON.stringify(sc.market.top)) say(`${sc.name}: the market list holds ${JSON.stringify(mkTop.slice(0, 3))} where ${JSON.stringify(sc.market.top.slice(0, 3))} is right`);
    if (mk.seen !== sc.market.seen || mk.canceled !== sc.market.canceled) say(`${sc.name}: market seen ${mk.seen} / canceled ${mk.canceled} where ${sc.market.seen} / ${sc.market.canceled} is right`);
    if (mk.rows.some((r) => r.canceled === true)) say(`${sc.name}: the market list ranks a canceled print`);
  }
  for (const sc of FX.scenarios) {
    const x = sc.cross;
    const idx = M.CARD.indexCrossFeed("darkpool", { data: sc.rows }, { limit: x.limit, tickers: Object.keys(x.ranks) });
    if (!sc.rows.length) continue;
    if (!x.population) { if (idx.status === "ok") say(`${sc.name}: a feed with only canceled prints is not a list`); continue; }
    if (idx.population !== x.population) say(`${sc.name}: population ${idx.population} where ${x.population} live prints is right`);
    if (idx.canceled !== x.canceled) say(`${sc.name}: ${idx.canceled} canceled where ${x.canceled} is right`);
    if (idx.capped !== x.capped) say(`${sc.name}: capped ${idx.capped} where ${x.capped} is right (${x.population} live, ${x.canceled} canceled, limit ${x.limit})`);
    for (const [t, rank] of Object.entries(x.ranks)) if (!idx.entries[t] || idx.entries[t].rank !== rank) say(`${sc.name}: ${t} ranks ${idx.entries[t] && idx.entries[t].rank} where ${rank} is right`);
  }
  return bad;
}

const base = { STOCK, PULSE, CARD };
eq(cases(base).join("; "), "", `${FX.scenarios.length} scenarios of off-exchange prints with canceled ones, unpriced ones and ties are ranked, summed, shared and counted as exact decimals do, in the name's panel, the market list and the cross-feed rank`);
ok(FX.scenarios[0].perName.canceled === 1 && FX.scenarios[0].perName.live.length === 5 && FX.scenarios[0].perName.topPct === 29, "the first scenario holds a canceled print larger than every live one and a 28.5% share that rounds to 29");
ok(FX.scenarios.some((s) => s.perName.live.length === 0 && s.perName.canceled > 0), "the fixture holds a name whose every priced print was canceled");
ok(FX.scenarios.some((s) => s.perName.shed > 0 && s.perName.canceled > 0) && FX.scenarios.some((s) => s.perName.unpriced > 0 && s.perName.canceled > 0), "and names with shed, unpriced and canceled prints together");

{
  const all = STOCK.shapeStockDarkpool({ data: [
    { ticker: "SYA101", executed_at: "2026-10-02T15:00:00Z", price: "10.00", size: 100, premium: "1000.00", canceled: true },
    { ticker: "SYA101", executed_at: "2026-10-02T15:01:00Z", price: "10.00", size: 50, premium: "500.00", canceled: true },
  ] });
  eq([all.status, all.rows.length, all.canceled, all.reason], ["quiet", 2, 2, "all 2 priced off-exchange prints were canceled"], "when every priced print was canceled the panel is quiet and says so, never $0 across 0 prints");
  eq(CARD.darkpoolLead(all), null, "and has no lead figure");
  const none = STOCK.shapeStockDarkpool({ data: [] });
  eq([none.status, none.canceled, none.reason], ["quiet", 0, undefined], "an empty feed is quiet with no canceled count to explain");
}

const MUTANTS = [
  ["a canceled print takes a ranked slot", "shared/flows-stock.js", [["const live = rows.filter((r) => r.canceled !== true);", "const live = rows;"]], "STOCK"],
  ["the canceled prints are not listed", "shared/flows-stock.js", [["rows: kept.concat(voided.slice(0, CANCELED_SHOWN))", "rows: kept"]], "STOCK"],
  ["the canceled prints are not counted", "shared/flows-stock.js", [["canceled: voided.length,", "canceled: 0,"]], "STOCK"],
  ["the lead sums the canceled prints", "shared/flows-card.js", [["const rows = (panel.rows || []).filter((r) => r.canceled !== true);\n  if (!rows.length) return null;\n  const total", "const rows = (panel.rows || []);\n  if (!rows.length) return null;\n  const total"]], "CARD"],
  ["the share goes through Math.round of a float product", "shared/flows-card.js", [["const topPct = wholePercent(top / total);", "const topPct = Math.round(top / total * 100);"]], "CARD"],
  ["the lead forgets the canceled sentence", "shared/flows-card.js", [["const voided = panel.canceled > 0", "const voided = false && panel.canceled > 0"]], "CARD"],
  ["the market list ranks a canceled print", "shared/flows-pulse.js", [["if (flag(r.canceled) === true) { canceled++; continue; }", ""]], "PULSE"],
  ["the cross-feed ranks a canceled print", "shared/flows-card.js", [["if (r.canceled === true) { canceled++; continue; }\n", ""]], "CARD"],
  ["the cross-feed cap forgets the canceled rows", "shared/flows-card.js", [["shaped.length + canceled >= lim", "shaped.length >= lim"]], "CARD"],
];
for (const [name, rel, transforms, slot] of MUTANTS) {
  let mod;
  try { mod = await loadMutated(rel, transforms, { salt: Math.floor(Math.random() * 1e6) }); } catch (e) { assert.fail(`the planted build '${name}' did not load: ${e.message}`); }
  ok(cases({ ...base, [slot]: mod }).length > 0, `planted wrong build must fail: ${name}`);
}

console.log(`✓ math-darkpool: ${checks} assertions - canceled off-exchange prints are left out of every sum, share, rank and cross-feed position and counted instead, listed last and tagged in the name's panel, an all-canceled name is quiet with its reason, the top share rounds as an exact fraction does, and ${MUTANTS.length} planted wrong builds that each fail`);
