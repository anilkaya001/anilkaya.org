export const AI_CALL_EPOCH = 2;

export const AI_LENGTH_RETRY_MS = 60 * 60 * 1000;

const CHAT_COMPLETIONS_SCHEMA = /^@cf\/zai-org\//;

export function modelInput(model, messages, { maxTokens, temperature } = {}) {
  if (typeof model === "string" && CHAT_COMPLETIONS_SCHEMA.test(model)) {
    return {
      messages,
      max_completion_tokens: maxTokens,
      temperature,
      chat_template_kwargs: { enable_thinking: false },
    };
  }
  return { messages, max_tokens: maxTokens, temperature };
}

const take = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);

function unthink(text) {
  if (text === null) return { text: null, thought: false };
  const open = /^<think>/i.exec(text);
  if (!open) return { text, thought: false };
  const close = text.search(/<\/think>/i);
  if (close === -1) return { text: null, thought: true };
  return { text: take(text.slice(close + "</think>".length)), thought: true };
}

export function aiText(out) {
  if (!out || typeof out !== "object") return { text: null, finish: null, reasoned: false };
  const choice = Array.isArray(out.choices) && out.choices.length &&
    out.choices[0] && typeof out.choices[0] === "object" ? out.choices[0] : null;
  const message = choice && choice.message && typeof choice.message === "object" ? choice.message : null;
  const finish = choice && typeof choice.finish_reason === "string" ? choice.finish_reason
    : typeof out.finish_reason === "string" ? out.finish_reason : null;
  const raw = take(out.response) || (message && take(message.content)) || (choice && take(choice.text));
  const cut = unthink(raw);
  const reasoned = cut.thought ||
    Boolean(message && (take(message.reasoning_content) || take(message.reasoning))) ||
    Boolean(take(out.reasoning_content) || take(out.reasoning));
  return { text: cut.text, finish, reasoned };
}

export function askFailure(error) {
  const text = error && error.message ? String(error.message) : "";
  const code = /\b(3036|3040|5035|5006)\b/.exec(text);
  switch (code && code[1]) {
    case "3036": return { why: "allowance",
      say: "The free daily allowance for the model is spent for today. It resets at " +
        "00:00 UTC. The readings below were measured by the pipeline and are unaffected." };
    case "3040": return { why: "capacity",
      say: "The model had no capacity for this question just now — nothing was spent, " +
        "and asking again shortly may work. The readings below are unaffected." };
    case "5035": return { why: "plan",
      say: "The model this site uses is no longer available on its plan, which is a " +
        "configuration fault here rather than a limit you reached. The readings below " +
        "were measured by the pipeline and are unaffected." };
    default: return { why: "unreachable",
      say: "The model could not be reached, and it did not say why. The readings below " +
        "were measured by the pipeline and are unaffected." };
  }
}

const envModel = (env, key) => {
  const m = env && typeof env[key] === "string" ? env[key].trim() : "";
  return m === "" ? null : m;
};

export function aiChain(env) {
  const primary = envModel(env, "FLOWS_ASK_MODEL");
  if (primary === null) return [];
  const fallback = envModel(env, "FLOWS_ASK_FALLBACK_MODEL");
  return fallback === null || fallback === primary ? [primary] : [primary, fallback];
}

export function aiCallSignature(env) {
  const joined = aiChain(env).join("|");
  let h = 5381;
  for (let i = 0; i < joined.length; i++) h = (((h << 5) + h) ^ joined.charCodeAt(i)) >>> 0;
  return "ai" + AI_CALL_EPOCH + "." + h.toString(36);
}

function parseRates(raw) {
  const parts = (typeof raw === "string" ? raw : "").split(",").map((x) => Number(x.trim()));
  if (parts.length !== 2 || !parts.every((x) => Number.isFinite(x) && x >= 0)) return null;
  return { inPerM: parts[0], outPerM: parts[1] };
}

export function modelRates(env, model) {
  const [primary, fallback] = aiChain(env);
  if (model === primary) return parseRates(env && env.FLOWS_ASK_NEURONS);
  if (fallback && model === fallback) return parseRates(env && env.FLOWS_ASK_FALLBACK_NEURONS);
  return null;
}

export function primaryRates(env) {
  return parseRates(env && env.FLOWS_ASK_NEURONS);
}

export const AI_DAILY_NEURONS = 10000;

