import assert from "node:assert/strict";
import * as K from "../server/http.js";
import { createRouter } from "../server/router.js";
import { flowsAiRows } from "../server/routes/flows-ai.js";
import { memberAllowed } from "../shared/flows-access.js";
import { TICKER_RE } from "../shared/flows-live.js";
import { workerSource, expect, absent, moduleSource } from "./lib/source-scan.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

const SEED = Date.parse("2026-09-25T13:00:00.000Z");
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(SEED); }
  static now() { return SEED; }
};

const origin = "https://anilkaya.org";
const req = (method, path, init = {}) => new Request(origin + path, { method, ...init });
const view = (e) => (e ? { status: e.status, code: e.code, message: e.message, headers: e.headers, details: e.details } : null);
const STUB = new Proxy({}, { get: () => () => null });
const table = createRouter(flowsAiRows(STUB));

eq(table.rows.map((r) => [r.path, r.methods, r.auth]), [
  ["/api/flows/ai-usage", ["GET"], "flows"], ["/api/flows/summary", ["GET"], "flows"],
  ["/api/flows/dossier", ["GET"], "flows"], ["/api/flows/ask", ["POST"], "flows"]], "the flows-ai family is ai-usage, summary and dossier by GET and ask by POST, all behind the Flows session");
ok(table.rows.every((r) => r.id === "flows." + r.path.slice("/api/flows/".length)), "with the ids flows.<name>");

const BRIEFS = {
  none: null,
  good: { payload: JSON.stringify({ sessionDate: "2026-09-24", facts: [1] }), updatedAt: 77 },
  bad: { payload: "not json", updatedAt: 5 },
  failed: "failed",
};
const BOARDS = {
  none: null,
  plain: { text: "Quiet.", llm: false, model: null, guard: null, generatedAt: "2026-09-24T21:00:00Z" },
  model: { text: "Busy.", llm: true, model: "@cf/x", guard: "clear", generatedAt: "2026-09-25T12:00:00Z" },
};

function scenario({ brief = "none", board = "none", questionFails = false, askBody = null } = {}) {
  const log = [];
  const rec = (name, ...args) => log.push([name, ...args]);
  const deps = {
    askSpend: async (env) => { rec("askSpend"); return { calls: 3 }; },
    summaryResponse: async (env, ctx, ticker, session) => { rec("summaryResponse", ctx && ctx.tag, ticker, session && session.username); return K.json({ ticker, reading: true }); },
    readFlowsSummary: async (env, scope) => { rec("readFlowsSummary", scope); return BOARDS[board]; },
    neuronProvenance: (summary) => { rec("neuronProvenance", summary.text); return "prov:" + summary.text; },
    ensureFlowsTables: async () => { rec("ensureFlowsTables"); },
    dossierResponse: async (env, ctx, ticker, url, session) => { rec("dossierResponse", ctx && ctx.tag, ticker, url.search, session && session.username); return K.json({ ticker, dossier: true }); },
    askQuestion: async (request) => {
      rec("askQuestion", request.method);
      if (questionFails) throw new K.HttpError(400, "invalid_question", "Ask a question");
      return askBody || { question: "what is the market doing", subject: "" };
    },
    askAnswer: async (asked, env, index, updatedAt, subject, ctx, session) => { rec("askAnswer", asked, index, updatedAt, subject, ctx && ctx.tag, session && session.username); return K.json({ answered: asked }); },
    readFlowsPayload: async (env, key, trace) => {
      rec("readFlowsPayload", key);
      if (brief === "failed") { trace.failed = true; return null; }
      return BRIEFS[brief];
    },
    briefWithLive: async (env, index) => { rec("briefWithLive", index); return { index: { ...index, live: true }, overlay: null }; },
    askFloodPeriodS: 60,
  };
  return { log, deps };
}

