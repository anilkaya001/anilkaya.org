import { opIdOf, shapeOf } from "../../shared/flows-call-meter.js";
import { ORIGIN } from "./vendor.mjs";
import { world } from "./world.mjs";

export const VOLFLOW = Object.freeze({ paceMs: 150, vendorMs: [40, 420], ingestMs: 2000, lanes: 3, share: 1.2, slackMs: 2000, chainMs: 6000 });

const SESSION = "2026-08-24";
const GENERATED = "2026-08-24T21:45:00Z";
const INGEST = ORIGIN + "/api/flows/ingest";
const pad3 = (n) => String(n % 1000).padStart(3, "0");

const ML_SCRIPTS = [
  [8, () => ({ kind: "short" })],
  [3, () => ({ kind: "full" })],
  [2, () => ({ kind: "full-then-422" })],
  [1, () => ({ kind: "first-422" })],
  [1, () => ({ kind: "first-500" })],
];

const INGEST_SCRIPTS = [
  [14, () => "ok"],
  [1, () => "first-refused"],
  [1, () => "merged-refused"],
];

const json = (body, status = 200) => {
  const text = JSON.stringify(body);
  return new Response(text, { status, headers: { "Content-Type": "application/json", "Content-Length": String(text.length) } });
};

function multiLegAnswer(script, offset) {
  if (script.kind === "first-500") return new Response("internal error", { status: 500, headers: { "Content-Type": "text/plain" } });
  if (script.kind === "first-422" && offset === 0) return json({ error: "unprocessable" }, 422);
  if (script.kind === "full-then-422" && offset > 0) return json({ error: "unprocessable" }, 422);
  const full = script.kind !== "short" && offset === 0;
  const n = full ? 500 : 7;
  return json({ data: Array.from({ length: n }, (_, i) => ({ id: `m${offset}-${i}` })) });
}

export function expectedMultiLeg(plan) {
  const out = { names: 0, full: 0, firstBad: 0, laterBad: 0, codes: {} };
  const add = (code, n) => { out.codes[code] = (out.codes[code] || 0) + n; };
  for (const p of plan) {
    out.names++;
    if (p.ml.kind === "full" || p.ml.kind === "full-then-422") out.full++;
    if (p.ml.kind === "first-500") { out.firstBad++; add("500", 5); }
    if (p.ml.kind === "first-422") { out.firstBad++; add("422", 1); }
    if (p.ml.kind === "full-then-422") { out.laterBad++; add("422", 1); }
  }
  return out;
}

