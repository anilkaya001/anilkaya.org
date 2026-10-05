import {
  FRESH_CLASSES, LIVE_CLOCK, phaseAt, expectedNightlySession, nextWeekdayDay, easternDay,
} from "../../shared/flows-freshness.js";
import { timeMs } from "../../shared/flows-live.js";
import { githubTarget, githubHeaders, githubSignal, transientRefusal } from "./live.mjs";
import { etTime } from "./health.mjs";

export const WITNESS = Object.freeze({
  tier1StaleMs: FRESH_CLASSES.market.staleS * 1000,
  tier2StaleMs: FRESH_CLASSES.breadth.staleS * 1000,
  confirm: Object.freeze({ tier1: 2, tier2: 2, nightly: 1, nightlyPending: 2, chain: 1, probe: 3 }),
  recover: Object.freeze({ tier1: 3, tier2: 3, nightly: 1, chain: 1, probe: 3 }),
  renotifyMs: 6 * 60 * 60 * 1000,
  reopenWithinMs: 6 * 60 * 60 * 1000,
  retryOpenMs: 15 * 60 * 1000,
  readDeadlineMs: 10 * 1000,
  issuesListMax: 100,
  author: "github-actions[bot]",
});

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TITLE_RE = /^\[flows-witness:([a-z0-9-]+)\]/;
const flag = (v) => (v === 0 || v === 1 ? v : null);
const validDay = (d) => typeof d === "string" && DAY_RE.test(d);
const minutes = (ms) => Math.max(0, Math.round(ms / 60000));
const stamp = (ms) => `${easternDay(ms)} ${etTime(ms)}`;

export const WITNESS_CHECKS = Object.freeze({
  tier1: Object.freeze({
    title: "Tier 1 is stale: the Worker's live:market or live:focus stopped advancing",
    remedy: [
      "Readers see the Stale pill once a live key is 25 minutes old, so this is already visible on the site.",
      "Check that the Worker's crons are registered (wrangler triggers: 1-59/5 13-21 * * MON-FRI and 3-58/5 13-21 * * MON-FRI) and that the Worker holds UW_API_KEY (tier1_why says error:no-key when it does not).",
      "A vendor outage looks the same from here; the issue closes itself when the keys advance again. DEPLOY.md section 10.5i.",
    ],
  }),
  tier2: Object.freeze({
    title: "Tier 2 is stale: live:breadth stopped advancing while the loop runs",
    remedy: [
      "Readers see the Stale pill on breadth, strips, gex, vol, movers, tape and news once they are 45 minutes old.",
      "Look at this run's log for `live: N key(s) not published` and `vendor request(s) timed out`: a vendor outage or a rate limit stops a pass from writing.",
      "Tier 1 (live:market, live:focus) is written by the Worker and can be healthy while this is open. DEPLOY.md section 10.5i.",
    ],
  }),
  nightly: Object.freeze({
    title: "The nightly has not landed by 21:00 ET",
    remedy: [
      "Every nightly-class key (boards, cards, scores, brief, roster, focus) is behind for readers from 21:00 ET.",
      "Look at GitHub, Actions, flows-pipeline: a run that never started, or one that failed before it published meta.",
      "Dispatch it by hand: gh workflow run flows-pipeline.yml (or Run workflow in the Actions tab).",
      "If the detail says the store answered pending, the nightly may have landed: the Worker reports a failed D1 read (the daily row-read quota, an outage) the same way as a missing row, so look at the site's Flows pages before dispatching.",
    ],
  }),
  chain: Object.freeze({
    title: "The live loop stopped: a pass hung or its successor could not be started",
    remedy: [
      "When the dispatch was refused: until a GitHub starter arrives (they have arrived 4 to 8 hours late), Tier 2 and the nightly start are not running.",
      "Check Settings, Actions, General, Workflow permissions, and that flows-live.yml still grants actions: write and issues: write.",
      "Restart it by hand: gh workflow run flows-live.yml. The next loop closes this issue.",
      "When a pass hung and the successor was dispatched, the loop restarts by itself. A pass is abandoned only when no vendor or ingest call settled for 90 seconds or it ran past 10 minutes, so a slow or timing-out vendor never does this: read the run's `live loop:` lines and the `vendor request(s) timed out ... in the abandoned pass` line for what stalled. DEPLOY.md section 10.5k.",
    ],
  }),
  drill: Object.freeze({
    title: "Witness drill: this issue proves the alert channel and closes itself",
    remedy: [
      "Nothing is wrong. The live workflow was dispatched with drill ticked, opened this issue with its own token and closed it again.",
      "If you were mentioned and were notified, the channel that carries every other witness issue works.",
      "An HTTP 410 from the API means Issues are switched off for the repository (Settings, General, Features); an HTTP 403 means the job's token lacks issues: write.",
    ],
  }),
  probe: Object.freeze({
    title: "The witness cannot read the store through the ingest route",
    remedy: [
      "Three consecutive ticks read nothing: the ingest route answered 403, 5xx or nothing to the runner.",
      "A 403 with a cf-ray is Cloudflare challenging the runner: the WAF skip rule of DEPLOY.md section 10.0 item 3.",
      "While this is open the loop cannot say whether Tier 1 or the nightly are healthy.",
    ],
  }),
});