async function reference(path, rc, d) {
  const { request, env, ctx, url, session } = rc;
  const { json, HttpError, requireTicker, requireSameOrigin, tickerParam } = K;
  const askSpend = d.askSpend;
  if (path === "/api/flows/ai-usage") {
    return json({ spend: await askSpend(env) });
  }
  if (path === "/api/flows/summary") {
    const subject = tickerParam(url);
    if (subject !== "") {
      if (!TICKER_RE.test(subject)) {
        throw new HttpError(400, "invalid_ticker", "Unknown ticker");
      }
      return d.summaryResponse(env, ctx, subject, session);
    }

    const summary = await d.readFlowsSummary(env, "board");
    if (summary === null) {
      return json({ status: "pending", scope: "board", summary: null, llm: false, model: null,
        guard: null, generatedAt: null, provenance: null,
        note: "No summary has been generated for this session yet. Nothing is claimed " +
          "about the market by that — it says the briefing has not been published, " +
          "not that the session was quiet." });
    }
    return json({ status: "ok", scope: "board", summary: summary.text, llm: summary.llm,
      model: summary.model, guard: summary.guard, generatedAt: summary.generatedAt,
      provenance: d.neuronProvenance(summary) });
  }
  if (path === "/api/flows/dossier") {
    const ticker = requireTicker(url);
    await d.ensureFlowsTables(env);
    return d.dossierResponse(env, ctx, ticker, url, session);
  }
  if (path === "/api/flows/ask") {
    requireSameOrigin(request);
    const { question: asked, subject: onPage } = await d.askQuestion(request);
    if (!(await memberAllowed(env.AI_ASK, session))) {
      throw new HttpError(429, "rate_limited", "Too many questions in the last minute; ask again shortly.",
        { "Retry-After": String(d.askFloodPeriodS) });
    }

    const trace = {};
    const stored = await d.readFlowsPayload(env, "brief", trace);

    if (stored === null) {
      return json({ status: trace.failed ? "unreadable" : "pending", question: asked,
        answer: null, llm: false, facts: [], guard: null, model: null,
        spend: await askSpend(env),
        note: trace.failed
          ? "The briefing could not be read from the store, so no answer is offered. " +
            "That is a fault on this site rather than a fact about the session."
          : "The briefing has not been published for this session yet, so there is " +
            "nothing measured to answer from. Nothing is claimed about the market by that." });
    }
    let index;
    try {
      index = JSON.parse(stored.payload);
    } catch {
      throw new HttpError(500, "brief_unreadable",
        "The briefing was published and could not be read, so no answer is offered. " +
        "That is a fault on this site rather than a fact about the session.");
    }
    return d.askAnswer(asked, env, (await d.briefWithLive(env, index)).index, stored.updatedAt, onPage, ctx, session);
  }
  throw new Error("no reference for " + path);
}

async function outcome(run) {
  try {
    const res = await run();
    return { status: res.status, headers: [...res.headers].sort(), body: await res.text() };
  } catch (e) {
    return { threw: view(e) };
  }
}

const limiters = {
  absent: undefined,
  allow: { limit: async () => ({ success: true }) },
  deny: { limit: async () => ({ success: false }) },
  down: { limit: async () => { throw new Error("limiter down"); } },
};
const SUMMARY_QS = ["", "?t=", "?t=NVDA", "?t=nvda", "?t=%20nvda%20", "?t=BRK.B", "?t=NOT%20A%20TICKER", "?t=%3Cscript%3E", "?t=A&t=B"];
const DOSSIER_QS = ["", "?t=NVDA", "?t=nvda&render=1", "?t=NVDA&budget=900", "?t=", "?t=NOT%20A%20TICKER"];
const ASK_INIT = {
  plain: { headers: { "Content-Type": "application/json" } },
  same: { headers: { "Content-Type": "application/json", Origin: origin } },
  foreign: { headers: { "Content-Type": "application/json", Origin: "https://evil.example" } },
  crossSite: { headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "cross-site" } },
  sameSite: { headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin" } },
};

