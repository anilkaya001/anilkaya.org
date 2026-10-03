import { aiChain, aiCallSignature, askModels, modelRates, AI_INTRADAY_REFRESH_MS, AI_LENGTH_RETRY_MS } from "./flows-ai.js";
import {
  READING_VERSION, READING_MAX_TOKENS, READING_TEMPERATURE, heldTags, readingFallback, readingShape, absentShape, hasSubstance, renderForReading, promptForReading,
  parseReading, vetReading, askPick, ASK_QUOTE_RULE, SECTION_CAPS,
} from "./flows-reading.js";
import { KINDS } from "./flows-dossier.js";

export const READ_SCOPE = "read:";
export const READ_GENERATING_MS = 90 * 1000;
export const READ_BOX_MS = 1500;
export const READ_BUDGET_SHARE = 0.75;

export const READ_COOLDOWN_MS = Object.freeze({
  "read:refused": 20 * 60 * 1000,
  "read:unparsable": 20 * 60 * 1000,
  "read:overlong": 20 * 60 * 1000,
  "unreachable:budget": 30 * 60 * 1000,
  "unreachable:allowance": 30 * 60 * 1000,
  "unreachable:capacity": 5 * 60 * 1000,
  "unreachable:unreachable": 5 * 60 * 1000,
  "unreachable:plan": 60 * 60 * 1000,
  "unreachable:empty": AI_LENGTH_RETRY_MS,
  "unreachable:length": AI_LENGTH_RETRY_MS,
});

export const READ_COOLDOWN_DEFAULT_MS = 10 * 60 * 1000;

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

export function readMode(env) {
  const raw = env && typeof env.FLOWS_READ_MODE === "string" ? env.FLOWS_READ_MODE.trim().toLowerCase() : "";
  return raw === "off" ? "off" : "on";
}

export const cooldownMs = (guard) => (Object.hasOwn(READ_COOLDOWN_MS, guard) ? READ_COOLDOWN_MS[guard] : READ_COOLDOWN_DEFAULT_MS);

export function readSignature(env) {
  return aiCallSignature(env) + "|r" + READING_VERSION;
}

const fingerprintOf = (dossier, env) => dossier.fingerprint + "|" + readSignature(env);

export function neuronCost(env, model, usage) {
  const rates = modelRates(env, model);
  if (!rates || !isObj(usage)) return null;
  const tin = Math.max(0, Math.round(Number(usage.prompt_tokens) || 0));
  const tout = Math.max(0, Math.round(Number(usage.completion_tokens) || 0));
  return { neurons: Math.ceil((tin * rates.inPerM + tout * rates.outPerM) / 1e6), tokensIn: tin, tokensOut: tout };
}

function storedFrom(row) {
  if (!row || typeof row !== "object") return null;
  let body = null;
  try { body = JSON.parse(typeof row.ideas === "string" ? row.ideas : "null"); } catch { body = null; }
  const at = typeof row.generated_at === "string" ? Date.parse(row.generated_at) : NaN;
  const kind = isObj(body) && body.kind === "reading" ? body : null;
  return {
    fingerprint: typeof row.fingerprint === "string" ? row.fingerprint : "",
    llm: row.llm === 1,
    guard: typeof row.guard === "string" ? row.guard : null,
    model: typeof row.model === "string" ? row.model : null,
    at: Number.isFinite(at) ? at : null,
    shape: kind && isObj(kind.shape) ? kind.shape : null,
    refused: kind && Array.isArray(kind.refused) ? kind.refused : [],
  };
}

const good = (s) => s !== null && s.llm === true && s.shape !== null && s.guard !== "generating";

function readyFrom(stored, extra) {
  return { ...stored.shape, status: "ready", generated: true, label: "Model wording", generatedAt: stored.shape.generatedAt || (stored.at ? new Date(stored.at).toISOString() : null), ...(extra || {}) };
}

function fallbackProvenance(why, describe, guard) {
  switch (why) {
    case "off": return "Deterministic reading: assembled from templates over the dossier's facts. Model wording is switched off on this site.";
    case "no-model": return "Deterministic reading: assembled from templates over the dossier's facts. No model is configured for this site.";
    case "generating": return "Deterministic reading: assembled from templates over the dossier's facts while a model writes its wording. The model's wording replaces this only if every sentence of it passes the checks against the facts it cites.";
    case "store": return "Deterministic reading: assembled from templates over the dossier's facts. The store could not record a request for model wording, so none was made.";
    case "cooldown": {
      if (guard === "read:refused") return "Deterministic reading: a model's wording for this dossier was refused by the checks against its facts, and the next attempt waits a short while.";
      if (guard === "read:unparsable") return "Deterministic reading: a model's reply could not be read as the required shape, and the next attempt waits a short while.";
      if (guard === "read:overlong") return "Deterministic reading: a model's reply was longer than the limit, and the next attempt waits a short while.";
      return typeof describe === "function" ? describe(guard) : "Deterministic reading: no model wording is available.";
    }
    default: return "Deterministic reading: assembled from templates over the dossier's facts.";
  }
}

