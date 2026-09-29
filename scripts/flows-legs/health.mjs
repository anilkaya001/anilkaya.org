import { easternDay, easternClock, easternInstant, closeMinutes, nextWeekdayDay } from "../../shared/flows-freshness.js";
import { timeMs } from "../../shared/flows-live.js";

export const HEALTH = Object.freeze({
  focusCron: "3-58/5 13-21 * * MON-FRI",
  summaryCron: "15,45 * * * *",
  summaryStaleMin: 75,
  finalReadMin: 10,
  lastPassMin: 30,
  settleMin: 10,
  edge403: 24,
  retrySpentMs: 60_000,
});

export function republishRepair(sessionDate) {
  const next = DAY_RE.test(String(sessionDate || "")) ? nextWeekdayDay(sessionDate) : null;
  const when = next
    ? `before 09:30 ET on ${next}; from that open the pipeline refuses an in-progress session, and after that ` +
      `close it ranks ${next} instead, so ${sessionDate} can no longer be republished`
    : "before the next session's 09:30 ET open";
  return `REPAIR (${when}): GitHub → Actions → flows-pipeline → Run workflow → tick republish_session → ` +
    "Run workflow (from a shell: gh workflow run flows-pipeline.yml -f republish_session=true). Nothing else is needed.";
}

export const DISPATCH_ADVICE = Object.freeze({
  401: "renew GITHUB_DISPATCH_TOKEN",
  403: "give GITHUB_DISPATCH_TOKEN Actions read and write on this repository, or renew it",
  404: "GITHUB_DISPATCH_TOKEN cannot see this repository or its workflow: scope it to this repository (DEPLOY.md 10.0)",
  422: "GitHub rejected the ref or the inputs: check FLOWS_LIVE_REF and the workflow's inputs on main",
  other: "check GITHUB_DISPATCH_TOKEN and the workflow (DEPLOY.md 10.0)",
});

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n) => String(n).padStart(2, "0");