export function spendShape(env, day, calls, tokensIn, tokensOut, byModel) {
  const base = primaryRates(env);
  const rows = Array.isArray(byModel) ? byModel : [];
  let raw = 0;
  let known = base !== null && Array.isArray(byModel);
  let restIn = tokensIn;
  let restOut = tokensOut;
  const models = rows.map((r) => {
    const rates = modelRates(env, r.model);
    restIn -= r.tokensIn;
    restOut -= r.tokensOut;
    if (rates === null) { known = false; return { ...r, neurons: null }; }
    const part = r.tokensIn * rates.inPerM + r.tokensOut * rates.outPerM;
    raw += part;
    return { ...r, neurons: Math.ceil(part / 1e6) };
  });
  if (known) raw += Math.max(0, restIn) * base.inPerM + Math.max(0, restOut) * base.outPerM;

  const neurons = known ? Math.ceil(raw / 1e6) : null;
  return {
    day, calls, tokensIn, tokensOut,
    allowanceNeurons: AI_DAILY_NEURONS,
    neurons,

    remaining: neurons === null ? null : Math.max(0, AI_DAILY_NEURONS - neurons),
    assumesSoleSpender: true,
    byModel: models,
  };
}

export function retryableGuard(guard, ageMs) {
  if (typeof guard !== "string" || !guard.startsWith("unreachable")) return false;
  if (guard === "unreachable:empty") return false;
  if (guard === "unreachable:length") return Number.isFinite(ageMs) && ageMs >= AI_LENGTH_RETRY_MS;
  return true;
}

export const AI_INTRADAY_REFRESH_MS = 45 * 60 * 1000;

export function intradayFloorMs(llm, guard) {
  return !llm && (guard === "unreachable:length" || guard === "unreachable:empty")
    ? AI_LENGTH_RETRY_MS : AI_INTRADAY_REFRESH_MS;
}

const REPLIED_GUARDS = new Set(["invented", "forecast", "unreachable:length", "unreachable:empty"]);

export function repliedGuard(guard) {
  return typeof guard === "string" && REPLIED_GUARDS.has(guard);
}

const stopGuard = (replied) =>
  (replied.some((a) => a.finish === "length") ? "unreachable:length" : "unreachable:empty");

export async function askModels(ai, chain, messages, opts, onUsage) {
  const models = [];
  for (const m of Array.isArray(chain) ? chain : []) {
    if (typeof m === "string" && m && !models.includes(m)) models.push(m);
  }
  const attempts = [];
  for (const model of models) {
    let out;
    try {
      out = await ai.run(model, modelInput(model, messages, opts));
    } catch (error) {
      const failure = askFailure(error);
      attempts.push({ model, text: null, finish: null, reasoned: false, failed: failure.why });
      const replied = attempts.filter((a) => a.failed === null);
      if (replied.length && failure.why !== "allowance") {
        return { text: null, model: replied[0].model, attempts, failure, guard: stopGuard(replied) };
      }
      return { text: null, model, attempts, failure, guard: "unreachable:" + failure.why };
    }
    if (typeof onUsage === "function") {
      try { await onUsage(model, out && out.usage); } catch {  }
    }
    const read = aiText(out);
    attempts.push({ model, text: read.text, finish: read.finish, reasoned: read.reasoned, failed: null });
    if (read.text) return { text: read.text, model, attempts, failure: null, guard: null };
  }
  return {
    text: null,
    model: models.length ? models[0] : null,
    attempts,
    failure: null,
    guard: attempts.length ? stopGuard(attempts) : null,
  };
}

const stopSaid = (a) => (a && a.finish === "length"
  ? "spent its whole answer budget before writing any text"
  : "answered with no text");

export function emptyNote(attempts) {
  const [first, second] = (Array.isArray(attempts) ? attempts : []).filter((a) => a && a.failed === null);
  const head = "The model " + stopSaid(first);
  if (!second) return head;
  return head + (stopSaid(second) === stopSaid(first)
    ? ", and so did the fallback model asked after it"
    : ", and the fallback model asked after it " + stopSaid(second));
}

export function fallbackNote(result) {
  const a = result && Array.isArray(result.attempts) ? result.attempts : [];
  if (a.length < 2 || !result.text) return null;
  const first = a[0];
  return { from: first.model, stop: first.finish === "length" ? "length" : "empty", reasoned: first.reasoned === true };
}
