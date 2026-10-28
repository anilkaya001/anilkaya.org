import { readFileSync } from "node:fs";
import { cronJob } from "../../shared/flows-live-worker.js";
import { FF_PLANNED } from "./d1-budget-ff.mjs";

export const CAPS = Object.freeze({ written: 100000, read: 5000000 });

export const UPSERT_READS_PER_WRITE = 1;

export const WEEKDAY = "2026-09-22";
export const WEEKEND = "2026-09-26";

const DOW = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };

function expand(field, lo, hi, names = null) {
  const out = new Set();
  for (const part of field.split(",")) {
    const [range, step] = part.split("/");
    const n = (x) => (names && Object.hasOwn(names, x) ? names[x] : Number(x));
    let from = lo;
    let to = hi;
    if (range !== "*") {
      const [a, b] = range.split("-");
      from = n(a);
      to = b === undefined ? (step === undefined ? from : hi) : n(b);
    }
    const by = step === undefined ? 1 : Number(step);
    if (![from, to, by].every(Number.isFinite) || by < 1) throw new Error("d1-budget: unreadable cron field " + field);
    for (let v = from; v <= to; v += by) out.add(v);
  }
  return out;
}

export function cronStrings(toml = readFileSync(new URL("../../wrangler.toml", import.meta.url), "utf8")) {
  const m = /^crons\s*=\s*\[([^\]]*)\]/m.exec(toml);
  if (!m) throw new Error("d1-budget: wrangler.toml declares no crons");
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

