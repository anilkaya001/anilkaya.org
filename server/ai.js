import { askModels } from "../shared/flows-ai.js";
import {
  AI_REJECT_SLOTS, AI_RETAIN_DAYS, guardOutcome, tokenOf, transportOutcome, foldCounters, isWordingFailure,
} from "../shared/flows-ai-broker.js";

const OUTCOME_SQL =
  "INSERT INTO flows_ai_outcome (day, surface, model, outcome, reason, n, ms_sum, ms_max) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6) " +
  "ON CONFLICT(day, surface, model, outcome, reason) DO UPDATE SET n = n + 1, ms_sum = ms_sum + ?6, ms_max = max(ms_max, ?6)";

const REJECT_SQL =
  "INSERT INTO flows_ai_reject (surface, slot, at, model, reason, culprit) VALUES (?1, " +
  "coalesce((SELECT (slot + 1) % ?6 FROM flows_ai_reject WHERE surface = ?1 ORDER BY at DESC, slot DESC LIMIT 1), 0), ?2, ?3, ?4, ?5) " +
  "ON CONFLICT(surface, slot) DO UPDATE SET at = excluded.at, model = excluded.model, reason = excluded.reason, culprit = excluded.culprit";

const COUNTERS_SQL =
  "SELECT day, surface, model, outcome, reason, n, ms_sum, ms_max FROM flows_ai_outcome WHERE day >= ?1 AND day <= ?2";

const RING_SQL =
  "SELECT surface, slot, at, model, reason, culprit FROM flows_ai_reject ORDER BY at DESC, slot DESC LIMIT " + AI_REJECT_SLOTS;

const PRUNE_SQL = "DELETE FROM flows_ai_outcome WHERE day < ?1";

const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

async function record(env, deps, call, outcome, reason, token) {
  if (!env || !env.DB) return false;
  try {
    await deps.ensureFlowsTables(env);
    const at = deps.now();
    const model = call.model || "none";
    const statements = [env.DB.prepare(OUTCOME_SQL).bind(dayOf(at), call.surface, model, outcome, reason, call.ms)];
    if (isWordingFailure(outcome) && token !== "") {
      statements.push(env.DB.prepare(REJECT_SQL).bind(call.surface, at, model, outcome + (reason ? ":" + reason : ""), token, AI_REJECT_SLOTS));
    }
    if (statements.length === 1) await statements[0].run();
    else await env.DB.batch(statements);
    return true;
  } catch (error) {
    if (typeof deps.failed === "function") deps.failed(error, { surface: call.surface, outcome });
    return false;
  }
}

export async function aiCall(env, deps, request) {
  const { surface, chain, messages, opts, onUsage } = request;
  const started = deps.now();
  const said = await askModels(deps.ai(), chain, messages, opts, onUsage, deps.log);
  const call = {
    surface,
    model: typeof said.model === "string" ? said.model : null,
    ms: Math.max(0, Math.round(deps.now() - started)),
    settled: false,
    outcome: null,
  };
  const finish = async (outcome, reason, token) => {
    call.settled = true;
    call.outcome = outcome;
    return record(env, deps, call, outcome, reason, token);
  };
  call.settle = async (verdict, token = "") => {
    if (call.settled) return false;
    const out = guardOutcome(verdict);
    return finish(out.outcome, out.reason, tokenOf(token));
  };
  const transport = transportOutcome(said);
  if (transport !== null) await finish(transport.outcome, transport.reason, "");
  return { ...said, call };
}

export async function readAiBlock(env, deps, { days = 1 } = {}) {
  const span = Math.min(Math.max(1, Math.trunc(Number(days)) || 1), AI_RETAIN_DAYS - 1);
  const now = deps.now();
  const today = dayOf(now);
  const from = dayOf(now - (span - 1) * 86400000);
  if (!env || !env.DB) return null;
  try {
    await deps.ensureFlowsTables(env);
    const [counters, ring] = await env.DB.batch([
      env.DB.prepare(COUNTERS_SQL).bind(from, today),
      env.DB.prepare(RING_SQL),
    ]);
    return foldCounters(counters && counters.results, ring && ring.results, { days: span, today });
  } catch {
    return null;
  }
}

export async function pruneAiOutcomes(env, now) {
  if (!env || !env.DB) return 0;
  const res = await env.DB.prepare(PRUNE_SQL).bind(dayOf(now - AI_RETAIN_DAYS * 86400000)).run().catch(() => null);
  return res && res.meta ? Number(res.meta.changes) || 0 : 0;
}
