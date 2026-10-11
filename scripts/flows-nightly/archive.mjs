import { priorTradingDays } from "../../shared/flows-freshness.js";
import { num, SCORE_SCALE } from "../../shared/flows-features.js";
import { tradingCalendar } from "../../shared/flows-record.js";
import {
  priorLedger, retirePlan, buildRoster, RETIRE_AFTER_SESSIONS, rosterKeyTicker,
} from "../../shared/flows-universe.js";
import { DRY_RUN } from "./flags.mjs";
import { runPooled, sleep } from "./vendor.mjs";
import {
  ARCHIVE_DATE_RE, ARCHIVE_RETENTION_DAYS, datedKey, landedKeys, publish, readSaid, readStored, retire,
  sessionArchiveKeys,
} from "./store.mjs";
import { closedPriceWindow } from "./clock.mjs";
import { candleDate, sessionCandles } from "./rank.mjs";

const nameCount = (n) => `${n} name${n === 1 ? "" : "s"}`;

export function readBoardMemory(read, runSessionDate) {
  const body = read && read.payload;

  const stamp = (v) => (typeof v === "string" && ARCHIVE_DATE_RE.test(v) ? v : null);
  const prior = stamp(body && body.sessionDate);
  const run = stamp(runSessionDate);

  const rows = body && Array.isArray(body.rows) ? body.rows.filter((r) => r && r.t) : null;
  const named = rows ? rows.length : null;
  const answer = (status, keep, note) => ({
    status,
    rows: keep ? rows : [],
    incumbents: keep ? rows.length : 0,
    named,
    sessionDate: prior,
    note,
  });

  if (!rows) {

    return answer("unavailable", false, read && read.absent
      ? "No board has ever been published under this key, so there is no earlier session to " +
        "compare against and this board is a cold start: no row claims to be new, no rank move " +
        "is drawn, and no name is held on incumbency. The comparison begins on the next run " +
        "that finds a board here."
      : "The published board could not be read on this run" +
        (read && read.status ? ` (the store answered ${read.status})` : " (the read did not complete)") +
        ", so this board is a cold start: no row claims to be new, no rank move is drawn, and " +
        "no name is held on incumbency. Yesterday's board may well exist — this run could not " +
        "see it, which is a fact about the store and not about the session.");
  }
  if (!rows.length) {
    return answer("quiet", false,
      "The published board was read and named no rows, so there was no membership to remember " +
      "and this board is a cold start: no row claims to be new and no name is held on " +
      "incumbency. A board that published nothing is a session that ranked nothing, which is " +
      "not the same as a board that could not be read.");
  }
  if (prior === null || run === null) {

    const which = prior === null && run === null
      ? "Neither the published board nor this run carries a session date"
      : prior === null
        ? "The published board carries no session date"
        : "This run could not resolve a session date";
    return answer("undated", true,
      `${which}, so this run could not check whether the board it read was its own output from ` +
      `an earlier run today. Its ${nameCount(rows.length)} were used as the memory anyway: ` +
      "discarding a real membership over a missing stamp would report a cold start on a session " +
      "that had one. Read the marks below as unverified rather than as a comparison against a " +
      "named session.");
  }
  if (prior === run) {
    return answer("same-session", false,
      `The published board this run read is stamped ${prior}, the same session this run is ` +
      `publishing, so it is this run's own output rather than a prior session. Its ` +
      `${nameCount(rows.length)} were discarded and this board is a cold start: hysteresis ` +
      "holds a name against YESTERDAY's board, and a second run against one session has no " +
      "yesterday to hold against. Every row here was ranked on this session alone. Keeping the " +
      "memory would have held the whole board in place and reported that as stability.");
  }
  if (prior > run) {

    return answer("ahead", false,
      `The published board this run read is stamped ${prior}, a LATER session than the ${run} ` +
      `this run is publishing, so it cannot be this run's yesterday. Its ${nameCount(rows.length)} ` +
      "were discarded and this board is a cold start. A run publishing an earlier session than " +
      "the board already live usually means a re-run against a stale tape, and that is worth " +
      "understanding before the marks here are read as a comparison.");
  }
  return answer("ok", true,
    `The published board this run read is stamped ${prior}, an earlier session than the ${run} ` +
    `this run is publishing, so its ${nameCount(rows.length)} are the incumbents today's ` +
    "ranking was held against.");
}