const escapeData = (v) => String(v).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const escapeProperty = (v) => escapeData(v).replace(/:/g, "%3A").replace(/,/g, "%2C");

export const annotation = (level, title, message) =>
  `::${level} title=${escapeProperty(title)}::${escapeData(message).slice(0, 1000)}`;

export const issueTitle = (id) => `[flows-witness:${id}] ${WITNESS_CHECKS[id] ? WITNESS_CHECKS[id].title : id}`;

export function witnessView(body) {
  const c = body && typeof body === "object" && body.clock && typeof body.clock === "object" ? body.clock : null;
  if (!c || !validDay(c.day)) return null;
  const t1 = c.tier1 && typeof c.tier1 === "object" ? c.tier1 : null;
  const ledger = c.ledger && typeof c.ledger === "object" ? c.ledger
    : body.ledger && typeof body.ledger === "object" ? body.ledger : null;
  return {
    clock: {
      day: c.day, trading: flag(c.trading), earlyClose: flag(c.earlyClose),
      closedDays: Array.isArray(c.closedDays) ? c.closedDays.filter(validDay).slice(-20) : [],
    },
    tier1: t1 ? { atMs: timeMs(t1.at), okAtMs: timeMs(t1.okAt), why: typeof t1.why === "string" ? t1.why.slice(0, 60) : null } : null,
    summaryAtMs: timeMs(c.summaryAt),
    dispatchWhy: typeof c.dispatchWhy === "string" ? c.dispatchWhy.slice(0, 40) : null,
    ledger,
  };
}

const readAtOf = (payload) => timeMs(payload && payload.fresh && payload.fresh.readAt);

export const sessionOf = (payload) =>
  (payload && typeof payload.sessionDate === "string" && DAY_RE.test(payload.sessionDate.slice(0, 10))
    ? payload.sessionDate.slice(0, 10) : null);

export function evaluateTier1({ at, view, market = null, focus = null }) {
  const id = "tier1";
  if (!view) return { id, status: "inconclusive", why: "the Worker's clock could not be read" };
  if (view.tier1 && view.tier1.why === "off") return { id, status: "skip", why: "FLOWS_LIVE_MODE is off" };
  const p = phaseAt(at, view.clock);
  if (!p || !p.trading) return { id, status: "skip", why: "not a trading day" };
  if (at < p.open || at > p.close + LIVE_CLOCK.tier1AfterCloseMin * 60000) {
    return { id, status: "skip", why: "outside Tier 1's window" };
  }
  const signals = [];
  let unread = false;
  if (view.tier1) signals.push({ name: "Tier 1's last tick", t: view.tier1.atMs });
  for (const [name, read] of [["live:market", market], ["live:focus", focus]]) {
    if (read && read.failed) unread = true;
    else if (read) signals.push({ name, t: read.pending ? NaN : readAtOf(read.payload) });
  }
  if (!signals.length) return { id, status: "inconclusive", why: "no Tier 1 signal could be read" };
  const since = (t) => Math.max(Number.isFinite(t) ? t : -Infinity, p.open);
  const late = signals.filter((s) => at - since(s.t) > WITNESS.tier1StaleMs);
  const say = (s) => (Number.isFinite(s.t) && s.t >= p.open
    ? `${s.name}: ${etTime(s.t, p.day)}, ${minutes(at - s.t)} min before this check`
    : `${s.name}: nothing since the ${etTime(p.open)} open`);
  if (late.length) {
    const why = view.tier1 && view.tier1.why && view.tier1.why !== "written" ? ` Tier 1's last outcome: ${view.tier1.why}.` : "";
    return {
      id, status: "breach",
      detail: `${late.map(say).join("; ")}; readers see Stale from ${minutes(WITNESS.tier1StaleMs)} minutes.${why}`,
      evidence: signals.map((s) => ({ name: s.name, at: Number.isFinite(s.t) ? new Date(s.t).toISOString() : null,
        ageMin: minutes(at - since(s.t)) })),
    };
  }
  if (unread) return { id, status: "inconclusive", why: "a Tier 1 key could not be read" };
  if (signals.every((s) => Number.isFinite(s.t) && s.t >= p.open)) return { id, status: "ok" };
  return { id, status: "pending", why: "not every Tier 1 key has been written since the open yet" };
}

