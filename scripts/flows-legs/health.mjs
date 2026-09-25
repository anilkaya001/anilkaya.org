import { easternDay, easternClock, easternInstant, closeMinutes } from "../../shared/flows-freshness.js";
import { timeMs } from "../../shared/flows-live.js";

export const HEALTH = Object.freeze({
  finalReadMin: 10,
  lastPassMin: 30,
  settleMin: 10,
  edge403: 24,
  retrySpentMs: 60_000,
});

export const REPUBLISH_REPAIR = "REPAIR: GitHub → Actions → flows-pipeline → Run workflow → tick republish_session → " +
  "Run workflow (from a shell: gh workflow run flows-pipeline.yml -f republish_session=true). Nothing else is needed.";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n) => String(n).padStart(2, "0");

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
  heartbeatRead = null, edge403 = 0, retrySpentMs = 0 } = {}) {
  const failures = [];
  const notes = [`edge: ${edge403} ingest answer(s) of HTTP 403, ${(retrySpentMs / 1000).toFixed(1)} s of retry budget spent`];
  if (edge403 >= HEALTH.edge403 || retrySpentMs >= HEALTH.retrySpentMs) {
    failures.push(`HEALTH: the edge answered ${edge403} ingest request(s) with HTTP 403 and retries spent ` +
      `${Math.round(retrySpentMs / 1000)} s of the 90 s budget: add the WAF skip rule for /api/flows/ingest (DEPLOY.md 10.0)`);
  }
  if (typeof sessionDate !== "string" || !DAY_RE.test(sessionDate)) {
    return { applies: false, why: "no session date", failures, notes };
  }
  const today = easternDay(now);
  if (today !== sessionDate) {
    return { applies: false, why: `this run is for ${sessionDate} and today is ${today}; the live checks describe today`,
      failures, notes };
  }
  const body = payloadOf(clockRead);
  const clock = body && body.clock && typeof body.clock === "object" ? body.clock : null;
  const sameDay = !!clock && clock.day === sessionDate;
  const closeMin = closeMinutes(sessionDate, sameDay ? clock : null);
  if (easternClock(now).minutes < closeMin + HEALTH.settleMin) {
    return { applies: false, why: `the ${sessionDate} session has not closed`, failures, notes };
  }
  const close = easternInstant(sessionDate, closeMin);
  const finalBy = close - HEALTH.finalReadMin * 60000;

  if (readFailed(clockRead) || !clock) {
    failures.push(`HEALTH: the Worker's clock could not be read (${readFailed(clockRead) ? said(clockRead) : "no clock"})`);
  } else if (!sameDay) {
    failures.push(`HEALTH: Tier 1 never ticked on ${sessionDate}: the Worker's clock still holds ${clock.day}`);
  } else {
    if (clock.trading === 0) {
      failures.push(`HEALTH: Tier 1 closed ${sessionDate} as a holiday, but the vendor printed a ${sessionDate} session`);
    }
    const tier1 = clock.tier1 && typeof clock.tier1 === "object" ? clock.tier1 : null;
    if (!tier1) notes.push("the Worker's clock carries no Tier 1 telemetry (a Worker older than this check)");
    else if (tier1.why === "off") {
      notes.push("FLOWS_LIVE_MODE is off, so the live layer is not checked");
      return { applies: true, why: "live-off", failures, notes };
    } else {
      if (typeof tier1.why === "string" && tier1.why.startsWith("error:")) {
        failures.push(`HEALTH: Tier 1's last tick failed with ${tier1.why}` + (tier1.why === "error:no-key"
          ? ": the Worker has no UW_API_KEY secret (wrangler secret put UW_API_KEY)" : ""));
      }
      const at = timeMs(tier1.at);
      if (!(at >= close)) {
        failures.push(`HEALTH: Tier 1 last ticked at ${etTime(at, sessionDate)}, before the ${etTime(close)} close`);
      }
    }
    if (typeof clock.dispatchWhy === "string" && /^refused:40[13]$/.test(clock.dispatchWhy)) {
      failures.push(`HEALTH: GitHub refused the Worker's dispatch (${clock.dispatchWhy}): renew GITHUB_DISPATCH_TOKEN`);
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
  return { applies: true, why: null, failures, notes };
}

export async function runHealthGate({ sessionDate, read, now = () => Date.now(), edge403 = 0, retrySpentMs = 0,
  dry = false, log = console.log, warn = console.warn } = {}) {
  if (dry) {
    log("health gate: skipped in a dry run, which reads no store");
    return { applies: false, failures: [], notes: [] };
  }
  const safe = async (key) => {
    try { return await read(key); } catch (error) {
      return { payload: null, failed: true, status: 0, detail: error && error.message ? error.message : String(error) };
    }
  };
  const [clockRead, marketRead, heartbeatRead] = [await safe("clock"), await safe("live:market"),
    await safe("live:heartbeat")];
  const verdict = healthChecks({ sessionDate, now: now(), clockRead, marketRead, heartbeatRead, edge403, retrySpentMs });
  log(`health gate: ${verdict.applies ? "checked" : "live checks skipped — " + verdict.why}; ` +
    `${verdict.failures.length} failure(s)`);
  for (const n of verdict.notes) log("  " + n);
  for (const line of verdict.failures) warn(line);
  return verdict;
}
