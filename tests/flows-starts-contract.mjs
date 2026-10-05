import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FRESH_CLASSES, easternInstant, liveStalled } from "../shared/flows-freshness.js";
import {
  runLiveLoop, chainDispatch, chainWithRetry, githubTarget, readLiveClock, liveRunVerdict, transientRefusal, LIVE_LOOP,
} from "../scripts/flows-legs/live.mjs";
import {
  WITNESS, WITNESS_CHECKS, annotation, witnessView, evaluateTier1, evaluateTier2, evaluateNightly, createWitness, createIssueReporter,
  issueTitle, issueBody, ownerHandle, runUrl,
} from "../scripts/flows-legs/witness.mjs";
import { NIGHTLY, nightlyStartDue, createNightlyStart } from "../scripts/flows-legs/starts.mjs";
import {
  createWatch, normalizeRead, tier1Window, tier2Window, witnessDrill, challenged, keptView, WATCH_RETRY,
} from "../scripts/flows-legs/watch.mjs";
import { fakeWorld, fakeGithub } from "../scripts/flows-legs/live-world-fake.mjs";
import { DRY_SCENARIOS, DRY_DAY, DRY_WEEKEND, dryLiveDay } from "../scripts/flows-legs/live-day.mjs";
import { LIVE_VENDOR } from "../scripts/flows-pipeline.mjs";

const ROOT = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), "utf8");

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const deep = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };
const at = (day, h, m = 0, s = 0) => easternInstant(day, h * 60 + m) + s * 1000;
const D = DRY_DAY;
const HOUR = 3600 * 1000;
const MIN = 60 * 1000;

{
  const live = read(".github/workflows/flows-live.yml");
  ok(/permissions:\n {2}contents: read\n {2}id-token: write\n {2}actions: write\n {2}issues: write\n\n/.test(live),
    "THE LIVE WORKFLOW'S GRANTS are read on the contents, the OIDC token, actions: write (the chain and the nightly " +
    "dispatch) and issues: write (the witness), and nothing else");
  ok(/FLOWS_LIVE_KEEP: "1"/.test(live) && /FLOWS_LIVE_LOOP: "1"/.test(live),
    "and the read step keeps the loop alive between sessions, so the 32 cron lines are only a backup");
  ok(!/secrets\.(?!UW_API_KEY|FLOWS_INGEST_URL)/.test(live) && !/GITHUB_DISPATCH_TOKEN|FLOWS_INGEST_TOKEN/.test(live),
    "with no secret beyond the vendor key and the ingest URL: the nightly is started with the job's own token");
  ok(/drill:\n {8}description: "[^"]+"\n {8}type: boolean\n {8}default: false/.test(live) &&
     /group: \$\{\{ inputs\.drill && 'flows-live-drill' \|\| 'flows-live' \}\}\n {2}cancel-in-progress: false/.test(live) &&
     /FLOWS_LIVE_DRILL: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.drill && '1' \|\| '' \}\}/.test(live),
  "THE DRILL is a boolean dispatch input, set as FLOWS_LIVE_DRILL on a dispatch only, and it runs in a concurrency group of its own: " +
    "in the loop's group it would queue behind a loop that lives 340 minutes and be replaced by the next hop");
  const uses = [...live.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
  ok(uses.length === 2 && uses.every((u) => /^actions\/(checkout|setup-node)@[0-9a-f]{40}$/.test(u)),
    "and no new action joined the job, every one still pinned to a commit");
  const pipeline = read(".github/workflows/flows-pipeline.yml");
  ok(!/issues:/.test(pipeline) && (pipeline.match(/actions: write/g) || []).length === 1,
    "while the nightly workflow gained no permission at all");
  ok(/origin:\n {8}description: "[^"]*live-loop[^"]*"\n {8}type: string/.test(pipeline),
    "and its origin input names the live loop as a dispatcher");
  const gate = /- name: Resolve whether this firing is the intended one[\s\S]*?run: \|\n([\s\S]*?)\n\n/.exec(pipeline)[1]
    .split("\n").map((l) => l.replace(/^ {10}/, "")).join("\n");
  const dir = mkdtempSync(join(tmpdir(), "flows-starts-gate-"));
  const output = join(dir, "out");
  writeFileSync(output, "");
  const ran = spawnSync("bash", ["-e", "-c", gate.replace('ZONE="$(TZ=America/New_York date +%Z)"', 'ZONE="EDT"')], {
    encoding: "utf8", env: { ...process.env, EVENT: "workflow_dispatch", FIRED: "", ORIGIN: "live-loop", GITHUB_OUTPUT: output } });
  ok(/run=true/.test(readFileSync(output, "utf8")) && /Dispatched by: live-loop/.test(ran.stdout),
    "RUN UNDER BASH, the nightly's gate proceeds for a dispatch whose origin is live-loop and says who sent it");
  rmSync(dir, { recursive: true, force: true });
}

{
  const sent = [];
  const fetchImpl = async (url, init) => { sent.push({ url, init }); return { status: 204 }; };
  const env = { GITHUB_TOKEN: "ghs_job", GITHUB_REPOSITORY: "anilkaya001/anilkaya.org" };
  const r = await chainDispatch({ env, fetchImpl, at: at(D, 17, 30), workflow: NIGHTLY.workflow, inputs: { origin: NIGHTLY.origin } });
  ok(r.sent && sent.length === 1 &&
     sent[0].url === "https://api.github.com/repos/anilkaya001/anilkaya.org/actions/workflows/flows-pipeline.yml/dispatches",
  "THE NIGHTLY DISPATCH is one POST to the nightly workflow's dispatches endpoint of this repository");
  deep(JSON.parse(sent[0].init.body), { ref: "main", inputs: { origin: "live-loop" } },
    "carrying the origin and nothing else: the tick input the live workflow declares is not declared by the nightly, " +
    "and GitHub answers an undeclared input 422");
  ok(sent[0].init.headers.Authorization === "Bearer ghs_job" && sent[0].init.signal instanceof AbortSignal &&
     sent[0].init.signal.aborted === false,
  "under the job's own token, with a deadline so a hung GitHub cannot hold the loop");
  await chainDispatch({ env, fetchImpl, at: 5 });
  deep(JSON.parse(sent[1].init.body), { ref: "main", inputs: { tick: new Date(5).toISOString(), origin: "chain" } },
    "and the chain's own dispatch keeps its old body");
  deep(githubTarget({}), { ok: false, why: "no-token" }, "no token is no target");
  deep([githubTarget({ GITHUB_TOKEN: "t", GITHUB_REPOSITORY: "a b" }).why, githubTarget({ GITHUB_TOKEN: "t", GITHUB_REPOSITORY: "a/b",
    GITHUB_API_URL: "https://evil.example" }).why], ["bad-repo", "bad-base"], "and a bad repository or host is refused");

  const script = (statuses) => {
    const seen = [];
    return { seen, send: async () => { const s = statuses.shift(); seen.push(s); return s === 204 ? { sent: true, why: "sent", status: 204 }
      : { sent: false, why: s === "no-token" ? "no-token" : "refused", status: s === "no-token" ? undefined : s }; } };
  };
  const napped = [];
  const nap = async (ms) => { napped.push(ms); };
  let s = script([403, 403, 204]);
  let out = await chainWithRetry(s.send, { sleep: nap });
  ok(out.sent && out.attempts === 3 && napped.join() === "15000,45000",
    "THE CHAIN RETRIES a refused dispatch after 15 s and 45 s, and the third try sends");
  napped.length = 0;
  s = script([403, 403, 403]);
  out = await chainWithRetry(s.send, { sleep: nap });
  ok(!out.sent && out.attempts === 3 && out.why === "refused" && s.seen.length === 3, "three refusals give up and say so");
  napped.length = 0;
  s = script(["no-token"]);
  out = await chainWithRetry(s.send, { sleep: nap });
  ok(!out.sent && out.attempts === 1 && napped.length === 0, "and a missing token is not retried");
  napped.length = 0;
  s = script([204]);
  out = await chainWithRetry(s.send, { sleep: nap });
  ok(out.sent && out.attempts === 1 && napped.length === 0, "nor is a dispatch that sent at once");
}