export const MEMORY_ARCHIVE_SESSIONS = 10;

const MEMORY_FALLS_BACK = new Set(["unavailable", "same-session", "ahead"]);

export async function resolveBoardMemory(side, sessionDate, {
  reader = readStored, sessions = MEMORY_ARCHIVE_SESSIONS,
} = {}) {
  const read = await reader("board:" + side);
  const memory = readBoardMemory(read, sessionDate);
  if (!MEMORY_FALLS_BACK.has(memory.status) || !ARCHIVE_DATE_RE.test(String(sessionDate || ""))) {
    return { ...memory, source: "live", key: "board:" + side };
  }
  const why = memory.status === "same-session"
    ? `the live board:${side} is this session's own earlier output`
    : memory.status === "ahead"
      ? `the live board:${side} is stamped a later session (${memory.sessionDate})`
      : read && read.absent
        ? `no board is published under board:${side}`
        : `the live board:${side} could not be read` +
          (read && read.status ? ` (the store answered ${read.status})` : "");
  let failures = 0;
  for (const day of priorTradingDays(sessionDate, sessions, null)) {
    const key = `board:${side}:${day}`;
    const stored = await reader(key);
    if (stored && stored.failed) { failures++; continue; }
    if (!stored || stored.absent || !stored.payload) continue;
    const archived = readBoardMemory(stored, sessionDate);
    if (archived.status !== "ok" && archived.status !== "quiet") continue;
    return {
      ...archived, source: "archive", key,
      note: `${archived.note} It was read from the dated archive (${key}) because ${why}.`,
    };
  }
  return {
    ...memory, source: "live", key: "board:" + side,
    note: `${memory.note} The dated archive was searched back ${sessions} sessions for an ` +
      `earlier board:${side} as well, and ` +
      (failures
        ? `${failures} of those reads failed, so an earlier board may exist that this run could not see.`
        : "held none."),
  };
}

export function sameSessionGate({ sessionDate, archive = null, republish = false } = {}) {
  if (!ARCHIVE_DATE_RE.test(String(sessionDate || ""))) {
    return { mode: "fresh", skip: false, generatedAt: null,
      note: "no session date, so there is no dated archive to check against" };
  }
  const keys = sessionArchiveKeys(sessionDate);
  const readOf = (key) => (archive && archive[key]) || null;
  const isHeld = (r) => Boolean(r && !r.failed && !r.absent && r.payload);
  const held = keys.filter((k) => isHeld(readOf(k)));
  const failed = keys.filter((k) => readOf(k) && readOf(k).failed);
  const absent = keys.filter((k) => !held.includes(k) && !failed.includes(k));
  const scores = readOf(`scores:${sessionDate}`);
  const at = isHeld(scores) && typeof scores.payload.generatedAt === "string"
    ? scores.payload.generatedAt : null;
  const list = (ks) => ks.join(", ");
  const are = (ks) => (ks.length === 1 ? "is" : "are");
  const unread = failed.length
    ? `${list(failed)} could not be read (the store answered ` +
      `${failed.map((k) => readOf(k).status || "nothing").join(", ")})`
    : "";
  if (republish) {
    return { mode: "republish", skip: false, generatedAt: at,
      note: (held.length
        ? `${list(held)} ${are(held)} archived` + (at ? ` (scores written ${at})` : "")
        : `scores:${sessionDate} ` + (failed.includes(`scores:${sessionDate}`)
          ? "could not be read" + (scores.status ? ` (the store answered ${scores.status})` : "")
          : "is not archived")) +
        ", and republish_session is set, so this run deletes whatever dated key the session " +
        "holds before it rewrites all three together with the live boards, scores, record and " +
        "cards — a board left behind by an earlier run whose scores write was lost would " +
        "otherwise refuse the rewrite and split the archive from the live board again" };
  }
  if (held.length && absent.length) {
    return { mode: "partial", skip: true, generatedAt: at,
      note: `${list(held)} ${are(held)} archived but ${list(absent)} ${are(absent)} not, so an ` +
        "earlier run of this session ranked it and part of its archive was lost. A plain run " +
        "cannot repair that: the dated keys are immutable, so a second ranking would go live " +
        "while the archive kept part of the first. The ranked leg is skipped and the run " +
        "exits non-zero. Dispatch with republish_session to rewrite the session's three keys " +
        "together." };
  }
  if (held.length) {
    return { mode: "archived", skip: true, generatedAt: at,
      note: (failed.length
        ? `${list(held)} ${are(held)} archived and ${unread}, so the archive may be incomplete`
        : `scores:${sessionDate} is already archived (written ${at || "at an unstamped time"}) ` +
          "with both dated boards") +
        ", so this run is a second run against one session. The ranked leg — boards, scores, " +
        "score track, record, brief and cards — is skipped: a second ranking would go live " +
        "while the archive kept the first, and the record would grade a board no reader " +
        "saw. Only the unranked market feeds are refreshed. Dispatch with " +
        "republish_session to rewrite the session instead." };
  }
  if (failed.length) {
    return { mode: "unverified", skip: false, generatedAt: null,
      note: `${unread}, so whether this session is already archived is unknown. Proceeding: a ` +
        "refused dated write is reported below, and a missed session cannot be recovered later" };
  }
  return { mode: "fresh", skip: false, generatedAt: null,
    note: `none of ${list(keys)} is archived, so this is the session's first run` };
}