const CHALLENGE_RE = /_cf_chl_opt|\/cdn-cgi\/challenge-platform\/|<title>\s*Just a moment/i;
const BLOCK_RE = /Sorry, you have been blocked|Attention Required! \| Cloudflare|cf-error-details/i;
const CF_CODE_RES = [
  /error[\s_-]?code["']?\s*[:=]?\s*["']?(1\d{3})\b/i,
  /cf-error-code[^>]*>\s*(1\d{3})\b/i,
  /\bError\s+(1\d{3})\b/,
];
const RAYS_KEPT = 3;

const headerOf = (headers, name) => {
  try { return headers && typeof headers.get === "function" ? headers.get(name) : null; } catch { return null; }
};
const cleaned = (value, allowed, max) => {
  if (typeof value !== "string") return null;
  const out = value.replace(allowed, "").trim().slice(0, max);
  return out || null;
};

function cloudflareCode(text) {
  for (const re of CF_CODE_RES) {
    const m = re.exec(text);
    if (m) return m[1];
  }
  return null;
}

function workerErrorCode(text) {
  const body = text.trim();
  if (!body.startsWith("{") || body.length > 16384) return null;
  let parsed;
  try { parsed = JSON.parse(body); } catch { return null; }
  const error = parsed && typeof parsed === "object" ? parsed.error : null;
  if (!error || typeof error !== "object" || typeof error.code !== "string" || typeof error.message !== "string") return null;
  return /^[a-z][a-z0-9_]{0,39}$/.test(error.code) ? error.code : "unnamed";
}

export function refusalOf({ headers = null, text = "" } = {}) {
  const body = typeof text === "string" ? text : "";
  const mitigated = cleaned(String(headerOf(headers, "cf-mitigated") || "").toLowerCase(), /[^a-z_-]/g, 24);
  const seen = {
    mitigated,
    ray: cleaned(headerOf(headers, "cf-ray"), /[^A-Za-z0-9-]/g, 40),
    server: cleaned(headerOf(headers, "server"), /[^A-Za-z0-9 ._/-]/g, 40),
    type: cleaned(String(headerOf(headers, "content-type") || "").split(";")[0].toLowerCase(), /[^a-z0-9.+/-]/g, 60),
  };
  const code = cloudflareCode(body);
  if (!mitigated && !code) {
    const own = workerErrorCode(body);
    if (own) return { kind: "worker", code: own, ...seen };
  }
  if (mitigated === "challenge" || CHALLENGE_RE.test(body)) return { kind: "challenge", code: null, ...seen };
  if (mitigated || code || BLOCK_RE.test(body)) return { kind: "block", code, ...seen };
  return { kind: "unmarked", code: null, ...seen };
}

export const refusalLabel = (seen) => (seen.kind === "block" && seen.code ? `block ${seen.code}` : seen.kind);

export function refusalBrief(seen) {
  if (!seen) return "";
  if (seen.kind === "worker") return `the Worker's own ${seen.code}`;
  return refusalLabel(seen) + (seen.ray ? `, cf-ray ${seen.ray}` : ", no cf-ray");
}

export function refusalTally() {
  return { count: 0, kinds: {}, worker: {}, statuses: {} };
}

export const retriedStatus = (status) => status === 0 || status === 408 || status === 429 || status >= 500;

export function tallyAnswer(tally, response, text = "") {
  const status = response && Number.isInteger(response.status) ? response.status : 0;
  if (!tally || !retriedStatus(status)) return tally;
  const headers = response ? response.headers : null;
  const ray = cleaned(headerOf(headers, "cf-ray"), /[^A-Za-z0-9-]/g, 40);
  const code = cloudflareCode(typeof text === "string" ? text : "");
  const statuses = tally.statuses || (tally.statuses = {});
  const slot = statuses[status] || (statuses[status] = { n: 0, unrayed: 0, rays: [], codes: {}, codeRays: {},
    server: cleaned(headerOf(headers, "server"), /[^A-Za-z0-9 ._/-]/g, 40) });
  slot.n++;
  if (!ray) slot.unrayed++;
  const keep = (list) => { if (ray && list.length < RAYS_KEPT && !list.includes(ray)) list.push(ray); };
  if (code) {
    slot.codes[code] = (slot.codes[code] || 0) + 1;
    keep(slot.codeRays[code] || (slot.codeRays[code] = []));
  } else keep(slot.rays);
  return tally;
}

export function tallyRefusal(tally, seen) {
  if (!tally || !seen) return tally;
  if (seen.kind === "worker") {
    tally.worker[seen.code] = (tally.worker[seen.code] || 0) + 1;
    return tally;
  }
  tally.count++;
  const label = refusalLabel(seen);
  const slot = tally.kinds[label] || (tally.kinds[label] = { kind: seen.kind, code: seen.code, n: 0, rays: [],
    server: seen.server, mitigated: seen.mitigated });
  slot.n++;
  if (!slot.mitigated && seen.mitigated) slot.mitigated = seen.mitigated;
  if (!slot.server && seen.server) slot.server = seen.server;
  if (seen.ray && slot.rays.length < RAYS_KEPT && !slot.rays.includes(seen.ray)) slot.rays.push(seen.ray);
  return tally;
}

const SKIP_RULE = "the Skip rule for /api/flows/ingest in DEPLOY.md 10.0 item 3";
const DAILY_LIMIT = "the Workers Free plan's 100,000 requests a day ran out, and every request to the site counts: " +
  "it resets at 00:00 UTC, and Workers Paid removes the cap (DEPLOY.md 10.0 item 5)";
const WORKER_CODES = Object.freeze({ 1101: "the Worker threw", 1102: "the Worker ran over its CPU or memory limit" });
const rayNote = (slot) => (slot.rays.length ? `; Ray ID ${slot.rays.join(", ")}` : "; no cf-ray");

function blockRemedy(code) {
  if (code === "1027") return DAILY_LIMIT;
  if (code === "1020") return `a WAF custom rule blocks the route: ${SKIP_RULE}, placed above that rule, lets it through`;
  if (code === "1010") {
    return `Browser Integrity Check blocks the route: tick Browser Integrity Check in ${SKIP_RULE}, or turn it off ` +
      "(Security → Settings)";
  }
  if (["1005", "1006", "1007", "1008", "1009"].includes(code)) {
    return "an IP Access rule bans the runner's address, network or country: remove it (Security → WAF → Tools); " +
      "GitHub runners change address from run to run";
  }
  return `find the Ray ID in Security → Events; ${SKIP_RULE} covers custom rules, rate limiting, managed rules, ` +
    "Security Level and Browser Integrity Check, and Bot Fight Mode can only be turned off";
}

const were = (n, one, many) => (n === 1 ? `1 was ${one}` : `${n} were ${many}`);

export function edgeRemedy(label, slot) {
  const n = slot.n;
  if (slot.kind === "challenge") {
    return `HEALTH: ${were(n, "a Cloudflare challenge", "Cloudflare challenges")} ` +
      `(${slot.mitigated ? "cf-mitigated: " + slot.mitigated : "a challenge page, no cf-mitigated"}${rayNote(slot)}), which Bot ` +
      `Fight Mode, a WAF rule or Security Level issue: add ${SKIP_RULE}, with Security Level and Browser Integrity ` +
      "Check ticked; challenges that go on with that rule in place come from Bot Fight Mode, which the Free plan " +
      "cannot skip: turn it off (Security → Settings → Bot traffic)";
  }
  if (slot.kind === "block") {
    return `HEALTH: ${were(n, "a Cloudflare block", "Cloudflare blocks")} (${slot.code ? "error " + slot.code : "no error code"}` +
      `${slot.mitigated ? ", cf-mitigated: " + slot.mitigated : ""}${rayNote(slot)}): ${blockRemedy(slot.code)}`;
  }
  if (slot.kind === "unmarked" && slot.rays.length) {
    return `HEALTH: ${were(n, "a 403", "403s")} with neither a Cloudflare mitigation marker nor the Worker's JSON error ` +
      `(server ${slot.server || "unnamed"}${rayNote(slot)}): find the Ray ID in Security → Events`;
  }
  if (slot.kind === "unmarked") {
    return `HEALTH: ${were(n, "a 403", "403s")} with no cf-ray (server ${slot.server || "unnamed"}), so never through ` +
      "Cloudflare: something between the runner and the edge refused them";
  }
  return `HEALTH: ${were(n, "a 403", "403s")} of an unknown kind (${label}): ${SKIP_RULE}`;
}

const statusSlots = (statuses) => Object.entries(statuses || {}).map(([status, slot]) => [Number(status), slot])
  .filter(([status, slot]) => Number.isInteger(status) && slot && slot.n > 0).sort((a, b) => a[0] - b[0]);
const statusName = (status) => (status ? `HTTP ${status}` : "no answer");
const slotRays = (slot, codes = null) => (codes || [null, ...Object.keys(slot.codeRays || {})])
  .flatMap((c) => (c === null ? slot.rays : (slot.codeRays && slot.codeRays[c]) || []));
const rayList = (slots, pick = null) => [...new Set(slots.flatMap(([, s]) => slotRays(s, pick ? pick(s) : null)))]
  .slice(0, RAYS_KEPT);

function edgeNote(edge403, kinds, worker403, retrySpentMs, statuses) {
  const slots = Object.entries(kinds || {}).filter(([, s]) => s && s.n > 0).sort((a, b) => b[1].n - a[1].n);
  const named = slots.reduce((sum, [, s]) => sum + s.n, 0);
  const parts = slots.map(([label, s]) => `${label} ${s.n}${s.rays.length ? " (cf-ray " + s.rays.join(", ") + ")" : ""}`);
  if (edge403 > named) parts.push(`unclassified ${edge403 - named}`);
  const own = Object.entries(worker403 || {}).filter(([, n]) => n > 0);
  const ownN = own.reduce((sum, [, n]) => sum + n, 0);
  const others = statusSlots(statuses).map(([status, s]) => {
    const bits = Object.entries(s.codes || {}).map(([code, n]) => `error ${code} ${n}`);
    const rays = slotRays(s).slice(0, RAYS_KEPT);
    if (rays.length) bits.push("cf-ray " + rays.join(", "));
    if (status && s.unrayed) bits.push(s.unrayed === s.n ? "no cf-ray" : `${s.unrayed} with no cf-ray`);
    return `${statusName(status)} ${s.n}${bits.length ? " (" + bits.join("; ") + ")" : ""}`;
  });
  return `edge: ${edge403} ingest answer(s) of HTTP 403${parts.length ? " [" + parts.join("; ") + "]" : ""}, ` +
    `${(retrySpentMs / 1000).toFixed(1)} s of retry budget spent` +
    (ownN ? `; not counted: ${ownN} JSON 403(s) from the Worker itself (${own.map(([c, n]) => `${c} ${n}`).join(", ")}), ` +
      "refused by the Worker's own rules, not by the edge" : "") +
    (others.length ? `; other retried answers: ${others.join(", ")}` : "");
}

function statusRemedies(statuses) {
  const slots = statusSlots(statuses);
  const lines = [];
  const codeN = (slot, code) => Math.min((slot.codes && slot.codes[code]) || 0, slot.n - slot.unrayed);
  const through = (test, less = () => 0) => slots.filter(([s]) => s !== 0 && test(s))
    .map(([s, slot]) => [s, { ...slot, n: slot.n - slot.unrayed - less(slot) }]).filter(([, slot]) => slot.n > 0);
  const total = (list) => list.reduce((sum, [, slot]) => sum + slot.n, 0);
  const uncapped = (slot) => [null, ...Object.keys(slot.codeRays || {}).filter((c) => c !== "1027")];
  const rays = (list, pick = uncapped) => (rayList(list, pick).length ? `Ray ID ${rayList(list, pick).join(", ")}` : "no Ray ID kept");
  const capped = through(() => true).map(([s, slot]) => [s, { ...slot, n: codeN(slot, "1027") }]).filter(([, slot]) => slot.n > 0);
  if (capped.length) {
    lines.push(`HEALTH: ${were(total(capped), "an answer with Cloudflare error 1027", "answers with Cloudflare error 1027")} ` +
      `(${capped.map(([s, slot]) => `HTTP ${s} ${slot.n}`).join(", ")}; ${rays(capped, () => ["1027"])}): ${DAILY_LIMIT}`);
  }
  const rate = through((s) => s === 429, (slot) => codeN(slot, "1027"));
  if (rate.length) {
    lines.push(`HEALTH: ${were(total(rate), "an HTTP 429", "HTTP 429s")} through Cloudflare (${rays(rate)}): the ` +
      "Worker never answers the ingest route with 429, so a Cloudflare rate limiting rule refused the runner: " +
      `${SKIP_RULE} skips rate limiting rules`);
  }
  const slow = through((s) => s === 408, (slot) => codeN(slot, "1027"));
  if (slow.length) {
    lines.push(`HEALTH: ${were(total(slow), "an HTTP 408", "HTTP 408s")} through Cloudflare (${rays(slow)}): the ` +
      "Worker never answers the ingest route with 408, so the edge timed out waiting for the runner's request, or a " +
      `Cloudflare rule answers 408: ${SKIP_RULE} covers a rate limiting or custom rule, and a timeout is the network ` +
      "between GitHub and Cloudflare, which the retries absorb");
  }
  const failing = through((s) => s >= 500, (slot) => codeN(slot, "1027"));
  if (failing.length) {
    const glosses = Object.entries(WORKER_CODES).map(([code, gloss]) => [code, gloss,
      failing.reduce((sum, [, slot]) => sum + ((slot.codes && slot.codes[code]) || 0), 0)]).filter(([, , n]) => n > 0);
    lines.push(`HEALTH: ${were(total(failing), "an HTTP 5xx answer", "HTTP 5xx answers")} ` +
      `(${failing.map(([s, slot]) => `${s} ${slot.n}`).join(", ")}; ${rays(failing)}): the ingest route itself ` +
      "failed, so the Worker or D1 was failing, not a Cloudflare rule" +
      glosses.map(([code, gloss, n]) => `; ${n} carried error ${code}: ${gloss}`).join("") +
      "; the ingest lines above name each answer");
  }
  const silent = slots.filter(([s]) => s === 0);
  if (silent.length) {
    lines.push(`HEALTH: ${were(silent[0][1].n, "a request with no usable answer", "requests with no usable answer")} ` +
      "(the connection failed or timed out, or the body was not JSON): the network between the runner and the edge, " +
      "or a Worker that never answered; the ingest lines above name each error");
  }
  const unrayed = slots.filter(([s, slot]) => s !== 0 && slot.unrayed > 0);
  if (unrayed.length) {
    const n = unrayed.reduce((sum, [, slot]) => sum + slot.unrayed, 0);
    const servers = [...new Set(unrayed.map(([, slot]) => slot.server).filter(Boolean))];
    lines.push(`HEALTH: ${n} answer(s) (${unrayed.map(([s, slot]) => `${statusName(s)} ${slot.unrayed}`).join(", ")}) ` +
      `carried no cf-ray (server ${servers.length ? servers.join(", ") : "unnamed"}), so they never passed through ` +
      "Cloudflare: something between the runner and the edge answered them");
  }
  return lines;
}

function edgeFailures(edge403, kinds, retrySpentMs, statuses) {
  if (!(edge403 >= HEALTH.edge403 || retrySpentMs >= HEALTH.retrySpentMs)) return [];
  const spent = `${Math.round(retrySpentMs / 1000)} s of the 90 s budget`;
  const others = statusRemedies(statuses);
  if (!(edge403 > 0)) {
    const head = `HEALTH: ingest retries spent ${spent} with no edge 403`;
    if (others.length) return [head, ...others];
    return [`${head}: the ingest lines above name each answer; a 429 or 408 with a cf-ray is a Cloudflare rate ` +
      `limiting rule or an edge timeout (${SKIP_RULE}), and a 5xx or no answer is the Worker or D1 failing`];
  }
  const slots = Object.entries(kinds || {}).filter(([, s]) => s && s.n > 0).sort((a, b) => b[1].n - a[1].n);
  if (!slots.length) {
    return [`HEALTH: the edge answered ${edge403} ingest request(s) with HTTP 403 and retries spent ${spent}: ` +
      "add the WAF skip rule for /api/flows/ingest (DEPLOY.md 10.0 item 3)", ...others];
  }
  return [`HEALTH: the edge answered ${edge403} ingest request(s) with HTTP 403 and retries spent ${spent}`,
    ...slots.map(([label, slot]) => edgeRemedy(label, slot)), ...others];
}

export const LAB_SIGN_IN = Object.freeze({ warnDays: 120, failDays: 150, goneDays: 180 });
export const LAB_URL = "https://anilkaya.org/lab/";
export const OAUTH_CALLBACK = "https://anilkaya.org/auth/callback";
export const SIGN_IN_ADVICE = `Sign in to the Lab at ${LAB_URL} — Google deletes an OAuth client unused for about ` +
  `six months; keep the callback ${OAUTH_CALLBACK} registered.`;
const DAY_MS = 86400000;
const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);