{
  const S = "2026-09-29";
  const P = "2026-09-28";
  const due = (h, m, metaSession, attempts = [], day = S, clock = null) =>
    nightlyStartDue({ at: at(day, h, m), clock, metaSession, attempts });
  const sentAt = (h, m) => ({ at: at(S, h, m), sent: true });
  const refusedAt = (h, m) => ({ at: at(S, h, m), sent: false });
  eq(NIGHTLY.atMin, 17 * 60 + 30, "THE NIGHTLY IS DISPATCHED AT 17:30 ET, the workflow's own nominal time and the earliest " +
    "start measured: the 2026-09-23 manual dispatch at 17:36 ET landed at 17:47");
  deep([due(17, 29, P).why, due(17, 30, P).why, due(17, 30, P).due], ["before-window", "first", true],
    "not a minute before 17:30 ET, and due at it while meta still holds the last session");
  deep([due(17, 30, S).why, due(17, 30, null).due, due(17, 30, undefined).due], ["landed", true, true],
    "landed means meta holds today's session; an unreadable or absent meta counts as not landed");
  deep([due(17, 45, P, [sentAt(17, 30)]).why, due(18, 14, P, [sentAt(17, 30)]).due], ["dispatched", false],
    "once sent, nothing more until the retry window");
  deep([due(18, 15, P, [sentAt(17, 30)]).why, due(18, 15, P, [sentAt(17, 30)]).due], ["retry", true],
    "at 18:15 ET a nightly that has not landed is dispatched once more, as the Worker's own clock would");
  deep(due(18, 15, P, [sentAt(17, 30), sentAt(18, 15)]).why, "dispatched", "and never a third time");
  deep(due(18, 15, P, [sentAt(17, 50)]).due, false, "the retry waits 30 minutes after the first send");
  deep([due(17, 35, P, [refusedAt(17, 30)]).why, due(17, 40, P, [refusedAt(17, 30), refusedAt(17, 35)]).why],
    ["first", "first"], "A REFUSED DISPATCH IS TRIED AGAIN on the next slot, three times in all");
  const three = [refusedAt(17, 30), refusedAt(17, 35), refusedAt(17, 40)];
  deep([due(17, 45, P, three).why, due(18, 14, P, three).why, due(18, 15, P, three).why],
    ["refused", "refused", "retry"], "then it waits for the 18:15 retry window");
  deep(due(18, 45, P, [...three, refusedAt(18, 15)]).why, "refused", "and stops after a fourth refusal");
  deep([due(17, 30, P, [], "2026-10-03").why, due(17, 30, P, [], "2026-11-26").why], ["not-trading", "not-trading"],
    "a weekend and a holiday have no nightly");
  eq(due(17, 30, "2026-11-25", [], "2026-11-27").due, true, "an early close still dispatches at 17:30 ET: the run is scheduled by wall clock");
  const est = nightlyStartDue({ at: easternInstant("2026-11-03", 17 * 60 + 30), metaSession: "2026-11-02" });
  ok(est.due && new Date(easternInstant("2026-11-03", 17 * 60 + 30)).toISOString() === "2026-11-03T22:30:00.000Z",
    "and the same wall time holds under standard time (22:30 UTC)");
  eq(nightlyStartDue({ at: at(S, 3, 0), metaSession: P }).why, "before-window", "overnight it is not due");

  const refusedWith = (h, m, status, why = "refused") => ({ at: at(S, h, m), sent: false, status, why });
  deep([transientRefusal(refusedWith(17, 30, 503)), transientRefusal(refusedWith(17, 30, 500)), transientRefusal(refusedWith(17, 30, 429)),
    transientRefusal(refusedWith(17, 30, 408)), transientRefusal(refusedWith(17, 30, null, "unreachable")),
    transientRefusal(refusedWith(17, 30, 403)), transientRefusal(refusedWith(17, 30, 404)), transientRefusal(refusedWith(17, 30, 422)),
    transientRefusal(refusedWith(17, 30, 401)), transientRefusal(refusedWith(17, 30, undefined)), transientRefusal({ at: 1, sent: true, status: 204 }),
    transientRefusal(null)],
  [true, true, true, true, true, false, false, false, false, false, false, false],
  "A REFUSAL IS TRANSIENT when GitHub failed (5xx), asked to slow down (429), timed out (408) or did not answer, and permanent for a 401, 403, " +
    "404 or 422 (the token, the grant or the file), or when nothing is known");
  const drive = (answer, { landsAfter = Infinity, from = [17, 30], until = [22, 0] } = {}) => {
    const attempts = [];
    let landed = null;
    for (let x = at(S, ...from); x <= at(S, ...until); x += 5 * MIN) {
      const meta = landed !== null && x >= landed ? S : P;
      const d = nightlyStartDue({ at: x, metaSession: meta, attempts });
      if (!d.due) continue;
      const status = answer(x);
      attempts.push({ at: x, sent: status === 204, status: status === 0 ? null : status, why: status === 204 ? "sent" : status === 0 ? "unreachable" : "refused" });
      if (status === 204 && landed === null && Number.isFinite(landsAfter)) landed = x + landsAfter;
    }
    return attempts;
  };
  const et = (list) => list.map((a) => Math.floor(((a.at - easternInstant(S, 0)) / MIN) / 60) + ":" + String(Math.round((a.at - easternInstant(S, 0)) / MIN) % 60).padStart(2, "0") + (a.sent ? "+" : "-")).join(" ");
  eq(et(drive(() => 403)), "17:30- 17:35- 17:40- 18:15-", "A PERMANENT REFUSAL stays capped at four calls a day: three on the next slots and the 18:15 retry");
  const down = drive(() => 503);
  eq(et(down), "17:30- 17:35- 17:40- 18:15- 18:45- 19:15- 19:45- 20:15-",
    "A TRANSIENT REFUSAL is tried every half hour after 18:15 until 20:30 ET, so a GitHub outage of two hours is ridden out");
  ok(down.length <= NIGHTLY.firstTries + 1 + NIGHTLY.softRetries && down.every((a) => a.at <= at(S, 20, 30)), "at most nine calls in all, none after 20:30");
  eq(et(drive((x) => (x < at(S, 19, 30) ? 503 : 204), { landsAfter: 15 * MIN })), "17:30- 17:35- 17:40- 18:15- 18:45- 19:15- 19:45+",
    "and the first answer that sends ends it when the nightly lands: 503 until 19:30 ET sends at 19:45 and the nightly lands at 20:00, before the 21:00 line");
  eq(et(drive((x) => (x < at(S, 19, 30) ? 503 : 204))), "17:30- 17:35- 17:40- 18:15- 18:45- 19:15- 19:45+ 20:15+",
    "and a send that does not land is repeated once, 30 minutes on, as before");
  eq(et(drive((x) => (x < at(S, 18, 20) ? 0 : x < at(S, 19, 20) ? 429 : 204), { landsAfter: 15 * MIN })), "17:30- 17:35- 17:40- 18:15- 18:45- 19:15- 19:45+",
    "an unreachable API and a 429 are transient too");
  eq(et(drive((x) => (x === at(S, 17, 35) ? 503 : 403))), "17:30- 17:35- 17:40- 18:15-", "and the class that counts is the last answer: one 503 among refusals does not open the door");
  eq(et(drive((x) => (x < at(S, 18, 0) ? 204 : 403))), "17:30+ 18:15-", "A SEND THAT WAS FOLLOWED BY A REFUSED REPEAT is not tried again (the old rule called it due on every slot until the nightly landed)");
  eq(et(drive((x) => (x < at(S, 18, 0) ? 204 : 503))), "17:30+ 18:15- 18:45- 19:15- 19:45- 20:15-",
    "unless the refusal is transient, when the repeat is retried on the same half-hour cadence");

  const log = [];
  const gh = fakeGithub({ now: () => at(S, 17, 30) });
  const start = createNightlyStart({ env: { GITHUB_TOKEN: "t", GITHUB_REPOSITORY: "a/b" }, fetchImpl: gh.fetchImpl,
    log: (l) => log.push(l), warn: (l) => log.push(l) });
  const early = await start.step({ at: at(S, 16, 0), clock: null, metaSession: P });
  ok(!early.dispatched && early.busy === false && !("wakeAt" in early),
    "THE STEP stays idle before 17:30 and asks for no special wake: 17:30 ET is on the idle tick's own grid");
  ok((NIGHTLY.atMin * MIN) % LIVE_LOOP.idleMs === 0 && (NIGHTLY.atMin * MIN) % LIVE_LOOP.slotMs === 0 &&
     (NIGHTLY.retryMin * MIN) % LIVE_LOOP.slotMs === 0,
  "which the arithmetic keeps true: 17:30 and 18:15 ET are multiples of both the 15-minute idle tick and the 5-minute slot, " +
    "in any zone with a whole-quarter-hour offset, so a loop ticking on the epoch grid lands on them exactly");
  const go = await start.step({ at: at(S, 17, 30), clock: null, metaSession: P });
  ok(go.dispatched && go.dispatched.sent && go.busy === true && gh.record.dispatches.length === 1, "dispatches at 17:30 and turns busy");
  const again = await start.step({ at: at(S, 17, 35), clock: null, metaSession: P });
  ok(!again.dispatched && again.busy === true && gh.record.dispatches.length === 1, "keeps the five-minute pace without a second dispatch");
  const landed = await start.step({ at: at(S, 17, 50), clock: null, metaSession: S });
  ok(!landed.dispatched && landed.busy === false && log.some((l) => /nightly has landed/.test(l)), "and lets go once meta holds the session");
  const tomorrow = await start.step({ at: at("2026-09-30", 17, 30), clock: null, metaSession: S });
  ok(tomorrow.dispatched && tomorrow.dispatched.sent, "the next day's bookkeeping starts empty");
}