export async function fetchStoredPayload(key) {
  return (await readStored(key)).payload;
}

const ARCHIVE_READ_PACE_MS = 40;

const ARCHIVE_READ_RETRY_MS = 600;

const ARCHIVE_READ_GIVE_UP = 8;

export async function collectDatedBoards(sessionDate, payloads, enriched, inBandToday = null) {
  const boards = [];
  if (DRY_RUN) {
    const calendar = tradingCalendar(
      enriched.map((e) => (e.raw.ohlc || []).map(candleDate)));
    const days = calendar.filter((day) => day < sessionDate).slice(-22);

    const hash = (s) => {
      let h = 2166136261;
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
      return (h >>> 0) / 4294967296;
    };
    const last = days.length - 1;

    const publishedBand = num(payloads.long && payloads.long.deadBand)
      ?? num(payloads.short && payloads.short.deadBand);

    const band = publishedBand ?? 1;
    if (publishedBand === null) {
      console.log("  NOTE: neither board published a dead band, so the synthetic history's " +
        "crossings were computed against a fallback of 1 rather than against the session's " +
        "own threshold");
    }

    const historic = (row, i, inBandToday) => {
      const s = num(row && row.s);
      if (s === null) return null;
      const t = String(row.t || "");
      const bucket = hash(t);
      const age = last - i;

      const absent = hash(t + "|gap");
      if (absent < 0.06 && age === 0) return null;
      if (absent >= 0.06 && absent < 0.10 && age <= 1) return null;
      if (absent >= 0.10 && absent < 0.20 && age >= 3 && age <= 6) return null;

      if (age === 0) {

        if (inBandToday) {

          return s >= 0 ? band + 6 : -(band + 6);
        }
        if (bucket < 0.10) return s > 0 ? 0 : 0;
        if (bucket < 0.16) return s > 0 ? -(band + 9) : band + 9;
      }

      const ramp = 0.55 + 0.45 * (1 - age / Math.max(1, days.length));
      const wobble = Math.round((bucket - 0.5) * 18 * Math.sin((age + 1) * (0.3 + bucket)));
      const v = Math.round(s * ramp) + wobble;
      return Math.max(-100, Math.min(100, v));
    };

    const shaped = (rows, inBandToday) => (rows || []).map((row) => {
      const s = num(row && row.s);
      return { row, s, inBandToday };
    }).filter((x) => x.s !== null);

    const pools = [
      ...shaped(payloads.long && payloads.long.rows, false),
      ...shaped(payloads.short && payloads.short.rows, false),

      ...shaped(inBandToday, true),
    ];

    days.forEach((d, i) => {
      const rows = [];
      for (const { row, inBandToday } of pools) {
        const v = historic(row, i, inBandToday);
        if (v === null) continue;

        rows.push({ ...row, s: v });
      }

      boards.push({ d, side: "long", rows });
    });

    const scoreDays = days.slice(-4).map((d, k) => ({
      d,
      source: "scores",
      rows: pools.map(({ row, inBandToday }) => {
        const v = historic(row, days.length - 4 + k, inBandToday);
        if (v === null) return null;

        const q = Math.round(SCORE_SCALE * Math.atanh(Math.max(-0.999, Math.min(0.999, v / 100))) * 1e4);
        return { t: row.t, s: v, q };
      }).filter(Boolean),
    }));

    return { boards, scoreDays, probed: boards.length + scoreDays.length };
  }
  const base = Date.parse(sessionDate + "T00:00:00Z");
  if (!Number.isFinite(base)) {
    return { boards, scoreDays: [], probed: 0, absent: 0, failed: 0, statuses: [] };
  }
  const scoreDays = [];
  let probed = 0, absent = 0, failed = 0, recovered = 0;
  const statuses = new Set();
  let abandoned = false;

  outer:
  for (let back = 1; back <= ARCHIVE_RETENTION_DAYS; back++) {
    const t = new Date(base - back * 86400000);
    const dow = t.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const d = t.toISOString().slice(0, 10);
    for (const what of ["scores", "long", "short"]) {
      probed++;

      if (probed > 1) await sleep(ARCHIVE_READ_PACE_MS);

      const key = what === "scores" ? `scores:${d}` : `board:${what}:${d}`;
      let read = await readStored(key, { retries: 0 });

      if (read.failed) {
        await sleep(ARCHIVE_READ_RETRY_MS);
        const again = await readStored(key, { retries: 0 });
        if (!again.failed) recovered++;
        read = again;
      }

      if (read.failed) {
        failed++;
        statuses.add(read.status || (read.detail ? "network" : 0));

        if (failed >= ARCHIVE_READ_GIVE_UP && !boards.length) { abandoned = true; break outer; }
        continue;
      }

      if (read.absent) { absent++; continue; }

      const stored = read.payload;
      if (stored && Array.isArray(stored.rows) && stored.rows.length) {
        if (what === "scores") scoreDays.push({ d, rows: stored.rows, source: "scores" });
        else {
          boards.push({ d, side: what, rows: stored.rows,
            generatedAt: typeof stored.generatedAt === "string" ? stored.generatedAt : null });
        }
      } else {

        absent++;
      }
    }
  }

  if (failed) {
    console.warn(
      `  record archive: ${failed} of ${probed} read(s) FAILED` +
      (recovered ? `, ${recovered} more recovered on a retry` : "") +
      ` (status ${[...statuses].join(", ")})` +
      (abandoned
        ? " — ABANDONED. Every read refused, so this run can say NOTHING about" +
          " whether the archive holds sessions. It is not a cold archive."
        : ""));
  }

  return { boards, scoreDays, probed, absent, failed, recovered, statuses: [...statuses], abandoned };
}

