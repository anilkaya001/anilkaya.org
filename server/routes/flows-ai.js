import { HttpError, json, requireSameOrigin, requireTicker, tickerParam } from "../http.js";
import { memberAllowed } from "../../shared/flows-access.js";
import { TICKER_RE } from "../../shared/flows-live.js";

const row = (name, methods, handler) => ({ id: "flows." + name, path: "/api/flows/" + name, methods, auth: "flows", handler });

export function flowsAiRows(deps) {
  const { askSpend, summaryResponse, readFlowsSummary, neuronProvenance, ensureFlowsTables, dossierResponse, askQuestion, askAnswer,
    readFlowsPayload, briefWithLive, askFloodPeriodS } = deps;

  const aiUsage = async ({ env }) => json({ spend: await askSpend(env) });

  const summary = async ({ env, ctx, url, session }) => {
    const subject = tickerParam(url);
    if (subject !== "") {
      if (!TICKER_RE.test(subject)) {
        throw new HttpError(400, "invalid_ticker", "Unknown ticker");
      }
      return summaryResponse(env, ctx, subject, session);
    }

    const board = await readFlowsSummary(env, "board");
    if (board === null) {
      return json({ status: "pending", scope: "board", summary: null, llm: false, model: null,
        guard: null, generatedAt: null, provenance: null,
        note: "No summary has been generated for this session yet. Nothing is claimed " +
          "about the market by that — it says the briefing has not been published, " +
          "not that the session was quiet." });
    }
    return json({ status: "ok", scope: "board", summary: board.text, llm: board.llm,
      model: board.model, guard: board.guard, generatedAt: board.generatedAt,
      provenance: neuronProvenance(board) });
  };

  const dossier = async ({ env, ctx, url, session }) => {
    const ticker = requireTicker(url);
    await ensureFlowsTables(env);
    return dossierResponse(env, ctx, ticker, url, session);
  };

  const ask = async ({ request, env, ctx, session }) => {
    requireSameOrigin(request);
    const { question: asked, subject: onPage } = await askQuestion(request);
    if (!(await memberAllowed(env.AI_ASK, session))) {
      throw new HttpError(429, "rate_limited", "Too many questions in the last minute; ask again shortly.",
        { "Retry-After": String(askFloodPeriodS) });
    }

    const trace = {};
    const stored = await readFlowsPayload(env, "brief", trace);

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
    return askAnswer(asked, env, (await briefWithLive(env, index)).index, stored.updatedAt, onPage, ctx, session);
  };

  return [
    row("ai-usage", ["GET"], aiUsage),
    row("summary", ["GET"], summary),
    row("dossier", ["GET"], dossier),
    row("ask", ["POST"], ask),
  ];
}