{
  const S = D;
  const view = (over = {}) => witnessView({ key: "clock", clock: {
    day: S, trading: 1, earlyClose: null, closedDays: [], tier1: { at: null, okAt: null, why: "written" }, summaryAt: null,
    dispatchWhy: "no-token", ...over } });
  const market = (t) => ({ ok: true, payload: { fresh: { readAt: new Date(t).toISOString() } } });
  const T1 = (h, m, s = 0) => at(S, h, m, s);
  const tier1 = (now, over) => evaluateTier1({ at: now, view: view({ tier1: { at: new Date(now - 4 * MIN).toISOString(),
    okAt: new Date(now - 4 * MIN).toISOString(), why: "written" } }), market: market(now - 4 * MIN), focus: market(now - 2 * MIN), ...over });
  eq(tier1(T1(11, 0)).status, "ok", "TIER 1, healthy: a tick, live:market and live:focus all within five minutes");
  const stale = WITNESS.tier1StaleMs;
  eq(stale, FRESH_CLASSES.market.staleS * 1000, "the line is the readers' stale line for the market class, 25 minutes");
  const lateAt = T1(11, 30);
  const one = (age) => evaluateTier1({ at: lateAt, view: view({ tier1: { at: new Date(lateAt - 4 * MIN).toISOString(), okAt: null, why: "written" } }),
    market: market(lateAt - age), focus: market(lateAt - MIN) });
  deep([one(stale).status, one(stale + 1000).status], ["ok", "breach"], "exactly 25:00 old is healthy and 25:01 is a breach: older than 25 minutes");
  const m = one(30 * MIN);
  ok(m.status === "breach" && /live:market: 11:00 ET, 30 min before this check/.test(m.detail) && !/last tick/.test(m.detail) &&
     /readers see Stale from 25 minutes/.test(m.detail),
  "and it names the key that is late, not the ones that are not");
  const cron = evaluateTier1({ at: lateAt, view: view({ tier1: { at: new Date(lateAt - 40 * MIN).toISOString(), okAt: null, why: "written" } }),
    market: market(lateAt - 40 * MIN), focus: market(lateAt - 40 * MIN) });
  ok(cron.status === "breach" && cron.evidence.length === 3 && /Tier 1's last tick/.test(cron.detail) &&
     /live:focus/.test(cron.detail), "a dead cron shows on the tick, the market and the focus key together");
  const noKey = evaluateTier1({ at: lateAt, view: view({ tier1: { at: new Date(lateAt - MIN).toISOString(), okAt: null,
    why: "error:no-key" } }), market: market(lateAt - 40 * MIN), focus: market(lateAt - MIN) });
  ok(noKey.status === "breach" && /Tier 1's last outcome: error:no-key/.test(noKey.detail),
    "a Worker that ticks but cannot write says why (the outcome it recorded)");
  const open = at(S, 9, 30);
  const early = (min, read) => evaluateTier1({ at: open + min * MIN, view: view({ tier1: { at: null, okAt: null, why: null } }), market: read, focus: read });
  deep([early(10, { pending: true }).status, early(25, { pending: true }).status, early(26, { pending: true }).status],
    ["pending", "pending", "breach"], "NOTHING WRITTEN YET counts from the open, not from yesterday: pending for 25 minutes, then a breach");
  eq(early(26, { pending: true }).evidence.every((e) => e.at === null), true, "and the evidence says nothing has been written since the open");
  deep(evaluateTier1({ at: T1(11, 0), view: view({ tier1: { at: null, okAt: null, why: "off" } }) }).status, "skip",
    "FLOWS_LIVE_MODE off is a rollback, not a lapse");
  deep([evaluateTier1({ at: at(S, 9, 29, 59), view: view() }).status, evaluateTier1({ at: at(S, 16, 10, 1), view: view() }).status,
    evaluateTier1({ at: at("2026-10-03", 11, 0), view: witnessView({ clock: { day: "2026-10-03", trading: null } }) }).status,
    evaluateTier1({ at: at(S, 11, 0), view: view({ trading: 0 }) }).status], ["skip", "skip", "skip", "skip"],
  "and the check runs only from the open to ten minutes past the close of a trading day the tape has not closed");
  eq(evaluateTier1({ at: at(S, 16, 10), view: view({ tier1: { at: new Date(at(S, 16, 6)).toISOString(), okAt: null, why: "written" } }),
    market: market(at(S, 16, 6)), focus: market(at(S, 16, 8)) }).status, "ok", "the last due tick, 16:10 ET, is still inside it");
  eq(evaluateTier1({ at: T1(11, 0), view: null }).status, "inconclusive", "with no clock the answer is inconclusive, never a verdict");
  eq(evaluateTier1({ at: T1(11, 0), view: view({ tier1: { at: new Date(T1(10, 58)).toISOString(), okAt: null, why: "written" } }),
    market: { failed: true, status: 403 }, focus: { failed: true, status: 0 } }).status,
    "inconclusive", "unreadable keys are no evidence of health: with a fresh tick and nothing else readable the answer is inconclusive, so no issue closes on it");
  eq(evaluateTier1({ at: T1(11, 0), view: view({ tier1: { at: new Date(T1(10, 20)).toISOString(), okAt: null, why: "written" } }),
    market: { failed: true, status: 403 }, focus: { failed: true, status: 0 } }).status,
    "breach", "yet a tick that is itself 40 minutes old is a breach whatever else cannot be read");
  const noSignal = evaluateTier1({ at: T1(11, 0), view: witnessView({ clock: { day: S, trading: 1 } }), market: { failed: true }, focus: { failed: true } });
  eq(noSignal.status, "inconclusive", "and with nothing at all readable it is inconclusive");

  const nightly = (now, session, extra = {}) => evaluateNightly({ at: now, view: view(), meta: session === "failed" ? { failed: true, status: 403 }
    : session === null ? { pending: true } : { ok: true, payload: { sessionDate: session } }, ...extra });
  const P = "2026-09-28";
  deep([nightly(at(S, 20, 59, 59), P).status, nightly(at(S, 21, 0), P).status, nightly(at(S, 21, 0), S).status],
    ["ok", "breach", "ok"], "THE NIGHTLY has until 21:00 ET, the close plus five hours: fine at 20:59:59 with the last session in meta, " +
      "a breach at 21:00:00, fine once meta holds today");
  const b = nightly(at(S, 21, 5), P);
  ok(b.detail.includes("meta holds the 2026-09-28 session") && b.detail.includes("2026-09-29 session was due by 21:00 ET") &&
     b.detail.includes("before 09:30 ET on 2026-09-30"), "the breach names what meta holds, what was due and the repair deadline");
  eq(nightly(at(S, 21, 5), null).status, "breach", "an absent meta is a breach");
  eq(nightly(at(S, 21, 5), "failed").status, "inconclusive", "an unreadable meta is not");
  const pendingMeta = nightly(at(S, 21, 5), null);
  ok(pendingMeta.confirm === WITNESS.confirm.nightlyPending && /answered pending for meta/.test(pendingMeta.detail) && /failed D1 read/.test(pendingMeta.detail),
    "but a PENDING meta asks for a second look before it is a verdict, and says why: the Worker answers pending for a missing row and for a failed D1 read alike");
  ok(!("confirm" in nightly(at(S, 21, 5), P)) && !("confirm" in nightly(at(S, 21, 5), "2026-09-25")),
    "while a meta that is readable and stale is a verdict on the first tick");
  ok(WITNESS_CHECKS.nightly.remedy.some((l) => /answered pending/.test(l) && /D1/.test(l)), "and the issue's remedy tells the owner to look at the site before dispatching");

  const breadthRead = (t) => ({ ok: true, payload: { fresh: { readAt: new Date(t).toISOString() } } });
  const t2 = (now, read, over = {}) => evaluateTier2({ at: now, view: view(), breadth: read, ...over });
  const line = WITNESS.tier2StaleMs;
  eq(line, FRESH_CLASSES.breadth.staleS * 1000, "TIER 2: the line is the readers' stale line for the breadth class, 45 minutes");
  deep([t2(at(S, 11, 0), breadthRead(at(S, 10, 57))).status, t2(at(S, 11, 0), breadthRead(at(S, 11, 0) - line)).status,
    t2(at(S, 11, 0), breadthRead(at(S, 11, 0) - line - 1000)).status], ["ok", "ok", "breach"],
  "a pass three minutes ago is healthy, exactly 45:00 old is healthy and 45:01 is a breach");
  const b2 = t2(at(S, 11, 30), breadthRead(at(S, 10, 40)));
  ok(b2.status === "breach" && /live:breadth: 10:40 ET, 50 min before this check/.test(b2.detail) && /this loop is the writer/.test(b2.detail) &&
     b2.evidence.length === 1 && b2.evidence[0].name === "live:breadth", "the breach names the key, when it was last written and that this loop writes it");
  const never = t2(at(S, 11, 0), { pending: true });
  ok(never.status === "breach" && /nothing since the 09:30 ET open/.test(never.detail) && never.evidence[0].at === null,
    "nothing written since the open is a breach once 45 minutes have passed; yesterday's value counts as nothing");
  eq(t2(at(S, 11, 0), breadthRead(at(S, 16, 0) - 24 * HOUR)).status, "breach", "yesterday's last pass is not today's");
  deep([t2(at(S, 10, 14, 59), { pending: true }).status, t2(at(S, 10, 15), { pending: true }).status, t2(at(S, 10, 15, 1), { pending: true }).status,
    t2(at(S, 16, 25), breadthRead(at(S, 16, 20))).status, t2(at(S, 16, 25, 1), { pending: true }).status],
  ["skip", "pending", "breach", "ok", "skip"], "the check runs from 45 minutes after the open (nothing can be older) to 25 minutes past the close, when the last pass runs");
  deep([t2(at(S, 11, 0), { failed: true, status: 403 }).status, t2(at(S, 11, 0), null).status, evaluateTier2({ at: at(S, 11, 0), view: null, breadth: breadthRead(at(S, 10, 59)) }).status,
    t2(at(S, 11, 0), { pending: true }, { view: view({ tier1: { at: null, okAt: null, why: "off" } }) }).status,
    evaluateTier2({ at: at("2026-10-03", 11, 0), view: witnessView({ clock: { day: "2026-10-03", trading: null } }), breadth: { pending: true } }).status],
  ["inconclusive", "inconclusive", "inconclusive", "skip", "skip"], "an unreadable key or clock is no verdict, and a rollback or a weekend is not a lapse");
  let disagree = 0;
  for (let m = 10 * 60 + 16; m < 16 * 60; m += 1) {
    for (let lag = 0; lag <= 60; lag += 1) {
      const now = easternInstant(S, m);
      const late = evaluateTier2({ at: now, view: view(), breadth: breadthRead(now - lag * MIN) }).status === "breach";
      if (late !== liveStalled(now, now - lag * MIN, view().clock)) disagree++;
    }
  }
  eq(disagree, 0, "and it agrees with the Worker's own watchdog, liveStalled, on every minute of the session from 10:16 and every lag to an hour: the witness says aloud what the Worker can only log");
  deep([tier2Window(at(S, 11, 0), view()), tier2Window(at(S, 10, 0), view()), tier2Window(at(S, 16, 24), view()), tier2Window(at(S, 16, 26), view()),
    tier2Window(at(S, 11, 0), null), tier2Window(at("2026-10-03", 11, 0), witnessView({ clock: { day: "2026-10-03", trading: null } }))],
  [true, false, true, false, false, false], "the watch reads live:breadth only inside that window");
  const fri = "2026-10-02";
  deep([evaluateNightly({ at: at("2026-10-03", 12, 0), view: witnessView({ clock: { day: "2026-10-03", trading: null } }),
    meta: { ok: true, payload: { sessionDate: "2026-10-01" } } }).status,
  evaluateNightly({ at: at("2026-10-05", 20, 0), view: null, meta: { ok: true, payload: { sessionDate: "2026-10-01" } } }).status,
  evaluateNightly({ at: at("2026-10-05", 20, 0), view: null, meta: { ok: true, payload: { sessionDate: fri } } }).status],
  ["breach", "breach", "ok"], "A MISSED FRIDAY stays a breach through the weekend and Monday until 21:00 Monday's own nightly or a later session lands");
  eq(evaluateNightly({ at: at("2026-11-27", 21, 0), view: witnessView({ clock: { day: "2026-11-27", trading: 1, earlyClose: 1 } }),
    meta: { ok: true, payload: { sessionDate: "2026-11-25" } } }).status, "breach", "an early close is due at 21:00 ET too");
  eq(evaluateNightly({ at: at("2026-09-30", 10, 0), view: witnessView({ clock: { day: "2026-09-30", trading: 1,
    closedDays: [S] } }), meta: { ok: true, payload: { sessionDate: P } } }).status, "ok",
  "and a day the tape proved closed is no session: the closed days the Worker keeps are honoured");

  const body = { key: "clock", ledger: { cardsFailed: 0 }, clock: { day: S, trading: "1", earlyClose: 1, closedDays: ["2026-09-07", "junk", 4],
    tier1: { at: "2026-09-29T14:56:00.000Z", okAt: "x", why: "written" }, summaryAt: "2026-09-29T14:45:00.000Z", dispatchWhy: "no-token" } };
  const v = witnessView(body);
  ok(v.clock.trading === null && v.clock.earlyClose === 1 && v.clock.closedDays.join() === "2026-09-07" && v.tier1.atMs === Date.parse("2026-09-29T14:56:00Z") &&
     Number.isNaN(v.tier1.okAtMs) && v.ledger.cardsFailed === 0 && v.dispatchWhy === "no-token",
  "THE CLOCK BODY is read as the Worker serves it: flags that are not exactly 0 or 1 are unknown, closed days are cleaned, " +
    "and a ledger the ledger stream adds rides along untouched");
  deep([witnessView(null), witnessView({}), witnessView({ clock: { day: "2026-9-1" } })], [null, null, null], "and anything malformed is no clock");
  eq(witnessView({ clock: { day: S } }).ledger, null, "a Worker without the ledger reads as none");
  eq(witnessView({ clock: { day: S }, ledger: { a: 1 } }).ledger.a, 1, "wherever the ledger sits");
  deep([tier1Window(at(S, 11, 0), view()), tier1Window(at(S, 17, 0), view()), tier1Window(at(S, 11, 0), null)], [true, false, false],
    "the watch reads live:market and live:focus only inside Tier 1's window");
  deep([normalizeRead({ payload: { a: 1 }, status: 200 }), normalizeRead({ payload: null, absent: true }), normalizeRead({ failed: true, status: 403 }),
    normalizeRead(null)], [{ ok: true, payload: { a: 1 } }, { pending: true }, { failed: true, status: 403, detail: null },
    { failed: true, status: 0, detail: null }], "reads are ok, pending or failed, and nothing else");
}