export function labCheck(clockRead, now) {
  const body = clockRead && !clockRead.failed && !clockRead.absent && clockRead.payload && typeof clockRead.payload === "object"
    ? clockRead.payload : null;
  if (!body) return { note: "lab: the clock could not be read, so the age of the Lab's last Google sign-in is unknown this run" };
  if (!Object.hasOwn(body, "labActiveAt")) {
    return { note: "lab: the Worker does not report the Lab's last Google sign-in (a Worker older than this check)" };
  }
  if (body.labActiveAt === null) {
    return { note: "lab: no Google sign-in to the Lab is on record (no Lab user, or no Lab tables), so the OAuth " +
      `client's idle time cannot be told; one sign-in at ${LAB_URL} starts the count` };
  }
  const at = timeMs(body.labActiveAt);
  if (!Number.isFinite(at)) return { note: "lab: the Worker's labActiveAt is unreadable, so the sign-in age is unknown" };
  const days = Math.max(0, Math.floor((now - at) / DAY_MS));
  const on = (d) => utcDay(at + d * DAY_MS);
  const last = `the latest Google sign-in to the Lab on record is ${utcDay(at)}, ${days} day${days === 1 ? "" : "s"} ago`;
  if (days >= LAB_SIGN_IN.failDays) {
    return { failure: `HEALTH: ${last}. ${SIGN_IN_ADVICE} ` + (days >= LAB_SIGN_IN.goneDays
      ? "Google may already have deleted it: if sign-in fails with deleted_client or invalid_client, create a Web " +
        `application OAuth client (Google Cloud console → APIs & Services → Credentials) with the callback ${OAUTH_CALLBACK}, ` +
        "then wrangler secret put GOOGLE_CLIENT_ID and wrangler secret put GOOGLE_CLIENT_SECRET."
      : `Google deletes it about ${on(LAB_SIGN_IN.goneDays)}.`) };
  }
  if (days >= LAB_SIGN_IN.warnDays) {
    return { warning: `WARNING: ${last}. ${SIGN_IN_ADVICE} This gate turns the nightly red from ${on(LAB_SIGN_IN.failDays)}.` };
  }
  return { note: `lab: the Lab's Google OAuth client was used within the last ${LAB_SIGN_IN.warnDays} days; nothing to do` };
}

