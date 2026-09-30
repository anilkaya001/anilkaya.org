import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import * as ENGINE from "../shared/flows-quant-engine.js";
import { deskSmiles } from "../shared/flows-premium.js";
import { chain, engineBlock, openDesk } from "./desk-fixtures.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const flat = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();

const REF = JSON.parse(readFileSync(new URL("./fixtures-desk-lab.json", import.meta.url), "utf8"));
const S = REF.spot, RATE = REF.rate, ASOF_MS = Date.parse(REF.tape);
const symbol = (expiry, type, K) => "NVDA" + expiry.slice(2).replace(/-/g, "") + type + String(Math.round(K * 1000)).padStart(8, "0");

const cardOf = (g) => [{
  expiry: g.card.expiry, dte: 2, sessions: 2, hSessions: 2, T: g.card.T,
  forward: { F: S, D: 1, r: RATE, qImpl: 0, pairs: 0, method: "rate-only" },
  smile: { method: "svi", n: 20, fitInSpread: 0.9, rmseIvPts: 0.2, atmIv: g.card.atm, params: g.card.params, rr25: -0.03, bf25: 0.01, checks: { ok: true, minG: 0.1 } },
}];

const labPop = (g, line) => {
  const rows = g.rows.map((r) => ({ K: r.K, type: r.type, bid: r.bid, ask: r.ask, oi: 3000, volume: 500, sym: symbol(g.expiry, r.type, r.K), ivSeed: r.iv }));
  const expiry = ENGINE.buildExpiry({ expiry: g.expiry, rows, spot: S, asOfMs: ASOF_MS, rate: RATE, prev: null });
  const setup = ENGINE.setupEngine({ asOf: ASOF_MS, spot: S, pLaw: null, facts: {}, state: null, levels: null, event: null, stale: false }, [expiry]);
  const legs = line.type === "P" ? [{ type: "P", K: line.K, side: -1, qty: 1 }] : [{ type: "S", side: 1, qty: 1 }, { type: "C", K: line.K, side: -1, qty: 1 }];
  return ENGINE.priceStructure(setup, { family: line.type === "P" ? "short-put" : "covered-call", expiry: g.expiry, legs, basis: "natural" }).prob.popQ;
};

const payloadOf = (g, withCard) => {
  const block = engineBlock("NVDA", "2026-09-29", 190, {
    rate: { r: RATE, method: "parity:SPX", n: 3 },
    expiries: withCard ? deskSmiles(cardOf(g)) : [],
  });
  return chain({
    ticker: "NVDA", spot: S, asOf: "2026-09-30", source: "stock-state", tapeTime: REF.tape, engine: block,
    lines: g.lines.map((l) => ({ type: l.type, strike: l.K, expiry: g.expiry, bid: l.bid, ask: l.ask, iv: g.rows.find((r) => r.K === l.K && r.type === l.type).iv })),
    extra: { sessionDate: "2026-09-30", generatedAt: "2026-09-30T19:59:30Z" },
  });
};

const browser = await chromium.launch();
const errors = [];
const worst = {};
try {
  for (const g of REF.groups) {
    for (const withCard of [true, false]) {
      const page = await openDesk(browser, { payloads: { NVDA: payloadOf(g, withCard) }, query: "?t=NVDA&strategy=both&rank=annualized", errors });
      await page.waitForFunction((n) => document.querySelectorAll("#dkList .dk-row").length >= n, g.lines.length, { timeout: 15000 });
      let miss = 0, missLab = 0;
      for (const line of g.lines) {
        const sel = `#dkList .dk-row[data-strike="${line.K}"][data-strategy="${line.strategy}"][data-expiry="${g.expiry}"]`;
        await page.locator(sel + " .ui-info").first().click();
        await page.waitForSelector("#fxPop:popover-open");
        const facts = await page.$$eval("#fxPop dt", (dts) => Object.fromEntries(dts.map((dt) => [dt.textContent.trim(), dt.nextElementSibling.textContent.trim()])));
        await page.keyboard.press("Escape");
        await page.waitForSelector("#fxPop:not(:popover-open)", { state: "attached" });
        const desk = parseFloat(facts["Chance of profit"]) / 100;
        const lab = labPop(g, line);
        miss = Math.max(miss, Math.abs(desk - line.popQ));
        missLab = Math.max(missLab, Math.abs(desk - lab));
        if (withCard) {
          ok(Math.abs(desk - line.popQ) < 0.005, `${g.name} ${line.K}${line.type}: the desk's Win % (implied) ${(100 * desk).toFixed(1)} is within 0.5pp of the Breeden-Litzenberger probability of the generating smile, ${(100 * line.popQ).toFixed(2)} (mpmath, 40 digits)`);
          ok(Math.abs(desk - lab) < 0.005, `${g.name} ${line.K}${line.type}: and within 0.5pp of the strategy lab's ${(100 * lab).toFixed(2)}, priced by the same engine over the whole chain`);
          ok(new RegExp("^The card's smile shape for the " + g.card.expiry + " expiry").test(facts.Smile), `${g.name} ${line.K}${line.type}: and the line says the shape came from the card's ${g.card.expiry} expiry (${facts.Smile.slice(0, 70)})`);
          ok(/Priced at r 4\.00% \(measured from put-call parity on SPX\)/.test(facts.Carry), `${g.name} ${line.K}${line.type}: at the card's measured rate, named as such (${facts.Carry.slice(0, 70)})`);
        } else {
          ok(/^Flat at this contract's volatility/.test(facts.Smile), `${g.name} ${line.K}${line.type}: without the card's expiries the line says its smile is flat`);
        }
      }
      worst[g.name + (withCard ? "" : "-flat")] = { miss, missLab };
      await page.close();
    }
  }
  ok(worst.exact.miss < 0.005 && worst.neighbour.miss < 0.006, `across both chains the wired desk is never further than ${(100 * Math.max(worst.exact.miss, worst.neighbour.miss)).toFixed(2)}pp from the reference`);
  ok(worst["exact-flat"].miss > 0.02, `and the flat fit the desk used before misses it by ${(100 * worst["exact-flat"].miss).toFixed(2)}pp on the same chain, so the test would notice the expiries not arriving`);
  ok(worst["neighbour-flat"].miss > 0.01, `and by ${(100 * worst["neighbour-flat"].miss).toFixed(2)}pp on the chain whose expiry the card does not list`);
  eq(errors.length, 0, `no uncaught page error (${errors[0] || ""})`);
} finally {
  await browser.close();
}

const pp = (v) => (100 * v).toFixed(2) + "pp";
console.log("  worst line, desk against the reference / against the lab:");
for (const [name, w] of Object.entries(worst)) console.log("    " + name.padEnd(15) + pp(w.miss).padStart(8) + " / " + pp(w.missLab).padStart(7));
console.log(`✓ flows-desk-wiring: ${checks} assertions — the desk's Win % (implied) against an independent Breeden-Litzenberger reference on a skewed chain, ` +
  `within 0.5pp on every line of an expiry the card lists and of one it does not, and within 0.5pp of the strategy lab, ` +
  `with the flat fit shown to miss by more than two points on the same lines, and the carry and smile each line was priced on stated`);