{
  const makeReporter = ({ seed = [], failOpen = 0, failClose = 0, failReopen = 0, ghostOpens = 0 } = {}) => {
    const calls = [];
    const open = seed.map((it) => ({ ...it }));
    let n = 700;
    let opens = failOpen;
    let closes = failClose;
    let reopens = failReopen;
    let ghosts = ghostOpens;
    return {
      enabled: true, calls,
      list: async () => { calls.push(["list"]); return { ok: true, issues: open.map((it) => ({ ...it })) }; },
      open: async ({ title, body }) => {
        calls.push(["open", title, body]);
        if (opens-- > 0) return { ok: false, why: "HTTP 500" };
        const number = n++;
        const id = /^\[flows-witness:([a-z0-9-]+)\]/.exec(title)[1];
        open.push({ number, id, updatedAt: 0 });
        if (ghosts-- > 0) return { ok: false, why: "unreachable" };
        return { ok: true, number };
      },
      comment: async (number, body) => { calls.push(["comment", number, body]); return { ok: true }; },
      close: async (number, reason = "completed") => {
        calls.push(["close", number, reason]);
        if (closes-- > 0) return { ok: false, why: "HTTP 500" };
        const at = open.findIndex((it) => it.number === number);
        if (at >= 0) open.splice(at, 1);
        return { ok: true };
      },
      reopen: async (number) => {
        calls.push(["reopen", number]);
        if (reopens-- > 0) return { ok: false, why: "HTTP 500" };
        open.push({ number, id: "tier1", updatedAt: 0 });
        return { ok: true };
      },
    };
  };
  const kinds = (r) => r.calls.map((c) => c[0]);
  const breach = (id) => ({ id, status: "breach", detail: id + " is late" });
  const good = (id) => ({ id, status: "ok" });
  const lines = [];
  const mk = (reporter) => createWitness({ reporter, env: { GITHUB_REPOSITORY_OWNER: "anilkaya001", GITHUB_REPOSITORY: "anilkaya001/anilkaya.org",
    GITHUB_RUN_ID: "42" }, log: (l) => lines.push(l), warn: (l) => lines.push(l) });
  let t = at(D, 11, 0);
  let rep = makeReporter();
  let w = mk(rep);
  await w.start();
  await w.apply([breach("tier1")], { at: t });
  deep(kinds(rep), ["list"], "TIER 1 NEEDS TWO BREACHES IN A ROW: one late tick opens nothing");
  await w.apply([good("tier1")], { at: t += 5 * MIN });
  await w.apply([breach("tier1")], { at: t += 5 * MIN });
  await w.apply([{ id: "tier1", status: "pending" }], { at: t += 5 * MIN });
  await w.apply([breach("tier1")], { at: t += 5 * MIN });
  deep(kinds(rep), ["list"], "a recovery or a pending tick between two breaches resets the count");
  await w.apply([breach("tier1")], { at: t += 5 * MIN });
  deep(kinds(rep), ["list", "open"], "the second consecutive breach opens one issue");
  ok(rep.calls[1][1] === issueTitle("tier1") && /^\[flows-witness:tier1\] /.test(rep.calls[1][1]) &&
     rep.calls[1][2].startsWith("@anilkaya001\n") && /actions\/runs\/42/.test(rep.calls[1][2]),
  "titled by check id, mentioning the owner (a mention notifies even when the owner does not watch the repo), linking the run");
  await w.apply([breach("tier1")], { at: t += 5 * MIN });
  await w.apply([{ id: "tier1", status: "inconclusive" }, { id: "tier1", status: "skip" }], { at: t += 5 * MIN });
  deep(kinds(rep), ["list", "open"], "a persisting breach adds nothing inside six hours");
  await w.apply([breach("tier1")], { at: t += 6 * HOUR });
  deep(kinds(rep), ["list", "open", "comment"], "and one reminder comment after six");
  await w.apply([breach("tier1")], { at: t += 2 * MIN });
  eq(kinds(rep).length, 3, "not another until six more");
  ok(w.isOpen("tier1") && w.summary().breached.join() === "tier1" && w.summary().open.join() === "tier1", "the summary lists it open and confirmed");
  await w.apply([good("tier1")], { at: t += 5 * MIN });
  await w.apply([good("tier1")], { at: t += 5 * MIN });
  await w.apply([breach("tier1")], { at: t += 5 * MIN });
  await w.apply([good("tier1")], { at: t += 5 * MIN });
  await w.apply([{ id: "tier1", status: "skip" }], { at: t += 5 * MIN });
  await w.apply([good("tier1")], { at: t += 5 * MIN });
  await w.apply([good("tier1")], { at: t += 5 * MIN });
  deep(kinds(rep).slice(3), [], "RECOVERY IS NOT DECLARED ON ONE HEALTHY TICK: two, a breach, one, a skip and two more are no three in a row, " +
    "so the issue stays open and nothing is said");
  ok(w.isOpen("tier1") && w.summary().open.join() === "tier1", "still open");
  await w.apply([good("tier1")], { at: t += 5 * MIN });
  deep(kinds(rep).slice(3), ["comment", "close"], "the third consecutive healthy tick comments and closes the issue");
  ok(!w.isOpen("tier1") && w.summary().open.length === 0 && w.summary().breached.join() === "tier1",
    "and the summary still remembers the run saw a lapse, which is what turns the run red");
  await w.apply([good("tier1")], { at: t += 5 * MIN });
  eq(kinds(rep).length, 5, "a healthy tick after that costs no call");
  deep([WITNESS.recover.tier1, WITNESS.recover.tier2, WITNESS.recover.probe, WITNESS.recover.nightly, WITNESS.recover.chain], [3, 3, 3, 1, 1],
    "the hysteresis: a live key or the ingest route must be healthy for three ticks, while the nightly (it lands once) and the chain close on the first proof");
  await w.apply([breach("tier1")], { at: t += 20 * MIN });
  await w.apply([breach("tier1")], { at: t += 5 * MIN });
  deep(kinds(rep).slice(5), ["reopen", "comment"], "A FLAP REOPENS THE SAME ISSUE: a breach confirmed within six hours of the close reopens it and says so, " +
    "instead of opening a second one");
  ok(rep.calls[5][0] === "reopen" && rep.calls[5][1] === 700 && rep.calls[6][1] === 700 && rep.calls[6][2].startsWith("@anilkaya001\n"),
    "by its number, with the owner mentioned so the reopening notifies");
  eq(w.summary().issues.tier1, 700, "and the summary points at it");
  for (let i = 0; i < 3; i++) await w.apply([good("tier1")], { at: t += 5 * MIN });
  await w.apply([breach("tier1")], { at: t += 6 * HOUR + MIN });
  await w.apply([breach("tier1")], { at: t += 5 * MIN });
  deep(kinds(rep).slice(7), ["comment", "close", "open"], "but six hours after the close it is a new incident and gets a new issue");
  rep = makeReporter({ failReopen: 1 });
  w = mk(rep);
  t = at(D, 11, 0);
  for (const step of [breach, breach, good, good, good, breach, breach]) await w.apply([step("tier1")], { at: t += 5 * MIN });
  deep(kinds(rep), ["list", "open", "comment", "close", "reopen", "open"], "and a reopen GitHub refuses falls back to a new issue");

  rep = makeReporter({ seed: [{ number: 55, id: "nightly", updatedAt: t - HOUR }, { number: 56, id: "tier1", updatedAt: t - 8 * HOUR }] });
  w = mk(rep);
  await w.start();
  await w.apply([breach("nightly")], { at: t });
  deep(kinds(rep), ["list"], "AN ISSUE A PREVIOUS RUN LEFT OPEN IS FOUND, not duplicated: nothing new opens, and it is not nagged within six hours");
  await w.apply([breach("tier1"), breach("tier1")], { at: t });
  deep(kinds(rep), ["list", "comment"], "one that has been quiet for eight hours gets its reminder");
  await w.apply([good("nightly")], { at: t + 5 * MIN });
  deep(kinds(rep).slice(2), ["comment", "close"], "and a healthy tick closes the one this run never raised");
  deep(rep.calls[3], ["close", 55, "completed"], "by its number, as completed");

  rep = makeReporter({ seed: [{ number: 60, id: "chain", updatedAt: t }] });
  w = mk(rep);
  await w.start();
  await w.clear("chain", { at: t });
  deep(rep.calls.slice(1).map((c) => [c[0], c[1]]), [["comment", 60], ["close", 60]], "A LOOP THAT IS RUNNING closes the chain issue the last one left");
  await w.clear("chain", { at: t });
  eq(rep.calls.length, 3, "and only once");

  rep = makeReporter({ seed: [{ number: 5, id: "nightly", updatedAt: t - 9 * HOUR }, { number: 7, id: "nightly", updatedAt: t - HOUR },
    { number: 6, id: "tier1", updatedAt: t - HOUR }] });
  w = mk(rep);
  await w.start();
  deep(w.summary().issues, { nightly: 7, tier1: 6 }, "TWO OPEN ISSUES FOR ONE CHECK are both found: the newest is the one the loop keeps");
  await w.apply([breach("nightly")], { at: t });
  deep(rep.calls.slice(1).map((c) => [c[0], c[1], c[2]]).filter((c) => c[0] === "close" || c[0] === "comment"),
    [["close", 5, "not_planned"], ["comment", 7, "Closed #5 as a duplicate of this issue."]],
    "a duplicate is closed as not planned the first time the check is raised, with a note on the one that stays");
  await w.apply([good("nightly")], { at: t + 5 * MIN });
  deep(rep.calls.slice(-2).map((c) => c[0] + c[1]), ["comment7", "close7"], "and recovery closes the one that stayed");
  rep = makeReporter({ seed: [{ number: 5, id: "nightly", updatedAt: t - 9 * HOUR }, { number: 7, id: "nightly", updatedAt: t - HOUR }] });
  w = mk(rep);
  await w.start();
  await w.apply([good("nightly")], { at: t });
  deep(rep.calls.slice(1).map((c) => c[0] + c[1]), ["comment7", "close5", "comment7", "close7"],
    "a healthy tick with two left open by earlier runs closes both, so none is left open for ever");

  rep = makeReporter({ ghostOpens: 1 });
  w = mk(rep);
  t = at(D, 21, 0);
  await w.apply([breach("nightly")], { at: t });
  await w.apply([breach("nightly")], { at: t + 5 * MIN });
  await w.apply([breach("nightly")], { at: t + 15 * MIN });
  deep(kinds(rep), ["list", "open", "list"], "AN OPEN WHOSE ANSWER NEVER CAME may have created the issue: the retry looks before it opens another");
  eq(w.summary().issues.nightly, 700, "and adopts what it finds");
  deep(kinds(rep).filter((k) => k === "open").length, 1, "so one issue exists where a blind retry would have made two");

  rep = makeReporter({ failOpen: 1 });
  w = mk(rep);
  t = at(D, 21, 0);
  await w.apply([breach("nightly")], { at: t });
  await w.apply([breach("nightly")], { at: t + 5 * MIN });
  await w.apply([breach("nightly")], { at: t + 15 * MIN });
  deep(kinds(rep), ["list", "open", "list", "open"], "AN ISSUE THAT COULD NOT BE OPENED is tried again after 15 minutes, not every tick, " +
    "and the retry first looks for the issue the failed call may have created");
  ok(lines.some((l) => /could not open the nightly issue \(HTTP 500\)/.test(l)) && lines.some((l) => /^::error title=/.test(l)),
    "and the run says so on its own page (an annotation), so the red run is explained even when the issue is not");
  rep = makeReporter({ failClose: 1 });
  w = mk(rep);
  await w.apply([breach("nightly")], { at: t });
  await w.apply([good("nightly")], { at: t + 5 * MIN });
  await w.apply([good("nightly")], { at: t + 10 * MIN });
  deep(kinds(rep), ["list", "open", "comment", "close", "close"], "a close that failed is retried without a second recovery comment");
  w = createWitness({ reporter: null, log() {}, warn() {} });
  await w.apply([breach("nightly")], { at: t });
  await w.apply([good("nightly")], { at: t });
  ok(w.summary().breached.join() === "nightly" && w.summary().open.length === 0, "with no reporter at all it still counts the lapse and never throws");
  const disabled = createWitness({ reporter: { enabled: false, calls: [] }, log() {}, warn() {} });
  await disabled.apply([breach("nightly")], { at: t });
  eq(disabled.summary().breached.join(), "nightly", "as when the job has no token");

  rep = makeReporter();
  w = mk(rep);
  await w.raiseNow("chain", breach("chain"), { at: t });
  deep(kinds(rep), ["list", "open"], "a chain failure opens at once: it has no second look coming");
  rep = makeReporter();
  w = mk(rep);
  t = at(D, 21, 0);
  const pendingBreach = { id: "nightly", status: "breach", detail: "the store answered pending for meta", confirm: WITNESS.confirm.nightlyPending };
  await w.apply([pendingBreach], { at: t });
  deep([kinds(rep), w.isOpen("nightly"), w.summary().breached], [[], true, []],
    "A PENDING META ALONE opens nothing and asks to be read again (the check stays open for the loop's next tick)");
  await w.apply([good("nightly")], { at: t += 5 * MIN });
  await w.apply([pendingBreach], { at: t += 5 * MIN });
  deep([kinds(rep), w.isOpen("nightly")], [[], true], "a readable meta in between clears it");
  await w.apply([pendingBreach], { at: t += 5 * MIN });
  deep(kinds(rep), ["list", "open"], "two pending reads in a row are a lapse");
  rep = makeReporter();
  w = mk(rep);
  await w.apply([breach("nightly")], { at: t });
  deep(kinds(rep), ["list", "open"], "while a readable, stale meta needs no second look");
  rep = makeReporter();
  w = mk(rep);
  await w.apply([pendingBreach], { at: t });
  await w.apply([breach("nightly")], { at: t + 5 * MIN });
  deep(kinds(rep), ["list", "open"], "and a pending read followed by a stale one counts as the two");
  deep([WITNESS.confirm.tier1, WITNESS.confirm.tier2, WITNESS.confirm.nightly, WITNESS.confirm.nightlyPending, WITNESS.confirm.chain,
    WITNESS.confirm.probe], [2, 2, 1, 2, 1, 3],
  "THE DEBOUNCE: Tier 1 and Tier 2 two ticks (ten minutes), the nightly none when meta is readable and two when the store answered " +
    "pending (a failed D1 read looks the same), the chain none (a dead end), a blind probe three");
  eq(annotation("error", "Tier 1: stale, 100%", "line one\nline two: 5%"), "::error title=Tier 1%3A stale%2C 100%25::line one%0Aline two: 5%25",
    "ANNOTATIONS are escaped as the runner reads them (a colon or comma in a title and a newline in a message would otherwise end the command early)");
  ok(lines.filter((l) => l.startsWith("::error")).every((l) => /^::error title=[^:,]*::/.test(l)),
    "so every annotation the witness wrote parses");
  deep(Object.keys(WITNESS_CHECKS).sort(), ["chain", "drill", "nightly", "probe", "tier1", "tier2"], "five checks and the drill in all");
  eq(ownerHandle({ GITHUB_REPOSITORY_OWNER: "not valid!" , GITHUB_REPOSITORY: "anilkaya001/x" }), "anilkaya001", "the owner handle is validated before it is mentioned");
  eq(runUrl({ GITHUB_REPOSITORY: "a/b", GITHUB_RUN_ID: "9x" }), null, "and a run URL needs a numeric run id");
  ok(!/\/\/(?!github\.com)/.test(issueBody("tier1", { detail: "x" }, { at: t, env: {} }).replace(/https:\/\/\S+/g, "")), "and an issue body carries no secret");
}

{
  const sent = [];
  const reply = (status, json) => ({ status, ok: status < 300, json: async () => json });
  const fetchImpl = async (url, init) => {
    sent.push({ url, init });
    if (init.method === "GET") {
      const bot = { login: "github-actions[bot]", type: "Bot" };
      return reply(200, [
        { number: 3, title: "[flows-witness:nightly] The nightly has not landed", updated_at: "2026-09-29T21:05:00Z", user: bot },
        { number: 4, title: "[flows-witness:tier1] x", updated_at: "2026-09-29T15:00:00Z", pull_request: {}, user: bot },
        { number: 5, title: "An ordinary issue", updated_at: "2026-09-29T15:00:00Z", user: bot },
        { number: 9, title: "[flows-witness:nightly] The nightly has not landed", updated_at: "2026-09-29T21:30:00Z",
          user: { login: "someone-else", type: "User" } },
        { number: 10, title: "[flows-witness:chain] x", updated_at: "2026-09-29T21:30:00Z" },
      ]);
    }
    return reply(201, { number: 8 });
  };
  const env = { GITHUB_TOKEN: "ghs_job", GITHUB_REPOSITORY: "anilkaya001/anilkaya.org" };
  const r = createIssueReporter({ env, fetchImpl });
  const listed = await r.list();
  deep(listed, { ok: true, issues: [{ number: 3, id: "nightly", updatedAt: Date.parse("2026-09-29T21:05:00Z") }] },
    "THE REPORTER lists only open witness issues, not pull requests or other people's issues, and not a look-alike title " +
      "that a stranger opened (the repository is public) or one with no author: only what the job's own token wrote");
  ok(sent[0].url === "https://api.github.com/repos/anilkaya001/anilkaya.org/issues?state=open&sort=updated&direction=desc&per_page=100" &&
     sent[0].init.headers.Authorization === "Bearer ghs_job" && sent[0].init.signal instanceof AbortSignal && !("body" in sent[0].init),
  "with the job's token, a deadline and no body on a GET");
  deep(await r.open({ title: "t", body: "b" }), { ok: true, number: 8 }, "opens with a title and body");
  deep(JSON.parse(sent[1].init.body), { title: "t", body: "b" }, "and nothing else (no labels, which a repository may not have)");
  await r.comment(8, "hello");
  eq(sent[2].url.endsWith("/issues/8/comments") && sent[2].init.method === "POST", true, "comments on its number");
  await r.close(8);
  deep([sent[3].init.method, JSON.parse(sent[3].init.body)], ["PATCH", { state: "closed", state_reason: "completed" }], "closes as completed");
  await r.close(9, "not_planned");
  deep(JSON.parse(sent[4].init.body), { state: "closed", state_reason: "not_planned" }, "or as not planned for a duplicate");
  await r.reopen(8);
  deep([sent[5].url.endsWith("/issues/8"), sent[5].init.method, JSON.parse(sent[5].init.body)], [true, "PATCH", { state: "open", state_reason: "reopened" }],
    "and reopens with the reason GitHub records");
  const none = createIssueReporter({ env: {}, fetchImpl });
  deep([none.enabled, none.why, (await none.list()).ok], [false, "no-token", false], "with no token it is off and says why");
  const down = createIssueReporter({ env, fetchImpl: async () => { throw new Error("offline"); } });
  const failed = await down.open({ title: "t", body: "b" });
  ok(!failed.ok && failed.why === "unreachable", "and an unreachable API is a result, not an exception");
  const denied = createIssueReporter({ env, fetchImpl: async () => reply(403, { message: "Resource not accessible by integration" }) });
  deep(await denied.open({ title: "t", body: "b" }), { ok: false, why: "HTTP 403" }, "a refusal names its status");
}