export async function volflowScenario(seed, { time, vendor: mod, flow, store }) {
  const w = world(seed, "volflow");
  const before = mod.wire.snapshot();
  const saved = process.env.FLOWS_INGEST_URL;
  process.env.FLOWS_INGEST_URL = INGEST;
  store.resetPublishRetryBudget();
  mod.raiseReadPace(VOLFLOW.paceMs);
  const base = (seed % 10) * 100;
  const deepN = 16 + w.int(10);
  const crossN = 2 + w.int(4);
  const plan = Array.from({ length: deepN }, (_, i) => ({ ticker: "SYX" + pad3(base + i), deep: true, ml: w.weighted(ML_SCRIPTS)(w), ingest: w.weighted(INGEST_SCRIPTS)(w) }));
  const cross = Array.from({ length: crossN }, (_, i) => ({ ticker: "SYW" + pad3(base + i), deep: false, ml: null, ingest: "ok" }));
  const all = [...plan, ...cross];
  const byTicker = new Map(all.map((p) => [p.ticker, p]));
  const outside = "SYZ" + pad3(base);
  const posts = new Map();
  let attempts = 0;

  const fakeFetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.origin !== ORIGIN) throw new Error("the volflow world refuses a request to " + url.origin);
    if (url.pathname === "/api/flows/ingest") {
      const key = url.searchParams.get("key");
      await new Promise((r) => setTimeout(r, VOLFLOW.ingestMs));
      if (init.method !== "POST") return json({ payload: null }, 404);
      const body = JSON.parse(init.body);
      const list = posts.get(key) || [];
      list.push(body);
      posts.set(key, list);
      const t = key.startsWith("card-x:") ? key.slice(7) : null;
      const p = t ? byTicker.get(t) : null;
      if (p && p.ingest === "first-refused" && list.length === 1) return json({ error: { code: "bad" } }, 400);
      if (p && p.ingest === "merged-refused" && Object.hasOwn(body, "gex")) return json({ error: { code: "bad" } }, 400);
      return json({ ok: true });
    }
    attempts++;
    const op = opIdOf(url.pathname);
    const lo = VOLFLOW.vendorMs[0], hi = VOLFLOW.vendorMs[1];
    await new Promise((r) => setTimeout(r, lo + w.int(hi - lo)));
    if (op === "multi-leg") {
      const p = byTicker.get(url.searchParams.get("ticker_symbol"));
      return multiLegAnswer(p.ml, Number(url.searchParams.get("offset")) || 0);
    }
    return json({ data: [] });
  };

  const card = { panels: { oiDeltas: { status: "ok", rows: [0, 1, 2].map((i) => ({ oc: `SYX000260918C0010${i}000`, diff: 90 - i })) } } };
  const realFetch = globalThis.fetch;
  const quiet = { log: console.log, warn: console.warn };
  globalThis.fetch = fakeFetch;
  console.log = (line) => w.log(line);
  console.warn = (line) => w.log(line);
  const marks = { flowStart: 0, flowEnd: 0 };
  let summary = null, flushed = null;
  try {
    const job = (async () => {
      const keys = new Set(all.map((p) => "card-x:" + p.ticker));
      for (const p of [...all, { ticker: outside }]) {
        const body = { v: 1, ticker: p.ticker, sessionDate: SESSION, generatedAt: GENERATED, vol: { status: "ok", mark: "vol-" + p.ticker } };
        const key = "card-x:" + p.ticker;
        if (keys.has(key)) await store.hold(key, body);
        else await store.publish(key, body);
      }
      marks.flowStart = time.now();
      summary = await flow.runFlowLeg({
        uw: mod.uw, runPooled: mod.runPooled, publish: store.publish,
        stored: (key) => store.publishedStore[key] || null,
        readStored: async () => ({ payload: null, absent: true, status: 200 }),
        sessionDate: SESSION, generatedAt: GENERATED,
        deep: plan.map((p) => p.ticker), cross: cross.map((p) => p.ticker),
        cardOf: () => card, width: VOLFLOW.lanes, log: (line) => w.log(line),
      });
      marks.flowEnd = time.now();
      flushed = await store.flushHeld({ log: (line) => w.log(line) });
    })();
    const out = await time.drive(job, { maxTimers: 2_000_000 });
    w.check(!out.hung, "LIVENESS: the vol-flow stage settles");
    if (out.error) w.check(false, "the vol-flow stage threw: " + out.error.message);
  } finally {
    globalThis.fetch = realFetch;
    console.log = quiet.log;
    console.warn = quiet.warn;
    if (saved === undefined) delete process.env.FLOWS_INGEST_URL;
    else process.env.FLOWS_INGEST_URL = saved;
  }
  if (!summary || !flushed) return { violations: w.violations, checks: w.checks, events: w.events };

  for (const p of all) {
    const list = posts.get("card-x:" + p.ticker) || [];
    const last = list[list.length - 1];
    w.check(list.length >= 1, `card-x:${p.ticker} landed`);
    if (!last) continue;
    w.check(last.vol && last.vol.mark === "vol-" + p.ticker, `card-x:${p.ticker}: the vol section the leg held is in what landed`);
    if (p.ingest === "ok") {
      w.check(list.length === 1, `card-x:${p.ticker}: HELD, NOT WRITTEN TWICE: one write carries the vol and the flow sections, ${list.length} were made`);
      w.check(Object.hasOwn(last, "gex"), `card-x:${p.ticker}: and it carries the flow leg's sections`);
    }
    if (p.ingest === "first-refused") w.check(list.length === 2 && Object.hasOwn(last, "gex"), `card-x:${p.ticker}: a merged write the store refused once is written again whole (${list.length} writes)`);
    if (p.ingest === "merged-refused") w.check(!Object.hasOwn(last, "gex"), `card-x:${p.ticker}: a merged write the store keeps refusing falls back to the held vol payload, so the vol section is never lost`);
    const hist = (posts.get("hist:" + p.ticker) || []).length;
    w.check(p.ingest === "ok" ? hist === 1 : hist === 0, `hist:${p.ticker}: written once after its card-x landed, never after a refused one (${hist})`);
  }
  w.check((posts.get("card-x:" + outside) || []).length === 1, "a vol payload the flow leg does not rewrite is written at once");
  w.check(flushed.held === all.length && flushed.landed + flushed.flushed + flushed.failed === flushed.held && flushed.failed === 0,
    `CONSERVATION: every held key is landed with the flow write or flushed (${JSON.stringify(flushed)})`);
  w.check(store.heldKeys.size === 0, "and nothing is left held");

  const want = expectedMultiLeg(plan);
  const got = summary.multiLeg || {};
  w.check(got.names === want.names && got.full === want.full && got.firstBad === want.firstBad && got.laterBad === want.laterBad,
    `the multi-leg tally ${JSON.stringify(got)} differs from the script ${JSON.stringify(want)}`);
  const after = mod.wire.snapshot();
  const codes = {};
  const wasCodes = (before.ops["multi-leg"] && before.ops["multi-leg"].codes) || {};
  for (const [code, n] of Object.entries((after.ops["multi-leg"] && after.ops["multi-leg"].codes) || {})) {
    if (n - (wasCodes[code] || 0)) codes[code] = n - (wasCodes[code] || 0);
  }
  w.check(JSON.stringify(Object.entries(codes).sort()) === JSON.stringify(Object.entries(want.codes).sort()),
    `the meter files multi-leg's failures by exact code: ${JSON.stringify(codes)} expected ${JSON.stringify(want.codes)}`);
  const first = (after.ops["multi-leg"] && after.ops["multi-leg"].first) || [];
  for (const f of first) {
    w.check(f.t === shapeOf(plan[0].ticker) && Number.isInteger(f.pg) && Number.isInteger(f.a) && !("ticker" in f) && !("url" in f),
      `a failure sample carries the shape, page and attempt and never the ticker or the URL: ${JSON.stringify(f)}`);
  }

  const floor = attempts * VOLFLOW.paceMs;
  const chains = plan.filter((p) => p.ml.kind === "first-500").length;
  const took = marks.flowEnd - marks.flowStart;
  const bound = floor * VOLFLOW.share + VOLFLOW.slackMs + chains * VOLFLOW.chainMs;
  w.check(took <= bound, `PACE-BOUND: the flow leg's ${attempts} vendor calls take at least ${floor} ms at the pace; it took ${took} ms with the store answering in ${VOLFLOW.ingestMs} ms, past the ${Math.round(bound)} ms the lanes allow when no write sits on them`);
  w.log(`${all.length} names, ${attempts} vendor calls, flow ${took} ms against a ${floor} ms pace floor, ${chains} 5xx chain(s)`);
  return { violations: w.violations, checks: w.checks, events: w.events, took, floor, chains };
}