const CASES = [];
CASES.push({ path: "/api/flows/ai-usage", q: "", method: "GET" });
for (const q of SUMMARY_QS) for (const board of Object.keys(BOARDS)) CASES.push({ path: "/api/flows/summary", q, method: "GET", sc: { board } });
for (const q of DOSSIER_QS) CASES.push({ path: "/api/flows/dossier", q, method: "GET" });
for (const brief of Object.keys(BRIEFS)) {
  for (const [iname, init] of Object.entries(ASK_INIT)) {
    for (const lname of Object.keys(limiters)) {
      for (const questionFails of [false, true]) {
        CASES.push({ path: "/api/flows/ask", q: "", method: "POST", init, sc: { brief, questionFails }, env: { AI_ASK: limiters[lname] }, label: `${brief}/${iname}/${lname}/${questionFails}` });
      }
    }
  }
}
CASES.push({ path: "/api/flows/ask", q: "", method: "POST", init: ASK_INIT.plain, sc: { brief: "good", askBody: { question: "what about NVDA", subject: "NVDA" } }, env: {}, label: "subject" });

{
  let compared = 0;
  for (const c of CASES) {
    for (const session of [{ username: "anilkaya" }, { username: "guest" }, null]) {
      const mk = () => {
        const sc = scenario(c.sc);
        const full = c.path + c.q;
        return { sc, rc: { request: req(c.method, full, c.init), env: { tag: "env", ...(c.env || {}) }, url: new URL(origin + full), ctx: { tag: "ctx" }, session } };
      };
      const a = mk();
      const b = mk();
      const rows = createRouter(flowsAiRows(a.sc.deps));
      const got = await outcome(() => rows.find(c.path).handler(a.rc));
      const want = await outcome(() => reference(c.path, b.rc, b.sc.deps));
      const tag = `${c.path}${c.q} ${c.label || ""} as ${session && session.username}`;
      assert.deepEqual(got, want, tag);
      assert.deepEqual(a.sc.log, b.sc.log, tag + ": the same calls in the same order");
      compared++;
      checks += 2;
    }
  }
  ok(compared >= 300, "every row was compared with the code it replaced over the parameter grid: " + compared);
}

{
  const { log, deps } = scenario({ brief: "good" });
  const rows = createRouter(flowsAiRows(deps));
  const rc = (method, path, init, env = {}) => ({ request: req(method, path, init), env, url: new URL(origin + path), ctx: { tag: "c" }, session: { username: "m" } });
  const res = await rows.find("/api/flows/ask").handler(rc("POST", "/api/flows/ask", ASK_INIT.same));
  eq(await res.json(), { answered: "what is the market doing" }, "an ask over a stored briefing is answered from that briefing with the live overlay");
  eq(log.map((x) => x[0]), ["askQuestion", "readFlowsPayload", "briefWithLive", "askAnswer"], "after the same-origin check, the question, the limiter and the briefing are read in that order");
  eq(log[1], ["readFlowsPayload", "brief"], "from the brief key");
  eq(log[3].slice(1, 5), ["what is the market doing", { sessionDate: "2026-09-24", facts: [1], live: true }, 77, ""], "the answer gets the live-overlaid index and the stored time");
  log.length = 0;
  const denied = await outcome(() => rows.find("/api/flows/ask").handler(rc("POST", "/api/flows/ask", ASK_INIT.same, { AI_ASK: limiters.deny })));
  eq(denied.threw, { status: 429, code: "rate_limited", message: "Too many questions in the last minute; ask again shortly.", headers: { "Retry-After": "60" }, details: undefined }, "a member past the flood brake is 429 with Retry-After from the injected period");
  eq(log.map((x) => x[0]), ["askQuestion"], "after the question is read and before the briefing is");
  const foreign = await outcome(() => rows.find("/api/flows/ask").handler(rc("POST", "/api/flows/ask", ASK_INIT.foreign)));
  eq([foreign.threw.status, foreign.threw.code], [403, "forbidden"], "a foreign origin is 403 before the body is read");
}