{
  const result = await dryLiveDay({ log: () => {}, warn: () => {} });
  deep(result.problems, [], "THE DRY DAYS: every scenario's own expectations hold");
  eq(result.scenarios.length, DRY_SCENARIOS.length, "all of them ran");
  const by = (needle) => result.scenarios.find((s) => s.name.includes(needle));
  const healthy = by("healthy afternoon");
  ok(healthy.nightlyDispatches.length === 1 && healthy.issues.length === 0 && healthy.failed === false && healthy.chainDispatches.length === 1,
    "a healthy afternoon sends the nightly once, opens nothing, stays green and hands over");
  const blip = by("Tier 1 stops");
  ok(blip.issues.length === 1 && blip.closed === 1 && blip.failed, "a Tier 1 stall opens one issue, closes it on recovery and turns the run red");
  const weekend = by("weekend");
  ok(weekend.passes === 0 && weekend.githubCalls === 2 && weekend.reads === weekend.ticks + 1,
    `A WEEKEND COSTS ONE CLOCK READ A QUARTER HOUR (${weekend.reads} store reads over ${weekend.ticks} ticks), one meta read to start ` +
      "and two GitHub calls");
  const nightlyMiss = by("never lands");
  ok(nightlyMiss.issues.length === 1 && nightlyMiss.failed && nightlyMiss.nightlyDispatches.length === 2,
    "a nightly that never lands is dispatched twice and reported once");
  ok(by("refuses").nightlyDispatches.length === 4 && by("chain dispatch").issues.length === 1 && by("ingest route").closed === 1,
    "and a refusal, a broken chain and a dark ingest route each say so");
  const outage = by("fails the nightly dispatch");
  ok(outage.nightlyDispatches.length === 7 && outage.issues.length === 0 && !outage.failed && outage.githubCalls <= 7 + 2 + 3,
    `A GITHUB OUTAGE OF TWO HOURS is ridden out: ${outage.nightlyDispatches.length} dispatches on a half-hour cadence, the seventh sent, no issue, a green run`);
  const flapping = by("intermittent feed");
  ok(flapping.issues.length === 1 && flapping.closed >= 4 && flapping.failed,
    `AN INTERMITTENT FEED is one issue, reopened on each flap (${flapping.closed} closes, ${flapping.comments} comments), and still turns the run red`);
  ok(by("Tier 2 stops").issues.length === 1 && by("Tier 2 stops").closed === 1 && by("Tier 2 stops").failed,
    "A TIER 2 THAT PASSES BUT DOES NOT PUBLISH is one issue, closed on recovery");
  const challengedClock = by("clock read is challenged");
  ok(challengedClock.issues.length === 0 && !challengedClock.failed && !challengedClock.problems.length,
    "A CLOCK READ CHALLENGED ON THREE TICKS IN A ROW (issue #144) raises nothing: the witness keeps the last good clock of the day and still reads Tier 1 and Tier 2");
  const evening = by("idle ticks");
  ok(evening.issues.length === 0 && !evening.failed && !evening.problems.length,
    "AN IDLE EVENING WHOSE CLOCK READ IS CHALLENGED ONCE A TICK raises nothing: the clock is the only read there, and its retry answers");
  const blind = by("every read is challenged");
  ok(blind.issues.length === 1 && /^\[flows-witness:probe\]/.test(blind.issues[0].title) && blind.closed === 1 && !blind.problems.length,
    "while three ticks on which every read fails, each tried twice, still open the probe issue, and it closes when reads return");
  ok(by("one pending answer").issues.length === 1 && by("one pending answer").closed === 1 && !by("after midnight").problems.length &&
     by("after midnight").closed === 1, "a pending answer from meta is a lapse only when it repeats, and a nightly that lands after midnight closes its issue");
  const src = read("scripts/flows-pipeline.mjs");
  ok(/if \(DRY_RUN\) \{\s*const ticks = await dryLiveTicks\(\{ publish, store: publishedStore, shapeNews \}\);\s*const day = await dryLiveDay\(\{\}\);/.test(src) &&
     /if \(day\.problems\.length\) \{[\s\S]*?process\.exitCode = 1;/.test(src),
  "--live --dry-run runs the days and exits non-zero when one breaks its expectation");
  const cli = spawnSync("node", [new URL("scripts/flows-pipeline.mjs", ROOT).pathname, "--live", "--dry-run"], { encoding: "utf8" });
  const dayLines = cli.stdout.split("\n").filter((l) => l.startsWith("live day (dry run):"));
  ok(cli.status === 0 && dayLines.length === DRY_SCENARIOS.length && !/PROBLEM/.test(cli.stdout + cli.stderr),
    `and it does, from the command line: ${dayLines.length} days, exit ${cli.status}`);
  ok(/run RED/.test(cli.stdout) && /run green/.test(cli.stdout), "printing which days turn the run red and which stay green");
}

{
  const S = D;
  const drive = async (world, { budgetMs, watchOver = {}, passes = null, chain = null, loopOver = {} } = {}) => {
    let body = null;
    const notes = [];
    const watch = createWatch({ readOnce: world.readOnce, latestClock: () => body, env: world.env(), fetchImpl: world.github.fetchImpl,
      log: (l) => notes.push(l), warn: (l) => notes.push(l), ...watchOver });
    const loop = await runLiveLoop({ now: world.now, sleep: world.sleep, budgetMs, log() {}, warn: (l) => notes.push(l), watch,
      readClock: () => readLiveClock(world.readOnce, { seen: (b) => { body = b; } }),
      pass: passes || (async () => { world.advance(20000); return { skipped: null, answered: 10, landed: 5 }; }),
      chain: chain || (async () => ({ sent: true, why: "sent", status: 204 })), ...loopOver });
    return { loop, notes };
  };
  const issues = (w) => w.github.record.created.filter((c) => /flows-witness/.test(c.title));

  let w = fakeWorld({ day: S, start: at(S, 9, 20), tier1Down: [[at(S, 11, 0), at(S, 11, 15)]] });
  let r = await drive(w, { budgetMs: 3 * HOUR });
  eq(issues(w).length, 0, "A FIFTEEN-MINUTE STALL raises nothing: the tick after it is inside the 25-minute line");
  w = fakeWorld({ day: S, start: at(S, 9, 20), tier1Down: [[at(S, 11, 0), at(S, 11, 24)]] });
  r = await drive(w, { budgetMs: 3 * HOUR });
  eq(issues(w).length, 0, "and one late tick alone (a 24-minute stall seen once at 11:25) raises nothing either");
  w = fakeWorld({ day: S, start: at(S, 9, 20), marketDown: [[at(S, 11, 0), at(S, 12, 0)]] });
  r = await drive(w, { budgetMs: 3 * HOUR });
  ok(issues(w).length === 1 && /live:market/.test(issues(w)[0].body) && !/Tier 1's last tick: /.test(issues(w)[0].body.split("Evidence")[0]),
    "A VENDOR OUTAGE with the cron alive is a Tier 1 lapse too, and the issue names live:market, not the cron");
  w = fakeWorld({ day: S, start: at(S, 9, 20), tier1Down: [[at(S, 9, 32), at(S, 23, 0)]] });
  r = await drive(w, { budgetMs: 8 * HOUR });
  const comments = w.github.record.comments;
  ok(issues(w).length === 1 && comments.length === 1 && comments[0].at >= issues(w)[0].at + 6 * HOUR && comments[0].at <= at(S, 16, 11) &&
     issues(w)[0].at <= at(S, 10, 10),
  "A STALL THAT NEVER ENDS opens one issue about ten minutes past the line and comments once, six hours later, inside Tier 1's window");
  ok(liveRunVerdict(r.loop).failed && /tier1/.test(liveRunVerdict(r.loop).why), "and the run is red, naming the check");

  w = fakeWorld({ day: S, start: at(S, 17, 0), landAt: at(S, 22, 10), landOnDispatch: Infinity });
  r = await drive(w, { budgetMs: 6 * HOUR });
  const made = issues(w);
  ok(made.length === 1 && w.github.record.closed.length === 1 && w.github.record.closed[0].at >= at(S, 22, 10) && w.github.record.closed[0].at < at(S, 22, 20),
    "A NIGHTLY THAT LANDS LATE closes its issue within a tick of landing");

  const seeded = fakeWorld({ day: S, start: at(S, 21, 30), landOnDispatch: Infinity,
    github: { seed: [{ number: 12, title: "[flows-witness:nightly] The nightly has not landed by 21:00 ET", updatedAt: at(S, 21, 5) }] } });
  r = await drive(seeded, { budgetMs: 2 * HOUR });
  ok(issues(seeded).length === 0 && seeded.github.record.comments.length === 0, "A HOP AFTER 21:00 finds the issue the last run opened and adds nothing to it");

  const broken = fakeWorld({ day: S, start: at(S, 12, 0), github: {
    seed: [{ number: 31, title: "[flows-witness:chain] The live loop could not start its successor", updatedAt: at(S, 6, 0) }] } });
  r = await drive(broken, { budgetMs: 20 * MIN });
  ok(broken.github.record.closed.length === 1 && broken.github.record.closed[0].number === 31 && broken.github.record.closed[0].at < at(S, 12, 1) &&
     r.loop.watch.breached.length === 0,
  "A LOOP THAT STARTS after a broken chain closes the chain issue on its first tick, proof that the loop is alive again, and stays green");

  const hop = fakeWorld({ day: S, start: at(S, 21, 30), landAt: at(S, 21, 0) });
  r = await drive(hop, { budgetMs: HOUR });
  ok(r.loop.watch.breached.length === 0 && issues(hop).length === 0 && hop.github.record.dispatches.filter((d) => d.workflow === "flows-pipeline.yml").length === 0,
    "and a hop that finds the session landed dispatches and reports nothing");

  const mid = fakeWorld({ day: S, start: at(S, 17, 0), landOnDispatch: 25 * MIN });
  r = await drive(mid, { budgetMs: 40 * MIN });
  const second = fakeWorld({ day: S, start: at(S, 17, 40), landOnDispatch: 25 * MIN, landAt: at(S, 17, 55) });
  const carried = await drive(second, { budgetMs: HOUR });
  ok(mid.github.record.dispatches.filter((d) => d.workflow === "flows-pipeline.yml").length === 1 &&
     carried.notes.some((l) => /dispatch of flows-pipeline\.yml \(first\)/.test(l)),
  "A HOP BETWEEN THE DISPATCH AND THE LANDING costs one duplicate dispatch, which the nightly's concurrency group turns into a refresh");

  const blip = fakeWorld({ day: S, start: at(S, 10, 2), metaPending: [[at(S, 10, 0), at(S, 10, 4)]] });
  r = await drive(blip, { budgetMs: 40 * MIN });
  ok(issues(blip).length === 0 && blip.github.record.closed.length === 0 && r.loop.watch.breached.length === 0 && !liveRunVerdict(r.loop).failed &&
     blip.stat.reads.filter((x) => x.key === "meta").length >= 2 && blip.stat.reads.find((x) => x.key === "meta").at < at(S, 10, 4),
  "A SINGLE PENDING ANSWER on a hop's first tick (meta is always read there) opens no issue and leaves the run green: the loop reads meta again on the next tick and finds it");
  const dark = fakeWorld({ day: S, start: at(S, 10, 2), metaPending: [[at(S, 10, 0), at(S, 11, 0)]] });
  r = await drive(dark, { budgetMs: 90 * MIN });
  ok(issues(dark).length === 1 && /answered pending for meta/.test(issues(dark)[0].body) && /failed D1 read/.test(issues(dark)[0].body) &&
     issues(dark)[0].at >= at(S, 10, 4) && issues(dark)[0].at <= at(S, 10, 10) && dark.github.record.closed.length === 1 && dark.github.record.closed[0].at >= at(S, 11, 0),
  "but a meta that stays pending for an hour is reported after two reads, in words that say the Worker answers the same for a failed D1 read, and closes when it is readable");

  const strangers = fakeWorld({ day: S, start: at(S, 21, 30), landOnDispatch: Infinity, github: {
    seed: [{ number: 9, title: "[flows-witness:nightly] The nightly has not landed by 21:00 ET", updatedAt: at(S, 21, 20), author: "someone-else" }] } });
  r = await drive(strangers, { budgetMs: 40 * MIN });
  ok(issues(strangers).length === 1 && strangers.github.record.comments.length === 0 && strangers.github.record.closed.length === 0,
    "A LOOK-ALIKE ISSUE A STRANGER OPENED under the witness's title is not adopted, commented on or closed: the witness opens its own");

  const lost = fakeWorld({ day: S, start: at(S, 21, 30), landOnDispatch: Infinity, github: { loseCreates: 1 } });
  r = await drive(lost, { budgetMs: 90 * MIN });
  ok(issues(lost).length === 1 && lost.github.record.comments.length === 0 && r.loop.watch.issues.nightly === 100 &&
     r.notes.some((l) => /could not open the nightly issue/.test(l)) && r.notes.some((l) => /found issue #100 for nightly/.test(l)),
  "AN ISSUE WHOSE CREATION ANSWER WAS LOST (GitHub made it, the 15 s deadline fired first) is found again 15 minutes later, not made twice");

  const stuck = fakeWorld({ day: S, start: at(S, 21, 30), landOnDispatch: Infinity, landAt: at(S, 24, 20) });
  r = await drive(stuck, { budgetMs: 4 * HOUR });
  ok(issues(stuck).length === 1 && stuck.github.record.closed.length === 1 && stuck.github.record.closed[0].at >= at(S, 24, 20) &&
     stuck.github.record.closed[0].at <= at(S, 24, 40),
  "A NIGHTLY THAT LANDS AFTER MIDNIGHT closes its issue within a 15-minute tick of the landing: an open nightly issue keeps meta being read overnight and through a weekend");
  const overnightReads = stuck.stat.reads.filter((x) => x.key === "meta" && x.at > at(S, 24, 0));
  ok(overnightReads.length >= 1 && overnightReads.length <= 3, `at the cost of ${overnightReads.length} meta read(s) between midnight and the landing`);

  const tier2 = fakeWorld({ day: S, start: at(S, 9, 20), breadthDown: [[at(S, 10, 50), at(S, 12, 30)]] });
  r = await drive(tier2, { budgetMs: 4.5 * HOUR });
  ok(issues(tier2).length === 1 && /^\[flows-witness:tier2\]/.test(issues(tier2)[0].title) && /live:breadth: 10:46 ET/.test(issues(tier2)[0].body) &&
     issues(tier2)[0].at >= at(S, 11, 31) && issues(tier2)[0].at <= at(S, 11, 45) && tier2.github.record.closed.length === 1 &&
     tier2.github.record.closed[0].at >= at(S, 12, 30) && liveRunVerdict(r.loop).failed && /tier2/.test(liveRunVerdict(r.loop).why),
  "A TIER 2 THAT STOPS PUBLISHING while its passes run (breadth last written 10:46) is reported about 45 minutes on, two ticks after the line, closes three healthy ticks after it returns, and turns the run red");
  const brief = fakeWorld({ day: S, start: at(S, 9, 20), breadthDown: [[at(S, 10, 50), at(S, 11, 20)]] });
  await drive(brief, { budgetMs: 3 * HOUR });
  eq(issues(brief).length, 0, "while a half-hour gap inside the 45-minute line raises nothing");
  const sourceKinds = new Set(tier2.stat.reads.map((x) => x.key));
  ok(sourceKinds.has("live:breadth") && tier2.stat.reads.filter((x) => x.key === "live:breadth").every((x) => x.at >= at(S, 10, 15) && x.at <= at(S, 16, 25)),
    "and live:breadth is read only from 10:15 ET, not before");

  const thrower = await drive(fakeWorld({ day: S, start: at(S, 15, 50) }), { budgetMs: HOUR, watchOver: { readOnce: async () => { throw new Error("boom"); } } });
  ok(thrower.loop.exit === "budget" && thrower.loop.passes.length > 5, "A READ THAT THROWS costs a tick, not the loop");
  eq(WITNESS.readDeadlineMs, 10000, "a watch read has a ten-second deadline");
  let giveUp = null;
  const hung = await Promise.race([
    drive(fakeWorld({ day: S, start: at(S, 11, 0) }), { budgetMs: 20 * MIN, watchOver: { readDeadlineMs: 150, readOnce: () => new Promise(() => {}) } }),
    new Promise((resolve) => { giveUp = setTimeout(() => resolve("hung"), 20000); }),
  ]);
  clearTimeout(giveUp);
  ok(hung !== "hung" && hung.loop.exit === "budget", "and a read that never answers is given up on when the deadline falls, so the tick ends and the loop goes on");

  eq(LIVE_LOOP.passDeadlineMs, 4 * MIN, "A PASS has a four-minute wall deadline, about ten times the slowest pass the log has published");
  eq(LIVE_LOOP.tickDeadlineMs, 2 * MIN, "and a watch tick a two-minute one");
  const handover = LIVE_LOOP.chainRetryMs.reduce((a, b) => a + b, 0) + (LIVE_LOOP.chainRetryMs.length + 1) * LIVE_LOOP.githubTimeoutMs;
  ok(LIVE_LOOP.passDeadlineMs < LIVE_LOOP.slotMs && LIVE_LOOP.passDeadlineMs + handover <= 6 * MIN,
    `so a hung pass costs its deadline plus the hand-over (at worst ${Math.round((LIVE_LOOP.passDeadlineMs + handover) / 1000)} s with every ` +
      "dispatch retried), not the workflow's 355 minutes");
  const stuckPass = async ({ passDeadlineMs = 150, tickDeadlineMs = 2 * MIN, passes, sent = true }) => {
    const world = fakeWorld({ day: S, start: at(S, 11, 0) });
    const dispatched = [];
    let calls = 0;
    let giveUpAt = null;
    const t0 = Date.now();
    const run = await Promise.race([
      drive(world, { budgetMs: 2 * HOUR, loopOver: { passDeadlineMs, tickDeadlineMs },
        passes: async (p) => { calls++; return passes(p, world); },
        chain: async ({ at: when }) => { dispatched.push(when); return sent ? { sent: true, why: "sent", status: 204 } : { sent: false, why: "refused", status: 422 }; } }),
      new Promise((resolve) => { giveUpAt = setTimeout(() => resolve("hung"), 20000); }),
    ]);
    clearTimeout(giveUpAt);
    return { run, dispatched, calls, wallMs: Date.now() - t0, world };
  };
  const never = await stuckPass({ passes: async ({ index }, world) => {
    if (index < 2) { world.advance(20000); return { skipped: null, answered: 10, landed: 5 }; }
    return new Promise(() => {});
  } });
  ok(never.run !== "hung" && never.run.loop.exit === "hung" && never.run.loop.why === "pass-deadline" && never.wallMs < 5000,
    `A PASS THAT NEVER RESOLVES is abandoned when its deadline falls: the loop exits (${never.wallMs} ms of wall time for a 150 ms deadline) ` +
      "instead of holding the concurrency group until the workflow's timeout");
  ok(never.dispatched.length === 1 && never.run.loop.chained.sent && never.calls === 3,
    `and sends the chain dispatch exactly once (${never.dispatched.length}), after two healthy passes and the hung third`);
  ok(never.run.loop.passes.length === 3 && never.run.loop.passes[2].hung === true && never.run.loop.passes[2].errored === true &&
     never.run.notes.some((l) => /pass 3 did not finish within 0\.15 s/.test(l)),
  "the hung pass is recorded as one, and the log names it");
  const hungVerdict = liveRunVerdict(never.run.loop);
  ok(hungVerdict.failed && /a pass did not finish within its deadline/.test(hungVerdict.why) && /re-dispatched \(sent\)/.test(hungVerdict.why),
    "AND THE RUN EXITS RED, saying a pass hung and that the successor was dispatched");
  const refusedHang = await stuckPass({ passes: async () => new Promise(() => {}), sent: false });
  ok(refusedHang.run.loop.exit === "hung" && refusedHang.dispatched.length === 1 && liveRunVerdict(refusedHang.run.loop).failed &&
     /re-dispatched \(refused\)/.test(liveRunVerdict(refusedHang.run.loop).why),
  "a hung first pass whose dispatch is refused still exits red, naming the refusal");
  const slow = await stuckPass({ passDeadlineMs: 400, passes: async (p, world) => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    world.advance(20000);
    return { skipped: null, answered: 10, landed: 5 };
  } });
  ok(slow.run.loop.exit === "budget" && slow.dispatched.length === 1 && slow.run.loop.passes.every((p) => !p.hung) && slow.calls > 10,
    "while a pass that finishes inside its deadline, however slowly, is kept, and the loop runs to its budget as before");
  const throwing = await stuckPass({ passes: async ({ index }, world) => {
    world.advance(20000);
    if (index === 1) throw new Error("vendor down");
    return { skipped: null, answered: 10, landed: 5 };
  } });
  ok(throwing.run.loop.exit === "budget" && throwing.run.loop.passes[1].threw === "vendor down" && !throwing.run.loop.passes[1].hung,
    "and a pass that throws inside the deadline still costs a slot, not the loop");
  const stuckTick = await (async () => {
    const world = fakeWorld({ day: S, start: at(S, 11, 0) });
    const dispatched = [];
    let ticked = 0;
    let giveUpAt = null;
    const t0 = Date.now();
    const sticky = { tick: async () => { ticked++; return ticked < 3 ? { busy: false } : new Promise(() => {}); },
      summary: () => ({ breached: [], open: [] }) };
    const loop = await Promise.race([
      runLiveLoop({ now: world.now, sleep: world.sleep, budgetMs: 2 * HOUR, log() {}, warn() {}, watch: sticky, tickDeadlineMs: 150,
        readClock: async () => null, pass: async () => { world.advance(20000); return { skipped: null, answered: 1, landed: 1 }; },
        chain: async ({ at: when }) => { dispatched.push(when); return { sent: true, why: "sent", status: 204 }; } }),
      new Promise((resolve) => { giveUpAt = setTimeout(() => resolve("hung"), 20000); }),
    ]);
    clearTimeout(giveUpAt);
    return { loop, dispatched, ticked, wallMs: Date.now() - t0 };
  })();
  ok(stuckTick.loop !== "hung" && stuckTick.loop.exit === "hung" && stuckTick.loop.why === "tick-deadline" && stuckTick.loop.ticks === 3 &&
     stuckTick.dispatched.length === 1 && stuckTick.wallMs < 5000 && /a watch tick did not finish/.test(liveRunVerdict(stuckTick.loop).why),
  `A WATCH TICK THAT NEVER RESOLVES is given up on the same way: exit on its deadline (${stuckTick.wallMs} ms), one dispatch, a red run`);
  const pipelineSrc = read("scripts/flows-pipeline.mjs");
  ok(/settle\(loop\);\n  if \(loop\.exit === "hung"\) process\.exit\(process\.exitCode \|\| 1\);\n  return loop;/.test(pipelineSrc),
    "and the command line exits non-zero at once on a hung loop, because the abandoned pass may still hold a socket that would keep Node alive");

  eq(LIVE_LOOP.clockDeadlineMs, 10000, "The loop's own clock read has a ten-second deadline like the watch's");
  const quiet = { tick: async () => ({ busy: false }), summary: () => ({ breached: [], open: [] }) };
  for (const [name, watching] of [["kept-alive", quiet], ["legacy", null]]) {
    const world = fakeWorld({ day: S, start: at(S, 11, 0) });
    let timer = null;
    const done = await Promise.race([
      runLiveLoop({ now: world.now, sleep: world.sleep, budgetMs: 12 * MIN, log() {}, warn() {}, watch: watching, clockDeadlineMs: 60,
        readClock: () => new Promise(() => {}), pass: async () => ({ skipped: null, answered: 1, landed: 1 }),
        chain: async () => ({ sent: true, why: "sent", status: 204 }) }),
      new Promise((resolve) => { timer = setTimeout(() => resolve("hung"), 20000); }),
    ]);
    clearTimeout(timer);
    ok(done !== "hung" && done.exit === "budget", `and a clock read that never answers cannot hold the ${name} loop past it: the tick is skipped and the loop goes on`);
  }

  const errored = fakeWorld({ day: S, start: at(S, 15, 50) });
  const seenFirst = [];
  let bodyForErr = null;
  const wobble = { tick: async (t) => { seenFirst.push(t.first); if (seenFirst.length === 2) throw new Error("watch broke"); return { busy: false }; }, summary: () => ({ breached: [], open: [] }) };
  const rr = await runLiveLoop({ now: errored.now, sleep: errored.sleep, budgetMs: HOUR, log() {}, warn() {}, watch: wobble,
    readClock: () => readLiveClock(errored.readOnce, { seen: (b) => { bodyForErr = b; } }),
    pass: async () => ({ skipped: null, answered: 1, landed: 1 }), chain: async () => ({ sent: true, why: "sent", status: 204 }) });
  ok(seenFirst[0] === true && seenFirst.slice(1).every((f) => f === false) && rr.ticks === seenFirst.length && rr.exit === "budget",
    "THE LOOP tells the watch which tick is the first, once, and carries on when the watch throws");
}

{
  const S = D;
  deep([{ failed: true, status: 403 }, { failed: true, status: 408 }, { failed: true, status: 429 }, { failed: true, status: 500 },
    { failed: true, status: 503 }, { failed: true, status: 0, detail: "timeout" }].map(challenged), [true, true, true, true, true, true],
  "A CHALLENGED READ is a 403, a 408, a 429, a 5xx, a timeout or no answer");
  deep([{ failed: true, status: 403, final: true }, { failed: true, status: 400 }, { failed: true, status: 404 }, { pending: true },
    { ok: true, payload: {} }, null].map(challenged), [false, false, false, false, false, false],
  "and not the Worker refusing the credential, a 4xx it means, a pending answer or a success");
  eq(WATCH_RETRY.delayMs, 1000, "it is tried again once, one second later");

  const world = fakeWorld({ day: S, start: at(S, 11, 0) });
  const clockBody = (await world.readOnce("clock")).payload;
  const tickWith = async (fail, { times = 1, clockRead = true, body = clockBody, when = world.now(), over = {} } = {}) => {
    const calls = [];
    const slept = [];
    const readOnce = async (key) => {
      calls.push(key);
      if (key !== "clock" && calls.filter((k) => k === key).length <= times) return typeof fail === "function" ? fail() : fail;
      return world.readOnce(key);
    };
    const watch = createWatch({ readOnce, latestClock: () => body, env: world.env(), fetchImpl: world.github.fetchImpl,
      sleep: async (ms) => { slept.push(ms); }, log() {}, warn() {}, ...over });
    const out = await watch.tick({ at: when, clockRead });
    const result = (id) => out.results.find((x) => x.id === id) || null;
    return { calls, slept, result, market: calls.filter((k) => k === "live:market").length };
  };
  let t = await tickWith({ payload: null, failed: true, status: 403 });
  ok(t.market === 2 && t.slept.length === 3 && t.slept.every((ms) => ms === 1000) && t.result("tier1").status === "ok",
    "A WATCH READ CHALLENGED ONCE is read again a second later and the tick sees Tier 1 healthy");
  t = await tickWith({ payload: null, failed: true, status: 503 }, { times: 5 });
  ok(t.market === 2 && t.result("tier1").status === "inconclusive" && t.result("probe").status === "ok",
    "a read that fails twice is given up on after the one retry, never a third, and the clock read that answered keeps the probe quiet");
  for (const [fail, why] of [[{ payload: null, failed: true, status: 403, final: true }, "the Worker refusing the credential"],
    [{ payload: null, failed: true, status: 400 }, "a 400"], [{ payload: null, absent: true, status: 200 }, "a pending answer"]]) {
    t = await tickWith(fail);
    ok(t.market === 1 && t.slept.length === 0, `${why} is not retried`);
  }
  let first = true;
  t = await tickWith(() => (first ? (first = false, new Promise(() => {})) : { payload: null, failed: true, status: 403 }), { times: 1,
    over: { readDeadlineMs: 400, retryMs: 100, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) } });
  ok(t.market === 2 && t.result("tier1").status === "ok", "a first attempt that hangs is cut at its share of the deadline and retried inside it");
  const startedAt = Date.now();
  t = await tickWith(() => new Promise(() => {}), { times: 5,
    over: { readDeadlineMs: 400, retryMs: 100, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) } });
  const spent = Date.now() - startedAt;
  ok(t.market === 2 && spent < 400 + 300, `and a read that never answers, retried, still ends inside the ten-second deadline's scale (${spent} ms of 400)`);
  t = await tickWith({ payload: null, failed: true, status: 403 }, { times: 5, over: { readDeadlineMs: 150 } });
  ok(t.market === 1 && t.slept.length === 0, "a deadline shorter than the retry delay leaves room for one attempt only");

  t = await tickWith({ payload: null, failed: true, status: 403 }, { times: 5, clockRead: false });
  ok(t.result("probe").status === "breach" && /the clock read failed, HTTP 403/.test(t.result("probe").detail) &&
     t.result("tier1").status === "inconclusive",
  "A TICK WHOSE CLOCK READ AND EVERY RETRIED READ FAILED is blind: the probe breaches");
  t = await tickWith({ payload: null, failed: true, status: 403 }, { times: 0, clockRead: false });
  ok(t.result("probe").status === "ok" && t.result("tier1").status === "ok" && t.market === 1,
    "while a challenged clock read with healthy reads keeps the last good clock and evaluates Tier 1 on the keys alone");

  const view = witnessView(clockBody);
  const kept = keptView(view, at(S, 11, 0), false);
  ok(kept.clock.day === S && kept.tier1 === null && view.tier1 !== null,
    "THE KEPT CLOCK lends its calendar but not its Tier 1 stamp, which is as old as the last read that answered");
  eq(keptView(view, at(S, 11, 0), true), view, "a clock read this tick is used whole");
  eq(keptView(view, at(S, 24, 5), false), null, "and a kept clock is dropped once the Eastern day turns (the same-day rule)");
  const off = witnessView({ clock: { day: S, trading: 1, tier1: { at: null, why: "off" } } });
  eq(keptView(off, at(S, 11, 0), false).tier1.why, "off", "a kept clock that says Tier 1 is off keeps saying so");
  t = await tickWith({ payload: null, failed: true, status: 403 }, { times: 5, clockRead: false, when: at(S, 24, 10) });
  ok(t.result("tier1") === null && t.result("probe").status === "breach",
    "after midnight a kept clock from the day before is no clock: no Tier 1 window, and a blind tick is still a probe breach");
}