export function buildRecordCloses(enriched, datedBoards, sessionDate) {
  const closes = new Map();
  const bounded = ARCHIVE_DATE_RE.test(String(sessionDate || ""));
  const put = (t, d, c) => {
    const v = num(c);
    if (!t || !d || !(v > 0)) return;
    if (bounded && d > sessionDate) return;
    if (!closes.has(t)) closes.set(t, new Map());
    closes.get(t).set(d, v);
  };
  let boardPx = 0, boardPxRefused = 0;
  for (const b of datedBoards) {
    if (!closedPriceWindow(b.generatedAt, b.d)) {
      boardPxRefused += (b.rows || []).length;
      continue;
    }
    for (const row of b.rows || []) { put(row.t, b.d, row && row.px); boardPx++; }
  }
  for (const e of enriched) {
    for (const c of sessionCandles(e.raw.ohlc, sessionDate)) put(e.row.ticker, candleDate(c), c.close);
  }
  Object.defineProperty(closes, "sources", {
    value: { boardPx, boardPxRefused }, enumerable: false,
  });
  return closes;
}

export function recordCalendar(enriched, datedBoards, sessionDate) {
  return tradingCalendar([
    ...enriched.map((e) => sessionCandles(e.raw.ohlc, sessionDate).map(candleDate)),
    datedBoards.map((b) => b.d),
    ARCHIVE_DATE_RE.test(String(sessionDate || "")) ? [sessionDate] : [],
  ]).filter((d) => !ARCHIVE_DATE_RE.test(String(sessionDate || "")) || d <= sessionDate);
}

