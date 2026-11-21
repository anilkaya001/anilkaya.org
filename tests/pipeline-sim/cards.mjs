import { pathFor } from "../../shared/flows-vendor-ops.js";
import { validate } from "../../shared/flows-contracts.js";
import { coverageLedger } from "../../shared/flows-coverage.js";
import { fault, createVendor } from "./vendor.mjs";
import { expectation } from "./client.mjs";
import { tickers, world } from "./world.mjs";

export const ROUTES = Object.freeze(["max-pain", "spot-exposures-expiry-strike", "darkpool", "oi-change", "term-structure", "iv-rank", "earnings"]);

const SESSION = "2026-08-24";

const SCRIPTS = [
  [6, (w) => [fault.ok(1 + w.int(3))]],
  [4, () => [fault.empty()]],
  [1, () => [fault.http(404)]],
  [2, (w) => [fault.http(w.pick([500, 502, 503]))]],
  [1, () => [fault.rate(1)]],
  [1, () => [fault.stall()]],
  [1, () => [fault.malformed()]],
  [2, (w) => [fault.http(w.pick([500, 503])), fault.ok(2)]],
  [1, () => [fault.stall(), fault.ok(1)]],
];

const ofScript = (script) => {
  const want = expectation(script, false);
  return want.result === "fail" ? { status: want.status, kind: want.kind } : null;
};

const byRoute = (list) => [...list].sort((a, b) => (a.route < b.route ? -1 : a.route > b.route ? 1 : 0));

export function planNight(w, count = 5) {
  const names = tickers(w, count);
  return names.map((ticker, i) => {
    const t = ticker + String(i);
    const routes = ROUTES.map((route) => {
      const script = w.weighted(SCRIPTS)(w);
      return { route, path: pathFor(route, { ticker: t }), script, fail: ofScript(script) };
    });
    return { ticker: t, routes };
  });
}

const failuresOf = (name) => byRoute(name.routes.filter((r) => r.fail).map((r) => ({ route: r.route, status: r.fail.status, kind: r.fail.kind })));

const ROUTE_PANELS = Object.freeze({
  "spot-exposures-expiry-strike": ["surface"], darkpool: ["darkpool"], "oi-change": ["oiDeltas"], "term-structure": ["volContext"], "iv-rank": ["volContext"],
});

export function checkCard(w, name, card, plain, lost) {
  const failed = new Set(name.routes.filter((r) => r.fail).map((r) => r.route));
  const label = `${name.ticker} [${name.routes.map((r) => r.route + ":" + r.script.map((f) => f.kind).join(">")).join(" ")}]`;
  if (lost !== null) {
    w.check(JSON.stringify(byRoute(lost)) === JSON.stringify(failuresOf(name)), `${label}: the failed reads are ${JSON.stringify(failuresOf(name))}, the pipeline recorded ${JSON.stringify(byRoute(lost))}`);
  }
  if (failed.size === 0) {
    w.check(!("readFailures" in card), `${label}: a card with no failed read carries no readFailures key`);
    w.check(JSON.stringify(card) === JSON.stringify(plain), `${label}: and is byte for byte the card built with no failure list`);
  } else {
    w.check(Array.isArray(card.readFailures) && JSON.stringify(byRoute(card.readFailures.map((f) => ({ route: f.route, status: f.status, kind: f.kind })))) === JSON.stringify(failuresOf(name)),
      `${label}: the card lists exactly the failed reads`);
  }
  const marked = new Set();
  for (const route of failed) for (const panel of ROUTE_PANELS[route] || []) if (plain.panels[panel].status !== "ok") marked.add(panel);
  for (const panel of Object.keys(plain.panels)) {
    const had = plain.panels[panel];
    const now = card.panels[panel];
    if (marked.has(panel)) {
      w.check(now && now.status === "unavailable" && now.code === "failed", `${label}: a failed read behind the ${panel} panel makes it code failed, not an empty one (got ${JSON.stringify(now && { status: now.status, code: now.code })})`);
      const feeders = [...failed].filter((r) => (ROUTE_PANELS[r] || []).includes(panel));
      const said = String(now && now.reason);
      const named = feeders.find((route) => {
        const r = name.routes.find((x) => x.route === route).fail;
        return said.includes("feed's " + route + " read") && (r.status !== null ? said.includes("HTTP " + r.status) : r.kind === "timeout" ? said.includes("timed out") : said.includes("body that could not be read"));
      });
      w.check(named !== undefined, `${label}: the ${panel} reason names one of the failed routes and what went wrong (${said.slice(0, 100)})`);
    } else {
      w.check(JSON.stringify(now) === JSON.stringify(had), `${label}: a panel no failed read feeds is not touched (${panel})`);
    }
  }
  const top = (c) => JSON.stringify({ ...c, panels: undefined, readFailures: undefined });
  w.check(top(card) === top(plain), `${label}: nothing outside the panels and the failure list changes`);
  const v = validate("card:" + name.ticker, card, { allowSynthetic: true });
  w.check(v.ok, `${label}: a card built from a bad night is still a valid card (${JSON.stringify(v.structural.slice(0, 2))})`);
}