export function evaluateTier2({ at, view, breadth = null }) {
  const id = "tier2";
  if (!view) return { id, status: "inconclusive", why: "the Worker's clock could not be read" };
  if (view.tier1 && view.tier1.why === "off") return { id, status: "skip", why: "FLOWS_LIVE_MODE is off" };
  const p = phaseAt(at, view.clock);
  if (!p || !p.trading) return { id, status: "skip", why: "not a trading day" };
  if (at - p.open < WITNESS.tier2StaleMs || at > p.close + LIVE_CLOCK.runAfterCloseMin * 60000) {
    return { id, status: "skip", why: "outside Tier 2's window" };
  }
  if (!breadth || breadth.failed) return { id, status: "inconclusive", why: "live:breadth could not be read" };
  const t = breadth.pending ? NaN : readAtOf(breadth.payload);
  const from = Math.max(Number.isFinite(t) ? t : -Infinity, p.open);
  if (at - from <= WITNESS.tier2StaleMs) {
    return Number.isFinite(t) && t >= p.open ? { id, status: "ok" }
      : { id, status: "pending", why: "live:breadth has not been written since the open yet" };
  }
  return {
    id, status: "breach",
    detail: `live:breadth: ${Number.isFinite(t) && t >= p.open ? `${etTime(t, p.day)}, ${minutes(at - t)} min before this check`
      : `nothing since the ${etTime(p.open)} open`}; readers see Stale from ${minutes(WITNESS.tier2StaleMs)} minutes, ` +
      "and this loop is the writer",
    evidence: [{ name: "live:breadth", at: Number.isFinite(t) ? new Date(t).toISOString() : null, ageMin: minutes(at - from) }],
  };
}

export function evaluateNightly({ at, view, meta = null }) {
  const id = "nightly";
  if (!meta || meta.failed) return { id, status: "inconclusive", why: "meta could not be read" };
  const expected = expectedNightlySession(at, view ? view.clock : null);
  if (!expected) return { id, status: "skip", why: "no session is due" };
  const session = meta.pending ? null : sessionOf(meta.payload);
  if (session && session >= expected) return { id, status: "ok", expected, session };
  const next = nextWeekdayDay(expected);
  const holds = meta.pending
    ? "the store answered pending for meta (no row, or a failed D1 read, which the Worker reports the same way)"
    : `meta holds ${session ? "the " + session + " session" : "no session"}`;
  return {
    id, status: "breach", expected, session,
    ...(meta.pending ? { confirm: WITNESS.confirm.nightlyPending } : {}),
    detail: `${holds}, and the ${expected} session was due ` +
      `by 21:00 ET (the close plus the ${FRESH_CLASSES.nightly.graceS / 3600}-hour grace)` +
      (next ? `; dispatch it before 09:30 ET on ${next}, because from that open the pipeline refuses an in-progress ` +
        `session and after that close it ranks the newer one, so ${expected}'s archive can no longer be written` : ""),
  };
}