export function buildRecordBreaks(enriched) {
  const breaks = new Map();
  for (const e of enriched) {
    const dates = ((e.features && e.features.priceBreaks) || [])
      .map((b) => b && b.date).filter((d) => typeof d === "string" && d.length === 10);
    if (dates.length) breaks.set(e.row.ticker, dates);
  }
  return breaks;
}

export async function archiveDatedBoards(payloads, sessionDate, publishFn) {
  const lines = [];
  for (const side of ["long", "short"]) {
    const key = datedKey(side, sessionDate);
    if (!key) {
      lines.push(`  archive: session date is ${sessionDate === null ? "unresolved" : `"${sessionDate}"`}` +
                 " — refusing to write a dated key no prune could ever name");

      break;
    }
    try {
      await publishFn(key, payloads[side]);
    } catch (error) {
      if (error && error.status === 409) {
        lines.push(
          `  archive ${key}: ALREADY WRITTEN by an earlier run today, and this run's board ` +
          `differs from it — the archive is immutable and KEEPS THE FIRST, which is the ` +
          `board the reader saw and the one the record will be scored against. This run's ` +
          `board is live on board:${side} regardless. Two runs on one session disagreeing ` +
          `is worth understanding: usually a second run against a later tape, but it is ` +
          `also what a scoring change mid-session would look like from here.`);
      } else {
        lines.push(`  archive ${key}: ${error.message}`);
      }
    }
  }
  return lines;
}

export async function republishWithChain(payloads, chainByTicker, sessionDate, publishFn, refresh = null,
  meta = undefined) {
  const lines = [];
  for (const side of ["long", "short"]) {
    const payload = payloads[side];
    if (!payload || !Array.isArray(payload.rows)) continue;
    const metaBefore = JSON.stringify(payload.variation ?? null);
    if (meta !== undefined) payload.variation = meta;
    const metaMoved = JSON.stringify(payload.variation ?? null) !== metaBefore;
    let merged = 0, refreshed = 0;
    for (const row of payload.rows) {
      if (typeof refresh === "function") {
        const before = JSON.stringify(row.variation ?? null);
        if (refresh(row) && JSON.stringify(row.variation ?? null) !== before) refreshed++;
      }
      const c = chainByTicker.get(row.t);
      if (!c) continue;

      row.skew = c.scalars.skew;
      row.term = c.scalars.term;
      row.atmIv = c.scalars.atmIv;

      row.skewDays = c.scalars.skewDays;
      merged++;
    }
    if (!merged && !refreshed && !metaMoved) continue;

    const key = datedKey(side, sessionDate);

    if (!key) {
      lines.push(`  re-publish board:${side}: SKIPPED — the session date ` +
        `${JSON.stringify(sessionDate)} is not an archive date, so the dated copy ` +
        `cannot be written and the live board is left as the store already has it, ` +
        `rather than gaining columns its own archive will never carry`);
      continue;
    }

    try {
      await publishFn(key, payload);
    } catch (error) {
      lines.push(error && error.status === 409
        ? `  archive ${key}: ALREADY HOLDS this session (409) — an earlier run wrote it and ` +
          "the archive keeps the first. This run's board still goes live below; dispatch " +
          "with republish_session to rewrite both together"
        : `  archive ${key}: NOT WRITTEN — ${error.message}. The end-of-run check writes it ` +
          "again from this same payload; if that fails too the run says the archive is lost");
    }

    try {
      await publishFn("board:" + side, payload);
      lines.push(`  re-published board:${side} with chain columns on ${merged} row(s)` +
        (refreshed ? `, variation re-measured on ${refreshed}` : "") +
        (metaMoved ? ", and the board's measured variation block" : ""));
    } catch (error) {
      lines.push(`  re-publish ${side}: ${error.message} — the store keeps the pre-chain board`);
    }
  }
  return lines;
}