export function etTime(ms, day = null) {
  if (!Number.isFinite(ms)) return "never";
  const c = easternClock(ms);
  const d = easternDay(ms);
  return `${day && d !== day ? d + " " : ""}${pad(Math.floor(c.minutes / 60))}:${pad(c.minutes % 60)} ET`;
}

const readFailed = (read) => !read || read.failed;
const said = (read) => (read && read.status ? `HTTP ${read.status}` : "no answer");
const payloadOf = (read) => (read && !read.failed && !read.absent && read.payload && typeof read.payload === "object"
  ? read.payload : null);

export function healthChecks({ sessionDate, now = Date.now(), clockRead = null, marketRead = null,
  focusRead = null, heartbeatRead = null, edge403 = 0, edgeKinds = null, worker403 = null, edgeStatuses = null, retrySpentMs = 0 } = {}) {
  const failures = edgeFailures(edge403, edgeKinds, retrySpentMs, edgeStatuses);
  const notes = [edgeNote(edge403, edgeKinds, worker403, retrySpentMs, edgeStatuses)];
  const warnings = [];
  const lab = labCheck(clockRead, now);
  if (lab.failure) failures.push(lab.failure);
  if (lab.warning) warnings.push(lab.warning);
  if (lab.note) notes.push(lab.note);
  if (typeof sessionDate !== "string" || !DAY_RE.test(sessionDate)) {
    return { applies: false, why: "no session date", failures, warnings, notes };
  }
  const today = easternDay(now);
  if (today !== sessionDate) {
    return { applies: false, why: `this run is for ${sessionDate} and today is ${today}; the live checks describe today`,
      failures, warnings, notes };
  }
  const body = payloadOf(clockRead);
  const clock = body && body.clock && typeof body.clock === "object" ? body.clock : null;
  const sameDay = !!clock && clock.day === sessionDate;
  const closeMin = closeMinutes(sessionDate, sameDay ? clock : null);
  if (easternClock(now).minutes < closeMin + HEALTH.settleMin) {
    return { applies: false, why: `the ${sessionDate} session has not closed`, failures, warnings, notes };
  }
  const close = easternInstant(sessionDate, closeMin);
  const finalBy = close - HEALTH.finalReadMin * 60000;

  if (readFailed(clockRead) || !clock) {
    failures.push(`HEALTH: the Worker's clock could not be read (${readFailed(clockRead) ? said(clockRead) : "no clock"})`);
  } else {
    const tier1 = clock.tier1 && typeof clock.tier1 === "object" ? clock.tier1 : null;
    if (!Object.hasOwn(clock, "summaryAt")) {
      notes.push("the Worker's clock carries no summary telemetry (a Worker older than this check)");
    } else {
      const summaryAt = timeMs(clock.summaryAt);
      if (!Number.isFinite(summaryAt)) {
        failures.push(`HEALTH: the summary cron has never completed a firing (is ${HEALTH.summaryCron} registered? ` +
          "wrangler triggers deploy)");
      } else if (now - summaryAt > HEALTH.summaryStaleMin * 60000) {
        failures.push(`HEALTH: the summary cron last completed a firing at ${etTime(summaryAt, sessionDate)}, more than ` +
          `${HEALTH.summaryStaleMin} minutes before this check (is ${HEALTH.summaryCron} registered? if it is, its firings ` +
          "are dying: the Worker's logs say)");
      }
    }
    if (tier1 && tier1.why === "off") {
      notes.push("FLOWS_LIVE_MODE is off, so the live layer is not checked");
      return { applies: true, why: "live-off", failures, warnings, notes };
    }
    const at = tier1 ? timeMs(tier1.at) : NaN;
    if (!sameDay) {
      failures.push(at >= close
        ? `HEALTH: Tier 1 ticked through ${etTime(at, sessionDate)} but never read the ${sessionDate} session: ` +
          `the Worker's clock still holds ${clock.day}`
        : `HEALTH: Tier 1 never ticked on ${sessionDate}: the Worker's clock still holds ${clock.day}`);
    } else if (clock.trading === 0) {
      failures.push(`HEALTH: Tier 1 closed ${sessionDate} as a holiday, but the vendor printed a ${sessionDate} session`);
    }
    if (!tier1) notes.push("the Worker's clock carries no Tier 1 telemetry (a Worker older than this check)");
    else {
      if (typeof tier1.why === "string" && tier1.why.startsWith("error:")) {
        failures.push(`HEALTH: Tier 1's last tick failed with ${tier1.why}` + (tier1.why === "error:no-key"
          ? ": the Worker has no UW_API_KEY secret (wrangler secret put UW_API_KEY)" : ""));
      }
      if (sameDay && !(at >= close)) {
        failures.push(`HEALTH: Tier 1 last ticked at ${etTime(at, sessionDate)}, before the ${etTime(close)} close`);
      }
    }
    const refused = typeof clock.dispatchWhy === "string" ? /^refused:(4\d\d)$/.exec(clock.dispatchWhy) : null;
    if (refused) {
      failures.push(`HEALTH: GitHub refused the Worker's dispatch (${clock.dispatchWhy}): ` +
        (DISPATCH_ADVICE[refused[1]] || DISPATCH_ADVICE.other));
    } else if (clock.dispatchWhy === "no-token") {
      notes.push("dispatch: the Worker has no GITHUB_DISPATCH_TOKEN, so the Tier 2 loop chains itself and dispatches " +
        "the nightly with its own job token, GitHub's schedules being the backup; a supported mode, not a failure " +
        "(DEPLOY.md 10.0 item 1 and 10.5k)");
    }
  }

  const market = payloadOf(marketRead);
  if (readFailed(marketRead)) failures.push(`HEALTH: live:market could not be read (${said(marketRead)})`);
  else if (!market) failures.push("HEALTH: live:market has never been written");
  else {
    const readAt = timeMs(market.fresh && market.fresh.readAt);
    if (!(readAt >= finalBy)) {
      failures.push(`HEALTH: Tier 1 last wrote live:market at ${etTime(readAt, sessionDate)}, not by ${etTime(finalBy)}`);
    }
  }

  const focus = payloadOf(focusRead);
  if (readFailed(focusRead)) failures.push(`HEALTH: live:focus could not be read (${said(focusRead)})`);
  else if (!focus) {
    failures.push(`HEALTH: live:focus has never been written (is ${HEALTH.focusCron} registered? wrangler triggers deploy)`);
  } else {
    const readAt = timeMs(focus.fresh && focus.fresh.readAt);
    if (!(readAt >= finalBy)) {
      failures.push(`HEALTH: the focus cron last wrote live:focus at ${etTime(readAt, sessionDate)}, not by ` +
        `${etTime(finalBy)} (is ${HEALTH.focusCron} registered? its "live:focus not written" log lines say why a read was kept)`);
    }
  }

  const beat = payloadOf(heartbeatRead);
  const run = beat && beat.run && typeof beat.run === "object" ? beat.run : null;
  if (readFailed(heartbeatRead)) failures.push(`HEALTH: live:heartbeat could not be read (${said(heartbeatRead)})`);
  else if (!beat) failures.push(`HEALTH: no live pass for ${sessionDate}: live:heartbeat is absent`);
  else if (beat.session !== sessionDate) {
    failures.push(`HEALTH: no live pass for ${sessionDate}: the last Tier 2 pass was for ${beat.session || "no session"}`);
  } else if (run) {
    const calls = Number(run.calls) || 0;
    const failedCalls = Number(run.failedCalls) || 0;
    if (!(calls - failedCalls > 0)) {
      failures.push(`HEALTH: the last live pass for ${sessionDate} answered no vendor call (${failedCalls} of ${calls} failed)`);
    }
    const finished = timeMs(run.finishedAt);
    if (!(finished >= close - HEALTH.lastPassMin * 60000)) {
      failures.push(`HEALTH: the last live pass for ${sessionDate} finished at ${etTime(finished, sessionDate)}, ` +
        "so Tier 2 stopped before the close");
    }
  }
  return { applies: true, why: null, failures, warnings, notes };
}