{
  const wholeDay = async (day) => {
    const world = fakeWorld({ day, start: easternInstant(day, 0) });
    const end = easternInstant(day, 24 * 60);
    const runs = [];
    while (world.now() < end) {
      let body = null;
      const env = world.env();
      const watch = createWatch({ readOnce: world.readOnce, latestClock: () => body, env, fetchImpl: world.github.fetchImpl, log() {}, warn() {} });
      const started = world.now();
      const loop = await runLiveLoop({ now: world.now, sleep: world.sleep, budgetMs: LIVE_LOOP.budgetMs, log() {}, warn() {}, watch,
        readClock: () => readLiveClock(world.readOnce, { seen: (b) => { body = b; } }),
        pass: async () => { world.advance(20000); return { skipped: null, answered: 38, landed: 10 }; },
        chain: ({ at: when }) => chainWithRetry(() => chainDispatch({ env, fetchImpl: world.github.fetchImpl, at: when }), { sleep: world.sleep }) });
      runs.push({ started, ended: world.now(), exit: loop.exit, chained: loop.chained && loop.chained.sent, passes: loop.passes.length });
    }
    const reads = world.stat.reads.filter((r) => r.at < end);
    const calls = world.github.record.calls.filter((c) => c.at < end);
    return { world, runs, reads, calls, end };
  };
  const weekday = await wholeDay(D);
  ok(weekday.runs.length >= 4 && weekday.runs.every((r) => r.exit === "budget" && r.chained) &&
     weekday.runs.slice(1).every((r, i) => r.started - weekday.runs[i].ended < 60 * 1000),
  `A WEEKDAY IS ONE UNBROKEN CHAIN: ${weekday.runs.length} runs, each handing over to the next within a minute of its own end, none exiting for the night`);
  eq(weekday.runs.reduce((n, r) => n + r.passes, 0), 85, "with a Tier 2 pass on every slot from 09:31 to 16:25 ET (85, the count of 2026-09-28)");
  const kinds = {};
  for (const r of weekday.reads) kinds[r.key] = (kinds[r.key] || 0) + 1;
  ok(weekday.reads.length <= 410 && kinds["live:market"] === kinds["live:focus"] && kinds["live:market"] <= 82 && kinds.meta <= 10 &&
     kinds["live:breadth"] >= 70 && kinds["live:breadth"] <= 76,
  `and it costs the Worker ${weekday.reads.length} ingest reads (${JSON.stringify(kinds)}), ${(weekday.reads.length / 1000).toFixed(2)}% of the Free plan's 100,000 requests a day, ` +
    "of which the breadth read is one a tick from 10:15 (45 minutes after the open) to 16:25 ET");
  ok(weekday.calls.length <= 12, `and GitHub ${weekday.calls.length} calls (an issue listing and a chain dispatch per run, and the nightly)`);
  const nightlySends = weekday.world.github.record.dispatches.filter((d) => d.workflow === "flows-pipeline.yml");
  ok(nightlySends.length === 1 && nightlySends[0].at === at(D, 17, 30),
    "with the nightly dispatched exactly once, at 17:30:00 ET sharp: the loop is idle from 16:25 and its 15-minute tick lands on the minute, with no special wake");
  eq(weekday.world.github.record.created.length, 0, "and nothing to report");
  const weekend = await wholeDay(DRY_WEEKEND);
  const wk = {};
  for (const r of weekend.reads) wk[r.key] = (wk[r.key] || 0) + 1;
  ok(weekend.reads.length <= 110 && Object.keys(wk).sort().join() === "clock,meta" && weekend.runs.every((r) => r.passes === 0) &&
     weekend.calls.length <= 12 && weekend.world.github.record.dispatches.every((d) => d.workflow === "flows-live.yml"),
  `A SATURDAY costs ${weekend.reads.length} reads (${JSON.stringify(wk)}), no pass and no nightly, and only the chain calls GitHub`);
}