export function plainRedispatchSaid(report) {
  return (report || []).some((a) => a && a.state !== "lost")
    ? "a plain re-dispatch finds the session partly archived and skips it"
    : "this run confirmed none of the session's keys, so a plain re-dispatch ranks it " +
      "again unless the store holds one this run could not read";
}

export async function ensureArchived(payloadsByKey, { landed, reader = readStored, write }) {
  const report = [];
  for (const [key, payload] of Object.entries(payloadsByKey)) {
    if (!payload) continue;
    if (landed.has(key)) { report.push({ key, state: "written" }); continue; }
    const read = await reader(key);
    if (read && !read.failed && !read.absent && read.payload) {
      report.push({ key, state: "held" });
      continue;
    }
    try {
      await write(key, payload);
      report.push({ key, state: "repaired" });
    } catch (error) {
      report.push({ key, state: error && error.status === 409 ? "held" : "lost",
        detail: error && error.message ? error.message : String(error) });
    }
  }
  return report;
}

export function pickPriorRoster(late, early, { log = () => {} } = {}) {
  if (!late || !late.failed) return late;
  if (!early || early.failed) return late;
  log(`  roster: the prior roster could not be read now (HTTP ${late.status}); using the copy read at the start of ` +
    "this run, which only this run could have changed");
  return early;
}

export const LEDGER_PROBE_MAX = 2400;

export const LEDGER_PROBE_FAIL_MAX = 25;

export const LEDGER_PROBE_RETRY_BUDGET_MS = 20_000;

export const LEDGER_PROBE_CHUNK = 96;

const probeDayOf = (p) => {
  const d = p && typeof p === "object" ? (p.sessionDate || String(p.generatedAt || "").slice(0, 10)) : null;
  return ARCHIVE_DATE_RE.test(String(d || "")) ? d : null;
};

const probeFound = (card, x) => card === "present" || x === "present" || card === "landed" || x === "landed";

async function probeLedgerMetadata({ list, landed, probeMany, past, limit, failLimit, chunk }) {
  const asked = [];
  const chargeOf = (keys) => keys.filter((k) => !k.startsWith("hist:")).length;
  let capped = false, budget = 0;
  for (const t of list) {
    const keys = ["card:" + t, "card-x:" + t, "hist:" + t].filter((k) => !landed.has(k));
    if (budget + chargeOf(keys) > limit) { capped = true; break; }
    budget += chargeOf(keys);
    asked.push(...keys);
  }
  const answers = new Map();
  let reads = 0, charged = 0, failed = 0, requests = 0, metaBytes = 0;
  for (let i = 0; i < asked.length; i += chunk) {
    if (failed >= failLimit || past()) { capped = true; break; }
    const batch = asked.slice(i, i + chunk);
    requests++;
    reads += batch.length;
    charged += chargeOf(batch);
    const r = await probeMany(batch);
    const shaped = !!r && !r.failed && r.status === 200 && !!r.keys && typeof r.keys === "object";
    if (!shaped) {
      if (requests === 1) {
        return { fallback: { status: r && r.status ? r.status : 0, said: r ? readSaid(r) : "no answer",
          code: r && typeof r.code === "string" ? r.code : null } };
      }
      failed += batch.length;
      continue;
    }
    metaBytes += Number(r.bytes) || 0;
    for (const key of batch) {
      const a = r.keys[key];
      if (!a || typeof a !== "object") { failed++; continue; }
      answers.set(key, a.present === true ? a : null);
    }
  }
  const known = new Map();
  let avoided = 0;
  const state = (key) => (landed.has(key) ? "landed" : !answers.has(key) ? "unknown" : answers.get(key) ? "present" : "absent");
  const take = (key) => {
    const a = answers.get(key);
    if (!a) return;
    known.set(key, probeDayOf(a));
    avoided += Number(a.bytes) || 0;
  };
  for (const t of list) {
    const card = state("card:" + t), x = state("card-x:" + t);
    take("card:" + t);
    take("card-x:" + t);
    if (probeFound(card, x) && !landed.has("hist:" + t)) take("hist:" + t);
  }
  return { known, reads, charged, failed, capped, path: "metadata", requests, metaBytes, avoided, fallback: null };
}