export async function runHealthGate({ sessionDate, read, now = () => Date.now(), edge = null, dry = false,
  annotate = false, log = console.log, warn = console.warn } = {}) {
  if (dry) {
    log("health gate: skipped in a dry run, which reads no store");
    return { applies: false, failures: [], warnings: [], notes: [] };
  }
  const safe = async (key) => {
    try { return await read(key); } catch (error) {
      return { payload: null, failed: true, status: 0, detail: error && error.message ? error.message : String(error) };
    }
  };
  const [clockRead, marketRead, focusRead, heartbeatRead] = [await safe("clock"), await safe("live:market"),
    await safe("live:focus"), await safe("live:heartbeat")];
  const seen = { ...refusalTally(), retrySpentMs: 0, ...(typeof edge === "function" ? edge() : edge) };
  const verdict = healthChecks({ sessionDate, now: now(), clockRead, marketRead, focusRead, heartbeatRead, edge403: seen.count,
    edgeKinds: seen.kinds, worker403: seen.worker, edgeStatuses: seen.statuses, retrySpentMs: seen.retrySpentMs });
  log(`health gate: ${verdict.applies ? "checked" : "live checks skipped — " + verdict.why}; ` +
    `${verdict.failures.length} failure(s)` + (verdict.warnings.length ? `, ${verdict.warnings.length} warning(s)` : ""));
  for (const n of verdict.notes) log("  " + n);
  for (const line of verdict.warnings) warn(annotate ? `::warning title=Lab sign-in::${line}` : line);
  for (const line of verdict.failures) warn(line);
  return verdict;
}