export function dayFirings(crons, day) {
  const base = Date.parse(day + "T00:00:00Z");
  const dow = new Date(base).getUTCDay();
  const out = [];
  for (const cron of crons) {
    const [mi, hr, dom, mo, wd] = cron.split(/\s+/);
    if (dom !== "*" || mo !== "*") throw new Error("d1-budget: " + cron + " is not a daily cron");
    if (!expand(wd, 0, 6, DOW).has(dow)) continue;
    for (const h of [...expand(hr, 0, 23)].sort((a, b) => a - b)) {
      for (const m of [...expand(mi, 0, 59)].sort((a, b) => a - b)) {
        const at = base + (h * 60 + m) * 60000;
        out.push({ cron, at, job: cronJob(cron, at) });
      }
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

export function firingCounts(crons = cronStrings()) {
  const count = (day) => {
    const c = { rth: 0, focus: 0, funds: 0, housekeeping: 0, summary: 0 };
    for (const f of dayFirings(crons, day)) {
      if (!Object.hasOwn(c, f.job)) throw new Error("d1-budget: a cron firing maps to the unpriced job " + f.job);
      c[f.job]++;
    }
    return c;
  };
  return { weekday: count(WEEKDAY), weekend: count(WEEKEND) };
}

export const ENGINE_CEILINGS = Object.freeze({
  rth: Object.freeze({ trips: 3, read: 13, written: 5 }),
  focus: Object.freeze({ trips: 2, read: 650, written: 2 }),
  funds: Object.freeze({ trips: 2, read: 2, written: 1 }),
  summary: Object.freeze({ trips: 2, read: 5, written: 1 }),
  housekeeping: Object.freeze({ trips: 10, read: 4, written: 3 }),
});

export const COLD_START = Object.freeze({
  trips: 6,
  written: 22,
  startsPerWeekday: 312,
  source: "worst case: every one of the 312 Tier 1, focus, housekeeping and summary firings (the funds tick runs no bootstrap) on a fresh isolate runs the schema bootstrap batch (23 statements, 20 of them CREATE, three column probes); whether D1 bills a DDL statement as a row written is unmeasured (PLAN.final.md section 12), so each is counted as one",
});

export const TIER2 = Object.freeze({
  passesPerWeekday: 84,
  pass: Object.freeze({ trips: 11, read: 0, written: 13 }),
  storedReadsPerPass: 5,
  watchReadsPerWeekday: 520,
  source: "W02 section 2.5: 84 passes a weekday; scripts/flows-legs/live.mjs reads board:long, board:short, board:watch, focus and live:heartbeat once a pass; watch.mjs at most 5 reads a 5-minute tick in session",
});

export const NIGHTLY = Object.freeze({
  posts: Object.freeze({ cards: 706, cardX: 868, hist: 694, views: 27, deletes: 8 }),
  readRows: 3900,
  source: "measured log 2026-10-02 (W02 section 2.5, DEPLOY.md 832-837, 928-932): about 700 keys written, upsert reads about 700, archive walk about 270, store listing about 580; plus a full deepening night (docs/deepening.md): the governor's 535 rotated names each post a card, a card-x and a hist",
});

export const RAIL = Object.freeze({
  hoursDemanded: 16,
  loadEveryMinutes: 5,
  source: "shared/flows-rt-hub.js: the roster batch every five minutes while a viewer or a snapshot request holds demand; a 16-hour viewing day is the planning assumption",
});

export const MEMBERS = Object.freeze({
  count: 12,
  readRowsPerMemberDay: 18000,
  source: "PLAN.final.md 5.3: 6,700-18,000 rows read per member-day; the upper figure",
});

export const PLANNED = Object.freeze([
  Object.freeze({ id: "oracle.nightly", row: "oracle", written: 1730, read: 1730, source: "docs/oracle.md: one oracle row for each of the 856 carded names, oracle-top and oracle-norm, each post adding one manifest row through the door trigger (written 862 x 2) and, in warn mode, reading two rows for its tuple" }),
  Object.freeze({ id: "flowlab.nightly", row: "WP2", written: 10, read: 10, source: "docs/packages/WP2-flow-intelligence.md 7.3: five nightly keys, each post adding one manifest row through the door trigger (written 5 x 2) and, in warn mode, reading two rows for its tuple" }),
  Object.freeze({ id: "flowlab.nightly-read", row: "WP2", written: 0, read: 600, source: "docs/packages/WP2-flow-intelligence.md 7.3: one row a read of the nightly route; twelve members at fifty reads a day" }),
  Object.freeze({ id: "observer", row: "P1-25", written: 4, read: 672, source: "PLAN.final.md 5.3: transitions only; 48 firings of a 14-row batch" }),
  Object.freeze({ id: "ai.counters", row: "P1-08, P1-44", written: 660, read: 0, source: "PLAN.final.md 5.3: about 260 outcome and 400 class rows at about 200 calls" }),
  Object.freeze({ id: "ai.notes", row: "P1-45", written: 40, read: 0, source: "PLAN.final.md 5.3" }),
  Object.freeze({ id: "archive.ideas", row: "P0-42, P3-01", written: 3, read: 0, source: "PLAN.final.md 5.3" }),
  Object.freeze({ id: "lab.attempt-index", row: "P0-10", written: 200, read: 0, source: "PLAN.final.md 5.3: one index row per attempt" }),
  Object.freeze({ id: "dossier.slow-kinds", row: "P3-11", written: 800, read: 0, source: "PLAN.final.md 5.3" }),
  Object.freeze({ id: "member.state", row: "P3-35, Decision 6", written: 600, read: 54000, source: "100 members a day: 30 visit writes (a ping writes at most once a minute and otherwise reads 2 rows), 3 list writes, 3 exports (one row written each; the daily count read twice, about 100 rows), 100 pings (200 rows), 10 state reads and 5 Since reads of 5 rows; the 03:00 ET sweep deletes at most 500 export rows and re-seals at most 50" }),
  Object.freeze({ id: "audit.log", row: "P2-26", written: 10, read: 0, source: "PLAN.final.md 5.3" }),
  Object.freeze({ id: "ops.views", row: "P1-27, P2-03", written: 0, read: 4800, source: "24 rows a minute for 2.5 hours of owner viewing plus ten AI-block reads of 280 plus thirty coverage reads of 48" }),
  Object.freeze({ id: "coverage.view", row: "B1", written: 0, read: 6000, source: "B1 of the pipeline design: the owner's coverage read costs the 2,001-row listing ceiling at worst and about 500 rows in production (167 cards, 167 card-x, about 150 hist, 26 metadata ids), held 60 s in the Cache API, so a dozen reads a day is under 6,000" }),
  Object.freeze({ id: "positioning.view", row: "WP4", written: 0, read: 300, source: "WP4 section 13: the Positioning page reads one stored key (one row) a load, a drill reads one card-x row, and an owner opens the page about 300 times a day at most; the nightly adds one payload key to the posts already counted and card-x writes are unchanged in number" }),
  Object.freeze({ id: "lab.active-at", row: "P1-71", written: 0, read: 3, source: "PLAN.final.md 5.3: at most 3 rows after the scans are removed" }),
  Object.freeze({ id: "door.v2", row: "B3", written: 9212, read: 96800, source: "DESIGN.md 2.1 and 12 (B3, warn mode): 2,303 nightly posts (a full deepening night) add one manifest row each through the trigger and read two rows (the key's stored tuple and the universe's name list); the quarantine ring is priced at 2,303 would-have-refused events, each an insert plus its prune and body-clear rows (3), and a brake count of at most 40 rows read" }),
]);

export const AI_CAP_WORST_WRITES = 5000;

export const MEASURED_CEILINGS = Object.freeze({ nightlyPostWritten: 1, rosterRead: 190 });

export const D1_USERS = Object.freeze({
  "worker.js": ["engines", "members.pages", "nightly.ingest", "tier2.ingest", "ops.views", "ai.counters"],
  "server/ai.js": ["ai.counters"],
  "server/member-store.js": ["member.state"],
  "server/ops.js": ["ops.views"],
  "server/schema.js": ["engines"],
  "server/store.js": ["nightly.ingest", "members.pages", "door.v2", "coverage.view"],
  "shared/flows-dossier-worker.js": ["members.pages", "dossier.slow-kinds"],
  "shared/flows-ledger.js": ["engines", "tier2.ingest"],
  "shared/flows-live-worker.js": ["engines", "tier2.ingest"],
  "shared/flows-rt-hub.js": ["rail.roster"],
  "shared/lab-sign-in.js": ["lab.active-at"],
});

export function railLoads() {
  return RAIL.hoursDemanded * (60 / RAIL.loadEveryMinutes);
}

export function ledger(counts, measured = MEASURED_CEILINGS) {
  const engines = [];
  for (const job of Object.keys(ENGINE_CEILINGS)) {
    const c = ENGINE_CEILINGS[job];
    engines.push({ id: "engines." + job, kind: "engine", firings: counts.weekday[job],
      written: counts.weekday[job] * c.written,
      read: counts.weekday[job] * (c.read + UPSERT_READS_PER_WRITE * c.written) });
  }
  engines.push({ id: "engines.cold-start", kind: "engine", written: COLD_START.startsPerWeekday * COLD_START.written, read: COLD_START.startsPerWeekday * 4 });
  const t2 = TIER2.passesPerWeekday;
  const p = TIER2.pass;
  const posts = Object.values(NIGHTLY.posts).reduce((a, b) => a + b, 0);
  const rows = [
    ...engines,
    { id: "tier2.ingest", kind: "engine", written: t2 * p.written,
      read: t2 * (p.read + UPSERT_READS_PER_WRITE * p.written + TIER2.storedReadsPerPass) + TIER2.watchReadsPerWeekday },
    { id: "nightly.ingest", kind: "engine", written: posts * measured.nightlyPostWritten + 1,
      read: NIGHTLY.readRows + UPSERT_READS_PER_WRITE * posts },
    { id: "rail.roster", kind: "reader", written: 0, read: railLoads() * measured.rosterRead },
    { id: "members.pages", kind: "reader", written: 0, read: MEMBERS.count * MEMBERS.readRowsPerMemberDay },
    ...[...PLANNED, ...FF_PLANNED].map((x) => ({ id: x.id, kind: "planned", written: x.written, read: x.read })),
  ];
  return rows;
}

export function totals(rows) {
  return rows.reduce((t, r) => ({ written: t.written + r.written, read: t.read + r.read }), { written: 0, read: 0 });
}