export async function bootstrapLedger({ tickers = [], landed = new Set(), reader, probeMany = null, pool = runPooled, width = 4,
  deadline = null, limit = LEDGER_PROBE_MAX, failLimit = LEDGER_PROBE_FAIL_MAX, chunk = LEDGER_PROBE_CHUNK } = {}) {
  const list = [...new Set(tickers)].filter((t) => rosterKeyTicker("card:" + t)).sort();
  const past = () => Number.isFinite(deadline) && Date.now() > deadline;
  let fallback = null;
  if (probeMany) {
    const meta = await probeLedgerMetadata({ list, landed, probeMany, past, limit, failLimit, chunk });
    if (!meta.fallback) return meta;
    fallback = meta.fallback;
  }
  const known = new Map();
  let reads = 0, failed = 0, capped = false;
  const probe = async (key) => {
    if (reads >= limit || failed >= failLimit || past()) {
      capped = true;
      return "skipped";
    }
    reads++;
    const r = await reader(key);
    if (!r || r.failed) { failed++; return "failed"; }
    if (r.absent || !r.payload || r.payload.status === "pending") return "absent";
    known.set(key, probeDayOf(r.payload));
    return "present";
  };
  await pool(list, async (t) => {
    const card = landed.has("card:" + t) ? "landed" : await probe("card:" + t);
    const x = landed.has("card-x:" + t) ? "landed" : await probe("card-x:" + t);
    if (probeFound(card, x) && !landed.has("hist:" + t)) {
      await probe("hist:" + t);
    }
  }, { width });
  return { known, reads, charged: reads, failed, capped, path: "per-key", requests: reads, metaBytes: 0, avoided: 0, fallback };
}

export function probeSaid(p) {
  const tail = `${p.known.size} older key(s) found` +
    (p.failed ? `, ${p.failed} ${p.path === "metadata" ? "key(s) unanswered" : "read(s) failed"}` : "") +
    (p.capped ? " — the probe stopped at its cap, its failure limit or the deadline" : "");
  if (p.path === "metadata") {
    return `${p.reads} key(s) asked over ${p.requests} metadata request(s) of ${p.metaBytes} bytes, ` +
      `${p.charged} card and card-x key(s) counted against the cap, ${p.avoided} bytes of stored payload left undownloaded, ${tail}`;
  }
  const why = p.fallback
    ? ` (the metadata form answered ${p.fallback.said}${p.fallback.code ? " " + p.fallback.code : ""}, so ` +
      (p.fallback.code === "too_many_keys" ? "the chunk is above this Worker's cap, not an older Worker" : "an older Worker is assumed") + ")"
    : "";
  return `${p.reads} read(s) key by key${why}, ${tail}`;
}