{
  const HOP = LIVE_LOOP.budgetMs;
  const LATENCY = 30 * 1000;
  const lines = [];
  for (let h = 5; h <= 20; h++) for (const m of [17, 47]) lines.push(h * 60 + m);
  const monday = Date.UTC(2026, 8, 28);
  const week = (lagMin, refuseHop = -1) => {
    const landings = [];
    for (let w = 0; w < 2; w++) for (let d = 0; d < 5; d++) for (const s of lines) landings.push(monday + (w * 7 + d) * 86400000 + (s + lagMin) * 60000);
    landings.sort((a, b) => a - b);
    const runs = [];
    let running = null;
    let pending = false;
    let i = 0;
    const limit = monday + 9 * 86400000;
    for (;;) {
      const landing = i < landings.length ? landings[i] : Infinity;
      const ending = running ? running.end : Infinity;
      const t = Math.min(landing, ending);
      if (t === Infinity || t > limit) break;
      if (ending <= landing) {
        const hopped = runs.length - 1 !== refuseHop;
        const queued = hopped ? "chain" : pending ? "cron" : null;
        running = null;
        pending = false;
        if (queued) {
          running = { start: t + (queued === "chain" ? LATENCY : 0), by: queued };
          running.end = running.start + HOP;
          runs.push(running);
        }
      } else {
        i++;
        if (!running) {
          running = { start: t, end: t + HOP, by: "cron" };
          runs.push(running);
        } else pending = true;
      }
    }
    return runs;
  };
  const gaps = (runs) => runs.slice(1).map((r, k) => r.start - runs[k].end);
  const wrong = [];
  for (const lag of [0, 120, 300, 480]) {
    const runs = week(lag);
    if (runs.filter((r) => r.by === "cron").length !== 1) wrong.push(`+${lag} min: ${runs.filter((r) => r.by === "cron").length} cron-started runs`);
    if (gaps(runs).some((g) => g !== LATENCY)) wrong.push(`+${lag} min: a gap of ${Math.max(...gaps(runs)) / 1000} s`);
    if (runs.length < 25) wrong.push(`+${lag} min: only ${runs.length} runs in nine days`);
  }
  deep(wrong, [], "UNDER KEEP THE 32 CRON LINES START ONE LOOP AND THEN NEVER RUN: through the concurrency group (one running, one pending that a newer one replaces) " +
    "only the first starter of the week starts a run, every later one is replaced by the loop's own hop, and the hops follow each other by the 30 s a dispatch takes, at every delivery lag from none to eight hours");
  const broken = [];
  for (const lag of [0, 300]) {
    for (const hop of [1, 6]) {
      const runs = week(lag, hop);
      if (runs[hop + 1].by !== "cron" || runs[hop + 1].start !== runs[hop].end) broken.push(`+${lag} min, hop ${hop}: the successor was ${runs[hop + 1].by} after ${(runs[hop + 1].start - runs[hop].end) / 60000} min`);
    }
  }
  deep(broken, [], "and a hop that fails on a weekday is covered by the starter pending behind it: in any 340 minutes at least ten lines are delivered, so the pending one starts the moment " +
    "the loop ends, with no gap");
  const whole = week(0);
  const saturday = whole.findIndex((r) => new Date(r.end).getUTCDay() === 6);
  const weekend = week(0, saturday);
  ok(saturday > 0 && weekend[saturday + 1] && weekend[saturday + 1].by === "cron" && weekend[saturday + 1].start - weekend[saturday].end > 24 * 3600 * 1000,
    "while a hop that fails on a Saturday waits for the first starter of the next weekday, more than a day: the lines are Monday to Friday, which is why the witness raises the chain issue at once");
}