export function createIssueReporter({ env = process.env, fetchImpl = fetch } = {}) {
  const target = githubTarget(env);
  const call = async (method, path, body) => {
    if (!target.ok) return { ok: false, why: target.why };
    try {
      const res = await fetchImpl(`${target.api}/repos/${target.repo}${path}`, {
        method, headers: githubHeaders(target.token), signal: githubSignal(),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      let json = null;
      try { json = await res.json(); } catch { json = null; }
      return { ok: res.status >= 200 && res.status < 300, status: res.status, json,
        why: res.status >= 200 && res.status < 300 ? "ok" : "HTTP " + res.status };
    } catch (error) {
      return { ok: false, why: "unreachable", error: error instanceof Error ? error.message : String(error) };
    }
  };
  return {
    enabled: target.ok,
    why: target.ok ? null : target.why,
    async list() {
      const r = await call("GET", `/issues?state=open&sort=updated&direction=desc&per_page=${WITNESS.issuesListMax}`);
      if (!r.ok || !Array.isArray(r.json)) return { ok: false, why: r.why };
      const issues = [];
      for (const it of r.json) {
        const ours = !!it && !!it.user && it.user.login === WITNESS.author;
        const m = ours && typeof it.title === "string" && !it.pull_request ? TITLE_RE.exec(it.title) : null;
        if (m && Number.isInteger(it.number)) {
          issues.push({ number: it.number, id: m[1], updatedAt: timeMs(it.updated_at) || 0 });
        }
      }
      return { ok: true, issues };
    },
    async open({ title, body }) {
      const r = await call("POST", "/issues", { title, body });
      return r.ok && r.json && Number.isInteger(r.json.number) ? { ok: true, number: r.json.number } : { ok: false, why: r.why };
    },
    async comment(number, body) {
      const r = await call("POST", `/issues/${number}/comments`, { body });
      return { ok: r.ok, why: r.why };
    },
    async close(number, reason = "completed") {
      const r = await call("PATCH", `/issues/${number}`, { state: "closed", state_reason: reason });
      return { ok: r.ok, why: r.why };
    },
    async reopen(number) {
      const r = await call("PATCH", `/issues/${number}`, { state: "open", state_reason: "reopened" });
      return { ok: r.ok, why: r.why };
    },
  };
}

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

export function ownerHandle(env = {}) {
  const fromEnv = typeof env.GITHUB_REPOSITORY_OWNER === "string" ? env.GITHUB_REPOSITORY_OWNER : "";
  const fromRepo = typeof env.GITHUB_REPOSITORY === "string" ? env.GITHUB_REPOSITORY.split("/")[0] : "";
  const handle = OWNER_RE.test(fromEnv) ? fromEnv : OWNER_RE.test(fromRepo) ? fromRepo : null;
  return handle;
}

export function runUrl(env = {}) {
  const server = typeof env.GITHUB_SERVER_URL === "string" && /^https:\/\/[A-Za-z0-9.-]+$/.test(env.GITHUB_SERVER_URL)
    ? env.GITHUB_SERVER_URL : "https://github.com";
  const repo = typeof env.GITHUB_REPOSITORY === "string" && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.GITHUB_REPOSITORY)
    ? env.GITHUB_REPOSITORY : null;
  const id = typeof env.GITHUB_RUN_ID === "string" && /^\d{1,20}$/.test(env.GITHUB_RUN_ID) ? env.GITHUB_RUN_ID : null;
  return repo && id ? `${server}/${repo}/actions/runs/${id}` : null;
}

export function issueBody(id, result, { at, since, env = {}, dispatches = null } = {}) {
  const spec = WITNESS_CHECKS[id];
  const owner = ownerHandle(env);
  const url = runUrl(env);
  const lines = [];
  if (owner) lines.push(`@${owner}`, "");
  lines.push(result.detail || "The check failed.", "");
  if (Number.isFinite(since)) lines.push(`First seen ${stamp(since)}; this note is from ${stamp(at)}.`, "");
  if (result.evidence && result.evidence.length) {
    lines.push("Evidence", ...result.evidence.map((e) => `- ${e.name}: ${
      e.at ? stamp(Date.parse(e.at)) : "not written since the open"} (${e.ageMin} min old)`), "");
  }
  if (dispatches && dispatches.length) {
    lines.push("The loop's nightly dispatches today", ...dispatches.map((d) =>
      `- ${etTime(d.at)}: ${d.sent ? "sent" : d.why === "unreachable" ? "unreachable" : "refused"}${d.status ? " (HTTP " + d.status + ")" : ""}`), "");
  }
  const refused = dispatches && dispatches.length && !dispatches.some((d) => d.sent);
  if (spec) {
    lines.push("What to check", ...spec.remedy.map((r) => `- ${r}`));
    if (id === "nightly" && refused) {
      lines.push(dispatches.every(transientRefusal)
        ? "- Every dispatch above failed on GitHub's side (HTTP 5xx, 429 or no answer) for the whole retry window: " +
          "check githubstatus.com; nothing here needs changing, and the manual dispatch above still works once GitHub answers."
        : "- Every dispatch above was refused by GitHub: check Settings, Actions, General, Workflow permissions, " +
          "and that flows-live.yml still grants actions: write.");
    }
    lines.push("");
  }
  lines.push(`Raised by the live loop's witness${url ? " in " + url : ""}. It closes this issue by itself when the check passes again.`);
  return lines.join("\n");
}

export function createWitness({ reporter = null, env = {}, log = console.log, warn = console.warn } = {}) {
  const states = new Map();
  const breached = new Set();
  let seeded = false;
  const live = () => !!reporter && reporter.enabled;
  const stateOf = (id) => {
    if (!states.has(id)) {
      states.set(id, { streak: 0, okStreak: 0, since: null, issue: null, extras: [], notifiedAt: 0, triedAt: -Infinity,
        raised: false, lastClosed: null, uncertain: false, recoveryNoted: false });
    }
    return states.get(id);
  };
  const confirmOf = (r) => (Number.isInteger(r.confirm) && r.confirm > 0 ? r.confirm : WITNESS.confirm[r.id] || 1);
  const recoverOf = (id) => WITNESS.recover[id] || 1;

  const adopt = (issues, only = null) => {
    const byId = new Map();
    for (const it of issues) {
      if (!WITNESS_CHECKS[it.id] || (only && it.id !== only)) continue;
      if (!byId.has(it.id)) byId.set(it.id, []);
      byId.get(it.id).push(it);
    }
    for (const [id, list] of byId) {
      const s = stateOf(id);
      const numbers = [...new Set([...list.map((it) => it.number), ...(s.issue ? [s.issue.number] : [])])].sort((a, b) => b - a);
      const kept = list.find((it) => it.number === numbers[0]);
      s.issue = { number: numbers[0] };
      s.extras = numbers.slice(1);
      if (kept) s.notifiedAt = Math.max(s.notifiedAt, kept.updatedAt);
    }
  };

  const seed = async () => {
    if (seeded || !live()) return;
    const listed = await reporter.list();
    if (!listed.ok) {
      warn(annotation("warning", "Witness", `could not list the open witness issues (${listed.why}); a repeat issue is possible`));
      return;
    }
    seeded = true;
    adopt(listed.issues);
  };

  const refresh = async (id) => {
    const listed = await reporter.list();
    if (listed.ok) adopt(listed.issues, id);
    return listed.ok;
  };

  const closeExtras = async (id, s) => {
    if (!s.extras.length || !live() || !s.issue) return;
    const left = [];
    const done = [];
    for (const number of s.extras) {
      const shut = await reporter.close(number, "not_planned");
      if (shut.ok) done.push(number);
      else {
        left.push(number);
        warn(annotation("warning", "Witness", `could not close the duplicate issue #${number} (${shut.why})`));
      }
    }
    s.extras = left;
    if (done.length) {
      log(`witness: closed duplicate issue(s) ${done.map((n) => "#" + n).join(", ")} for ${id}`);
      await reporter.comment(s.issue.number, `Closed ${done.map((n) => "#" + n).join(", ")} as ${done.length > 1 ? "duplicates" : "a duplicate"} of this issue.`);
    }
  };

  const notify = async (id, result, ctx, s) => {
    if (!live()) return;
    await seed();
    const body = issueBody(id, result, { at: ctx.at, since: s.since, env, dispatches: ctx.dispatches });
    if (!s.issue) {
      if (ctx.at - s.triedAt < WITNESS.retryOpenMs) return;
      s.triedAt = ctx.at;
      if (s.uncertain) {
        await refresh(id);
        if (s.issue) {
          s.uncertain = false;
          log(`witness: found issue #${s.issue.number} for ${id} (an open whose answer never arrived may have created it); adopting it`);
          await closeExtras(id, s);
          return;
        }
      }
      const back = s.lastClosed && ctx.at - s.lastClosed.at < WITNESS.reopenWithinMs ? s.lastClosed : null;
      if (back) {
        const again = await reporter.reopen(back.number);
        if (again.ok) {
          s.issue = { number: back.number };
          s.notifiedAt = ctx.at;
          s.lastClosed = null;
          log(`witness: ${id} breached again — reopened issue #${back.number}`);
          const said = await reporter.comment(back.number, body);
          if (!said.ok) warn(annotation("warning", "Witness", `could not comment on issue #${back.number} (${said.why})`));
          return;
        }
        warn(annotation("warning", "Witness", `could not reopen issue #${back.number} (${again.why}); opening a new one`));
      }
      const made = await reporter.open({ title: issueTitle(id), body });
      if (made.ok) {
        s.issue = { number: made.number };
        s.notifiedAt = ctx.at;
        s.uncertain = false;
        log(`witness: opened issue #${made.number} for ${id}`);
      } else {
        s.uncertain = true;
        warn(annotation("warning", "Witness", `could not open the ${id} issue (${made.why})`));
      }
    } else {
      await closeExtras(id, s);
      if (ctx.at - s.notifiedAt >= WITNESS.renotifyMs) {
        const said = await reporter.comment(s.issue.number, body);
        if (said.ok) {
          s.notifiedAt = ctx.at;
          log(`witness: still breached — commented on issue #${s.issue.number} for ${id}`);
        } else warn(annotation("warning", "Witness", `could not comment on issue #${s.issue.number} (${said.why})`));
      }
    }
  };

  const raise = async (id, result, ctx) => {
    const s = stateOf(id);
    s.recoveryNoted = false;
    s.okStreak = 0;
    if (!s.raised) {
      s.raised = true;
      breached.add(id);
      warn(annotation("error", (WITNESS_CHECKS[id] || { title: id }).title, result.detail || id));
    }
    await notify(id, result, ctx, s);
  };

  const recover = async (id, ctx) => {
    const s = stateOf(id);
    const had = s.raised || !!s.issue;
    s.streak = 0;
    s.okStreak = 0;
    s.since = null;
    s.raised = false;
    if (!had) return;
    log(`witness: ${id} recovered at ${etTime(ctx.at)}`);
    if (!s.issue || !live()) {
      s.issue = null;
      s.extras = [];
      return;
    }
    const number = s.issue.number;
    if (!s.recoveryNoted) {
      s.recoveryNoted = true;
      await reporter.comment(number, `Recovered at ${etTime(ctx.at)}: the check passes again, so the loop is closing this issue.`);
    }
    await closeExtras(id, s);
    const shut = await reporter.close(number);
    if (shut.ok) {
      s.lastClosed = { number, at: ctx.at };
      s.issue = null;
      s.recoveryNoted = false;
    } else warn(annotation("warning", "Witness", `could not close issue #${number} (${shut.why})`));
  };

  const settle = async (id, ctx) => {
    const s = stateOf(id);
    s.streak = 0;
    if (!(s.raised || s.issue)) {
      s.since = null;
      s.okStreak = 0;
      return;
    }
    s.okStreak++;
    if (s.okStreak >= recoverOf(id) || s.recoveryNoted) await recover(id, ctx);
  };

  return {
    async start() {
      await seed();
    },
    async apply(results, ctx) {
      for (const r of results) {
        if (!r || !r.id) continue;
        const s = stateOf(r.id);
        if (r.status === "breach") {
          s.okStreak = 0;
          s.streak++;
          if (s.streak === 1) s.since = ctx.at;
          if (s.raised || s.streak >= confirmOf(r)) await raise(r.id, r, ctx);
        } else if (r.status === "ok") {
          await settle(r.id, ctx);
        } else if (r.status === "skip" || r.status === "pending") {
          s.streak = 0;
          s.okStreak = 0;
        }
      }
    },
    async raiseNow(id, result, ctx) {
      const s = stateOf(id);
      if (!s.since) s.since = ctx.at;
      await raise(id, result, ctx);
    },
    async clear(id, ctx) {
      await recover(id, ctx);
    },
    isOpen(id) {
      const s = stateOf(id);
      return s.raised || !!s.issue || s.streak > 0;
    },
    summary() {
      return {
        breached: [...breached],
        open: [...states.entries()].filter(([, s]) => s.raised || s.issue).map(([id]) => id),
        issues: Object.fromEntries([...states.entries()].filter(([, s]) => s.issue).map(([id, s]) => [id, s.issue.number])),
      };
    },
  };
}