{
  const gateCalls = [];
  const gates = { flows: async (request, env) => { gateCalls.push(request.method); return env.user || null; } };
  const { deps, log } = scenario();
  const r = createRouter(flowsAiRows(deps));
  const rc = (method, path, env = {}) => ({ request: req(method, path), env, url: new URL(origin + path), ctx: {} });
  for (const [path, allowed, wrong] of [
    ["/api/flows/ai-usage", "GET", ["POST", "PUT", "DELETE", "PATCH", "HEAD"]],
    ["/api/flows/summary?t=NVDA", "GET", ["POST", "PUT", "DELETE", "PATCH", "HEAD"]],
    ["/api/flows/dossier?t=NVDA", "GET", ["POST", "PUT", "DELETE", "PATCH", "HEAD"]],
    ["/api/flows/ask", "POST", ["GET", "PUT", "DELETE", "PATCH", "HEAD"]],
  ]) {
    gateCalls.length = 0;
    for (const method of wrong) {
      let e = null;
      try { await r.handle(rc(method, path, { user: { username: "u" } }), gates); } catch (x) { e = x; }
      eq([e && e.status, e && e.code, e && e.headers], [405, "method_not_allowed", { Allow: allowed }], method + " " + path + " is 405 with Allow: " + allowed);
    }
    eq(gateCalls, [], path + ": the method gate runs before the session is read");
    let anon = null;
    try { await r.handle(rc(allowed, path), gates); } catch (x) { anon = x; }
    eq([anon && anon.status, anon && anon.code, anon && anon.message], [401, "unauthorized", "Authentication required"], path + ": an anonymous caller is 401");
    eq(log.length, 0, path + ": and nothing ran for it");
  }
}

{
  const w = workerSource();
  const text = moduleSource("worker.js");
  expect(w, /createRouter\(flowsReadRows\([\s\S]*?\),\s*flowsDeskRows\(\{[\s\S]*?\}\),\s*flowsAiRows\(\{/, { min: 1, max: 1, why: "the Worker's one table takes the flows-ai family after the desk family" });
  expect(text, /ROUTER\.handle\(/, { min: 1, max: 1, why: "and is consulted once" });
  for (const r of table.rows) {
    absent(text, new RegExp('path === "' + r.path.replace(/[-/]/g, "\\$&") + '"'), { anchor: /path === "\/api\/flows\/lk"/, why: r.path + " is a table row and no longer a branch of the chain" });
  }
  ok(/requireMethod\(request, \["GET"\]\);\s*const session = await currentFlowsUser\(request, env\);/.test(text),
    "the prefix block's method gate is GET alone now that ask is a POST row, still before the session gate");
  expect(text, /const ASK_FLOOD_PERIOD_S = 60;/, { min: 1, max: 1, why: "the flood period stays a Worker constant the contract reads, injected into the family" });
  const src = moduleSource("server/routes/flows-ai.js");
  ok(!/\benv\.AI\b|\bcappedAi\b|\bmeteredAi\b|\baskModels\b|\bai\.run\b/.test(src), "the family never touches the model binding: every model call stays behind the injected helpers and cappedAi");
  ok(!/from "\.\.\/\.\.\/worker\.js"|cloudflare:/.test(src), "and imports neither the Worker nor the platform");
  expect(w, /askModels\(meteredAi\(env\)/, { min: 4, max: 4, why: "all four metered call sites are still found in the Worker's closure after the move" });
  expect(w, /async function summaryResponse\(/, { min: 1, max: 1, why: "the helpers the rows call stay one copy each in the Worker" });
}

globalThis.Date = RealDate;
console.log(`server-ai: ${checks} checks`);