export async function retireAndRoster({
  sessionDate, generatedAt, depth = new Map(), exempt = new Set(), candidates = [], reader, probeMany = null, lister = null,
  prior = null, landed = landedKeys, deadline = null, remove = retire, write = publish, log = (line) => console.log(line),
} = {}) {
  if (!ARCHIVE_DATE_RE.test(String(sessionDate || ""))) {
    log("  roster: no session date, so no card can be aged — nothing retired, no roster written");
    return null;
  }
  const priorPayload = prior && prior.payload ? prior.payload : null;
  let { known, complete, why } = priorLedger(priorPayload, { sessionDate });
  let ledger = "carried";
  if (prior && prior.failed) {
    ledger = "unread";
    known = new Map();
    log(`  roster: the prior roster could not be read (HTTP ${prior.status}) — nothing is retired tonight, and the next run probes the store to rebuild the ledger`);
  } else if (!complete) {
    const probed = await bootstrapLedger({ tickers: [...new Set([...candidates, ...known.keys()].map((k) => rosterKeyTicker(k) || k))],
      landed, reader, probeMany, deadline });
    for (const [k, v] of probed.known) if (!known.has(k) || v) known.set(k, v);
    ledger = probed.capped || probed.failed ? "bootstrap-partial" : "bootstrap";
    log(`  roster: the prior ledger is not complete (${why}), so the store was probed — ${probeSaid(probed)}`);
  }
  if (lister && !(prior && prior.failed)) {
    const listed = await lister().catch((error) => ({ failed: true, status: 0, detail: error.message }));
    if (listed && !listed.failed && listed.keys && typeof listed.keys === "object") {
      let seen = 0, unknown = 0;
      for (const [key, a] of Object.entries(listed.keys)) {
        if (!rosterKeyTicker(key) || !a || a.present !== true) continue;
        seen++;
        if (known.has(key) || landed.has(key)) continue;
        known.set(key, probeDayOf(a));
        unknown++;
      }
      log(`  roster: the store lists ${seen} card, card-x and hist key(s), ${unknown} the ledger did not know` +
        (unknown ? " — aged with the rest, so any older than " + RETIRE_AFTER_SESSIONS + " sessions is retired tonight" : "") +
        (listed.truncated ? " (the listing was cut at its cap)" : ""));
    } else {
      log(`  roster: the store's key listing could not be read (${listed && listed.status ? "HTTP " + listed.status : "no answer"}` +
        `${listed && listed.detail ? ", " + listed.detail : ""}) — the ledger is used as it stands`);
    }
  }
  const plan = retirePlan({ sessionDate, known, landed, exempt });
  let removed = 0, absent = 0, refused = 0, streak = 0, lastStatus = 0;
  const gone = [];
  const held = { ...plan.held };
  for (const key of plan.retire) {
    if (streak >= 3) { held[key] = known.get(key); refused++; continue; }
    const r = await remove(key);
    if (r && r.ok) { removed++; streak = 0; gone.push(key); continue; }
    if (r && r.status === 404) { absent++; streak = 0; gone.push(key); continue; }
    refused++; streak++; lastStatus = r ? r.status : 0;
    held[key] = known.get(key);
  }
  log(`  retire: ${plan.retire.length} card/card-x/hist key(s) older than ${RETIRE_AFTER_SESSIONS} sessions and not ` +
    `rebuilt tonight — ${removed} removed` + (absent ? `, ${absent} already absent` : "") +
    (refused ? `, ${refused} refused (last HTTP ${lastStatus}), kept for the next run` : "") +
    `; ${Object.keys(held).length} older key(s) held (${plan.kept.young} within the window, ${plan.kept.exempt} exempt` +
    (plan.kept.undated ? `, ${plan.kept.undated} undated` : "") + ")");
  const built = buildRoster({ sessionDate, generatedAt, depth, landed, held, retired: gone, ledger });
  let written = true;
  try {
    if (!built.fits) {
      log(`  roster: ${built.bytes} bytes, over the cap — the held ledger is dropped so the roster still publishes`);
      const slim = buildRoster({ sessionDate, generatedAt, depth, landed, held: {}, retired: [], ledger: "dropped" });
      await write("roster", slim.payload);
    } else {
      await write("roster", built.payload);
    }
  } catch (error) {
    written = false;
    log(`  roster: NOT written (${error.message}) after ${removed} key(s) were removed` +
      (absent ? ` and ${absent} found already absent` : "") +
      ` — the stored roster stays at its older session, so the next run finds the gap and probes the store`);
  }
  const counts = built.payload.counts;
  if (written) {
    log(`  roster: ${Object.keys(built.payload.depth).length} carded name(s) — ` +
      Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ") + `, ${built.bytes} bytes (ledger ${ledger})`);
  }
  return { retired: removed, absent, refused, held: Object.keys(held).length, heldKeys: held, ledger, bytes: built.bytes, written,
    rostered: Object.keys(built.payload.depth).length };
}