function readyProvenance(label, cost, refusedCount) {
  return "Model wording by " + label + ", checked sentence by sentence against the facts it cites; every figure was copied from them." +
    (cost && isNum(cost.neurons) ? " It cost " + cost.neurons + " neurons." : " Its cost was not reported.") +
    (refusedCount ? " " + refusedCount + " part" + (refusedCount === 1 ? "" : "s") + " of its answer " + (refusedCount === 1 ? "was" : "were") + " refused and left out." : "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const BOXED = Symbol("boxed");

const flights = new Map();

async function generate({ env, deps, ticker, dossier, tags, fingerprint, startedAt, chain }) {
  const scope = READ_SCOPE + ticker;
  const store = (summary, shape, llm, model, guard, refused) => deps.write(scope, fingerprint, summary, { v: 1, kind: "reading", shape, refused: refused || [] }, llm, model, guard, startedAt).catch(() => {});
  const rendered = renderForReading(dossier);
  const prompt = promptForReading(dossier, tags, rendered);
  let used = null;
  let billed = null;
  const said = await askModels(deps.ai(), chain, [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }],
    { maxTokens: READING_MAX_TOKENS, temperature: READING_TEMPERATURE },
    async (model, usage) => {
      billed = model;
      used = usage;
      if (typeof deps.recordSpend === "function") await deps.recordSpend(model, usage);
    });
  if (!said.text) {
    await store("", null, false, said.model, said.guard || "unreachable:empty", []);
    return { stored: "failed", guard: said.guard || "unreachable:empty" };
  }
  if (said.text.length > SECTION_CAPS.reply) {
    await store("", null, false, said.model, "read:overlong", []);
    return { stored: "failed", guard: "read:overlong" };
  }
  const parsed = parseReading(said.text);
  if (parsed === null) {
    await store("", null, false, said.model, "read:unparsable", []);
    return { stored: "failed", guard: "read:unparsable" };
  }
  const vet = vetReading(parsed, dossier, tags, { shown: prompt.shown, rendered: prompt.user });
  if (!vet.ok) {
    await store("", null, false, said.model, "read:refused", vet.refused.slice(0, 16));
    return { stored: "failed", guard: "read:refused", refused: vet.refused };
  }
  const sections = { ...vet.sections };
  if (sections.identity === null) {
    const fb = readingFallback(dossier, tags);
    if (fb.identity) sections.identity = { ...fb.identity, template: true };
  }
  const cost = neuronCost(env, billed || said.model, used);
  const label = deps.modelLabel ? deps.modelLabel(billed || said.model) : billed || said.model;
  const refusedCount = vet.refused.filter((x) => x.section !== "tags").length;
  const shape = readingShape({
    dossier, tags, sections, chosen: vet.tags, status: "ready", generated: true, model: billed || said.model, modelLabel: label,
    neurons: cost ? cost.neurons : null, tokens: cost ? { in: cost.tokensIn, out: cost.tokensOut } : null,
    provenance: readyProvenance(label, cost, refusedCount), generatedAt: startedAt, refused: vet.refused,
  });
  await store(vet.sections.identity ? vet.sections.identity.text : vet.sections.now.text, shape, true, billed || said.model, refusedCount ? "read:trimmed:" + refusedCount : null, vet.refused.slice(0, 16));
  return { stored: "ready", shape };
}

function fallbackShape({ dossier, tags, env, status, why, describe, guard, note, retryAfterS }) {
  const sections = readingFallback(dossier, tags);
  const shape = readingShape({ dossier, tags, sections, chosen: sections.tags, status, generated: false, provenance: fallbackProvenance(why, describe, guard), note: note || null, why });
  return retryAfterS ? { ...shape, retryAfterS } : shape;
}

function absentFrom(dossier, ticker) {
  const sections = readingFallback(dossier, []);
  return absentShape(ticker, {
    status: "absent", why: "nothing",
    note: "Nothing is held for " + ticker + " that a reading can be written from.",
    provenance: "Deterministic reading: no packet of the dossier holds anything to read, so every packet is named unknown.",
    fingerprint: dossier.fingerprint, asOf: dossier.asOf,
    coverage: { ok: 0, partial: 0, withheld: dossier.coverage ? (dossier.coverage.withheld || 0) + (dossier.coverage.unavailable || 0) : 0, pending: dossier.coverage ? dossier.coverage.pending || 0 : 0 },
    unknown: sections.unknown,
  });
}

export async function readingFor(env, ctx, ticker, deps, opts = {}) {
  const now = isNum(opts.now) ? opts.now : Date.now();
  const mode = readMode(env);
  const chain = aiChain(env);
  const canModel = mode === "on" && Boolean(env && env.AI) && chain.length > 0 && Boolean(env && env.DB);
  const scope = READ_SCOPE + ticker;
  const signature = readSignature(env);

  let stored = null;
  let storeDown = false;
  if (canModel) {
    try { stored = storedFrom(await deps.readRow(scope)); } catch { storeDown = true; }
  }
  const ageMs = stored && stored.at !== null ? now - stored.at : Infinity;

  if (canModel && good(stored) && stored.fingerprint.endsWith("|" + signature) && ageMs < AI_INTRADAY_REFRESH_MS) {
    return readyFrom(stored, { held: "floor" });
  }

  const assembling = Promise.resolve(deps.assemble({ own: true, now }));
  let result;
  if (isNum(opts.boxMs) && opts.boxMs > 0) {
    const raced = await Promise.race([assembling, sleep(opts.boxMs).then(() => BOXED)]);
    if (raced === BOXED) {
      const keep = assembling.catch(() => {});
      if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(keep);
      return absentShape(ticker, { status: "generating", why: "assembling", note: "The dossier for " + ticker + " is still being assembled.",
        provenance: "The dossier is being assembled from what the nightly, the live layer and the vendor hold; the reading follows it." });
    }
    result = raced;
  } else {
    result = await assembling;
  }
  const dossier = result.dossier;
  if (!hasSubstance(dossier)) return absentFrom(dossier, ticker);
  const tags = heldTags(dossier);
  const fingerprint = fingerprintOf(dossier, env);
  const describe = deps.describeGuard;
  const fb = (status, why, extra) => fallbackShape({ dossier, tags, env, status, why, describe, ...(extra || {}) });

  if (mode === "off") return fb("fallback", "off");
  if (!canModel) return fb("fallback", "no-model");
  if (storeDown) return fb("fallback", "store");

  if (good(stored) && stored.fingerprint === fingerprint) return readyFrom(stored, { held: "fingerprint" });

  if (stored && stored.guard === "generating" && ageMs < READ_GENERATING_MS) return fb("generating", "generating");

  if (stored && !good(stored) && stored.guard !== "generating" && stored.guard) {
    const wait = cooldownMs(stored.guard);
    if (ageMs < wait) return fb("fallback", "cooldown", { guard: stored.guard, retryAfterS: Math.ceil((wait - ageMs) / 1000) });
  }

  if (flights.has(ticker)) return fb("generating", "generating");

  const marked = await deps.mark(scope, fingerprint, chain[0]);
  if (marked.failed) return fb("fallback", "store");
  if (!marked.startedAt) return fb("generating", "generating");

  const work = generate({ env, deps, ticker, dossier, tags, fingerprint, startedAt: marked.startedAt, chain })
    .catch((error) => {
      console.error(JSON.stringify({ message: "reading failed", ticker, error: error instanceof Error ? error.message : String(error) }));
      return deps.write(scope, fingerprint, "", { v: 1, kind: "reading", shape: null, refused: [] }, false, chain[0], "unreachable:unreachable", marked.startedAt).catch(() => {});
    })
    .finally(() => { if (flights.get(ticker) === work) flights.delete(ticker); });
  flights.set(ticker, work);
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(work); else await work;
  return fb("generating", "generating");
}

export async function readingSafe(env, ctx, ticker, deps, opts) {
  try {
    return await readingFor(env, ctx, ticker, deps, opts);
  } catch (error) {
    console.error(JSON.stringify({ message: "reading unavailable", ticker, error: error instanceof Error ? error.message : String(error) }));
    return absentShape(ticker, { status: "unavailable", why: "error", note: "The reading for " + ticker + " could not be built.",
      provenance: "Deterministic reading: it could not be built, which is a fault on this side and not a fact about the name." });
  }
}

export async function askDossierFor(ticker, question, deps) {
  const result = await deps.assemble({ own: false });
  const dossier = result.dossier;
  if (!hasSubstance(dossier)) return { facts: [], promptFacts: [], about: null, silent: KINDS.slice(), rule: ASK_QUOTE_RULE };
  const pick = askPick(dossier, question, {});
  return { facts: pick.facts, promptFacts: pick.promptFacts, about: pick.about, silent: pick.silent, rule: ASK_QUOTE_RULE, fingerprint: dossier.fingerprint };
}

export function readingFlightsPending() {
  return flights.size;
}