{
  const dead = (a, l) => ({ skipped: null, answered: a, landed: l });
  const chained = { sent: true, why: "sent", status: 204 };
  deep([liveRunVerdict({ passes: [dead(30, 8)], exit: "budget", chained, watch: { breached: [] } }).failed,
    liveRunVerdict({ passes: [dead(30, 8)], exit: "budget", chained, watch: { breached: ["nightly"] } }).failed,
    liveRunVerdict({ passes: [], exit: "budget", chained: { sent: false, why: "refused" } }).failed,
    liveRunVerdict({ passes: [], exit: "budget", chained, watch: { breached: [] } }).failed], [false, true, true, false],
  "THE RUN'S COLOUR: red for a confirmed lapse or a chain that could not hand over, on a weekend with no pass as much as in a session, and green otherwise");
  const both = liveRunVerdict({ passes: [dead(0, 0)], exit: "budget", chained: { sent: false, why: "refused" }, watch: { breached: ["tier1", "probe"] } });
  ok(/every one of 1 pass/.test(both.why) && /chain dispatch was refused/.test(both.why) && /tier1, probe/.test(both.why), "and it gives every reason");
}

{
  const write = (body) => {
    const dir = mkdtempSync(join(tmpdir(), "flows-uw-"));
    const file = join(dir, "run.mjs");
    writeFileSync(file, body);
    return { dir, file };
  };
  const hangs = [];
  const server = createServer((req, res) => {
    hangs.push(req.url);
    if (req.url.startsWith("/ok")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ t: "AAPL" }] }));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const pipeline = new URL("scripts/flows-pipeline.mjs", ROOT).href;
  const script = (live) => `
    process.argv.push("x"${live ? ', "--live"' : ""});
    const timeouts = [];
    const realTimeout = AbortSignal.timeout.bind(AbortSignal);
    AbortSignal.timeout = (ms) => { timeouts.push(ms); return realTimeout(ms); };
    const m = await import(${JSON.stringify(pipeline)});
    const out = {};
    const started = Date.now();
    if (process.env.SKIP_HANG !== "1") {
      try { await m.uw("/hang/x"); out.hang = "answered"; } catch (e) { out.hang = e.name; }
    }
    out.hangMs = Date.now() - started;
    out.ok = (await m.uw("/ok/x")).length;
    out.timeouts = timeouts;
    console.log(JSON.stringify(out));
    process.exit(0);
  `;
  const run = (live, env) => new Promise((resolve) => {
    const { dir, file } = write(script(live));
    const child = spawn(process.execPath, [file], { env: { ...process.env, UW_API_KEY: "k", FLOWS_UW_BASE_URL: `http://127.0.0.1:${port}`, ...env } });
    let out = "";
    child.stdout.on("data", (c) => { out += c; });
    child.stderr.on("data", (c) => { out += c; });
    const timer = setTimeout(() => child.kill("SIGKILL"), 20000);
    child.on("close", () => { clearTimeout(timer); rmSync(dir, { recursive: true, force: true }); resolve(out.trim().split("\n").pop()); });
  });
  const liveRun = JSON.parse(await run(true, { FLOWS_UW_TIMEOUT_MS: "300" }));
  ok(liveRun.hang === "TimeoutError" && liveRun.hangMs >= 550 && liveRun.hangMs < 5000 && liveRun.ok === 1,
    `THE VENDOR CLIENT gives up on a connection that never answers (${liveRun.hangMs} ms for two 300 ms tries), where Node's default waits 300 s a try, ` +
      "and still reads a healthy endpoint");
  eq(hangs.filter((u) => u.startsWith("/hang")).length, 2, "one try and one retry after a timeout, then the error goes up: a dead endpoint costs two deadlines, not five");
  deep(liveRun.timeouts.slice(0, 2), [300, 300], "each try carries its own deadline");
  const defaults = JSON.parse(await run(true, { FLOWS_UW_TIMEOUT_MS: "", SKIP_HANG: "1" }));
  ok(defaults.timeouts.length === 1 && defaults.timeouts[0] === 20000 && LIVE_VENDOR.timeoutMs === 20000 && LIVE_VENDOR.timeoutRetries === 1,
    "and the deadline is 20 s by default, whatever a malformed override says");
  const clamped = JSON.parse(await run(true, { FLOWS_UW_TIMEOUT_MS: "5", SKIP_HANG: "1" }));
  eq(clamped.timeouts[0], 20000, "an override below 100 ms is ignored");
  server.close();
  const seen = [];
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
    process.argv.push("x");
    globalThis.fetch = async (url, init) => { console.log(JSON.stringify({ signal: "signal" in init })); return new Response(JSON.stringify({ data: [1] })); };
    const m = await import(${JSON.stringify(pipeline)});
    await m.uw("/api/x");
  `], { encoding: "utf8", env: { ...process.env, UW_API_KEY: "k" } });
  seen.push(child.stdout.trim());
  eq(seen[0], '{"signal":false}', "THE NIGHTLY'S CLIENT is untouched: no deadline outside --live");
  const src = read("scripts/flows-pipeline.mjs");
  ok(/const keep = process\.env\.FLOWS_LIVE_KEEP === "1";/.test(src) && /chainWithRetry\(\(\) => chainDispatch\(\{ env: process\.env, at \}\)\)/.test(src) &&
     /createWatch\(\{ readOnce: readStoredOnce, latestClock: \(\) => clockBody, env: process\.env \}\)/.test(src),
  "AND THE WATCH is built only when the workflow asks to keep the loop alive, from the same single-try read the clock uses");
  ok(/vendor request\(s\) timed out after/.test(src), "with the count of timed-out requests on the pass's log line");
}

{
  const env = { GITHUB_TOKEN: "ghs_job", GITHUB_REPOSITORY: "anilkaya001/anilkaya.org", GITHUB_REPOSITORY_OWNER: "anilkaya001" };
  const gh = fakeGithub({ now: () => 5 });
  const quiet = { log() {}, warn() {} };
  const done = await witnessDrill({ env, fetchImpl: gh.fetchImpl, ...quiet });
  ok(done.ok && done.number === 100 && gh.record.created.length === 1 && /^\[flows-witness:drill\]/.test(gh.record.created[0].title) &&
     gh.record.comments.length === 1 && gh.record.closed.length === 1 && gh.record.closed[0].number === 100,
  "THE DRILL opens one issue with the witness's own code, comments and closes it, so it proves the same channel a real lapse uses");
  ok(/@anilkaya001/.test(gh.record.created[0].body) && /Nothing is wrong/.test(gh.record.created[0].body), "mentioning the owner and saying it is a drill");
  const denied = fakeGithub({ writeStatus: 403 });
  const failed = await witnessDrill({ env, fetchImpl: denied.fetchImpl, ...quiet });
  ok(!failed.ok && /could not be opened/.test(failed.why), "an API that refuses the write fails the drill");
  const gone = fakeGithub({ writeStatus: 410 });
  ok(!(await witnessDrill({ env, fetchImpl: gone.fetchImpl, ...quiet })).ok, "as does a repository with Issues switched off (410)");
  const nothing = await witnessDrill({ env: {}, fetchImpl: gh.fetchImpl, ...quiet });
  ok(!nothing.ok && /no usable token \(no-token\)/.test(nothing.why), "and a job with no token");
  ok(WITNESS_CHECKS.drill && /410/.test(WITNESS_CHECKS.drill.remedy.join(" ")) && /issues: write/.test(WITNESS_CHECKS.drill.remedy.join(" ")),
    "whose issue says what a 410 and a 403 mean");

  const runCli = (githubApi) => new Promise((resolve) => {
    const child = spawn(process.execPath, [new URL("scripts/flows-pipeline.mjs", ROOT).pathname, "--live"], {
      env: { ...process.env, FLOWS_LIVE_DRILL: "1", GITHUB_TOKEN: "ghs_job", GITHUB_REPOSITORY: "anilkaya001/anilkaya.org",
        GITHUB_API_URL: githubApi, UW_API_KEY: "", FLOWS_LIVE_TOKEN: "" } });
    let out = "";
    child.stdout.on("data", (c) => { out += c; });
    child.stderr.on("data", (c) => { out += c; });
    child.on("close", (status) => resolve({ status, out }));
  });
  const served = fakeGithub({ now: () => Date.now() });
  const relay = createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    const r = await served.fetchImpl(`http://127.0.0.1${req.url}`, { method: req.method, body: text || undefined });
    res.writeHead(r.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(await r.json()));
  });
  await new Promise((resolve) => relay.listen(0, "127.0.0.1", resolve));
  const good = await runCli(`http://127.0.0.1:${relay.address().port}`);
  ok(good.status === 0 && /the alert channel works/.test(good.out) && served.record.created.length === 1 && served.record.closed.length === 1,
    `AND FROM THE COMMAND LINE, with no vendor key and no ingest credential, the drill runs against a GitHub API (exit ${good.status})`);
  const refusing = fakeGithub({ writeStatus: 403 });
  relay.removeAllListeners("request");
  relay.on("request", async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    const r = await refusing.fetchImpl(`http://127.0.0.1${req.url}`, { method: req.method, body: text || undefined });
    res.writeHead(r.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(await r.json()));
  });
  const bad = await runCli(`http://127.0.0.1:${relay.address().port}`);
  ok(bad.status === 1 && /witness drill: FAILED/.test(bad.out), "and it exits red when the channel is broken, which is what a drill is for");
  relay.close();
  const src = read("scripts/flows-pipeline.mjs");
  ok(/if \(process\.env\.FLOWS_LIVE_DRILL === "1" && !DRY_RUN\) return runWitnessDrill\(\);\n  console\.log\(DRY_RUN/.test(src),
    "the drill is decided before the vendor key and the live credential are demanded, and never in a dry run");
}

console.log(`✓ flows-starts: ${checks} assertions — the live workflow's grants, the nightly dispatched at 17:30 ET with the job's own token ` +
  `(origin live-loop, no undeclared input), capped for a permanent refusal and ridden through a two-hour GitHub outage; the witness's Tier 1, ` +
  `Tier 2 and nightly lines at 25 minutes, 45 minutes and 21:00 ET with their debounce, three-tick recovery, reopen, dedupe, author check, ` +
  `reminder and duplicate cleanup; the issue reporter against a fake GitHub; the loop kept alive through the night, the weekend and the hop, ` +
  `and its cron starters through the concurrency group; ${DRY_SCENARIOS.length} dry days; the vendor client's 20 s deadline`);