export async function cardScenario(seed, { time = null, rank = null, card: cardMod, coverage = null, reads = "live" } = {}) {
  const w = world(seed, "cards");
  const names = planNight(w, 5);
  const builds = new Map();
  const vendor = reads === "live" ? createVendor({ time, scripts: new Map(names.flatMap((n) => n.routes.map((r) => [r.path, r.script]))) }) : null;
  const realFetch = globalThis.fetch;
  if (vendor) globalThis.fetch = vendor.fetch;
  try {
    for (const name of names) {
      w.log(`night ${name.ticker}: ${name.routes.map((r) => r.route + "=" + r.script.map((f) => f.kind).join(">")).join(" ")}`);
      let feeds;
      let lost;
      if (reads === "live") {
        const run = rank.readDeepFeeds({ ticker: name.ticker, sessionDate: SESSION, surfaceExpiries: ["2026-09-18", "2026-10-16"], spotPx: 100, quantPrep: {}, carried: [] });
        const out = await time.drive(run);
        if (!w.check(!out.hung, `LIVENESS: the reads for ${name.ticker} must settle`)) continue;
        if (!w.check(out.ok, `${name.ticker}: the reads never throw, whatever the feed does (${out.error && out.error.message})`)) continue;
        feeds = out.value;
        lost = feeds.lost;
      } else {
        lost = failuresOf(name);
        feeds = { maxPain: [], surface: [], dpRaw: null, oiRaw: null, termRaw: null, rankRaw: null };
      }
      const inputs = {
        ticker: name.ticker, row: { close: 100, prev_close: 99 }, features: {}, strikes: [], ticks: [], expiries: [], maxPain: feeds.maxPain || [], surface: feeds.surface || [], chain: null,
        darkpool: feeds.dpRaw, oiDeltas: feeds.oiRaw, termStructure: feeds.termRaw, ivRank: feeds.rankRaw, sessionDate: SESSION, generatedAt: SESSION + "T22:00:00Z",
      };
      const card = cardMod.buildCard({ ...inputs, readFailures: lost });
      const plain = cardMod.buildCard(inputs);
      builds.set(name.ticker, card);
      checkCard(w, name, card, plain, reads === "live" ? lost : null);
    }
  } finally {
    globalThis.fetch = realFetch;
  }
  if (coverage && builds.size) {
    const universe = { t: [...builds.keys()], n: builds.size, cols: { px: [...builds.keys()].map(() => 10000) }, units: { px: ["usd", 100] }, sessionDate: SESSION };
    const cards = new Map([...builds].map(([t, card]) => [t, { card, cardX: null, hist: null }]));
    const roster = { depth: Object.fromEntries([...builds.keys()].map((t) => [t, "board"])), session: {}, sessionDate: SESSION };
    const ledger = coverage.coverageLedger({ universe, roster, cards, expected: SESSION });
    for (const [product, counts] of Object.entries(ledger.counts)) {
      w.check(Object.values(counts).reduce((a, b) => a + b, 0) === ledger.n, `CONSERVATION: ${product}'s states add up to the ${ledger.n} names`);
    }
  }
  return { violations: w.violations, checks: w.checks, events: w.events, requests: vendor ? vendor.requests.length : 0 };
}

export { coverageLedger };
