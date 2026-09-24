import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { chromium } from "playwright";
import { startWorker, FLOWS_PASSWORD, FLOWS_TEST_USER } from "./worker-server.mjs";
import { buildScoreTrack } from "../shared/flows-scores.js";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const deep = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

const TOKEN = "overview-token-aaaaaaaaaaaaaaaa";
const server = await startWorker({ extraVars: [`FLOWS_INGEST_TOKEN:${TOKEN}`] });
const url = (p) => server.baseURL + p;

const post = (key, body) => fetch(url("/api/flows/ingest?key=" + encodeURIComponent(key)), {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
  body: JSON.stringify(body),
});

const SESSION = "2026-08-24";

const bullRows = [
  { t: "KLA", r: 3, s: 41, cnv: 62, px: 812.40, chg: 0.0071, netPrem: 21400000, dp: 1,
    fam: { F: 44, P: 12, D: 30, V: 51, O: 40 } },
  { t: "ORCL", r: 1, s: 88, cnv: 81, px: 244.10, chg: 0.0192, netPrem: 36743812, dp: 1,
    fam: { F: 71, P: 90, D: 22, V: 63, O: 58 } },
  { t: "ADBE", r: 4, s: 33, cnv: 55, px: 372.66, chg: 0.0043, netPrem: -998000, dp: 1,
    fam: { F: 29, P: 18, D: 21, V: 40, O: 33 } },
  { t: "DE", r: 2, s: 57, cnv: 70, px: 498.02, chg: -0.0035, netPrem: 4100000, dp: 1,
    fam: { F: 33, P: 20, D: 61, V: 44, O: 35 } },

  { t: "CAT", r: 5, s: 26, cnv: 51, px: 415.88, chg: 0.0012, netPrem: 862000,
    fam: { F: 24, P: 9, D: 14, V: 36, O: 28 } },
];
const bearRows = [
  { t: "MU", r: 3, s: -35, cnv: 58, px: 118.77, chg: -0.0104, netPrem: -1700000, dp: 1,
    fam: { F: -40, P: -12, D: -25, V: 55, O: 41 } },
  { t: "PFE", r: 1, s: -91, cnv: 84, px: 24.33, chg: -0.0221, netPrem: -32300000, dp: 1,
    fam: { F: -55, P: -94, D: -30, V: 39, O: 62 } },
  { t: "XOM", r: 4, s: -28, cnv: 49, px: 112.04, chg: -0.0017, netPrem: -759000, dp: 1,
    fam: { F: -26, P: -11, D: -19, V: 33, O: 24 } },
  { t: "BAC", r: 2, s: -62, cnv: 66, px: 47.15, chg: 0.0008, netPrem: -7100000, dp: 1,
    fam: { F: -70, P: -31, D: -48, V: 48, O: 29 } },
];
const SCORES = new Map([...bullRows, ...bearRows].map((r) => [r.t, r.s]));

const board = (side, rows, sessionDate = SESSION, extra = {}) => ({
  side, rows, sessionDate, status: "ok", v: 2,
  generatedAt: new Date().toISOString(),
  deadBand: 20, scored: 24, neutral: 15, universe: 264, enriched: 60,
  ...extra,
});

const TRACK_DAYS = [
  { d: "2026-08-18", source: "boards", rows: [
    { t: "ORCL", s: 74 }, { t: "PFE", s: -55 }, { t: "NKE", s: 50 },
    { t: "CAT", s: -30 }, { t: "DE", s: 57 }, { t: "BAC", s: -50 }, { t: "AVGO", s: 62 },
  ] },
  { d: "2026-08-19", source: "scores", rows: [
    { t: "ORCL", s: 76 }, { t: "PFE", s: -58 }, { t: "MU", s: -18 }, { t: "NKE", s: 47 },
    { t: "CAT", s: -31 }, { t: "DE", s: 57 }, { t: "ADBE", s: 33 }, { t: "BAC", s: -55 },
  ] },
  { d: "2026-08-21", source: "scores", rows: [
    { t: "ORCL", s: 80, q: 1820 }, { t: "PFE", s: -60 }, { t: "NKE", s: 45 },
    { t: "CAT", s: -30 }, { t: "DE", s: 57 }, { t: "ADBE", s: 33 },
    { t: "BAC", s: -62 }, { t: "AVGO", s: 40 },
  ] },
  { d: SESSION, source: "scores", rows: [
    { t: "ORCL", s: 88, q: 2450 }, { t: "PFE", s: -91 }, { t: "MU", s: -35 },
    { t: "NKE", s: 18 }, { t: "CAT", s: 26 }, { t: "DE", s: 57 },
    { t: "ADBE", s: 33 }, { t: "KLA", s: 41 },
  ] },
];

const FLAT_DAYS = ["2026-08-21", SESSION].map((d) => ({
  d, source: "scores",
  rows: [...bullRows, ...bearRows].map((r) => ({ t: r.t, s: r.s })),
}));

const COLD_DAYS = [
  { d: "2026-08-21", source: "scores", rows: [{ t: "ORCL", s: 80 }] },
  { d: SESSION, source: "scores", rows: [{ t: "PFE", s: -91 }] },
];

const scoretrack = (days) => ({
  v: 2, sessionDate: SESSION, generatedAt: new Date().toISOString(),
  ...buildScoreTrack(days, { deadBand: 20, epoch: "2026-08-26" }),
});

const market = {
  v: 2, status: "ok", sessionDate: SESSION, generatedAt: new Date().toISOString(),
  n: 264, screened: 264,
  breadth: { bull: 9, bear: 12, flat: 0, unpriced: 3, tilt: -0.0143 },
  premium: { net: -18400000, tilt: -0.0212 },
};

const alerts = {
  v: 2, status: "ok", sessionDate: SESSION, generatedAt: new Date().toISOString(),
  readAt: "2026-08-25T10:28:20.000Z", refreshed: "nightly", seen: 7, cap: 60,

  rows: [
    { t: "ORCL", cp: "C", k: 250, exp: "2026-09-18", prem: 2980960, rule: "RepeatedHits",
      spanStart: "2026-08-24T13:47:00-04:00", spanEnd: "2026-08-24T13:52:00-04:00",
      askPrem: 2235720, bidPrem: 745240 },
    { t: "PFE", cp: "P", k: 24, exp: "2026-09-18", prem: 1450000, rule: "SteadyAccumulation",
      spanStart: "2026-08-24T09:35:00-04:00", spanEnd: "2026-08-24T09:41:00-04:00",
      askPrem: 348000, bidPrem: 1102000 },
    { t: "KLA", cp: "C", k: 820, exp: "2026-10-16", prem: 940000, rule: "LowHistoricVolume" },
  ],
};

const watch = {
  v: 2, side: "watch", status: "ok", sessionDate: SESSION,
  generatedAt: new Date().toISOString(), deadBand: 20, scored: 24, neutral: 15,
  rows: [
    { t: "NKE", r: 1, s: 18, cnv: 44, px: 78.10 },
    { t: "SBUX", r: 2, s: -12, cnv: 39, px: 92.44 },
  ],
};

const eventsPayload = {
  v: 2, status: "ok", sessionDate: SESSION, generatedAt: new Date().toISOString(),
  windowDays: 21, inWindow: 2, gateOrigin: SESSION,
  rows: [
    { t: "ORCL", d: "2026-08-27", dte: 3, sdte: 3, im: 0.0642, s: 88, st: "ranked" },

    { t: "PFE", d: "2026-09-04", dte: 11, sdte: 8, im: 0.0310, s: null, st: "gated" },
  ],
};

const pulsePayload = {
  v: 2, status: "ok", sessionDate: SESSION, generatedAt: new Date().toISOString(),
  readAt: new Date().toISOString(), cadenceMinutes: 15,
  totals: {
    status: "ok", seen: 3, cap: 20, shed: 0,
    rows: [
      { date: SESSION, callPrem: 17036252974, callVol: 12202894,
        putPrem: 13054676706, putVol: 6493149 },
      { date: "2026-08-21", callPrem: 15548052618, callVol: 9169998,
        putPrem: 14209345121, putVol: 7101223 },
      { date: "2026-08-20", callPrem: 12980114003, callVol: 8110447,
        putPrem: 12118880554, putVol: 6902551 },
    ],
  },
  tide: {
    status: "ok", seen: 3, cap: 78, shed: 0,
    points: [
      { t: SESSION + "T09:30:00-04:00", callPrem: -146307772, putPrem: -83670685, vol: -916838 },
      { t: SESSION + "T09:35:00-04:00", callPrem: 39938956, putPrem: 61514946, vol: 681275 },
      { t: SESSION + "T09:40:00-04:00", callPrem: 88110432, putPrem: -12004881, vol: 402117 },
    ],
  },
};

await post("pulse", pulsePayload);
await post("board:long", board("long", bullRows, SESSION, { deep: 4 }));
await post("board:short", board("short", bearRows, SESSION, { deep: 4 }));
await post("board:watch", watch);
await post("market", market);
await post("flowalerts", alerts);
await post("scoretrack", scoretrack(TRACK_DAYS));

{
  const { signFlowsSession } = await import("../shared/flows-auth.js");
  const { SESSION_SECRET } = await import("./worker-server.mjs");
  const cookie = { Cookie: "flows_session=" + await signFlowsSession(FLOWS_TEST_USER, SESSION_SECRET, 600, "1") };
  const now = await (await fetch(url("/api/flows/now?n=board:long,board:short,flowalerts,pulse,brief"), { headers: cookie })).json();
  for (const key of ["board:long", "board:short", "flowalerts", "pulse"]) {
    eq(now.keys[key].session, SESSION, `the heartbeat reads ${key}'s session from its column, without the payload`);
    ok(["fresh", "stale"].includes(now.keys[key].state), `and judges it on the nightly clock (${now.keys[key].state})`);
  }
  eq(now.keys.brief.state, "pending", "an unpublished key is pending on the heartbeat, never stale");
  const board = await fetch(url("/api/flows/board?side=long"), { headers: cookie });
  await board.text();
  eq(board.headers.get("x-fresh-session"), SESSION, "the board passthrough carries X-Fresh-Session");
  ok(/^\d{13}$/.test(board.headers.get("x-server-now") || ""), "and X-Server-Now for the page's clock skew");
}

const NEW_KEYS = /\/api\/flows\/(regime|universe|now|lk)(\?|$)/;
const stubNewKeys = (target) => target.route(NEW_KEYS, (route) => route.fulfill({
  status: 200, contentType: "application/json", body: JSON.stringify({ status: "pending" }) }));

const POP_READ = `(() => {
  const pop = document.getElementById("fxPop");
  const body = document.getElementById("fxPopB");
  if (!pop || !body) return null;
  const lead = body.querySelector(":scope > .ui-lead");
  const kids = Array.from(body.children).filter((n) => !n.classList.contains("ui-pop-sub"));
  const facts = {};
  for (const dt of body.querySelectorAll(":scope > dl > dt")) {
    facts[dt.textContent.trim()] = dt.nextElementSibling ? dt.nextElementSibling.textContent.trim() : "";
  }
  const sections = {};
  for (const h4 of body.querySelectorAll(":scope > h4")) {
    const lines = [];
    for (let n = h4.nextElementSibling; n && n.tagName === "P"; n = n.nextElementSibling) {
      lines.push(n.textContent.trim());
    }
    sections[h4.textContent.trim()] = lines.join(" ");
  }
  const table = body.querySelector("table");
  return {
    open: pop.matches(":popover-open"),
    title: document.getElementById("fxPopT").textContent.trim(),
    lead: lead ? lead.textContent.trim() : "",
    leadFirst: kids.length > 0 && kids[0] === lead,
    leadBeforeTable: !table || (lead && Boolean(lead.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING)),
    text: body.textContent,
    facts, sections,
    heads: Array.from(body.querySelectorAll("thead th"), (th) => th.textContent.trim()),
    rows: Array.from(body.querySelectorAll("tbody tr"), (tr) => Array.from(tr.children, (td) => td.textContent.trim())),
    focusable: Array.from(body.querySelectorAll(".hm-tw"), (w) => w.tabIndex === 0 && w.getAttribute("role") === "region"),
  };
})()`;

async function why(pg, sel) {
  const clicked = await pg.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    const pop = document.getElementById("fxPop");
    if (pop && pop.matches(":popover-open")) pop.hidePopover();
    el.click();
    return true;
  }, sel);
  return clicked ? pg.evaluate(POP_READ) : null;
}
const shut = (pg) => pg.evaluate(() => {
  const pop = document.getElementById("fxPop");
  if (pop && pop.matches(":popover-open")) pop.hidePopover();
});
const moduleWhy = (pg, id) => why(pg, "#" + id + " .ui-mod-h > .ui-info");

async function silenceOf(pg, sel) {
  const base = await pg.evaluate((s) => {
    const p = document.querySelector(s);
    if (!p) return null;
    return { kind: p.dataset.empty || null, word: (p.querySelector(".ui-silent-t") || p).textContent.trim() };
  }, sel);
  if (!base) return null;
  const pop = await why(pg, sel + "[data-info], " + sel + " [data-info]");
  await shut(pg);
  return { ...base, text: pop ? pop.lead : "", title: pop ? pop.title : "" };
}

const CHIPS = `Object.fromEntries(Array.from(document.querySelectorAll("#ccVerdict [data-chip]"), (c) => {
  const v = c.querySelector(".ui-chip-v");
  const full = v.querySelector(".hm-v-full");
  const halves = Array.from(v.querySelectorAll(".hm-v-full .hm-half"), (x) => x.textContent.trim());
  const hidden = full ? (full.querySelector(".visually-hidden") || {}).textContent || "" : "";
  const use = c.querySelector(".hm-chip-g use");
  const shown = full ? halves.join(" / ") : v.textContent.trim();
  return [c.dataset.chip, {
    v: shown, halves, spoken: hidden.trim(),
    tone: v.dataset.tone || null,
    kind: c.dataset.empty || null,
    mark: use ? use.getAttribute("href") : null,
    label: c.querySelector(".ui-chip-l").textContent.trim(),
    tag: c.tagName, info: Boolean(c.dataset.info),
  }];
}))`;
const chipsOf = (pg) => pg.evaluate(CHIPS);
const chipWhy = (pg, key) => why(pg, `#ccVerdict [data-chip="${key}"]`);

const LEADERS = `((id) => Array.from(document.querySelectorAll("#" + id + " .hm-lrow"), (r) => ({
  tag: r.tagName, t: r.querySelector(".hm-t").textContent.trim(),
  href: r.getAttribute("href"), title: r.getAttribute("title"), label: r.getAttribute("aria-label") || "",
  rank: r.querySelector(".hm-rk").textContent.trim(),
  score: r.querySelector(".hm-score").textContent.trim(),
  scoreTone: r.querySelector(".hm-score").dataset.tone || null,
  conv: r.querySelector(".hm-conv").textContent.trim(),
  chg: r.querySelector(".hm-chg").textContent.trim(),
  prem: r.querySelector(".hm-prem").textContent.trim(),
  cross: (r.querySelector(".cc-cross") || {}).textContent || null,
  hidden: r.hidden,
})))`;
const leaders = (pg, id) => pg.evaluate(`${LEADERS}(${JSON.stringify(id)})`);

const signIn = async (pg) => {
  await pg.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
  await pg.fill("#u", FLOWS_TEST_USER);
  await pg.fill("#p", FLOWS_PASSWORD);
  await Promise.all([
    pg.waitForNavigation({ waitUntil: "domcontentloaded" }),
    pg.click(".flows-submit"),
  ]);
};

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  await stubNewKeys(page);

  let allowFetchFailure = false;
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    if (allowFetchFailure && /Failed to load resource/.test(text)) return;
    errors.push("console: " + text);
  });

  await signIn(page);
  await page.waitForSelector("#ccBull .hm-lrow", { timeout: 15000 });

  {
    const seat = await page.evaluate(() => {
      const grid = document.querySelector(".hm-grid");
      const hero = document.getElementById("hmHero");
      return {
        ids: Array.from(grid.children, (n) => n.id),
        heroW: Math.round(hero.getBoundingClientRect().width),
        gridW: Math.round(grid.getBoundingClientRect().width),
        chipsInHero: Boolean(hero.querySelector("#ccVerdict [data-chip]")),
        jump: document.querySelectorAll(".cc-jump").length,
      };
    });
    deep(seat.ids, ["hmHero", "hmVerdict", "hmBull", "hmBear", "hmChg", "hmVol", "hmLean",
      "hmAlerts", "hmEvents", "hmWatch", "hmNews"],
      "the page reads hero, verdict, both leaders, what changed, volatility, sectors, " +
      "flagged windows, the calendar, the band's edge and the headlines, in that order");
    ok(Math.abs(seat.heroW - seat.gridW) <= 2,
      `the market hero spans the whole grid (${seat.heroW} of ${seat.gridW})`);
    ok(seat.chipsInHero, "and carries the session readings inside it rather than as a second bar");
    eq(seat.jump, 0, "and there is no jump strip: every module is one card on one screen of cards");

    const titles = await page.$$eval(".hm-grid .ui-mod-t", (hs) => hs.map((h) => h.textContent.trim()));
    ok(titles.length >= 9, `every module carries a title (${titles.length})`);
    for (const t of titles) {
      const words = t.split(/\s+/).length;
      ok(words >= 1 && words <= 3, `a module title is one to three words (${t})`);
      ok(t !== t.toUpperCase() || !/[A-Z]{2}/.test(t), `and sentence case, never ALL-CAPS (${t})`);
    }
  }

  {
    const hero = await page.evaluate(() => {
      const v = document.getElementById("hmTideV");
      const pill = document.querySelector("#hmTideState .hm-pill");
      return {
        value: v.dataset.value || v.textContent.trim(),
        tone: v.dataset.tone,
        state: pill && pill.dataset.state,
        pillInfo: Boolean(pill && pill.dataset.info),
        legs: Array.from(document.querySelectorAll("#hmTideLegs .ui-metric"), (m) => ({
          k: m.querySelector(".ui-metric-l").textContent.trim(),
          v: m.querySelector(".ui-metric-v").textContent.trim(),
          silent: m.querySelector(".ui-metric-v").dataset.tone === "silent",
          state: (m.querySelector(".ui-state") || {}).dataset?.state || null,
        })),
        svg: document.querySelectorAll("#hmTide svg[role=img]").length,
        label: (document.querySelector("#hmTide svg[role=img]") || { getAttribute: () => "" }).getAttribute("aria-label"),
        cap: document.getElementById("hmTideCap").textContent.trim(),
      };
    });
    eq(hero.value, "+$100.1M",
      "the hero prints the session's last net premium off the pulse tide: calls minus puts at the last point");
    eq(hero.tone, "up", "toned by its sign");
    eq(hero.cap, "Bullish premium", "and named in two words, never a paragraph");
    eq(hero.state, "stale",
      "the live key is unpublished, so the pulse's own session is read — and an August session " +
      "read in September wears the stale pill rather than a live dot");
    ok(hero.pillInfo, "with its reason one tap away");
    deep(hero.legs.map((l) => l.k), ["Net calls", "Net puts", "0DTE"],
      "the hero splits the net into its two legs and the zero-day share");
    eq(hero.legs[0].v, "+$88.1M", "the call leg at the last point");
    eq(hero.legs[1].v, "\u2212$12.0M", "and the put leg, signed with U+2212");
    ok(hero.legs[2].silent && hero.legs[2].state === "quiet",
      `a 0DTE leg no key carried for a stale session is an em dash wearing the quiet glyph, since no later read ` +
      `will fill it; the pending glyph is kept for a live tide (${JSON.stringify(hero.legs[2])})`);
    eq(hero.svg, 1, "the tide river is drawn");
    ok(/net premium/i.test(hero.label || ""), `and names what it plots to assistive tech (${hero.label})`);

    const pill = await why(page, "#hmTideState .hm-pill");
    ok(pill.open && pill.facts.Source === "pulse",
      `the pill's disclosure names the source it read (${JSON.stringify(pill.facts)})`);
    await shut(page);

    const vol = await silenceOf(page, "#ccVol [data-empty]");
    eq(vol.kind, "pending",
      "an unpublished regime key and live volatility layer leave the volatility module pending, not blank");
    ok(/neither has published/.test(vol.text), `and it says so behind Why (${vol.text})`);
  }

  {
    const tiles = await chipsOf(page);
    const keys = Object.keys(tiles);
    eq(keys.length, 5, "the hero states five session readings");
    deep(keys, ["Flow bias", "Breadth", "Cleared", "Put/call", "Flagged"],
      "flow bias, breadth, the cleared pool, put/call and the flagged count");
    ok(!("Session" in tiles) && !("Screened" in tiles),
       "the session and the screened population are the page's CAPTION, not two of " +
       "its readings — a date and a count that cannot be compared to a lean");
    for (const [k, t] of Object.entries(tiles)) {
      eq(t.tag, "BUTTON", `${k} is a button, because it opens its own disclosure`);
      ok(t.info, `and carries one (${k})`);
    }

    const meta = await page.evaluate(() => ({
      datetime: document.getElementById("ccMetaDate").getAttribute("datetime"),
      text: document.getElementById("ccMetaDate").textContent.trim(),
      screened: document.getElementById("ccMetaScreened").textContent.trim(),
    }));
    eq(meta.datetime, SESSION,
       "the caption names the session every figure below it is of, machine-readably");
    eq(meta.text, "Monday, Aug 24", "and in words a person reads at a glance");
    ok(meta.screened.includes("264"),
       "and how many names were screened, from the market payload");

    const head = await page.evaluate(() => {
      const box = document.getElementById("hmVerdict");
      return {
        title: document.getElementById("fxTitle").textContent.trim(),
        bar: document.getElementById("fxBarT").textContent.trim(),
        cls: box.className,
        line: document.getElementById("hmVerdictT").textContent.trim(),
        by: box.querySelector(".hm-verdict-by").textContent.trim(),
        mark: (box.querySelector(".hm-mark") || {}).dataset?.state || null,
        pending: box.querySelectorAll("[data-state=pending]").length,
      };
    });
    eq(head.title, "Last session",
       "a session that is not today's Eastern trading day is titled as the last session, never as Today over an older date");
    eq(head.bar, "Last session", "and the compact toolbar title that replaces the heading on scroll says the same");
    eq(head.line, "Bearish premium: flow bias \u22122.1%, 12 names net sold against 9 bought.",
       "with no written summary the verdict line is computed from the page's own flow bias and breadth");
    eq(head.by, "Computed", "and is attributed to the arithmetic rather than to Neuron");
    eq(head.mark, "quiet", "under a quiet mark");
    ok(/\bis-computed\b/.test(head.cls) && !/\bis-pending\b/.test(head.cls),
       `and the card leaves its pending styling, so the computed line is not dimmed like a placeholder (${head.cls})`);
    eq(head.pending, 0, "never a bare pending sign where a reading exists");

    eq(tiles["Flow bias"]?.v, "−2.1%",
       "the dollar-weight tilt is a share of premium, with its unit");
    const bias = await chipWhy(page, "Flow bias");
    ok(/−1\.4%/.test(bias.facts["Names equally weighted"] || ""),
       `and the equal-weight tilt is kept one tap away rather than dropped (${bias.facts["Names equally weighted"]})`);
    await shut(page);

    const prose = Object.entries(tiles).filter(([, t]) => !/^[\u2212+≥]?[\d.,%\u2014 /]+$/.test(t.v));
    eq(prose.length, 0,
       `no chip explains itself in prose while its value is a measurement (${
         prose.map(([k, t]) => k + ": " + t.v).join(" | ")})`);
    for (const [k, t] of Object.entries(tiles)) {
      ok(t.label.split(/\s+/).length <= 2, `and each is named in a word or two (${k}: ${t.label})`);
    }

    eq(tiles["Flow bias"]?.tone, "down",
       "a sold tape is toned as one, after the U+2212 in the glyph has already said so");
    ok(/^\u2212/.test(bias.facts["Names equally weighted"] || ""),
       "and the equal weighting carries its own sign in its own glyph");

    deep(tiles.Breadth?.halves, ["9", "12"], "breadth prints both sides of the split");
    deep(await page.evaluate(() => Array.from(document.querySelectorAll('#ccVerdict [data-chip="Breadth"] .hm-v-full .hm-half'), (x) => x.dataset.tone)),
      ["up", "down"], "the bought side toned up and the sold side down, so the pair reads without its label");
    ok(/bought/.test(tiles.Breadth?.spoken) && /sold/.test(tiles.Breadth?.spoken),
       `and names which side is which to assistive tech, so a bare 9 / 12 is never a ratio (${tiles.Breadth?.spoken})`);
    const breadth = await chipWhy(page, "Breadth");
    eq(breadth.facts.Bought, "9", "the disclosure names the bought side");
    eq(breadth.facts.Sold, "12", "and the sold side");
    await shut(page);

    deep(tiles.Cleared?.halves, ["5", "4"],
       "and both boards are counted whole, not to the region cap");
    ok(/bullish/.test(tiles.Cleared?.spoken) && /bearish/.test(tiles.Cleared?.spoken),
       `each side named in words (${tiles.Cleared?.spoken})`);
    ok(!("Both sides" in tiles), "and the old row-count tile is gone rather than kept beside it");
    eq(tiles.Flagged?.v, "7", "the vendor's flagged-window count");
    eq(tiles["Put/call"]?.v, "0.53",
       "put contracts per call off the pulse's own daily totals, when no history has published a z");

    eq(await page.locator("#ccVerdict [data-chip][data-empty]").count(), 0,
       "and no chip on a fully published session wears a silence mark");
  }

  {
    const bull = await leaders(page, "ccBull");
    const bear = await leaders(page, "ccBear");
    ok(bull.length > 0 && bear.length > 0, "both sides are populated from one page load");

    deep(bull.map((r) => r.t), ["ORCL", "DE", "KLA", "ADBE", "CAT"],
      "the bullish region shows the whole side in the payload's published rank order");

    deep(bear.map((r) => r.t), ["PFE", "BAC", "MU", "XOM"],
      "and the bearish region leads with the most bearish name, not the largest number");

    eq(bear[0]?.score, "−91", "the leading bear row prints its score as a real minus");
    ok(bear.every((r) => r.score.startsWith("−") && r.scoreTone === "down"),
       "and every bear row reads bearish in the glyph and is toned to match");
    ok(bull.every((r) => r.score.startsWith("+")), "while every bull row reads bullish");

    const orcl = bull.find((r) => r.t === "ORCL");
    deep([orcl.rank, orcl.t, orcl.score, orcl.conv, orcl.chg, orcl.prem],
      ["1", "ORCL", "+88", "conv 81", "+1.92%", "+$36.7M"],
      "a row carries rank, score, conviction, session change and net premium");
    ok(bull.every((r) => !r.hidden) && bear.every((r) => !r.hidden),
       "and a side of five or fewer is drawn whole, with nothing folded behind All");
  }

  {
    const px = await page.evaluate(() => {
      const r = document.querySelector('#ccBull .hm-lrow[data-ticker="ORCL"]');
      const c = r.querySelector(".hm-chg");
      return { text: c.textContent.trim(), title: c.getAttribute("title"), label: r.getAttribute("aria-label") };
    });
    eq(px.text, "+1.92%", "the change cell prints the session's price return");
    ok(/price return/.test(px.title || ""),
       `spelling out what is divided by what (${px.title})`);
    ok(/score/i.test(px.title || ""),
       `and naming the other change on the same screen, so the two cannot be read as one (${px.title})`);
    ok(/price \+1\.92%/.test(px.label),
       `and the spoken row names the quantity rather than the bare word both changes share (${px.label})`);

    const chg = await moduleWhy(page, "hmChg");
    ok(chg.heads.includes("\u0394 score"),
       `the change module's move column is in score points and says so (${chg.heads.join(" | ")})`);
    await shut(page);
  }

  {
    const shape = await page.evaluate(() => {
      const el = document.querySelector("#ccBull .hm-lrow");
      return { tag: el.tagName, type: el.getAttribute("type"), t: el.dataset.t,
               href: el.getAttribute("href"), pop: el.getAttribute("aria-haspopup") };
    });
    eq(shape.tag, "A", "a ranked row is an anchor, not a button that opens a modal");
    eq(shape.href, "/flows/ticker/?t=ORCL&s=signal&from=overview",
       `and it names the reader, the section and the surface it was read off (${shape.href})`);
    eq(shape.type, null, "an anchor carries no type");
    eq(shape.t, undefined,
       "and no data-t: the attribute existed only so a click delegation could find it");
    eq(shape.pop, null,
       "nor aria-haspopup=dialog, which would announce a modal that no longer exists");

    eq(await page.locator("#flowsCard").count(), 0,
       "and the card dialog is gone from the document rather than merely unreachable");

    const cat = (await leaders(page, "ccBull")).find((r) => r.t === "CAT");
    eq(cat.tag, "DIV", "a row the run built no card for renders as a plain row");
    eq(cat.href, null, "with no href — there is nothing to open");
    ok(/No detail card/.test(cat.title || ""),
       `and it says why rather than looking broken (${cat.title})`);

    eq(await page.locator("#ccBull .cc-open, #ccBear .cc-open").count(), 8,
       "so eight of the nine published names link to a reader and the ninth says why");

    const hrefs = await page.evaluate(() => Array.from(
      document.querySelectorAll("#ccBull .cc-open, #ccBear .cc-open"),
      (a) => [a.querySelector(".hm-t").textContent.trim(), a.getAttribute("href")]));
    for (const [name, href] of hrefs) {
      eq(href, "/flows/ticker/?t=" + name + "&s=signal&from=overview",
         `${name}: links to its own name on the reader (${href})`);
    }

    await page.evaluate(() => { window.__noReload = true; });
    await Promise.all([
      page.waitForNavigation({ timeout: 10000 }),
      page.locator("#ccBull .cc-open").first().click(),
    ]);
    ok(/\/flows\/ticker\/\?t=/.test(page.url()),
       `clicking a name lands on the reader for that name (${page.url()})`);
    eq(await page.evaluate(() => window.__noReload === undefined), true,
       "and it is a real navigation rather than a modal painted over this page");
    await page.goBack({ waitUntil: "networkidle" });
    await page.waitForSelector("#ccBull .cc-open", { timeout: 10000 });
  }

  {
    const strips = await page.evaluate(() => {
      const read = (sel) => Array.from(document.querySelectorAll(sel), (cell) => {
        const svg = cell.querySelector("svg");
        return {
          t: cell.closest(".hm-lrow").querySelector(".hm-t").textContent.trim(),
          drawn: !!svg,
          label: svg && svg.getAttribute("aria-label"),
          zero: !!(svg && svg.querySelector(".hm-zero")),
          text: cell.textContent.trim(),
        };
      });
      return { bull: read("#ccBull .hm-trk"), bear: read("#ccBear .hm-trk") };
    });
    eq(strips.bull.length, 5, "every bull row gets a strip cell");
    for (const s of strips.bull) {
      ok(s.drawn, `${s.t} draws its trace beside its score`);
      ok(s.zero, `and against an always-drawn zero rule (${s.t})`);
    }

    const xom = strips.bear.find((s) => s.t === "XOM");
    ok(xom && !xom.drawn && xom.text === "—",
       `a name with no trace says so with an em dash (${xom && xom.text})`);

    const ends = await page.evaluate(() => {
      const y = (id, name) => {
        const row = document.querySelector(`#${id} .hm-lrow[data-ticker="${name}"]`);
        const dots = Array.from(row.querySelectorAll(".hm-trk circle"),
          (c) => Number(c.getAttribute("cy")));
        return { min: Math.min(...dots), max: Math.max(...dots) };
      };
      return { orcl: y("ccBull", "ORCL"), pfe: y("ccBear", "PFE") };
    });
    ok(ends.pfe.min > ends.orcl.max,
       `both sides are drawn on one scale (PFE ${ends.pfe.min.toFixed(1)} below ` +
       `ORCL ${ends.orcl.max.toFixed(1)}; y grows downward)`);
  }

  {
    const chg = await moduleWhy(page, "hmChg");
    const lede = chg.lead;
    ok(chg.leadFirst && chg.leadBeforeTable,
       "the change module's finding is the FIRST thing in its disclosure, above the table it is about");
    ok(/7 of 9 names/.test(lede),
       `the module states how many moved out of how many were comparable (${lede})`);
    ok(/±20/.test(lede), `and the threshold the crossings are counted against (${lede})`);
    ok(/1 cleared, 1 faded back inside, 1 flipped sides/.test(lede),
       `and the three crossing counts by name, not as one total (${lede})`);
    ok(/2026-08-21/.test(lede) && new RegExp(SESSION).test(lede),
       `and the two sessions it is a change between (${lede})`);
    ok(/2 names were scored on the prior session and not on this one/.test(lede),
       `and the names that left the pool, which no delta can show (${lede})`);

    const rows = chg.rows;
    deep(rows.map((r) => r[1]), ["CAT", "NKE", "MU", "PFE", "ORCL", "AVGO", "BAC"],
      "crossings lead, then fresh drift by size, then the readings that are not about today");

    deep(rows[0], ["flipped · window high", "CAT", "+56", "1 session", "+26", "—", "1",
                   "this session"],
      "each row names the event, the move, the span it took, where it landed and how old the opinion is");

    deep(chg.heads, ["Event", "Name", "Δ score", "Over", "Ended at", "Δ resid ×10⁴",
                 "Run · sessions", "As of"],
      "every column is headed with what it measures and, where it has one, its unit");
    ok(chg.focusable.length === 1 && chg.focusable[0],
       "and the table scrolls inside its own keyboard-reachable region rather than widening the page");

    const by = Object.fromEntries(rows.map((r) => [r[1], r]));
    eq(by.MU[3], "2 sessions", "a move across a gap says how many sessions it spans");
    eq(by.PFE[3], "1 session", "and an overnight move says that it is one");
    eq(by.MU[0], "cleared · window low",
       "the name that came out of the dead band is the headline event, in words");
    eq(by.NKE[0], "faded · window low",
       "and the exit signal is worded as its own event, not as a smaller entry");

    eq(by.AVGO[3], "2 sessions · board-only",
       "a comparison spanning the backfill is marked rather than presented as adjacency");

    eq(by.ORCL[5], "+630", "a move is also given in residual units where both ends carried one");
    eq(by.PFE[5], "—", "and absent where either end did not, which is not a zero");

    eq(by.BAC[7], "2026-08-21 · 1 session back",
       "a name not scored in the newest session says which session it was last scored on");
    eq(by.ORCL[7], "this session", "and one that was says so");
    const fresh = rows.findIndex((r) => r[7] !== "this session");
    ok(fresh === 5, `and the stale readings are demoted below the fresh ones (${fresh})`);

    ok(!rows.some((r) => r[1] === "DE" || r[1] === "ADBE"),
       "a name that held its score is counted in the lead and is not a move");
    ok(!rows.some((r) => r[1] === "KLA"),
       "and a name with one scored session has nothing to subtract from");
    await shut(page);

    const stats = await page.evaluate(() => Object.fromEntries(Array.from(
      document.querySelectorAll("#ccChgStats .ui-metric"), (m) => [
        m.querySelector(".ui-metric-l").textContent.trim(),
        { v: m.querySelector(".ui-metric-v").textContent.trim(),
          s: (m.querySelector(".ui-metric-s") || {}).textContent || "" }])));
    deep(Object.keys(stats), ["Moved", "Cleared", "Faded", "Flipped"],
      "the module's surface is four counts, not a paragraph");
    eq(stats.Moved.v, "7", "how many moved");
    eq(stats.Moved.s, "of 9", "out of how many were comparable");
    deep([stats.Cleared.v, stats.Faded.v, stats.Flipped.v], ["1", "1", "1"],
      "and each crossing counted by name");

    const list = await page.evaluate(() => Array.from(
      document.querySelectorAll("#ccChgList .hm-crow"), (r) => ({
        t: r.dataset.ticker, tag: r.tagName, href: r.getAttribute("href"),
        title: r.getAttribute("title"), hidden: r.hidden,
        ev: r.querySelector(".hm-ev").textContent.trim(),
        dv: r.querySelector(".hm-dv").textContent.trim(),
      })));
    deep(list.map((r) => r.t), rows.map((r) => r[1]),
      "the visible list is the table's rows in the table's order");
    eq(list.filter((r) => !r.hidden).length, 5, "five are drawn and the rest fold behind All");
    eq(await page.locator("#ccChgList .ui-disclose").textContent(), "All 7",
      "and the fold says how many it holds");
    const cells = Object.fromEntries(list.map((r) => [r.t, r]));
    eq(cells.CAT.ev, "flipped", "a crossing names itself on the row");
    eq(cells.CAT.dv, "+56", "beside its move in score points");
    const labels = await page.evaluate(() => {
      const r = document.querySelector('#ccChgList .hm-crow[data-ticker="CAT"]');
      const c = (sel) => getComputedStyle(r.querySelector(sel), "::before").content;
      return { dv: c(".hm-dv"), end: c(".hm-end") };
    });
    ok(/\u0394|Δ/.test(labels.dv) && /now/.test(labels.end),
      `and neither number on the row is bare: the move wears a delta and the end score says it is the score now (${labels.dv} / ${labels.end})`);
    eq(cells.ORCL?.tag, "A", "a changed name with a card links to its reader");
    eq(cells.ORCL?.href, "/flows/ticker/?t=ORCL&s=signal&from=overview",
       `at the address the ranked region uses for the same name (${cells.ORCL?.href})`);

    eq(cells.CAT?.tag, "DIV", "a crossing with no card is still a plain row");
    eq(cells.CAT?.href, null, "with no href, so there is nothing to follow");
    ok(/No detail card/.test(cells.CAT?.title || ""),
       `and it says why rather than looking broken (${cells.CAT?.title})`);

    eq(cells.AVGO?.tag, "DIV", "and a name on no board opens nothing either");

    const tags = Object.fromEntries([
      ...(await leaders(page, "ccBull")), ...(await leaders(page, "ccBear"))].map((r) => [r.t, r.cross]));
    eq(tags.CAT, "flipped", "a ranked name that changed sides says so on its own row");
    eq(tags.MU, "cleared", "and one that came out of the band this session says that");
    eq(tags.PFE, null, "while the largest drift on the page carries no crossing tag");
    eq(tags.DE, null, "and neither does a name that has not moved at all");

    await Promise.all([
      page.waitForNavigation({ timeout: 10000 }),
      page.locator('#ccChgList .cc-open[data-ticker="MU"]').click(),
    ]);
    ok(/\/flows\/ticker\/\?t=MU\b/.test(page.url()),
       `a name in the change module leads to that name's reader (${page.url()})`);
    await page.goBack({ waitUntil: "networkidle" });
    await page.waitForSelector("#ccChgList .cc-open", { timeout: 10000 });
  }

  {
    const pending = await silenceOf(page, "#ccEvents [data-empty]");
    ok(pending, "the never-published events calendar renders a silence");
    eq(pending.kind, "pending", "marked as an unpublished key");
    eq(pending.word, "Pending", "in one word on the surface");
    ok(/has not been published/.test(pending.text) && !/could not be read/.test(pending.text),
       `and worded behind Why as one — the pipeline has not spoken (${pending.text})`);
    ok(!/No name/.test(pending.text),
       "and it makes no claim about what the calendar holds, because it has not seen it");

    eq(await page.locator("#ccAlerts .hm-arow").count(), 3,
       "the flagged-window module draws the vendor's rows");
    const al = await moduleWhy(page, "hmAlerts");
    eq(al.rows.length, 3, "and its disclosure tabulates the same three");

    deep(al.rows[0],
      ["13:47", "ORCL", "C 250 09-18", "$3.0M", "ask 75%", "RepeatedHits"],
      "each flagged window names when it opened, the contract, the premium, which side " +
      "of the quote the vendor attributed it to, and the rule that fired");

    deep([al.rows[2][0], al.rows[2][4]], ["\u2014", "\u2014"],
      "a window the vendor timed and split for neither prints the em dash in both, " +
      "rather than a zero o'clock and an even split nobody measured");
    const quietMeter = await page.evaluate(() => {
      const row = document.querySelectorAll("#ccAlerts .hm-arow")[2];
      return { dash: Boolean(row.querySelector(".ui-dash.hm-side")), meter: Boolean(row.querySelector(".ui-meter")) };
    });
    ok(quietMeter.dash && !quietMeter.meter,
       "and the row draws no ask-share meter for a split nobody measured");
    ok(/largest flagged window/i.test(al.lead), `the alerts disclosure leads with its own finding (${al.lead})`);
    ok(/\d/.test(al.lead),
       `and the lead carries a figure (${al.lead}) — a one-liner with no number in it is prose`);
    ok(al.leadFirst && al.leadBeforeTable,
       "and it is the FIRST thing in the disclosure — a finding drawn under the rows it is about is a caption");
    await shut(page);

    eq(await page.locator("#ccWatch .ui-row").count(), 2,
       "and the dead band's residents are listed rather than counted");

    eq(await page.locator("#ccWatch .cc-open, #ccWatch a.ui-row").count(), 0,
       "the watch module mints no opener, because no watched name has a card");

    const wt = await moduleWhy(page, "hmWatch");
    ok(/zero rule|unsided/.test(wt.lead), `#ccWatch leads with its own finding (${wt.lead})`);
    ok(/\d/.test(wt.lead), `and the lead carries a figure (${wt.lead})`);
    ok(wt.leadFirst, "and it is the first thing in its disclosure");
    await shut(page);

    const asUsd = (text) => {
      const m = /^\$([\d.]+)([BMK]?)$/.exec(text.trim());
      if (!m) return null;
      return Number(m[1]) * ({ B: 1e9, M: 1e6, K: 1e3 }[m[2]] || 1);
    };

    const premAt = al.heads.findIndex((h) => /^premium$/i.test(h));
    ok(premAt >= 0, `the flagged-window table has a Premium column (${al.heads.join(" | ")})`);
    const premCells = al.rows.map((r) => asUsd(r[premAt]));
    ok(premCells.length >= 2 && premCells.every((one) => one !== null),
       `every drawn premium parses (${premCells.join(", ")}) — a column this check could not ` +
       "read would let it pass by comparing nothing");
    for (let i = 1; i < premCells.length; i++) {
      ok(premCells[i] <= premCells[i - 1],
         `the flagged windows are drawn largest premium first (${premCells.join(" ")}) — the ` +
         "module's list label and its lead both say so, and the sentence a " +
         "reader is given about the order has to be the order they are in");
    }
    const listed = await page.$$eval("#ccAlerts .hm-arow .ui-row-v", (vs) => vs.map((v) => v.textContent.trim()));
    deep(listed, al.rows.map((r) => r[premAt]), "and the visible rows are the table's, in the table's order");
  }

  {
    allowFetchFailure = true;
    await page.route("**/api/flows/scoretrack*", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: "{}" }));
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccChg [data-empty]", { timeout: 15000 });
    const failed = await silenceOf(page, "#ccChg [data-empty]");
    eq(failed.kind, "unreadable", "an endpoint that answered 500 is marked unreadable");
    ok(/could not be read/.test(failed.text),
       `and says the fault is this page's (${failed.text})`);
    ok(/not a fact about the session/.test(failed.text) || !/No name/.test(failed.text),
       "and refuses to report it as a session in which nothing moved");

    ok(await page.locator("#ccBull .hm-lrow").count() === 5,
       "and the modules that did answer are unaffected");

    eq(await page.locator("#ccBull .hm-trk svg").count(), 0,
       "with no strip drawn from a payload that never arrived");

    const sub = await page.evaluate(() => {
      const el = document.getElementById("ccChgSub");
      return { text: el.textContent.trim(), label: el.getAttribute("aria-label") };
    });
    eq(sub.text, "", "and the module header states no count out of a payload it never read");
    eq(sub.label, "since each name's prior scored session",
       "while still saying what a move is measured against");
    await page.unroute("**/api/flows/scoretrack*");
    allowFetchFailure = false;
  }

  {

    allowFetchFailure = true;
    await page.route("**/api/flows/board?side=long", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: "{}" }));
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccBull [data-empty]", { timeout: 15000 });

    const bull = await silenceOf(page, "#ccBull [data-empty]");
    eq(bull.kind, "unreadable", "a pole that answered 500 is marked unreadable");
    ok(/could not be read/.test(bull.text) && /not a fact about the session/.test(bull.text),
       `and says the fault is this page's (${bull.text})`);
    ok(!/No name leaned/.test(bull.text),
       "in words that are not the empty-side reading, which is a claim about the market");

    eq(await page.locator("#ccVerdict [data-chip]").count(), 5,
       "the hero still states its five readings");
    eq(await page.locator("#ccBear .hm-lrow").count(), 4,
       "the pole that DID answer still draws its whole side");
    eq(await page.locator("#ccChgList .hm-crow").count(), 7,
       "what changed still draws, out of a payload that came back fine");
    eq(await page.locator("#ccAlerts .hm-arow").count(), 3,
       "the flagged windows still draw");
    eq(await page.locator("#ccWatch .ui-row").count(), 2,
       "the dead band's residents still draw");
    eq(await page.locator("#ccEvents [data-empty]").count(), 1,
       "and the never-published calendar still says which silence IT is in");
    eq(await page.locator("#spinePlot svg").count(), 1, "the spine is still drawn");

    const tiles = await chipsOf(page);
    deep(tiles.Cleared?.halves, ["\u2014", "4"],
       "the unreadable side is an em dash, never a 0 — and each side keeps its own place, " +
       "so a half-silent chip cannot be read as a ratio");

    eq(await page.locator("#ccMetaDate").getAttribute("datetime"), SESSION,
       "and the session is taken off the half that answered");

    const status = await page.evaluate(
      () => document.getElementById("flowsStatus").textContent.trim());
    ok(/bullish board could not be read/.test(status),
       `the status line names the board that did not answer, by side (${status})`);
    ok(!/^Loading/.test(status),
       `rather than the loading sentence it used to be left holding (${status})`);
    ok(await page.locator('[data-rail-count="long"]').evaluate((el) => el.hidden),
       "and the rail badges nothing for it rather than badging 0");
    await page.unroute("**/api/flows/board?side=long");

    await page.route("**/api/flows/board?side=short", (route) => route.abort("failed"));
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccBear [data-empty]", { timeout: 15000 });
    const bear = await silenceOf(page, "#ccBear [data-empty]");
    eq(bear.kind, "unreadable", "a board whose request never came back is unreadable too");
    ok(/could not be read/.test(bear.text),
       `and is worded as this page's fault (${bear.text})`);
    eq(await page.locator("#ccBull .hm-lrow").count(), 5,
       "while the other pole is untouched by it");
    eq(await page.locator("#ccChgList .hm-crow").count(), 7,
       "and so is every module that answered");
    const netStatus = await page.evaluate(
      () => document.getElementById("flowsStatus").textContent.trim());
    ok(/bearish board could not be read/.test(netStatus),
       `named on the status line by side (${netStatus})`);
    await page.unroute("**/api/flows/board?side=short");

    for (const side of ["long", "short"]) {
      await page.route("**/api/flows/board?side=" + side, (route) =>
        route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
    }
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccChgList .hm-crow", { timeout: 15000 });
    eq(await page.locator("#ccChgList .hm-crow").count(), 7,
       "with both poles unreadable the change module still draws every mover it read");
    eq(await page.locator("#ccAlerts .hm-arow").count(), 3,
       "the flagged windows still draw");
    eq(await page.locator("#ccWatch .ui-row").count(), 2,
       "the dead band's residents still draw");
    eq(await page.locator("#ccVerdict [data-chip]").count(), 5,
       "and the hero still states five readings, every count of them an em dash");
    const both = await page.evaluate(() => ({
      bull: document.querySelector("#ccBull [data-empty]")?.dataset.empty || null,
      bear: document.querySelector("#ccBear [data-empty]")?.dataset.empty || null,
      status: document.getElementById("flowsStatus").textContent.trim(),
    }));
    eq(both.bull, "unreadable", "both poles say which silence they are in");
    eq(both.bear, "unreadable", "each in its own module");
    ok(/bullish and bearish boards could not be read/.test(both.status),
       `and the status line names them both, once (${both.status})`);
    ok(!/^Loading/.test(both.status),
       `rather than being left holding the loading sentence (${both.status})`);
    for (const side of ["long", "short"]) {
      await page.unroute("**/api/flows/board?side=" + side);
    }
    allowFetchFailure = false;
  }

  {

    await page.route("**/api/flows/board?side=watch", (route) => route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ side: "watch", rows: [], generatedAt: null, status: "pending" }),
    }));
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccWatch [data-empty]", { timeout: 15000 });
    const kind = await page.evaluate(
      () => document.querySelector("#ccWatch [data-empty]").dataset.empty);
    eq(kind, "pending", "an unpublished watch board is pending, not empty");
    const badge = await page.evaluate(() => {
      const el = document.querySelector('[data-rail-count="watch"]');
      return { text: el.textContent.trim(), hidden: el.hidden };
    });
    eq(badge.hidden, true, "and the rail badges nothing rather than badging 0");
    eq(badge.text, "", "with no number left behind in the slot");
    eq((await page.locator("#ccWatchSub").textContent()).trim(), "",
       "and the module header counts nothing it was never given");
    await page.unroute("**/api/flows/board?side=watch");

    await page.route("**/api/flows/board?side=watch", (route) => route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ ...watch, rows: [], status: "thin", neutral: 0, deadBand: 1 }),
    }));
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccWatch [data-empty]", { timeout: 15000 });
    const thin = await silenceOf(page, "#ccWatch [data-empty]");
    eq(thin.kind, "empty", "a thin watch board, with no name inside the band, is the measured quiet and not an outage");
    eq(thin.word, "Quiet", "in one word on the surface");
    ok(/cleared the ±1 band/.test(thin.text), `and says why behind Why (${thin.text})`);
    eq((await page.locator("#ccWatchSub").textContent()).trim(), "0", "with its count beside the title");
    await page.unroute("**/api/flows/board?side=watch");

    const todayET = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
    for (const [side, rows] of [["long", bullRows], ["short", bearRows]]) {
      await page.route("**/api/flows/board?side=" + side, (route) => route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify(board(side, rows, todayET, { deep: 4 })) }));
    }
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccMetaDate[datetime]", { timeout: 15000 });
    eq(await page.locator("#fxTitle").textContent(), "Today",
       "and only a session that IS today's Eastern date is titled Today");
    const served = await page.evaluate(() => fetch("/flows/", { credentials: "same-origin" }).then((r) => r.text()));
    ok(/<h1 id="fxTitle">Session<\/h1>/.test(served),
       "the server renders a neutral heading, so no reader without script, and no first paint, sees Today over an older session");
    ok(/<title>Flows — Home<\/title>/.test(served) && !/<title>[^<]*Today/.test(served),
       "and the document title names the page, not a day it cannot know");
    for (const side of ["long", "short"]) await page.unroute("**/api/flows/board?side=" + side);
  }

  {

    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccWatch .ui-row", { timeout: 15000 });
    const whole = await page.evaluate(() => {
      const el = document.getElementById("ccWatchSub");
      return { text: el.textContent.trim(), label: el.getAttribute("aria-label") || "" };
    });
    eq(whole.text, "2", "a watch board shorter than the cap is counted in one numeral");
    ok(/^all 2 /.test(whole.label),
       `and stated whole to assistive tech, which is the word that has to survive (${whole.label})`);

    const watchMany = Array.from({ length: 12 }, (_, i) => ({
      t: "W" + String(i + 1).padStart(2, "0"), r: i + 1, s: 18 - i,
      cnv: 40, px: 10 + i,

      resid: (i % 2 ? 1 : -1) * (0.0200 - i * 0.0011),
    }));
    await post("board:watch", { ...watch, rows: watchMany });
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccWatch .ui-row", { timeout: 15000 });
    eq(await page.locator("#ccWatch .ui-row").count(), 8,
       "twelve published rows are listed eight deep");
    const capped = await page.evaluate(() => {
      const el = document.getElementById("ccWatchSub");
      return { text: el.textContent.trim(), label: el.getAttribute("aria-label") || "" };
    });
    eq(capped.text, "8 of 12",
       "and the anchor says eight of twelve rather than \"12\" over eight names");
    ok(/^8 of 12 /.test(capped.label), `to assistive tech as well (${capped.label})`);

    const band = await page.evaluate(() => Array.from(
      document.querySelectorAll("#ccWatch .ui-row"), (row) => ({
        text: row.textContent, num: row.querySelector(".ui-row-v").textContent.trim() })));
    eq(band[0].num, "resid −0.0200",
       "a residual below zero carries U+2212, the page's one minus, and the name of its unit");
    eq(band[1].num, "resid +0.0189",
       "and one above zero carries the plus every other signed number here carries");
    ok(band.every((r) => !/-\d/.test(r.text)),
       "so no row in the band prints a hyphen-minus before a digit");
    eq(await page.evaluate(
       () => document.querySelector('[data-rail-count="watch"]').textContent.trim()), "12",
       "while the rail still badges the whole board, which is what its link opens");
    await post("board:watch", watch);

    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccAlerts .hm-arow", { timeout: 15000 });
    eq((await page.locator("#ccAlertsSub").textContent()).trim(), "3 of 7",
       "the flagged-window count is its rows against the read's own seen");
    const readOf = async (pg) => {
      const d = await moduleWhy(pg, "hmAlerts");
      await shut(pg);
      return d.facts.Read || "";
    };
    const stamp = await readOf(page);
    ok(/^nightly read /.test(stamp),
       `and the disclosure names the cadence before the instant (${stamp})`);
    ok(!/\d{2}:\d{2}:\d{2}/.test(stamp),
       `with no seconds field, which this feed cannot support (${stamp})`);
    ok(/read (\d{4}-\d{2}-\d{2} )?\d{2}:\d{2} \S/.test(stamp),
       `on a 24-hour clock that names the zone it is in, dated when the read is not today's (${stamp})`);

    const tzCtx = await browser.newContext({
      viewport: { width: 1280, height: 1000 }, timezoneId: "America/New_York" });
    await stubNewKeys(tzCtx);
    const tzPage = await tzCtx.newPage();
    tzPage.on("pageerror", (e) => errors.push("tz: " + e.message));
    await signIn(tzPage);
    await tzPage.waitForSelector("#ccAlerts .hm-arow", { timeout: 15000 });
    const tzSaid = await readOf(tzPage);

    ok(/read (\d{4}-\d{2}-\d{2} )?10:28 UTC/.test(tzSaid),
       `a reader in another zone sees the same instant under the same label, UTC, the one clock ` +
       `every stamp on the site now keeps (${tzSaid})`);
    ok(!/06:28/.test(tzSaid), `never silently converted to the reader's own zone (${tzSaid})`);
    await tzCtx.close();

    const alertMany = Array.from({ length: 10 }, (_, i) => ({
      t: "A" + String(i + 1).padStart(2, "0"), cp: "C", k: 100 + i,
      exp: "2026-09-18", prem: 2000000 - i * 1000, rule: "RepeatedHits",
    }));
    await post("flowalerts", { ...alerts, seen: 44, rows: alertMany });
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccAlerts .hm-arow", { timeout: 15000 });
    eq(await page.locator("#ccAlerts .hm-arow").count(), 8,
       "a feed longer than the cap is listed eight deep");
    eq(await page.locator("#ccAlerts .hm-arow:not([hidden])").count(), 5,
       "five of them on the surface and the rest behind All");
    const capSub = (await page.locator("#ccAlertsSub").textContent()).trim();

    eq(capSub, "8 of 44",
       "and the count states the read's whole population beside the eight rows it drew");
    ok(/^nightly read /.test(await readOf(page)), "with its cadence and instant one tap away");
    eq((await chipsOf(page)).Flagged?.v, "44",
       "which is the same number the Flagged chip prints in the hero");

    await post("flowalerts", { ...alerts, seen: 44, rows: alertMany,
      vendorLimit: 44, vendorTruncated: true });
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccAlerts .hm-arow", { timeout: 15000 });
    const ceiling = { chip: (await chipsOf(page)).Flagged,
      sub: (await page.locator("#ccAlertsSub").textContent()).trim(),
      label: await page.locator("#ccAlertsSub").getAttribute("aria-label") };
    eq(ceiling.chip.v, "≥44",
       "a read that hit the vendor's ceiling prints the count as a floor, never as a census");
    const floorWhy = await chipWhy(page, "Flagged");
    ok(/floor and never a census/.test(floorWhy.lead),
       `and the chip carries the floor's sentence behind its disclosure, not under the value (${floorWhy.lead})`);
    await shut(page);
    eq(ceiling.sub, "8 of ≥44",
       "the module count carries the same floor, so the two cannot disagree");
    ok(/at least 44/.test(ceiling.label || ""), `and says it in words to assistive tech (${ceiling.label})`);
    ok(/nightly/.test(await readOf(page)),
       "and carries when the read was taken, which is where that belongs");
    await post("flowalerts", { ...alerts, seen: 44, rows: alertMany,
      vendorLimit: 44, vendorTruncated: false });
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccAlerts .hm-arow", { timeout: 15000 });
    eq((await chipsOf(page)).Flagged?.v, "44", "a read published as NOT truncated prints the bare count");
    eq((await page.locator("#ccAlertsSub").textContent()).trim(), "8 of 44",
       "on the chip and in the module count alike");

    const noCadence = { ...alerts };
    delete noCadence.refreshed;
    await post("flowalerts", noCadence);
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccAlerts .hm-arow", { timeout: 15000 });

    const said = await readOf(page);
    ok(!/nightly/.test(said),
       `a payload that published no cadence is not reported as a nightly read (${said})`);
    ok(!/intraday/.test(said), `nor as an intraday one (${said})`);
    ok(/not published/.test(said),
       `and names the field that is missing instead (${said})`);
    await post("flowalerts", alerts);

    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccChgList .hm-crow", { timeout: 15000 });
    const chgSub = await page.evaluate(() => {
      const el = document.getElementById("ccChgSub");
      return { text: el.textContent.trim(), label: el.getAttribute("aria-label") };
    });
    eq(chgSub.text, "7", "the change module counts the movers it drew");
    eq(chgSub.label, "all 7 · since each name's prior scored session",
       "and keeps the sentence saying what a move is measured against");

    const manyMovers = ["2026-08-21", SESSION].map((d, i) => ({
      d, source: "scores",
      rows: Array.from({ length: 14 }, (_, k) => ({ t: "N" + k, s: 30 + k + (i ? k + 1 : 0) })),
    }));
    await post("scoretrack", scoretrack(manyMovers));
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccChgList .hm-crow", { timeout: 15000 });
    eq(await page.locator("#ccChgList .hm-crow").count(), 12,
       "fourteen movers are drawn twelve deep");
    const chgMany = await moduleWhy(page, "hmChg");
    eq(chgMany.rows.length, 12, "in the disclosure's table as well");
    await shut(page);
    const chgCap = await page.evaluate(() => {
      const el = document.getElementById("ccChgSub");
      return { text: el.textContent.trim(), label: el.getAttribute("aria-label") };
    });
    eq(chgCap.text, "12 of 14",
       "and the header says so rather than presenting an index as the population");
    ok(/^12 of 14 · /.test(chgCap.label), `in words too (${chgCap.label})`);
    await post("scoretrack", scoretrack(TRACK_DAYS));
  }

  {

    await post("scoretrack", scoretrack(FLAT_DAYS));
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccChg [data-empty]", { timeout: 15000 });
    const still = await silenceOf(page, "#ccChg [data-empty]");
    eq(still.kind, "empty", "a trace that moved nowhere is a measured emptiness");
    eq(still.word, "Quiet", "and says so in one word on the surface");
    ok(/Every one of the 9 names with two scored sessions held its score/.test(still.text),
       `and says exactly that, in the session's own terms (${still.text})`);
    ok(/reading about the session rather than a gap in the archive/.test(still.text),
       `and names which of the two it is (${still.text})`);
    ok(/±20/.test(still.text) && /No name crossed it/.test(still.text),
       `and states the threshold nothing crossed (${still.text})`);
    ok(!/fixture|dry run|synthetic/i.test(still.text),
       "without explaining itself in terms of how the data was made");
    ok(/\b9\b/.test(still.text),
       `and says how many names it compared, so the claim has a population (${still.text})`);

    ok(await page.locator("#ccBull .hm-trk svg").count() === 5,
       "and the strips still draw, because a flat line is a measurement");
  }

  {

    await post("scoretrack", scoretrack(COLD_DAYS));
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccChg [data-empty]", { timeout: 15000 });
    const cold = await silenceOf(page, "#ccChg [data-empty]");
    eq(cold.kind, "unavailable",
       "an archive with nothing to compare is not a measured emptiness");
    ok(/No name in the pool was scored on two sessions/.test(cold.text),
       `and says what is missing (${cold.text})`);
    ok(/not a market that stood still/.test(cold.text),
       `refusing the reading it cannot make (${cold.text})`);
    ok(!/held its score/.test(cold.text),
       "in words that are not the measured-emptiness sentence");
    await post("scoretrack", scoretrack(TRACK_DAYS));
  }

  {

    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#spinePlot svg", { timeout: 15000 });
    const spine = await page.evaluate(() => {
      const svg = document.querySelector("#spinePlot svg");
      if (!svg) return null;
      const band = svg.querySelector(".sp-band");
      const vb = svg.getAttribute("viewBox").split(/\s+/).map(Number);
      const ticks = Array.from(svg.querySelectorAll(".sp-ticklabel")).map((t) => t.textContent.trim());
      const dots = Array.from(svg.querySelectorAll(".sp-dot")).map((d) => ({
        x: Number(d.getAttribute("cx")),
        bull: d.classList.contains("is-bull"),
        t: d.getAttribute("data-t"),
        title: (d.querySelector("title") || {}).textContent,
      }));

      const tickX = {};
      const labels = Array.from(svg.querySelectorAll(".sp-ticklabel"));
      const lines = Array.from(svg.querySelectorAll(".sp-tick"));
      labels.forEach((l, i) => { tickX[l.textContent.trim()] = Number(lines[i].getAttribute("x1")); });
      const axis = svg.querySelector(".sp-axis");
      return {
        hasBand: !!band,
        bandFill: band && band.getAttribute("fill"),
        bandLabel: (svg.querySelector(".sp-bandlabel") || {}).textContent,
        ariaLabel: svg.getAttribute("aria-label"),
        width: vb[2], ticks, dots, tickX,
        axis: axis ? { x1: Number(axis.getAttribute("x1")), x2: Number(axis.getAttribute("x2")) } : null,
        hasPattern: !!svg.querySelector("defs pattern"),
        inRegion: !!document.querySelector("#hmChg #spinePlot"),
      };
    });
    ok(spine, "the spine is drawn");

    ok(spine.inRegion, "and it kept its place, inside the what-changed module");
    ok(spine.hasBand, "and it carries the dead band");

    ok(spine.hasPattern && /url\(#/.test(spine.bandFill || ""),
       `the band is hatched so it survives greyscale (${spine.bandFill})`);
    ok(/15 of 24/.test(spine.bandLabel || ""),
       `and says how much of the market it swallowed (${spine.bandLabel})`);
    ok(/not named/.test(spine.bandLabel || ""), "and that those names are not published");
    ok(/dead band/.test(spine.ariaLabel || "") || /inside the plus or minus/.test(spine.ariaLabel || ""),
       `a screen reader is told the same thing the picture says (${spine.ariaLabel})`);

    deep(spine.ticks, ["−100", "−50", "0", "+50", "+100"],
      "the axis is labelled -100..+100");

    ok(spine.axis, "the spine draws an axis line");
    const x0 = spine.tickX["−100"], x1 = spine.tickX["+100"];
    ok(Number.isFinite(x0) && Number.isFinite(x1) && x1 > x0,
       "the axis declares both of its endpoints");
    ok(Math.abs(x0 - spine.axis.x1) < 0.75,
       `the -100 tick IS the left end of the drawn axis (${x0} vs ${spine.axis.x1})`);
    ok(Math.abs(x1 - spine.axis.x2) < 0.75,
       `and +100 IS the right end (${x1} vs ${spine.axis.x2})`);
    ok(x0 >= 0 && x1 <= spine.width,
       `so the whole axis is on the canvas (${x0}..${x1} in 0..${spine.width})`);
    for (const d of spine.dots) {
      const score = SCORES.get(d.t);
      ok(score !== undefined, `the mark ${d.t} is a name from the payload`);
      const want = x0 + ((score + 100) / 200) * (x1 - x0);
      ok(Math.abs(d.x - want) < 0.75,
         `${d.t} at ${score} sits where a fixed ±100 axis puts it (${d.x.toFixed(1)} vs ${want.toFixed(1)})`);
      ok(d.x >= spine.axis.x1 - 0.75 && d.x <= spine.axis.x2 + 0.75,
         `and ${d.t} is drawn on the axis rather than past its end (${d.x.toFixed(1)})`);
    }

    eq(spine.dots.length, 9, "the spine marks every published name");
    const bulls = spine.dots.filter((d) => d.bull).map((d) => d.x);
    const bears = spine.dots.filter((d) => !d.bull).map((d) => d.x);
    eq(bulls.length, 5, "all five bullish names are on the axis");
    eq(bears.length, 4, "and all four bearish ones");
    ok(Math.max(...bears) < Math.min(...bulls),
       "every bearish mark sits left of every bullish one");

    const orclDot = spine.dots.find((d) => d.t === "ORCL");
    ok(orclDot && /ORCL/.test(orclDot.title || "") && /\+88/.test(orclDot.title || ""),
       `each mark names itself and its score (${orclDot && orclDot.title})`);
  }

  {

    const counts = await page.evaluate(() => {
      const out = {};
      for (const el of document.querySelectorAll("[data-rail-count]")) {
        out[el.dataset.railCount] = { text: el.textContent.trim(), hidden: el.hidden };
      }
      return out;
    });
    eq(counts.long?.text, "5", "the rail badges the bullish count");
    eq(counts.short?.text, "4", "and the bearish one");
    eq(counts.watch?.text, "2", "and the dead band's, which this page also has in hand");
    eq(counts.long?.hidden, false, "and reveals them once there is a real number");

    ok("events" in counts, "the events slot exists to be filled at all");
    eq(counts.events?.hidden, true,
       "and withholds while the calendar key is unpublished — a pending envelope is not a " +
       "count, and the rows this page would have drawn from one are not its population");

    const sub = await page.evaluate(() => {
      const el = document.getElementById("ccBullSub");
      return { text: el.textContent.trim(), said: el.dataset.said, label: el.getAttribute("aria-label") || "" };
    });
    eq(sub.text, "5", "the module count says how many the side actually holds");
    eq(sub.said, "all 5", "and says it is the whole side");
    ok(/^all 5 — open the long board$/.test(sub.label), `to assistive tech as a destination (${sub.label})`);
    eq(await page.locator("#ccBullSub").getAttribute("href"), "/flows/long/",
       "and is the way to the full side, which is a page rather than a state");

    await post("board:long", board("long", bullRows, SESSION,
      { deep: 4, cleared: 12, shed: 7 }));
    await post("board:short", board("short", bearRows, SESSION,
      { deep: 4, cleared: 9, shed: 5 }));
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccBull .hm-lrow", { timeout: 15000 });
    const pooled = await page.evaluate(() => {
      const out = {};
      for (const el of document.querySelectorAll("[data-rail-count]")) {
        out[el.dataset.railCount] = el.textContent.trim();
      }
      out.__bullRows = document.querySelectorAll("#ccBull .hm-lrow").length;
      return out;
    });
    eq(pooled.__bullRows, 5,
       "the page still draws the five names the bullish board published, so it really is an " +
       "excerpt of the twelve that payload says cleared the band");
    eq(pooled.long, "12",
       "and the rail badges TWELVE, the side's whole pool, rather than the five rows the " +
       "publisher's length cap left on the wire. The badge is the size of the SECTION its link " +
       "opens, and a badge that silently means “as many as we chose to publish” is the " +
       "truncation defect one element wide");
    eq(pooled.short, "9", "and nine on the bearish side, out of four published rows");
    eq(pooled.watch, "2",
       "while the watch badge is unchanged at its two rows: board:watch publishes `neutral` and " +
       "no `cleared` at all (flows-pipeline.mjs:5824), and flows-board.js fills this same " +
       "slot from its own rows.length, so moving this one alone would open the split the two " +
       "board badges just closed");

    const tiles = await chipsOf(page);
    const onePop = await page.evaluate(() => ({
      status: document.getElementById("flowsStatus").textContent.trim(),
      bullSub: document.getElementById("ccBullSub").dataset.said,
      bearSub: document.getElementById("ccBearSub").dataset.said,
      bullText: document.getElementById("ccBullSub").textContent.trim(),
      bullLabel: document.getElementById("ccBullSub").getAttribute("aria-label"),
    }));
    deep(tiles.Cleared?.halves, ["12", "9"], "the Cleared chip prints the pool the rail badges");
    eq(tiles.Cleared.halves[1], pooled.short,
       "read back against the badge rather than a literal: one bearish population, one number");
    eq(tiles.Cleared.halves[0], pooled.long,
       "and the same on the bullish side");

    ok(/^Bullish 5 of 12 · Bearish 4 of 9\b/.test(onePop.status),
       `the status line reconciles the rows it drew against the same pool, a word and a count per side (${onePop.status})`);
    eq(onePop.bullText, "12", "the pole count is the pool its link opens, not the excerpt on the wire");
    eq(onePop.bullSub, "top 5 of 12",
       "and says it is the top five of that pool");
    ok(/^top 5 of 12 — /.test(onePop.bullLabel || ""), `in words to assistive tech (${onePop.bullLabel})`);
    eq(onePop.bearSub, "top 4 of 9", "on both sides");

    await page.goto(url("/flows/long/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#flowsBody .bd-row[data-flip]", { timeout: 15000 });
    const onBoard = await page.evaluate(() => {
      const el = document.querySelector('[data-rail-count="long"]');
      return {
        badge: el ? el.textContent.trim() : null,
        status: document.getElementById("flowsStatus").textContent,
      };
    });
    eq(onBoard.badge, pooled.long,
       "/flows/long/ fills the same slot with the same number /flows/ did. Two routes wording " +
       "one quantity differently is how a reader concludes there are two quantities, and these " +
       "two are the pair the rail puts a link between");
    ok(/\(5 of 12 shown\)/.test(onBoard.status),
       `and the board's own status line reconciles that pool against the rows it drew ` +
       `(${onBoard.status})`);

    await post("board:long", board("long", bullRows, SESSION, { deep: 4 }));
    await post("board:short", board("short", bearRows, SESSION, { deep: 4 }));
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccBull .hm-lrow", { timeout: 15000 });
  }

  {

    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 900 });

      await page.waitForTimeout(450);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1);
      eq(overflow, false, `the overview overflows nothing at ${width}px`);
      const rows = await page.evaluate(() => Array.from(
        document.querySelectorAll("#ccBull .hm-lrow, #ccBear .hm-lrow, #ccChgList .hm-crow:not([hidden])"),
        (r) => ({ t: r.dataset.ticker, over: r.scrollWidth - r.clientWidth,
                  strip: Boolean(r.querySelector(".hm-trk svg")) || !r.querySelector(".hm-trk") ||
                    r.querySelector(".hm-trk").textContent.trim() === "\u2014" })));
      ok(rows.length >= 9, `the ranked and changed rows are measured at ${width}px (${rows.length})`);
      for (const r of rows) {
        ok(r.over <= 1, `${r.t} fits its card at ${width}px rather than scrolling sideways (${r.over}px over)`);
      }
      ok(rows.every((r) => r.strip), `and every row keeps its score strip at ${width}px`);
    }

    const tabs = await page.evaluate(() => [...document.querySelectorAll(".fx-tabs a")]
      .map((a) => a.getAttribute("href")));
    assert.deepEqual(tabs, ["/flows/", "/flows/long/", "/flows/ticker/", "/flows/market/", "/flows/ask/"],
      "at 390px the bottom tab bar carries Home, Boards, Search, Market and Ask"); checks++;
    for (const dest of ["/flows/", "/flows/long/"]) {
      ok(await page.locator(`.fx-tabs a[href="${dest}"]`).isVisible(),
         `${dest} is one tap away in the tab bar at 390px`);
    }
    ok(!(await page.locator('.flows-rail a[href="/flows/desk/"]').isVisible()),
       "the sidebar is collapsed at 390px, so the rail is not drawn over the reading column");
    await page.click("#fxSideBtn");
    await page.waitForTimeout(500);
    for (const dest of ["/flows/", "/flows/long/", "/flows/short/", "/flows/desk/"]) {
      ok(await page.locator(`.flows-rail a[href="${dest}"]`).isVisible(),
         `${dest} is still reachable at 390px, in the sidebar the toolbar button opens`);
    }
    await page.keyboard.press("Escape");
    const away = await page.locator('.flows-rail a[href="/flows/desk/"]')
      .waitFor({ state: "hidden", timeout: 3000 }).then(() => true, () => false);
    ok(away, "and Escape puts the sidebar away again, once its slide-out has finished");
    eq(await page.evaluate(() => document.activeElement && document.activeElement.id), "fxSideBtn",
       "and hands focus back to the button that opened it");
    await page.setViewportSize({ width: 1280, height: 1000 });
  }

  {

    await post("board:short", board("short", bearRows, "2026-08-21", { deep: 4 }));
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#flowsStale:not([hidden])", { state: "attached", timeout: 15000 });
    const warn = await page.locator("#flowsStale").textContent();
    ok(/different sessions/.test(warn), `mismatched halves are called out (${warn})`);
    ok(/2026-08-24/.test(warn) && /2026-08-21/.test(warn),
       `and both dates are named, so the reader knows which half is stale (${warn})`);
    const pill = await why(page, "#hmStale .hm-pill");
    ok(pill && /different sessions/.test(pill.lead),
       `and the caption's stale pill carries the same sentence one tap away (${pill && pill.lead})`);
    await shut(page);

    ok(await page.locator("#ccBull .hm-lrow").count() > 0,
       "and the current half is still shown rather than blanked");
  }

  {
    await post("board:short", board("short", [], SESSION, { deep: 0 }));
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccBear [data-empty]", { timeout: 15000 });
    const empty = await silenceOf(page, "#ccBear [data-empty]");

    eq(empty.kind, "empty", "an empty side is a measured emptiness");
    ok(/No name leaned bearish/.test(empty.text),
       `and says what happened, not "error" (${empty.text})`);
    ok(!/could not be read/.test(empty.text) && !/has not been published/.test(empty.text),
       "in words that are not either of the other two silences");
    eq(await page.locator("#ccBull .hm-lrow").count(), 5,
       "and the other side is unaffected");
    eq(await page.locator("#spinePlot .sp-dot").count(), 5,
       "the spine draws what there is");
    const bearSub = await page.evaluate(() => {
      const el = document.getElementById("ccBearSub");
      return { text: el.textContent.trim(), label: el.getAttribute("aria-label") };
    });
    eq(bearSub.text, "0", "and the module count counts the nothing rather than promising ten");
    eq(bearSub.label, "0 ranked", "and says what it counted");
  }

  {

    await post("board:long", board("long", bullRows.map((r) =>
      r.t === "ORCL" ? { ...r, ed: "2026-08-27", edte: 3 }
      : r.t === "CAT" ? { ...r, ed: "2026-09-08", edte: 15 } : r), SESSION, { deep: 4 }));
    await post("board:short", board("short", bearRows, SESSION, { deep: 4 }));
    await post("events", eventsPayload);
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccEvents .ui-row", { timeout: 15000 });

    const marks = await page.evaluate(() => {
      const out = {};
      for (const row of document.querySelectorAll("#ccBull .hm-lrow")) {
        const mark = row.querySelector(".cc-ern");
        out[row.dataset.ticker] =
          mark ? { text: mark.textContent.trim(), title: mark.getAttribute("title"),
                   near: mark.classList.contains("is-near"),
                   glyph: Boolean(mark.querySelector("svg use")) } : null;
      }
      return out;
    });
    ok(marks.ORCL, "a ranked name that reports inside the window is marked on the ranked row");
    eq(marks.ORCL.text, "3s",
       "with the events payload's own unit — sessions, which is what the gate counted");
    ok(marks.ORCL.glyph && marks.ORCL.near,
       "behind a calendar glyph, and tinted as near because a print three sessions out is close");
    ok(/2026-08-27/.test(marks.ORCL.title || ""),
       `and the date in the title, because a count with no origin is not checkable (${marks.ORCL.title})`);
    ok(/3 sessions/.test(marks.ORCL.title || ""),
       `spelled out rather than abbreviated (${marks.ORCL.title})`);

    eq(marks.CAT?.text, "15d",
       "a board row with no calendar row falls back to the board's calendar-day count");
    ok(/15 calendar days/.test(marks.CAT?.title || ""),
       `and never prints one unit's number under the other's name (${marks.CAT?.title})`);
    eq(marks.CAT?.near, false, "and a print fifteen days out is not tinted as near");
    eq(marks.DE, null, "and a name that reports outside the window carries no marker at all");

    const ev = await moduleWhy(page, "hmEvents");
    deep(ev.rows[0], ["ORCL", "2026-08-27", "3s", "±6.4%", "+88", "ranked"],
      "the calendar row carries the score and the funnel stage it already held");
    eq(ev.rows[1][4], "—",
       "a gated name has no score, and an em dash is not a zero");
    eq(ev.rows[1][5], "gated", "and the stage says the board was forbidden, not neutral");

    eq(ev.lead,
       "1 of the 2 names drawn carries a score and 1 reached this calendar with none, " +
       "so the boards hold no opinion on it going into the print.",
       "the calendar leads with how many of the names it drew the board has an opinion about");
    ok(ev.leadFirst && ev.leadBeforeTable,
       "and it is the FIRST thing in the disclosure, above the table");
    await shut(page);

    const evRows = await page.evaluate(() => Array.from(
      document.querySelectorAll("#ccEvents .ui-row"), (r) => r.textContent.trim()));
    ok(/^ORCL/.test(evRows[0]) && /\+88$/.test(evRows[0]),
       `the visible calendar row names the ticker and ends on its score (${evRows[0]})`);
    ok(/gated$/.test(evRows[1]), `and a gated one ends on the word, not a zero (${evRows[1]})`);

    const evBadge = await page.evaluate(() => {
      const el = document.querySelector('[data-rail-count="events"]');
      return { text: el.textContent.trim(), hidden: el.hidden };
    });
    eq(evBadge.hidden, false, "the rail badges the calendar once a population has arrived");
    eq(evBadge.text, String(eventsPayload.inWindow),
       `with the ${eventsPayload.inWindow} names the payload says report inside the window`);
  }

  {

    const whole = await page.evaluate(() => {
      const el = document.getElementById("ccEventsSub");
      return { text: el.textContent.trim(), label: el.getAttribute("aria-label") || "" };
    });
    eq(whole.text, "2", "a calendar shorter than the cap is counted whole");
    ok(/^all 2 in the window/.test(whole.label), `and said whole (${whole.label})`);

    const evMany = Array.from({ length: 10 }, (_, i) => ({
      t: "E" + String(i + 1).padStart(2, "0"), d: "2026-09-0" + ((i % 9) + 1),
      dte: i + 1, sdte: i + 1, im: 0.02, s: 10 + i, st: "ranked",
    }));
    await post("events", { ...eventsPayload, inWindow: 30, rows: evMany });
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccEvents .ui-row", { timeout: 15000 });
    eq(await page.locator("#ccEvents .ui-row").count(), 8,
       "a calendar longer than the cap is listed eight deep");
    const capped = await page.evaluate(() => {
      const el = document.getElementById("ccEventsSub");
      return { text: el.textContent.trim(), label: el.getAttribute("aria-label") || "" };
    });
    eq(capped.text, "8 of 30",
       "and the count names the eight it drew as well as the thirty it did not");
    ok(/^8 of 30 in the window/.test(capped.label), `in words as well (${capped.label})`);

    eq(await page.evaluate(
       () => document.querySelector('[data-rail-count="events"]').textContent.trim()), "30",
       "the rail badges the thirty names reporting, not the ten rows published or the " +
       "eight this page drew from them");
    await post("events", eventsPayload);
  }

  {

    await post("market", { ...market,
      breadth: { ...market.breadth, tilt: 0.0500 },
      premium: { ...market.premium, tilt: -0.0300 } });
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccBull .hm-lrow", { timeout: 15000 });
    const tiles = await chipsOf(page);
    eq(tiles["Flow bias"]?.v, "−3.0%", "the dollar weighting is the chip's value");
    const d = await chipWhy(page, "Flow bias");
    eq(d.facts["Names equally weighted"], "+5.0%",
       "and the equal weighting is kept beside it, so the page cannot show one sign and hide the other");
    eq(tiles["Flow bias"]?.tone, "down", "each carries its own sign in the glyph before any hue is applied");
    ok(/opposite ways/.test(d.text), "and the disagreement is named in the disclosure where it can be read");
    await shut(page);

    const surface = await page.evaluate(() => document.querySelector('#ccVerdict [data-chip="Flow bias"]').textContent);
    ok(!/disagree|opposite/i.test(surface),
       "while the chip itself does not narrate the disagreement its own two glyphs already show");
    await post("market", market);
  }

  {

    const readTiles = () => chipsOf(page);
    const marks = new Map();

    const TILTS = ["Flow bias"];
    const equalOf = async () => {
      const d = await chipWhy(page, "Flow bias");
      await shut(page);
      return d.facts["Names equally weighted"] || "";
    };
    const leadOf = async (key) => {
      const d = await chipWhy(page, key);
      await shut(page);
      return d.lead;
    };

    allowFetchFailure = true;
    await page.route("**/api/flows/market", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: "{}" }));
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccBull .hm-lrow", { timeout: 15000 });
    let tiles = await readTiles();
    for (const k of [...TILTS, "Breadth"]) {
      eq(tiles[k]?.v, k === "Breadth" ? "— / —" : "—",
         `${k} is an em dash when the market payload could not be read`);
      eq(tiles[k]?.kind, "unreadable", `and is marked as this page's fault (${k})`);
      const lead = await leadOf(k);
      ok(/could not be read/.test(lead) && !/not measured/.test(lead),
         `worded as the fetch silence, never as a reading about the session (${lead})`);
    }

    const eqUnread = await equalOf();
    ok(/could not be read/.test(eqUnread),
       `the equal-weight tilt is worded as the fetch silence on its own line, not merely absent (${eqUnread})`);

    const metaScreened = await page.evaluate(() => {
      const el = document.getElementById("ccMetaScreened");
      return { said: el.dataset.said || "", kind: el.dataset.empty || null, hidden: el.hidden,
               mark: Boolean(el.querySelector(".hm-mark[data-info]")) };
    });
    eq(metaScreened.kind, "unreadable",
       "the screened population is marked as this page's fault on the caption too");
    ok(!metaScreened.hidden, "and is stated rather than hidden, which would be a fourth silence");
    ok(metaScreened.mark, "with a mark whose reason is one tap away");
    ok(/could not be read/.test(metaScreened.said) && !/not measured/.test(metaScreened.said),
       `worded as the fetch silence, never as a reading (${metaScreened.said})`);
    marks.set("unreadable", tiles[TILTS[0]].mark);
    await page.unroute("**/api/flows/market");
    allowFetchFailure = false;

    await page.route("**/api/flows/market", (route) => route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ status: "pending", rows: [] }) }));
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccBull .hm-lrow", { timeout: 15000 });
    tiles = await readTiles();
    for (const k of TILTS) {
      eq(tiles[k]?.v, "—", `${k} is an em dash on an unpublished market key`);
      eq(tiles[k]?.kind, "pending", `and is marked pending (${k})`);
      ok(/not published yet/.test(await leadOf(k)), `in the pipeline's own silence (${k})`);
    }
    const eqPending = await equalOf();
    ok(/not published yet/.test(eqPending),
       `and the equal-weight tilt is pending on its own line rather than absent (${eqPending})`);
    marks.set("pending", tiles[TILTS[0]].mark);
    await page.unroute("**/api/flows/market");

    await post("market", { ...market,
      breadth: { bull: 9, bear: 12, flat: 0, unpriced: 3 }, premium: { net: -18400000 } });
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccBull .hm-lrow", { timeout: 15000 });
    tiles = await readTiles();
    for (const k of TILTS) {
      eq(tiles[k]?.v, "—", `${k} is an em dash when the payload carries no tilt`);
      eq(tiles[k]?.kind, "unavailable", `and is marked as the payload's gap (${k})`);
      ok(/not on this payload/.test(await leadOf(k)),
         `worded as one, not as a session that measured nothing (${k})`);
    }
    const eqGap = await equalOf();
    ok(/not on this payload/.test(eqGap),
       `and the equal-weight tilt marks the payload's gap on its own line (${eqGap})`);
    deep(tiles.Breadth?.halves, ["9", "12"],
       "while the breadth the same payload does carry still prints");
    eq(tiles.Breadth?.kind, null, "with no mark on a chip that has its reading");
    marks.set("unavailable", tiles[TILTS[0]].mark);

    await post("market", { ...market,
      breadth: { bull: 0, bear: 0, flat: 264, unpriced: 0, tilt: null },
      premium: { netPositive: 0, netNegative: 0, net: 0, priced: 0, oneLegged: 0,
                 tilt: null, topShare: null } });
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccBull .hm-lrow", { timeout: 15000 });
    tiles = await readTiles();

    eq(tiles["Flow bias"]?.kind, "empty", "the dollar weighting over a zero gross is measured-empty");
    ok(/no net premium was priced/.test(await leadOf("Flow bias")),
       "in its own denominator's words");
    const eqEmpty = await equalOf();
    ok(/no name leaned/.test(eqEmpty),
       `a session in which no name leaned is measured-empty too, and says so as a reading (${eqEmpty})`);
    deep(tiles.Breadth?.halves, ["0", "0"], "and the measured zeros behind it print as zeros");
    eq(tiles.Breadth?.kind, null, "which are a reading, not a silence");
    marks.set("empty", tiles[TILTS[0]].mark);
    await post("market", market);

    eq(marks.size, 4, "the four silences were each seen once");
    eq(new Set(marks.values()).size, 4,
       `and draw four different marks by glyph alone (${[...marks].map(
         ([k, m]) => k + ": " + m).join(" | ")})`);
    ok([...marks.values()].every(Boolean), "and every one of them draws a mark at all");

    allowFetchFailure = true;
    for (const side of ["long", "short"]) {
      await page.route("**/api/flows/board?side=" + side, (route) =>
        route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
    }
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccChgList .hm-crow", { timeout: 15000 });
    tiles = await readTiles();

    const metaSession = await page.evaluate(() => {
      const el = document.getElementById("ccMetaDate");
      return { said: el.dataset.said || "", kind: el.dataset.empty || null };
    });
    eq(metaSession.kind, "unreadable", "with both boards unreadable the session is marked as this page's fault");
    ok(/could not be read/.test(metaSession.said), `and worded as one (${metaSession.said})`);
    deep(tiles.Cleared?.halves, ["—", "—"], "and so is the pool on both sides");
    eq(tiles.Cleared?.kind, "unreadable", "under the same mark");
    for (const side of ["long", "short"]) await page.unroute("**/api/flows/board?side=" + side);
    allowFetchFailure = false;

    for (const side of ["long", "short"]) {
      await page.route("**/api/flows/board?side=" + side, (route) => route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ side, rows: [], generatedAt: null, status: "pending" }) }));
    }
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccChgList .hm-crow", { timeout: 15000 });
    tiles = await readTiles();
    const metaPending = await page.evaluate(() => {
      const el = document.getElementById("ccMetaDate");
      return { said: el.dataset.said || "", kind: el.dataset.empty || null };
    });
    eq(metaPending.kind, "pending", "with both boards unpublished the session is pending");
    ok(/not published yet/.test(metaPending.said),
       `in the pipeline's own words (${metaPending.said})`);
    eq(tiles.Cleared?.kind, "pending", "and so is the pool");
    for (const side of ["long", "short"]) await page.unroute("**/api/flows/board?side=" + side);

    await page.route("**/api/flows/board?side=long", (route) => route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ ...board("long", bullRows, SESSION, { deep: 4 }),
                             sessionDate: undefined }) }));
    await page.route("**/api/flows/board?side=short", (route) => route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ side: "short", rows: [], generatedAt: null, status: "pending" }) }));
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccBull .hm-lrow", { timeout: 15000 });
    tiles = await readTiles();
    const metaGap = await page.evaluate(() => {
      const el = document.getElementById("ccMetaDate");
      return { said: el.dataset.said || "", kind: el.dataset.empty || null };
    });
    eq(metaGap.kind, "unavailable",
       "a board published without a session date is the payload's gap, not a fetch that failed");
    ok(/not on this payload/.test(metaGap.said), `and is worded as one (${metaGap.said})`);
    deep(tiles.Cleared?.halves, ["5", "—"],
       "while the pool prints the half that answered beside a dash for the half that has not — " +
       "and each side keeps its own place, so the half-silent chip still says WHICH half is missing");
    eq(tiles.Cleared?.kind, null,
       "with no mark, because the dash is explained in that half's own module and on the status line");
    for (const side of ["long", "short"]) await page.unroute("**/api/flows/board?side=" + side);
  }

  {

    await page.route("**/api/flows/board?side=long", (route) => route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ side: "long", rows: [], generatedAt: null, status: "pending" }),
    }));
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccBull [data-empty]", { timeout: 15000 });
    eq(await page.evaluate(() => document.querySelector("#ccBull [data-empty]").dataset.empty),
       "pending", "an unpublished pole is pending, which is its own silence");

    const drawn = await page.evaluate(() => {
      const svg = document.querySelector("#spinePlot svg");
      return {
        band: svg.querySelectorAll(".sp-band").length,
        label: svg.querySelector(".sp-bandlabel").textContent.trim(),
        dots: svg.querySelectorAll(".sp-dot").length,
      };
    });
    eq(drawn.band, 1, "the band is still hatched, off the board that published one");
    ok(/15 of 24 inside ±20/.test(drawn.label),
       `and the axis states the counts that payload carries (${drawn.label})`);
    ok(!/no dead band published/.test(drawn.label),
       `rather than the sentence reserved for a session that published none (${drawn.label})`);
    eq(drawn.dots, 4, "with the published side's names still on it");

    const status = await page.evaluate(
      () => document.getElementById("flowsStatus").textContent.trim());

    const metaLive = await page.evaluate(() => {
      const el = document.getElementById("ccMetaDate");
      return { datetime: el.getAttribute("datetime"), kind: el.dataset.empty || null };
    });
    eq(metaLive.datetime, SESSION,
       `and the page still names the session it is describing, in the caption ` +
       `(${metaLive.datetime})`);
    eq(metaLive.kind, null,
       "unmarked, because one half answering is enough to know which session this is");
    ok(/Band 15 of 24/.test(status),
       `and still states how much of the pool the band held (${status})`);
    ok(/Bullish \u2014 · Bearish 4/.test(status),
       `while counting the unpublished side as nothing known rather than as 0 (${status})`);
    ok(!/could not be read/.test(status),
       `and a key that has not published is not reported as a failed fetch (${status})`);
    await page.unroute("**/api/flows/board?side=long");
  }

  {

    await page.setViewportSize({ width: 2000, height: 1000 });
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#spinePlot svg", { timeout: 15000 });
    await page.waitForTimeout(300);
    const wide = await page.evaluate(() => {
      const svg = document.querySelector("#spinePlot svg");
      const vb = svg.getAttribute("viewBox").split(/\s+/).map(Number);
      return {
        vbW: vb[2], attrW: svg.getAttribute("width"),
        rendered: Math.round(svg.getBoundingClientRect().width),
        host: Math.round(document.getElementById("spinePlot").clientWidth),
        par: svg.getAttribute("preserveAspectRatio"),
      };
    });
    ok(wide.host > 600, `the widest tier really does give the spine a wide host (${wide.host})`);
    eq(wide.attrW, String(wide.vbW),
       "the svg carries an explicit width attribute equal to its viewBox width");
    ok(Math.abs(wide.rendered - wide.vbW) <= 1,
       `so one viewBox unit renders as one CSS pixel (${wide.rendered} css for ${wide.vbW} units)`);
    ok(Math.abs(wide.rendered - wide.host) <= 1,
       `and the drawing is the measured host width, not a fixed clamp (${wide.host})`);
    eq(wide.par, "xMidYMid meet", "with the aspect rule the invariant names");

    const strips = await page.evaluate(() => Array.from(
      document.querySelectorAll(".hm-trk svg"), (s) => ({
        attr: Number(s.getAttribute("width")), rendered: s.getBoundingClientRect().width })));
    ok(strips.length >= 8, `every ranked row with a trace draws a strip (${strips.length})`);
    for (const s of strips) {
      eq(s.attr, Math.round(s.rendered),
         `a score strip renders at its own width attribute, one viewBox unit per CSS pixel ` +
         `(${s.attr} units drawn at ${s.rendered}px)`);
    }

    await page.setViewportSize({ width: 900, height: 1000 });
    await page.waitForTimeout(450);
    const narrow = await page.evaluate(() => {
      const svg = document.querySelector("#spinePlot svg");
      const vb = svg.getAttribute("viewBox").split(/\s+/).map(Number);
      return { vbW: vb[2], rendered: Math.round(svg.getBoundingClientRect().width),
               host: Math.round(document.getElementById("spinePlot").clientWidth) };
    });
    ok(narrow.vbW !== wide.vbW,
       `a resize repaints the chart at the new width (${wide.vbW} -> ${narrow.vbW})`);
    ok(Math.abs(narrow.rendered - narrow.vbW) <= 1 && Math.abs(narrow.rendered - narrow.host) <= 1,
       `and the invariant survives it (${narrow.rendered} css for ${narrow.vbW} units)`);
    const restrip = await page.evaluate(() => Array.from(
      document.querySelectorAll(".hm-trk svg"), (s) => ({
        attr: Number(s.getAttribute("width")), rendered: s.getBoundingClientRect().width })));
    ok(restrip.every((s) => s.attr === Math.round(s.rendered)),
       "and every score strip is redrawn at its new width rather than stretched");

    const trails = await page.evaluate(() => Array.from(
      document.querySelectorAll("#spinePlot .sp-move"), (l) => ({
        t: (l.querySelector("title") || {}).textContent || "",
        dashed: !!l.getAttribute("stroke-dasharray"),
        x1: Number(l.getAttribute("x1")), x2: Number(l.getAttribute("x2")),
      })));

    eq(trails.length, 2,
       `only a name that CROSSED the band, and whose track reading IS this board row, trails its ` +
       `move (${trails.length}) — a drift is a row in the list below, not a line through the swarm`);
    deep(trails.map((l) => l.t.split(" ")[0]).sort(), ["CAT", "MU"],
      "and they are the two that crossed this session");
    const cat = trails.find((l) => /^CAT/.test(l.t));
    ok(cat && /over 1 session/.test(cat.t),
       `and each trail states its span in the title (${cat && cat.t})`);
    ok(cat && /from \u221230/.test(cat.t), `and where it came from (${cat && cat.t})`);
    ok(cat && cat.x2 > cat.x1, "with the trail running from where the name was to where it is");
    ok(!cat.dashed, "an overnight move is drawn solid");
    const mu = trails.find((l) => /^MU/.test(l.t));
    ok(mu && mu.dashed && /over 2 sessions/.test(mu.t),
       `and a move across a gap is dashed rather than tinted (${mu && mu.t})`);
    ok(mu && mu.x2 < mu.x1, "running left, the way a bearish move runs");

    const drift = await page.evaluate(() => (document.querySelector(
      '#spinePlot .sp-dot[data-t="ORCL"] title') || {}).textContent || "");
    ok(/\+8 over 1 session/.test(drift),
       `a drift that is not a crossing still states its move on its own mark (${drift})`);

    eq(await page.locator("#spinePlot .sp-cross").count(), 2,
       "the names that cleared and flipped are ringed on the axis");
    const ringed = await page.evaluate(() => Array.from(
      document.querySelectorAll("#spinePlot .sp-cross"), (c) => c.getAttribute("class")));
    deep(ringed.map((c) => c.replace("sp-cross ", "")).sort(), ["is-cleared", "is-flipped"],
      "each ring says which category change it marks");

    const muDot = await page.evaluate(() => (document.querySelector(
      '#spinePlot .sp-dot[data-t="MU"] title') || {}).textContent || "");
    ok(/· cleared$/.test(muDot), `a ringed mark names its crossing in words (${muDot})`);
    const deDot = await page.evaluate(() => (document.querySelector(
      '#spinePlot .sp-dot[data-t="DE"] title') || {}).textContent || "");
    ok(!/cleared|faded|flipped/.test(deDot),
       `and a mark that crossed nothing claims none (${deDot})`);
    eq(await page.locator('#spinePlot .sp-dot[data-t="NKE"]').count(), 0,
       "and the faded name is on no board, so the spine cannot show it at all");

    const bac = await page.evaluate(() => {
      const dot = document.querySelector('#spinePlot .sp-dot[data-t="BAC"]');
      return dot && {
        title: (dot.querySelector("title") || {}).textContent || "",
        trailed: Array.from(document.querySelectorAll("#spinePlot .sp-move"))
          .some((l) => /^BAC/.test((l.querySelector("title") || {}).textContent || "")),
      };
    });
    ok(bac, "a name whose reading is not about today is still marked at its published level");
    eq(bac.trailed, false, "but its move is not drawn from an origin neither payload holds");
    ok(/last scored 2026-08-21/.test(bac.title),
       `and the mark says when the track last saw it (${bac && bac.title})`);
    ok(!/over/.test(bac.title),
       "rather than restating a delta the change module has already dated");
    await page.setViewportSize({ width: 1280, height: 1000 });
  }

  {

    await post("scoretrack", scoretrack(TRACK_DAYS.concat([{
      d: "2026-08-25", source: "scores", rows: [{ t: "ORCL", s: 92, q: 2600 }],
    }])));
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#spinePlot svg", { timeout: 15000 });

    const stale = await page.evaluate(() => ({
      tags: document.querySelectorAll("#ccBull .cc-cross, #ccBear .cc-cross").length,
      trails: document.querySelectorAll("#spinePlot .sp-move").length,
      rings: document.querySelectorAll("#spinePlot .sp-cross").length,
      dots: document.querySelectorAll("#spinePlot .sp-dot").length,
      orcl: (document.querySelector('#spinePlot .sp-dot[data-t="ORCL"] title') || {}).textContent || "",
      aria: document.querySelector("#spinePlot svg").getAttribute("aria-label") || "",
    }));
    eq(stale.tags, 0,
       "no ranked row claims a crossing once the track's newest reading is not this session's");
    eq(stale.trails, 0,
       "and the spine trails nothing rather than drawing an origin from two payloads that disagree");
    eq(stale.rings, 0, "and rings no crossing onto a session it did not happen on");
    eq(stale.dots, 9, "while every published name is still marked at the level the BOARD published");
    ok(/last scored 2026-08-25/.test(stale.orcl),
       `a mark whose track score is not the board's says when the track last saw it (${stale.orcl})`);
    ok(!/trail the move/.test(stale.aria),
       "and the accessible description does not promise trails that are not drawn");

    const d = await moduleWhy(page, "hmChg");
    const byName = Object.fromEntries(d.rows.map((r) => [r[1], r[7]]));
    await shut(page);
    eq(byName.ORCL, "this session", "the one name scored in the newest session says so");
    ok(/2026-08-24 · 1 session back/.test(byName.CAT || ""),
       `and the rest are dated rather than dropped (CAT: ${byName.CAT})`);
    const old = await page.evaluate(() => Array.from(
      document.querySelectorAll("#ccChgList .hm-crow.is-old"), (r) => r.dataset.ticker));
    ok(old.includes("CAT") && !old.includes("ORCL"),
       `and the visible rows that are not about today are marked as such (${old.join(" ")})`);

    await post("scoretrack", scoretrack(TRACK_DAYS));
  }

  {

    await post("scoretrack", scoretrack([{
      d: SESSION, source: "scores",
      rows: [...bullRows, ...bearRows].map((r) => ({ t: r.t, s: r.s })),
    }]));
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccChg [data-empty]", { timeout: 15000 });
    const one = await silenceOf(page, "#ccChg [data-empty]");
    eq(one.kind, "unavailable",
       "an archive one session long cannot report change, and that is not a quiet market");
    ok(/holds a single session/.test(one.text) && new RegExp(SESSION).test(one.text),
       `it says so and names the session (${one.text})`);
    ok(/once a second session is archived/.test(one.text),
       `and what would make it answerable (${one.text})`);
    ok(!/held its score/.test(one.text) && !/No name in the pool/.test(one.text),
       "in words that are neither of the other two absences");

    await post("scoretrack", {
      v: 2, status: "ok", sessionDate: SESSION, generatedAt: new Date().toISOString(),
      windowSessions: 2, deadBand: 20,
      sessions: [{ d: "2026-08-21", source: "scores", names: 2, preEpoch: false },
                 { d: SESSION, source: "scores", names: 2, preEpoch: false }],
      names: [{ t: "ORCL", s: [80, 88], n: 2 }, { t: "PFE", s: [-60, -91], n: 2 }],
    });
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccChg [data-empty]", { timeout: 15000 });
    const old = await silenceOf(page, "#ccChg [data-empty]");
    const rowsDrawn = await page.locator("#ccChgList .hm-crow").count();
    eq(old.kind, "unavailable",
       "a track published before the change layer is a missing field, not a still market");
    eq(rowsDrawn, 0, "and nothing is listed from it");
    ok(/no name carries a d1 move/.test(old.text),
       `it names the field that is missing (${old.text})`);
    ok(/will not subtract two scores itself/.test(old.text),
       `and refuses the arithmetic that has no span attached (${old.text})`);

    ok(await page.locator("#ccBull .hm-trk svg").count() > 0,
       "while the series it does carry is still drawn");

    await post("scoretrack", scoretrack(TRACK_DAYS));
  }

  {

    await post("scoretrack", {
      v: 2, status: "ok", sessionDate: SESSION, generatedAt: new Date().toISOString(),
      windowSessions: 2, deadBand: 20, namesShed: 40, shedBy: "names", namesSeen: 41,
      sessions: [{ d: "2026-08-21", source: "scores", names: 41, preEpoch: false },
                 { d: SESSION, source: "scores", names: 41, preEpoch: false }],

      names: [{ t: "KLA", s: [null, 41], n: 1, last: 41, lastAt: 1, d1: null, run: 1 }],
      change: {
        session: SESSION, prior: "2026-08-21", comparable: 40, consecutive: 38,
        moved: 8, held: 32, current: 41, entered: 1, left: 0, band: 20,
        crossings: { cleared: 2, faded: 1, flipped: 0 }, status: "ok",
      },
    });
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccChg [data-empty]", { timeout: 15000 });
    const shed = await silenceOf(page, "#ccChg [data-empty]");
    eq(shed.kind, "unavailable",
       "a session whose movers were all shed is a payload limit, not a still market");
    ok(/8 of 40 names/.test(shed.text),
       `the count is still stated, because it is still true (${shed.text})`);
    ok(/row ceiling shed them/.test(shed.text),
       `and says which ceiling took the rows (${shed.text})`);
    ok(/no rows behind it/.test(shed.text),
       `and that the list below is not the answer to the count above (${shed.text})`);
    ok(!/held its score/.test(shed.text),
       "in words that are not the every-name-compared sentence");
    await post("scoretrack", scoretrack(TRACK_DAYS));
  }

  {

    await post("scoretrack", { ...scoretrack(TRACK_DAYS),
      ...buildScoreTrack(TRACK_DAYS, { deadBand: 20, epoch: "2026-08-20" }) });
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccChgList .hm-crow", { timeout: 15000 });
    await moduleWhy(page, "hmChg");
    const spans = await page.evaluate(() => Object.fromEntries(Array.from(
      document.querySelectorAll("#fxPopB tbody tr"),
      (tr) => [tr.children[1].textContent.trim(),
               { text: tr.children[3].textContent.trim(),
                 title: tr.children[3].getAttribute("title") || "" }])));
    await shut(page);
    ok(/across the epoch/.test(spans.MU?.text || ""),
       `a comparison straddling the epoch is marked (${spans.MU?.text})`);
    ok(/different pools/.test(spans.MU?.title || ""),
       `carrying the payload's own note rather than a caption written here (${spans.MU?.title})`);
    ok(!/across the epoch/.test(spans.ORCL?.text || ""),
       `and one entirely on this side of it is not (${spans.ORCL?.text})`);
    const flagged = await page.evaluate(() => {
      const r = document.querySelector('#ccChgList .hm-crow[data-ticker="MU"] .hm-sub');
      return r ? { text: r.textContent.trim(), title: r.getAttribute("title") || "" } : null;
    });
    ok(flagged && /across the epoch/.test(flagged.text) && /different pools/.test(flagged.title),
       `and the visible row carries the same flag with the same note (${flagged && flagged.text})`);
    await post("scoretrack", scoretrack(TRACK_DAYS));
  }

  {

    const today = new Date().toISOString().slice(0, 10);
    const serve = async (sessionDate, updatedAt) => {
      for (const [side, rows] of [["long", bullRows], ["short", bearRows]]) {
        await page.route("**/api/flows/board?side=" + side, (route) => route.fulfill({
          status: 200,
          headers: { "Content-Type": "application/json", "X-Payload-Updated": String(updatedAt) },
          body: JSON.stringify(board(side, rows, sessionDate, { deep: 4 })),
        }));
      }
    };
    const stop = async () => {
      for (const side of ["long", "short"]) {
        await page.unroute("**/api/flows/board?side=" + side);
      }
    };
    const read = () => page.evaluate(() => ({
      hidden: document.getElementById("flowsStale").hidden,
      text: document.getElementById("flowsStale").textContent.trim(),
      body: document.body.classList.contains("is-stale"),
      pill: Boolean(document.querySelector("#hmStale .hm-pill[data-state=stale]")),
    }));

    await serve(today, Date.now() - 5 * 60 * 1000);
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccBull .hm-lrow", { timeout: 15000 });
    let s = await read();
    eq(s.hidden, true, "a fresh session raises no staleness warning");
    eq(s.body, false, "and leaves the document unmarked");
    eq(s.text, "", "with no sentence left behind in the slot");
    eq(s.pill, false, "and no stale pill in the caption");
    await stop();

    const verdicts = await page.evaluate(() => {
      const S = window.FlowsUI.staleness;
      const now = Date.parse("2026-09-04T12:00:00Z");
      return {

        zeroStamp: S({ __updatedAt: 0 }, now).kind,
        negStamp: S({ __updatedAt: -1 }, now).kind,

        truncated: S({ sessionDate: "2026-09" }, now).kind,
        prose: S({ sessionDate: "Thursday" }, now).kind,

        realFresh: S({ __updatedAt: now - 60000, sessionDate: "2026-09-04" }, now).kind,
        realStaleSession: S({ __updatedAt: now - 60000, sessionDate: "2026-08-01" }, now).kind,
        nothing: S({}, now).kind,
      };
    });
    eq(verdicts.zeroStamp, "unknown",
       "a write stamp of 0 is an absent stamp, and an absent stamp is not a passed test");
    eq(verdicts.negStamp, "unknown", "and so is a negative one");
    eq(verdicts.truncated, "unknown",
       "a session date that is not a calendar day is not a date — Date.parse returning a " +
       "finite number for \"2026-09\" is exactly why the shape is checked before the parse");
    eq(verdicts.prose, "unknown", "and neither is prose");
    eq(verdicts.realFresh, "fresh",
       "while a payload carrying two readable dates that both pass still reports fresh");
    eq(verdicts.realStaleSession, "session",
       "and one whose session is five weeks old still raises the session warning");
    eq(verdicts.nothing, "unknown", "and a payload with nothing datable claims nothing");

    await serve(today, Date.now() - 5 * 24 * 60 * 60 * 1000);
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#flowsStale:not([hidden])", { state: "attached", timeout: 15000 });
    s = await read();
    eq(s.body, true, "a payload last written five days ago marks the document stale");
    eq(s.pill, true, "and wears the stale pill in the caption");
    ok(s.text.length > 20 && /written/.test(s.text),
       `and says the pipeline has not published, not that the market was quiet (${s.text})`);
    ok(!/different sessions/.test(s.text),
       "in words that are not the mismatched-halves sentence");
    await stop();

    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#flowsStale:not([hidden])", { state: "attached", timeout: 15000 });
    s = await read();
    eq(s.body, true, "and a session that stopped advancing marks it too");
    ok(new RegExp(SESSION).test(s.text),
       `naming the session the numbers actually describe (${s.text})`);
  }

  {

    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    await stubNewKeys(ctx);
    const shadow = await ctx.newPage();
    shadow.on("pageerror", (e) => errors.push("shadow: " + e.message));
    await shadow.addInitScript(() => {
      let held;
      Object.defineProperty(window, "FlowsUI", {
        configurable: true,
        get: () => held,
        set: (lib) => {
          const copy = Object.assign({}, lib);
          delete copy.staleness;
          held = Object.freeze(copy);
        },
      });
    });
    await signIn(shadow);
    await shadow.waitForSelector("#flowsStale:not([hidden])", { state: "attached", timeout: 15000 });
    const said = await shadow.evaluate(() => ({
      has: typeof window.FlowsUI.staleness,
      text: document.getElementById("flowsStale").textContent.trim(),
      stale: document.body.classList.contains("is-stale"),
      rows: document.querySelectorAll("#ccBull .hm-lrow").length,
    }));
    eq(said.has, "undefined", "the shared check really is absent from this page's module");
    ok(/could not run/.test(said.text),
       `and the page says the check could not run (${said.text})`);
    ok(/flows-ui/.test(said.text), "naming the module that is too old to carry it");
    ok(!/more than four days old/.test(said.text) && !/last written/.test(said.text),
       "and does not answer the question anyway out of a second copy of the arithmetic");
    eq(said.stale, true, "the document is marked, because nothing here is confirmed to be today's");
    ok(said.rows > 0, "while every reading the page DOES have is still drawn");
    await ctx.close();
  }

  {
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccLean [data-empty]", { timeout: 15000 });
    const lean = await silenceOf(page, "#ccLean [data-empty]");
    const news = await silenceOf(page, "#ccNews [data-empty]");
    eq(lean.kind, "pending",
       "an unpublished sector-premium key is PENDING on this page, not empty");
    eq(news.kind, "pending", "and so is an unpublished news key");
    for (const [what, said] of [["sector", lean.text], ["news", news.text]]) {
      ok(/has not been published/.test(said),
         `the ${what} module says the key has not been published (${said})`);
      ok(/nothing is being claimed/.test(said),
         `and that nothing is being claimed about the session (${said})`);
    }
  }

  const SECTORS = [

    { sector: "Energy", etf: "XLE", read: "ok", leanRatio: -0.55,
      netPremiumUsd: -5500000, grossPremiumUsd: 10000000,
      bullishPremiumUsd: 2250000, bearishPremiumUsd: 7750000, reason: null },
    { sector: "Information Technology", etf: "XLK", read: "ok", leanRatio: 0.02,
      netPremiumUsd: 400000000, grossPremiumUsd: 20000000000,
      bullishPremiumUsd: 10200000000, bearishPremiumUsd: 9800000000, reason: null },
    { sector: "Utilities", etf: "XLU", read: "quiet", leanRatio: null,
      netPremiumUsd: 0, grossPremiumUsd: 0,
      bullishPremiumUsd: 0, bearishPremiumUsd: 0,
      reason: "XLU was read and both premium sums were zero — measured and empty, not missing" },
    { sector: "Materials", etf: "XLB", read: "ok", leanRatio: 0.62,
      netPremiumUsd: 62000, grossPremiumUsd: 100000,
      bullishPremiumUsd: 81000, bearishPremiumUsd: 19000, reason: null },
    { sector: "Real Estate", etf: "XLRE", read: "unreadable", leanRatio: null,
      netPremiumUsd: null, grossPremiumUsd: null,
      bullishPremiumUsd: null, bearishPremiumUsd: null,
      reason: "no XLRE row in the sector-etfs response" },
    { sector: "Communication Services", etf: "XLC", read: "ok", leanRatio: 0,
      netPremiumUsd: 0, grossPremiumUsd: 50000000,
      bullishPremiumUsd: 25000000, bearishPremiumUsd: 25000000, reason: null },
    { sector: "Health Care", etf: "XLV", read: "ok", leanRatio: -0.09,
      netPremiumUsd: -900000, grossPremiumUsd: 10000000,
      bullishPremiumUsd: 4550000, bearishPremiumUsd: 5450000, reason: null },
    { sector: "Consumer Discretionary", etf: "XLY", read: "ok", leanRatio: 0.31,
      netPremiumUsd: 6200000, grossPremiumUsd: 20000000,
      bullishPremiumUsd: 13100000, bearishPremiumUsd: 6900000, reason: null },
    { sector: "Consumer Staples", etf: "XLP", read: "unreadable", leanRatio: null,
      netPremiumUsd: null, grossPremiumUsd: null,
      bullishPremiumUsd: 55391, bearishPremiumUsd: null,
      reason: "XLP carried bullish_premium but not the other side, and a lean needs both terms" },
    { sector: "Industrials", etf: "XLI", read: "ok", leanRatio: 0.14,
      netPremiumUsd: 1400000, grossPremiumUsd: 10000000,
      bullishPremiumUsd: 5700000, bearishPremiumUsd: 4300000, reason: null },
    { sector: "Financials", etf: "XLF", read: "ok", leanRatio: -0.22,
      netPremiumUsd: -4400000, grossPremiumUsd: 20000000,
      bullishPremiumUsd: 7800000, bearishPremiumUsd: 12200000, reason: null },
  ];

  const sectorLean = (extra = {}) => ({
    v: 2, status: "ok", sessionDate: SESSION, generatedAt: new Date().toISOString(),
    readAt: "2026-08-25T09:20:00.000Z", refreshed: "nightly", vendorDated: false,
    basis: "SPDR Select Sector ETFs, not GICS index levels",
    units: { netPremiumUsd: "usd", grossPremiumUsd: "usd", leanRatio: "ratio" },
    lean: {
      rank: "leanRatio", choice: true,
      relation: "netPremiumUsd = bullishPremiumUsd - bearishPremiumUsd",
      rejected: "ranking the eleven on netPremiumUsd, which ranks them by sector size",
      undefinedAtZero: "leanRatio is null when grossPremiumUsd is 0",
    },
    notSameAs: "sector:trix — that key is TRIX on daily closes and contains no option data",
    sectors: SECTORS, returned: 11, measured: 8, quiet: 1, unreadable: 2,
    ...extra,
  });

  await post("sector:premium", sectorLean());

  {
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccLean .hm-cell", { timeout: 15000 });

    const heat = await page.evaluate(() => Array.from(
      document.querySelectorAll("#ccLean .hm-cell"), (c) => ({
        etf: c.dataset.etf, read: c.dataset.read, tone: c.dataset.tone,
        v: c.querySelector(".hm-cell-v").textContent.trim(),
        n: c.querySelector(".hm-cell-n").textContent.trim(),
        a: Number(c.style.getPropertyValue("--a")),
      })));

    const d = await moduleWhy(page, "hmLean");
    const rows = await page.evaluate(() => Array.from(
      document.querySelectorAll("#fxPopB tbody tr"), (tr) => ({
        read: tr.dataset.read,

        etf: tr.querySelector(".cc-etf").textContent.trim(),
        cells: Array.from(tr.children, (td) => td.textContent.trim()),
        bar: !!tr.querySelector(".cc-ln-bar"),
        flat: !!tr.querySelector(".cc-ln-flat"),
        none: !!tr.querySelector(".cc-ln-none"),
        left: tr.querySelector(".cc-ln-fill") ? tr.querySelector(".cc-ln-fill").style.left : null,
        width: tr.querySelector(".cc-ln-fill")
          ? tr.querySelector(".cc-ln-fill").style.width : null,
        fillW: tr.querySelector(".cc-ln-fill") ? tr.querySelector(".cc-ln-fill").getBoundingClientRect().width : null,
      })));

    eq(rows.length, 11, "all eleven baskets are tabulated, including the ones that said nothing");
    eq(heat.length, 11, "and all eleven are on the heat strip");

    const order = rows.map((r) => r.etf);
    deep(order, ["XLB", "XLY", "XLI", "XLK", "XLC", "XLV", "XLF", "XLE", "XLU", "XLRE", "XLP"],
      "the eleven are ranked on leanRatio, the field the publisher ranks on and says so on " +
      "the payload — not on the dollar difference, which ranks by basket size");
    deep(heat.map((c) => c.etf), order, "and the heat strip reads in the same order as the table");
    ok(order[0] === "XLB" && order.indexOf("XLK") === 3,
       `the 62% lean on $62K outranks the 2% lean on $400M (${order.join(" ")})`);

    ok(order.indexOf("XLU") > order.indexOf("XLE"),
       `the quiet basket sorts past every measured lean rather than into the middle at 0 ` +
       `(${order.join(" ")})`);
    ok(order.indexOf("XLU") < order.indexOf("XLRE"),
       "and ahead of the unreadable ones, because measured-and-empty is a reading and " +
       "unreadable is not");

    const by = Object.fromEntries(rows.map((r) => [r.etf, r]));
    const cell = Object.fromEntries(heat.map((c) => [c.etf, c]));

    deep(by.XLB.cells.slice(2), ["+62.0%", "$62K", "$100K"],
      "a measured basket prints its share of premium, its signed dollars and its gross");
    deep(by.XLE.cells.slice(2), ["−55.0%", "−$5.5M", "$10.0M"],
      "and a bearish one carries U+2212 on both signed columns, not a hyphen");
    deep(by.XLK.cells.slice(2), ["+2.0%", "$400.0M", "$20.00B"],
      "the dollars are shown beside the ratio, because a ratio cannot say whether a lean " +
      "is $62K or $400M");
    eq(cell.XLB.v, "+62.0%", "the heat cell prints the same share the table does");
    eq(cell.XLE.v, "−55.0%", "with the same minus");
    eq(cell.XLB.tone, "up", "and a bullish lean is toned up");
    eq(cell.XLE.tone, "down", "and a bearish one down");
    ok(cell.XLB.a > cell.XLK.a, `and intensity follows the ratio, not the dollars (${cell.XLB.a} vs ${cell.XLK.a})`);

    deep(by.XLC.cells.slice(2), ["0.0%", "$0", "$50.0M"],
      "an exactly-even basket prints an unsigned measured zero on both, never an em dash");
    ok(by.XLC.bar && by.XLC.width === "0%",
       `and is still drawn ON the axis, at the rule (${by.XLC.width}) — the stylesheet's ` +
       "min-width is what keeps a measured zero visible rather than a zero-width nothing");
    ok(by.XLC.fillW >= 1, `and the stylesheet really does draw it (${by.XLC.fillW}px)`);

    eq(by.XLU.read, "quiet", "the basket with both sums at zero is marked quiet on the row");
    eq(by.XLU.cells[2], "—", "its ratio is the em dash, because 0/0 is undefined and not 0");
    eq(by.XLU.cells[3], "$0", "but its NET is the measured zero it is, and stays visible");
    eq(by.XLU.cells[4], "$0", "and so is its gross");
    ok(by.XLU.flat && !by.XLU.bar,
       "and it is not placed on the axis at all: a mark at the centre would say " +
       "\"measured, and neutral\", which is the one thing it is not");
    eq(cell.XLU.v, "0/0", "on the heat strip the quiet basket says 0/0, the undefined ratio it is");
    eq(cell.XLU.read, "quiet", "and wears the quiet state");

    eq(by.XLRE.read, "unreadable", "the basket that could not be read is marked unreadable");
    deep(by.XLRE.cells.slice(2), ["—", "—", "—"],
      "and every one of its numbers is the em dash");
    ok(by.XLRE.none && !by.XLRE.flat && !by.XLRE.bar,
       "with the em dash in the lean column too, so it cannot be mistaken for the quiet row");
    eq(cell.XLRE.v, "\u2014", "and on the heat strip the unreadable basket is the em dash");
    ok(cell.XLU.v !== cell.XLRE.v, "a quiet basket and an unreadable one are not the same glyph");

    ok(by.XLU.cells[3] !== by.XLRE.cells[3],
       `a measured zero and an absent reading are not the same glyph ` +
       `(${by.XLU.cells[3]} vs ${by.XLRE.cells[3]})`);

    eq(by.XLB.left, "50%", "a bullish lean starts at the centre rule and runs right");
    eq(by.XLB.width, "31%", "its width is its share of the fixed ±100% axis, not of the day");
    eq(by.XLE.left, "22.5%", "a bearish lean is drawn LEFT of the rule — position carries it");
    eq(by.XLE.width, "27.5%", "and the same fixed axis scales it");

    deep(d.heads, ["Sector", "Lean", "Lean · % of premium", "Net · $", "Gross · $"],
      "every numeric column carries its unit in its own header: a ratio and a dollar sum " +
      "never share a name");

    const region = (await page.locator("#hmLean").textContent()) + " " + d.text;
    ok(!/\bbp\b/.test(region),
       "and the word `bp` appears nowhere in this module or its disclosure — that is the OTHER " +
       "sector panel's unit, and the two quantities must not be confusable");

    const what = d.sections["What it is"] || "";
    const how = d.sections["How it is derived"] || "";
    const note = what + " " + how;
    ok(what.length > 0 && how.length > 0,
       `the disclosure prints its prose in two sections — a selector matching nothing would ` +
       "pass every regex below by having no text to contradict them");
    ok(/sector:trix/.test(note),
       `the note names the other key by name (${note.slice(0, 90)}…)`);
    ok(/\/flows\/market\//.test(note),
       "and the route that draws it, so a reader who has seen the other panel is told which " +
       "one they are looking at rather than left to infer it");
    ok(/option/i.test(note) && /premium/i.test(note),
       "while naming the quantity this one is made of");

    ok(/Derived: netPremiumUsd = bullishPremiumUsd - bearishPremiumUsd/.test(note),
       `the note carries the publisher's own relation between the three numbers ` +
       `(${note.slice(0, 120)}…)`);
    ok(/ranks them by sector size/.test(note),
       `and carries the publisher's own rejected alternative rather than a paraphrase of it ` +
       `(${note.slice(0, 60)}…)`);
    ok(/0\/0 is undefined/.test(note),
       "and states why the quiet basket has no ratio, in the module's own disclosure rather than only in a title");
    ok(/POSITION/.test(note),
       "and that the sign is carried by position, which is what survives greyscale");

    for (const [label, pattern] of [
      ["the quiet baskets and why 0/0 is not a neutral lean", /0\/0 is undefined/],
      ["the baskets that could not be read", /could not be read at all/],
      ["what the table is ordered on", /Ordered on the RATIO/],
      ["that a ratio carries no size", /a ratio carries no size/],
      ["which of the two sector panels this is", /\/flows\/market\//],
      ["the horizon the quantity is over", /today only/],
    ]) {
      ok(pattern.test(what),
         `${label} is in the "What it is" section — it changes what a drawn cell means, and a ` +
         "caveat filed under method is one nobody weighs");
      ok(!pattern.test(how), `and it is not also under method (${label})`);
    }
    ok(/Derived:/.test(how) && !/Derived:/.test(what),
       "while the publisher's own relation — how the three numbers are made, and nothing " +
       "about what they mean — is the method, and is not among the caveats");

    const surfaceWords = await page.evaluate(() => {
      const body = document.getElementById("ccLean");
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      let longest = 0;
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        if (!el || !el.checkVisibility() || el.closest(".visually-hidden")) continue;
        longest = Math.max(longest, n.textContent.trim().split(/\s+/).filter(Boolean).length);
      }
      return longest;
    });
    ok(surfaceWords <= 3,
       `and none of it is on the surface: the heat strip carries figures and names only ` +
       `(longest visible run ${surfaceWords} words)`);

    ok(!/undefined (leans|most|is)/.test(region),
       `no sentence in the module has "undefined" for a subject (${d.lead})`);

    eq(d.lead,
       "Materials leans most bullish at +62.0% of its own premium; Energy most bearish at −55.0%.",
       "the finding names the top and bottom basket by its sector name, at the percentages " +
       "their cells print — the ticker stays in the table cell, where it is a key rather than prose");
    ok(d.leadFirst && d.leadBeforeTable, "and it is the first thing in the disclosure");
    await shut(page);

    eq((await page.locator("#ccLeanSub").textContent()).trim(), "8 of 11 leaned",
       "the count states the baskets that produced a lean against the eleven asked about");

    await page.locator("#ccLeanSeg .ui-seg-i", { hasText: "Premium" }).click();
    await page.waitForFunction(() => document.getElementById("ccLeanSub").textContent.trim() !== "8 of 11 leaned",
      null, { timeout: 5000 });
    const prem = await page.evaluate(() => ({
      sub: document.getElementById("ccLeanSub").textContent.trim(),
      first: (() => { const c = document.querySelector("#ccLean .hm-cell");
        return { etf: c.dataset.etf, v: c.querySelector(".hm-cell-v").textContent.trim() }; })(),
      quiet: document.querySelector('#ccLean .hm-cell[data-etf="XLU"] .hm-cell-v').textContent.trim(),
    }));
    eq(prem.sub, "9 of 11 cleared premium",
       "switching the strip to premium recounts the baskets that carried a premium sum");
    deep(prem.first, { etf: "XLK", v: "+$400.0M" },
       "and re-ranks on the dollars, where the largest basket leads");
    eq(prem.quiet, "$0", "and the quiet basket prints the $0 it measured");
    await page.locator("#ccLeanSeg .ui-seg-i", { hasText: "Ratio" }).click();
    await page.waitForFunction(() => document.getElementById("ccLeanSub").textContent.trim() === "8 of 11 leaned",
      null, { timeout: 5000 }).catch(() => {});
    eq((await page.locator("#ccLeanSub").textContent()).trim(), "8 of 11 leaned",
       "and switching back restores the ratio's own count");
  }

  {
    const blind = SECTORS.map((s) => ({
      ...s, read: "unreadable", leanRatio: null,
      netPremiumUsd: null, grossPremiumUsd: null,
      reason: "no " + s.etf + " row in the sector-etfs response",
    }));

    await post("sector:premium", sectorLean({
      status: "quiet", sectors: blind, returned: 0, measured: 0, quiet: 0, unreadable: 11 }));
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccLean [data-empty]", { timeout: 15000 });
    const quietLeg = await silenceOf(page, "#ccLean [data-empty]");
    const quietRows = await page.locator("#ccLean .hm-cell").count();
    eq(quietRows, 0,
       "a leg the vendor answered with nothing draws no cells at all, rather than eleven " +
       "identical unreadable ones that would read as eleven findings");
    eq(quietLeg.kind, "empty", "and it is the measured silence: the feed was read");
    ok(/returned no rows/.test(quietLeg.text),
       `saying so in its own sentence (${quietLeg.text})`);

    await post("sector:premium", sectorLean({
      status: "unreadable", sectors: blind, returned: 9, measured: 0, quiet: 0, unreadable: 11 }));
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccLean [data-empty]", { timeout: 15000 });
    const badLeg = await silenceOf(page, "#ccLean [data-empty]");
    eq(badLeg.kind, "unreadable", "rows that arrived and did not shape are UNREADABLE");
    ok(/returned rows/.test(badLeg.text) && /parted company/.test(badLeg.text),
       `and the sentence says the field names disagree rather than that the market was quiet ` +
       `(${badLeg.text})`);
    ok(badLeg.text !== quietLeg.text,
       "and the two silences do not share a sentence, which is the only way a reader can " +
       "tell an empty feed from a broken one");

    await post("sector:premium", sectorLean());
  }

  const H = 3600000, M = 60000;
  const now = Date.now();
  const NEWS_ROWS_FIXTURE = [
    { headline: "Fed holds rates steady as the tape thins into the close",
      source: "Reuters", createdAt: new Date(now - (6 * H + 30 * M)).toISOString(),
      createdAtMs: now - (6 * H + 30 * M), major: true, sentiment: "neutral",
      tickers: ["ORCL", "CAT", "SNAP", "MU", "PFE"], tags: ["federal-reserve"] },

    { headline: "Sirius XM <b>surges</b> on <script>alert(1)</script> upgrade",
      source: "BusinessWire", createdAt: new Date(now - (2 * H + 15 * M)).toISOString(),
      createdAtMs: now - (2 * H + 15 * M), major: false, sentiment: "positive",
      tickers: ["SIRI"], tags: ["upgrade"] },

    { headline: "Oil steadies after inventory draw", source: "MarketNews",
      createdAt: new Date(now - (45 * M)).toISOString(), createdAtMs: now - (45 * M),
      major: null, sentiment: "negative", tickers: ["XOM"], tags: ["energy"] },
    { headline: "Chip orders slip in the September survey", source: "MarketNews",
      createdAt: new Date(now - (7 * H)).toISOString(), createdAtMs: now - (7 * H),
      major: false, sentiment: null, tickers: [], tags: [] },

    { headline: "An item the vendor sent with no timestamp", source: null,
      createdAt: null, createdAtMs: null, major: null, sentiment: null,
      tickers: [], tags: [] },
  ];

  for (let i = 0; i < 3; i += 1) {
    NEWS_ROWS_FIXTURE.splice(4, 0, {
      headline: "Filler headline " + (i + 1), source: "Wire",
      createdAt: new Date(now - (8 * H + i * M)).toISOString(),
      createdAtMs: now - (8 * H + i * M), major: false, sentiment: "neutral",
      tickers: [], tags: [],
    });
  }

  const newsPayload = (extra = {}) => ({
    v: 2, status: "ok", sessionDate: SESSION, generatedAt: new Date().toISOString(),
    readAt: new Date(now - (3 * H + 20 * M)).toISOString(), refreshed: "nightly",
    cadence: "once per weekday after the close, at 21:30 UTC — 17:30 America/New_York in " +
      "summer, 16:30 in winter", staleBy: "the next weekday's close",
    scope: "market-wide", rows: NEWS_ROWS_FIXTURE,
    requested: 100, returned: 10, kept: 8, cap: 60, capped: false, shed: 0,
    atVendorLimit: false, unusable: 2, undatedKept: 1, undatedSeen: 1,
    newest: new Date(now - (45 * M)).toISOString(),
    oldest: new Date(now - (9 * H + 20 * M)).toISOString(),
    ordered: true, orderedBy: "createdAt", orderedDesc: true, reason: null,
    ...extra,
  });

  await post("news", newsPayload());

  const newsWhy = async () => {
    const d = await why(page, "#ccNews .hm-news-open");
    const extra = await page.evaluate(() => ({
      note: (document.querySelector("#fxPopB .cc-nw-note") || {}).textContent || "",
      rows: document.querySelectorAll("#fxPopB .cc-nw-row").length,
    }));
    return { ...d, ...extra };
  };

  {
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccNews .hm-news-open", { timeout: 15000 });

    const surface = await page.evaluate(() => {
      const b = document.querySelector("#ccNews .hm-news-open");
      const sub = document.getElementById("ccNewsSub");
      return {
        headline: b.querySelector(".hm-news-h").textContent,
        age: b.querySelector(".hm-news-a").textContent.trim(),
        all: b.querySelector(".hm-news-n").textContent.trim(),
        sub: sub.textContent.trim(), label: sub.getAttribute("aria-label") || "",
      };
    });
    eq(surface.headline, NEWS_ROWS_FIXTURE[0].headline,
       "the surface carries one headline, the first stored row, as the way into the rest");
    ok(/^6h \d+m ago$/.test(surface.age),
       `and that headline's own age sits beside it, so it is never read as news (${surface.age})`);
    eq(surface.all, "All 8", "with a count of what the disclosure holds");

    const seat = await newsWhy();
    ok(seat.leadFirst,
       "the age of the fetch is the FIRST thing in the disclosure — under the last headline it " +
       "is a footnote, and a reader who reaches a headline without having read the age reads it as news");
    ok(/Fetched 3h \d+m ago.*After-close snapshot/.test(seat.lead),
       `and it names the post-close snapshot the pipeline publishes (${seat.lead})`);
    const note = seat.note.trim();
    ok(/^Fetched at (\d{4}-\d{2}-\d{2} )?\d\d:\d\d \S+, 3h \d+m ago\./.test(note),
       `it states when the feed was fetched AND how long ago, on a 24-hour clock that names ` +
       `its zone (${note.slice(0, 60)}…)`);
    ok(/once per weekday after the close, at 21:30 UTC/.test(note),
       "and the cadence the payload publishes, so the age is not read as bad luck");
    ok(/stale by the next weekday's close/.test(note),
       "and how stale it is allowed to get, stated rather than implied");
    ok(/never a live tape/.test(note),
       `so nothing here implies a stream (${note.slice(0, 40)}…)`);
    ok(/oldest of the 8 stored rows is 9h \d+m old/.test(note),
       `and bounds the whole stored window rather than only the newest row (${note})`);

    eq(seat.rows, 8, "every stored row is listed");
    eq(surface.sub, "8", "and the module counts how many it holds");
    ok(/^all 8 · fetched 3h \d+m ago$/.test(surface.label),
       `and says how old the read is (${surface.label})`);

    const rows = await page.evaluate(() => Array.from(
      document.querySelectorAll("#fxPopB .cc-nw-row"), (li) => ({
        headline: li.querySelector(".cc-nw-h").textContent,
        html: li.querySelector(".cc-nw-h").innerHTML,
        age: li.querySelector(".cc-nw-age").textContent.trim(),
        ageTitle: li.querySelector(".cc-nw-age").title,
        src: (li.querySelector(".cc-nw-src") || {}).textContent || null,
        sent: li.querySelector(".cc-nw-sent")
          ? { text: li.querySelector(".cc-nw-sent").textContent,
              cls: li.querySelector(".cc-nw-sent").className } : null,
        major: !!li.querySelector(".cc-nw-major"),
        opens: Array.from(li.querySelectorAll(".cc-open"), (a) => a.textContent.trim()),
        openHrefs: Array.from(li.querySelectorAll(".cc-open"), (a) => a.getAttribute("href")),
        plain: Array.from(li.querySelectorAll(".cc-nw-tk"), (s) => s.textContent),
        more: (li.querySelector(".cc-nw-more") || {}).textContent || null,
        tags: Array.from(li.querySelectorAll("script, b, i.injected"), (n) => n.tagName),
      })));
    await shut(page);

    ok(/^6h \d+m ago$/.test(rows[0].age),
       `the newest headline states its own age from the vendor's stamp (${rows[0].age})`);
    ok(/^2h \d+m ago$/.test(rows[1].age), `and so does the next (${rows[1].age})`);
    ok(/^\d+ min ago$/.test(rows[2].age),
       `an item under the hour is stated in minutes rather than "0h" (${rows[2].age})`);
    ok(/1 stored row carries no timestamp/.test(note),
       `and the note counts the rows that cannot be aged at all (${note.slice(-140)})`);
    ok(/The vendor's own stamp, verbatim: /.test(rows[0].ageTitle),
       `with the vendor's own stamp behind it, carried rather than reformatted ` +
       `(${rows[0].ageTitle.slice(0, 50)}…)`);

    const undated = rows.find((r) => /no timestamp/.test(r.ageTitle));
    ok(undated, "the row the vendor sent with no timestamp is on the page");
    eq(undated.age, "undated",
       "and it says so rather than being dated to now, which would be the confident zero in " +
       "the one dimension where it is invisible");

    const marked = rows.find((r) => /Sirius/.test(r.headline));
    eq(marked.headline, "Sirius XM <b>surges</b> on <script>alert(1)</script> upgrade",
       "a headline carrying markup is printed as the characters the vendor sent");
    deep(marked.tags, [],
       "and none of it became an element: the renderer builds nodes and sets textContent, " +
       "which is how every vendor string enters a page in this section");
    ok(!/<b>/.test(marked.html) && /&lt;b&gt;/.test(marked.html),
       `the angle brackets are escaped in the DOM rather than parsed (${marked.html.slice(0, 40)}…)`);

    deep(rows[0].opens, ["ORCL", "MU"],
      "only the names this session built a detail card for are minted as links");
    deep(rows[0].openHrefs,
      ["/flows/ticker/?t=ORCL&s=signal&from=overview",
       "/flows/ticker/?t=MU&s=signal&from=overview"],
      "at the same address a ranked row uses — a second address for one destination is a " +
      "second thing to keep in step");
    ok(rows[0].plain.includes("CAT"),
       `a board name with no card is printed plain (${rows[0].plain.join(" ")}) — the mention ` +
       "is still the join between a headline and a ranked name, and a link to an empty " +
       "reader is not");
    ok(rows[0].plain.includes("SNAP"),
       "and so is a name this session never screened at all");
    eq(rows[0].more, "+1 more",
       "and a headline naming more tickers than the row shows says how many, because a list " +
       "that truncates in silence reads as a population");

    eq(marked.sent.text, "positive", "the vendor's sentiment word is carried verbatim");
    ok(!/is-pos|is-neg|data-tone/.test(marked.sent.cls),
       `and is NOT tinted with this page's own polarity classes (${marked.sent.cls}) — green ` +
       "and red here mean the direction of OUR readings, and adding a vendor's label to them " +
       "would invite a reader to add two different claims together");

    ok(rows[0].major, "a row the vendor flagged major carries the mark");
    const unflagged = rows.find((r) => /Oil steadies/.test(r.headline));
    ok(!unflagged.major,
       "a row the vendor sent no flag on carries none — absence is not `false`");
    ok(/2 of the stored rows carried no major\/minor flag at all/.test(note),
       `and their number is stated once in the note instead (${note.slice(-120)})`);
  }

  {
    await post("news", newsPayload({
      kept: 60, capped: true, shed: 38, atVendorLimit: true, returned: 100 }));
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccNews .hm-news-open", { timeout: 15000 });
    const bothRead = await newsWhy();
    await shut(page);
    const both = bothRead.note.trim();
    ok(/vendor returned 100 rows against the 100 asked for, which is its documented ceiling/
      .test(both), `the vendor ceiling is named with the number that was hit (${both})`);
    ok(/true population is UNKNOWN and at least that large/.test(both),
       "and says the population is unknown, which is the whole content of that fact");
    ok(/60-row cap then shed 38 rows/.test(both),
       `while OUR cap is a separate sentence naming a separate number (${both})`);
    ok(/these rows arrived and were dropped here, so their number is known/.test(both),
       "and says the opposite thing about knowing the population, which is why they cannot " +
       "be one sentence");
    eq((await page.locator("#ccNewsSub").textContent()).trim(), "8 of 60",
       "and the count is against the payload's own kept, not the rows in hand");

    await post("news", newsPayload({
      kept: 60, capped: true, shed: 12, atVendorLimit: false, returned: 72 }));
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccNews .hm-news-open", { timeout: 15000 });
    const oursRead = await newsWhy();
    await shut(page);
    const ours = oursRead.note.trim();
    ok(/60-row cap then shed 12 rows/.test(ours),
       `our cap is still stated (${ours.slice(0, 120)}…)`);
    ok(!/documented ceiling/.test(ours) && !/UNKNOWN/.test(ours),
       "and the vendor-ceiling claim is absent, because it was not true this run");

    await post("news", newsPayload());
  }

  {
    await post("news", newsPayload({ status: "quiet", rows: [], kept: 0, returned: 0,
      reason: "the headlines feed was read and returned no rows" }));
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccNews [data-empty]", { timeout: 15000 });
    const empty = await silenceOf(page, "#ccNews [data-empty]");
    eq(empty.kind, "empty", "a feed that was read and had nothing in it is the MEASURED silence");
    ok(/the tape was checked and was empty/.test(empty.text),
       `and says which of the three it is (${empty.text})`);

    await post("news", newsPayload({ status: "unreadable", rows: [], kept: 0, returned: 40,
      reason: "the headlines feed returned 40 row(s) and none carried a headline" }));
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccNews [data-empty]", { timeout: 15000 });
    const broke = await silenceOf(page, "#ccNews [data-empty]");
    eq(broke.kind, "unreadable", "rows that arrived and carried no headline are UNREADABLE");
    ok(/not a quiet news day/.test(broke.text),
       `and the sentence refuses the reading the other silence would have given (${broke.text})`);
    ok(broke.text !== empty.text, "the three silences are three sentences, still");

    const undatedRead = newsPayload();
    delete undatedRead.readAt;
    await post("news", undatedRead);
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccNews .hm-news-open", { timeout: 15000 });
    const noStampRead = await newsWhy();
    await shut(page);
    const noStamp = {
      note: noStampRead.note.trim(),
      label: (await page.locator("#ccNewsSub").getAttribute("aria-label")) || "",
    };
    ok(/states no read time/.test(noStamp.note),
       `a payload with no readAt says so rather than implying freshness (${noStamp.note})`);
    ok(/unknown age rather than as something that just happened/.test(noStamp.note),
       "and tells the reader what to do with rows it cannot date");
    ok(!/fetched /.test(noStamp.label),
       `and the count claims no age either (${noStamp.label})`);

    await post("news", newsPayload());
  }

  {
    const REGIME = {
      v: 2, status: "ok", sessionDate: SESSION, generatedAt: new Date().toISOString(),
      volCurve: { byIndex: {
        SPY: { status: "ok", tenors: [1, 5, 7, 14, 30, 60, 90, 180, 365],
               iv: [0.11, 0.12, 0.125, 0.13, 0.142, 0.15, 0.155, 0.16, 0.168],
               ivp: 38, rv20: 0.118, ts: -0.084, shape: "contango" },
        QQQ: { status: "ok", tenors: [1, 5, 7, 14, 30, 60, 90, 180, 365],
               iv: [0.15, 0.16, 0.165, 0.17, 0.18, 0.187, 0.19, 0.196, 0.2],
               ivp: 44, rv20: 0.16, ts: -0.05, shape: "contango" },
      } },
      impliedCorrelation: { byIndex: { SPY: { status: "ok", rho: 0.312, dispersion: 0.22 },
                                       QQQ: { status: "ok", rho: 0.448 } } },
      zeroDte: { status: "ok", share: 0.41, np0: 12500000 },
      volRadar: { rich: { rows: [{ t: "ORCL", carded: true }] }, cheap: { rows: [{ t: "XOM" }] } },
    };
    await page.route("**/api/flows/regime", (route) => route.fulfill({
      status: 200, contentType: "application/json", body: JSON.stringify(REGIME) }));
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccVol .ui-metric", { timeout: 15000 });
    const vol = await page.evaluate(() => ({
      m: Object.fromEntries(Array.from(document.querySelectorAll("#ccVol .ui-metric"), (m) => [
        m.querySelector(".ui-metric-l").textContent.trim(),
        m.querySelector(".ui-metric-v").textContent.trim()])),
      term: document.querySelectorAll("#ccVol .hm-term svg[role=img]").length,
      rich: Array.from(document.querySelectorAll("#ccVol .hm-radar-r:first-child .hm-chiplink"),
        (a) => [a.tagName, a.textContent.trim(), a.getAttribute("href")]),
      stale: Boolean(document.querySelector("#hmVol .ui-mod-t .hm-mark[data-state=stale]")),
      zero: Array.from(document.querySelectorAll("#hmTideLegs .ui-metric"), (m) =>
        m.querySelector(".ui-metric-v").textContent.trim())[2],
    }));
    eq(vol.m["IV 30d"], "14.2%", "the index vol module reads the regime's fixed-tenor SPY curve");
    eq(vol.m.Term, "Contango", "and names its term shape in a word");
    eq(vol.m.Correlation, "0.31", "with the implied correlation beside it");
    eq(vol.m["0DTE share"], "41%", "and the zero-day share of the session's premium");
    eq(vol.term, 1, "the term structure is drawn on one chart");
    deep(vol.rich[0], ["A", "ORCL", "/flows/ticker/?t=ORCL&s=signal&from=overview"],
      "a rich name with a card links to its reader");
    ok(vol.stale, "an August regime read in September wears the stale mark on the module title");
    eq(vol.zero, "+$12.5M", "and the hero's 0DTE leg falls back to the regime's zero-day net premium");
    eq(vol.m["RV 20d"], "11.8%", "the regime's realized vol is named by its own 20-day window");
    const volSubs = await page.evaluate(() => Object.fromEntries(Array.from(document.querySelectorAll("#ccVol .ui-metric"), (m) => [
      m.querySelector(".ui-metric-l").textContent.trim(), (m.querySelector(".ui-metric-s") || {}).textContent || ""])));
    eq(volSubs["IV 30d"], "SPY · pct 38", "and its 1-year IV percentile is called a percentile");
    eq(vol.m.Dispersion, "+22.0pts",
      "dispersion is the members' IV less the index's: a difference of two vols, printed in vol points, never as a percent");

    const breadthAt = (session, value) => (route) => route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ status: "ok", session, dte: { share: { value, zeroNet: 1e5, weeklyNet: 1.9e6 } } }) });
    const shareNow = async () => {
      await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
      await page.waitForSelector("#ccVol .ui-metric", { timeout: 15000 });
      return page.evaluate(() => {
        const m = Array.from(document.querySelectorAll("#ccVol .ui-metric")).find((x) => x.querySelector(".ui-metric-l").textContent.trim() === "0DTE share");
        return m ? m.querySelector(".ui-metric-v").textContent.trim() : null;
      });
    };
    await page.route("**/api/flows/lk?k=breadth", breadthAt(SESSION, 0.052));
    eq(await shareNow(), "5%",
      "a live breadth layer as new as the regime supplies the 0DTE share, by the same rule the market page's expiry gauge uses, " +
      "so the two pages never print two shares for one session");
    await page.unroute("**/api/flows/lk?k=breadth");
    await page.route("**/api/flows/lk?k=breadth", breadthAt("2026-08-21", 0.052));
    eq(await shareNow(), "41%", "while a breadth layer older than the regime yields to it");
    await page.unroute("**/api/flows/lk?k=breadth");
    await page.unroute("**/api/flows/regime");

    const liveAt = new Date().toISOString();
    const t0 = Date.parse(SESSION + "T13:30:00Z");
    const ts = [0, 5, 10, 15].map((m) => new Date(t0 + m * 60000).toISOString());
    await page.route("**/api/flows/lk?k=market", (route) => route.fulfill({
      status: 200,
      headers: { "Content-Type": "application/json", "X-Fresh-State": "live" },
      body: JSON.stringify({
        status: "ok", session: SESSION, fresh: { readAt: liveAt },
        tide: { status: "ok", t: ts, ncp: [1e6, 3e6, 5e6, 9e6], npp: [2e6, 2e6, 1e6, 1e6],
                net: [-1e6, 1e6, 4e6, 8e6] },
        zeroDte: { status: "ok", t: ts, net: [0, 5e5, 1e6, 2.5e6] },
      }) }));
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#hmTide svg[role=img]", { timeout: 15000 });
    const live = await page.evaluate(() => ({
      value: document.getElementById("hmTideV").dataset.value,
      state: document.querySelector("#hmTideState .hm-pill").dataset.state,
      legs: Array.from(document.querySelectorAll("#hmTideLegs .ui-metric .ui-metric-v"), (v) => v.textContent.trim()),
      legend: document.querySelector("#hmTide .ui-legend, #hmTide [class*=legend]")?.textContent || "",
    }));
    eq(live.value, "+$8.0M", "a live market tide newer than the pulse takes the hero");
    eq(live.state, "live", "and the pill says live, off the worker's own freshness header");
    eq(live.legs[2], "+$2.5M", "with the live 0DTE net aligned onto the tide's buckets");
    ok(/0DTE/.test(live.legend), `and the zero-day series keyed on the river (${live.legend})`);
    const src = await why(page, "#hmTideState .hm-pill");
    eq(src.facts.Source, "live:market", "and the disclosure names the live key as the source");
    await shut(page);
    await page.unroute("**/api/flows/lk?k=market");

    const heroNow = () => page.evaluate(() => {
      const pill = document.querySelector("#hmTideState .hm-pill");
      return {
        value: document.getElementById("hmTideV").dataset.value || document.getElementById("hmTideV").textContent.trim(),
        state: pill.dataset.state, pill: pill.textContent.trim(),
        svg: document.querySelectorAll("#hmTide svg[role=img]").length,
        empty: (document.querySelector("#hmTide [data-empty]") || {}).dataset?.empty || null,
        note: (document.querySelector("#hmTide .ui-silent-t") || {}).textContent || null,
        zero: Array.from(document.querySelectorAll("#hmTideLegs .ui-metric-v"), (v) => v.textContent.trim())[2],
      };
    });
    const liveTide = (n, fresh, extra = {}) => (route) => route.fulfill({
      status: 200, headers: { "Content-Type": "application/json", "X-Fresh-State": fresh },
      body: JSON.stringify({ status: "ok", session: SESSION, fresh: { readAt: liveAt },
        tide: { status: "ok", t: ts.slice(0, n), ncp: [5e6, 3e6, 5e6, 9e6].slice(0, n), npp: [1e6, 2e6, 1e6, 1e6].slice(0, n),
                net: [4e6, 1e6, 4e6, 8e6].slice(0, n) }, ...extra }) });
    const heroAfter = async () => {
      await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
      await page.waitForSelector("#hmTideState .hm-pill:not([data-state=pending])", { timeout: 15000 });
      return heroNow();
    };

    await page.route("**/api/flows/lk?k=market", liveTide(1, "live"));
    const opening = await heroAfter();
    eq(opening.value, "+$100.1M",
       "a live tide of one read (the opening minutes) yields to the last session's whole tide rather than to Pending");
    eq(opening.svg, 1, "and the river is drawn from it");

    await page.route("**/api/flows/pulse", (route) => route.fulfill({ status: 200,
      headers: { "Content-Type": "application/json", "X-Fresh-State": "stale" },
      body: JSON.stringify({ ...pulsePayload, readAt: liveAt, live: { key: "live:market", session: SESSION },
        tide: { status: "ok", points: [{ t: ts[0], callPrem: 5e6, putPrem: 1e6 }] } }) }));
    const one = await heroAfter();
    eq(one.value, "+$4.0M", "with one read anywhere, the hero prints that read");
    eq(one.state, "live", "marked by the live key's own state");
    eq(one.empty, null, "and the river region is not a waiting sign");
    eq(one.note, "First read", "but one quiet word: the river draws from the second read");
    await page.unroute("**/api/flows/pulse");

    await page.route("**/api/flows/lk?k=market", liveTide(4, "stale"));
    const late = await heroAfter();
    eq(late.state, "stale", "a live tide past its fresh window is still drawn, marked stale");
    eq(late.svg, 1, "with its river");
    ok(/^Stale\s*·\s*(\d{1,2}:\d\d\s*[AP]M|[A-Z][a-z]{2} \d{1,2})$/.test(late.pill),
       `and the pill carries when it was read (${late.pill})`);

    {
      const thu = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
      await stubNewKeys(thu);
      const tp = await thu.newPage();
      tp.on("pageerror", (e) => errors.push("thu: " + e.message));
      await tp.clock.setFixedTime(new Date("2026-09-24T17:00:00Z"));
      await signIn(tp);
      await tp.route("**/api/flows/pulse", (route) => route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ status: "pending" }) }));
      const today = "2026-09-24";
      const one = [today + "T13:31:00Z"];
      const liveToday = (headers, n = 1) => (route) => route.fulfill({ status: 200,
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ status: "ok", session: today, fresh: { readAt: today + "T13:31:44Z" },
          tide: { status: "ok", t: n === 1 ? one : [today + "T13:30:00Z", today + "T13:35:00Z", today + "T13:40:00Z"],
                  ncp: [9e6, 9.5e6, 9.9e6].slice(0, n), npp: [3e5, 1e6, 1.2e6].slice(0, n),
                  net: [8.7e6, 8.5e6, 8.7e6].slice(0, n) } }) });
      const pillOf = async () => {
        await tp.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
        await tp.waitForSelector("#hmTideState .hm-pill:not([data-state=pending])", { timeout: 15000 });
        return tp.evaluate(() => {
          const pill = document.querySelector("#hmTideState .hm-pill");
          return { state: pill.dataset.state, pill: pill.textContent.trim(),
            title: document.getElementById("fxTitle").textContent.trim(),
            note: (document.querySelector("#hmTide .ui-silent-t") || {}).textContent || null,
            zero: (document.querySelector("#hmTideLegs [data-state]") || {}).dataset?.state || null };
        });
      };

      await tp.route("**/api/flows/lk?k=market", liveToday({ "X-Fresh-State": "closed", "X-Fresh-Phase": "closed" }));
      const broken = await pillOf();
      eq(broken.title, "Last session", "on a Thursday afternoon the boards of an earlier session are the last session");
      eq(broken.state, "stale",
         "a 'closed' header whose phase says the whole day is not trading, while the Eastern clock is inside the session, " +
         "is a broken trading flag: today's single morning read is shown as stale");
      ok(/^Stale\s*·\s*Sep 24 9:31\s*AM$/.test(broken.pill),
         `and because the tide is of another session than the page's boards, the pill names its day as well as its time (${broken.pill})`);
      eq(broken.note, "One read", "a lone read that was never followed up says one read, not first read, since no second is coming");
      eq(broken.zero, "quiet", "and a 0DTE leg that was never read for a stale tide is quiet, not a pending promise");

      await tp.route("**/api/flows/lk?k=market", liveToday({ "X-Fresh-State": "closed", "X-Fresh-Phase": "post" }));
      const early = await pillOf();
      eq(early.state, "closed", "an early close (phase post) is a true closed state and is left alone, not overridden to stale");
      ok(/^Closed\s*·\s*Sep 24$/.test(early.pill), `dated by its session (${early.pill})`);

      await tp.route("**/api/flows/lk?k=market", liveToday({ "X-Fresh-State": "live", "X-Fresh-Phase": "rth" }, 3));
      const live = await pillOf();
      eq(live.state, "live", "a live tide of today under yesterday's boards is live");
      ok(/^Live\s*·\s*Sep 24 9:31\s*AM$/.test(live.pill), `and its pill still carries the day (${live.pill})`);
      eq(live.zero, "pending", "while a live tide's missing 0DTE leg is still pending, since the next read may carry it");
      await thu.close();
    }

    await page.route("**/api/flows/lk?k=breadth", (route) => route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ status: "ok", session: SESSION, dte: { zero: { status: "ok", t: ts, net: [0, 1e6, 3e6, 7e6] } } }) }));
    await page.route("**/api/flows/lk?k=market", liveTide(4, "live",
      { zeroDte: { status: "ok", t: ts, net: [0, 5e5, 1e6, 2.5e6] } }));
    eq((await heroAfter()).zero, "+$7.0M", "the 0DTE leg reads live:breadth.dte.zero before live:market.zeroDte");
    await page.unroute("**/api/flows/lk?k=breadth");
    await page.route("**/api/flows/lk?k=market", liveTide(4, "live"));
    eq((await heroAfter()).zero, "\u2014", "and a live tide with no live 0DTE series does not borrow another session's number");
    await page.unroute("**/api/flows/lk?k=market");

    await page.route("**/api/flows/pulse", (route) => route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ status: "pending" }) }));
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#hmTide [data-empty]", { timeout: 15000 });
    eq((await heroNow()).empty, "pending", "only with no tide anywhere does the hero fall silent");
    await page.unroute("**/api/flows/pulse");

    await page.unroute(NEW_KEYS);
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccVol [data-empty]", { timeout: 15000 });
    const unwritten = await silenceOf(page, "#ccVol [data-empty]");
    eq(unwritten.kind, "pending",
      "against the Worker's own routes, a regime and a live layer nobody has written yet leave the module pending");
    eq(await page.locator("#hmTideState .hm-pill").getAttribute("data-state"), "stale",
      "while the hero falls back to the pulse it does have");

    allowFetchFailure = true;
    await page.route(NEW_KEYS, (route) => route.fulfill({ status: 404, contentType: "application/json",
      body: JSON.stringify({ error: { code: "not_found", message: "API route not found" } }) }));
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccVol [data-empty]", { timeout: 15000 });
    const notYet = await silenceOf(page, "#ccVol [data-empty]");
    eq(notYet.kind, "pending",
      "and a Worker that predates those routes (404) leaves it pending too, not unreadable — a route that has " +
      "not shipped is a key that has not published");
    await page.unroute(NEW_KEYS);
    await stubNewKeys(page);
    allowFetchFailure = false;
  }

  {
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccLean .hm-cell", { timeout: 15000 });
    await page.waitForSelector("#ccNews .hm-news-open", { timeout: 15000 });

    const wordy = await page.evaluate(() => {
      const grid = document.querySelector(".hm-grid");
      const walker = document.createTreeWalker(grid, NodeFilter.SHOW_TEXT);
      const out = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        if (!el || el.closest("svg, .visually-hidden, .hm-verdict, .hm-news-h, [hidden]")) continue;
        if (!el.checkVisibility()) continue;
        const words = n.textContent.trim().split(/\s+/).filter(Boolean).length;
        if (words > 6) out.push(n.textContent.trim());
      }
      return out;
    });
    deep(wordy, [],
      "no prose on the surface: outside the Neuron verdict line and a headline, no visible run of " +
      "text is longer than six words — every sentence lives behind a disclosure");
    const infos = await page.$$eval(".hm-grid [data-info]", (ns) => ns.length);
    ok(infos >= 15, `and the sentences are there, one tap away (${infos} disclosures)`);

    const classes = await page.evaluate(() => {
      const set = new Set();
      for (const root of [document.getElementById("hmLean"), document.getElementById("hmNews")]) {
        if (!root) continue;
        for (const n of [root, ...root.querySelectorAll("*")]) {
          for (const c of n.classList) set.add(c);
        }
      }
      return [...set].sort();
    });
    await why(page, "#hmLean .ui-mod-h > .ui-info");
    const popLean = await page.evaluate(() => Array.from(document.querySelectorAll("#fxPopB *"), (n) => [...n.classList]).flat());
    await why(page, "#ccNews .hm-news-open");
    const popNews = await page.evaluate(() => Array.from(document.querySelectorAll("#fxPopB *"), (n) => [...n.classList]).flat());
    await shut(page);
    const all = [...new Set([...classes, ...popLean, ...popNews])].sort();

    const CSS_TEXT = ["flows.css", "flows-home.css"].map((f) =>
      readFileSync(new URL("../assets/css/" + f, import.meta.url), "utf8")).join("\n")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    ok(all.length >= 14,
       `the two modules and their disclosures emit ${all.length} classes to check, read off the ` +
       "built DOM so a cell added tomorrow is checked tomorrow");
    for (const c of all) {
      const rule = new RegExp("\\." + c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![\\w-])");
      ok(rule.test(CSS_TEXT),
         `.${c} resolves to a rule in flows.css or flows-home.css — an unstyled class here is not a ` +
         "neutral one, it is an invisible one");
    }

    const tagGap = await page.evaluate(() => ["cc-cross", "cc-ern"].map((c) => {
      const tag = document.querySelector("#ccBull ." + c + ", #ccBear ." + c);
      if (!tag) return { c, present: false };
      const prev = tag.previousElementSibling;
      return { c, present: true,
               gap: prev ? tag.getBoundingClientRect().left - prev.getBoundingClientRect().right
                         : null };
    }));
    for (const t of tagGap) {
      ok(t.present, `a ranked row carries a .${t.c} tag to measure`);
      ok(t.gap > 0,
         `.${t.c} stands apart from the ticker it follows (gap ${t.gap}px)`);
    }

    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      const over = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      ok(over <= 1, `no horizontal overflow at ${width}px with every module drawn (${over}px)`);
    }
    await page.setViewportSize({ width: 1280, height: 1000 });
  }

  eq(errors.length, 0, `no uncaught page error across the whole session (${errors[0] || ""})`);

  console.log(`✓ flows-overview: ${checks} assertions — a one-glance cockpit that leads on the ` +
    `market's tide, pulse-read or live, with its two legs and the zero-day share, the regime's ` +
    `vol curve, correlation and radar pending by design until the key ships, and five session ` +
    `readings as chips whose every sentence is one tap away; both sides whole in the payload's ` +
    `own rank order as rows that ARE links to the reader, a score strip per row on one shared ` +
    `domain that redraws on resize, what changed as four counts and a list whose crossings ` +
    `lead, every delta printed with the number of sessions it spans, readings that are not about ` +
    `today demoted and dated, and the whole table one tap away with its finding first; earnings ` +
    `joined onto the ranked names in the events payload's own unit and the score joined back ` +
    `onto the calendar, both weightings of the tilt rather than a silent choice, four silences ` +
    `in four glyphs with four sentences behind them, one bearish population printed as one ` +
    `number in the rail, the chip, the status line and the pole count, a vendor ceiling printed ` +
    `as a floor and never a census, a residual signed in U+2212 with its unit named on the row, ` +
    `a spine at one viewBox unit per CSS pixel that trails only the crossings both payloads ` +
    `agree are this session's, the staleness guard that is flows-ui.js's one test, two halves ` +
    `that refuse to be one session when they are not, a board that does not answer contained ` +
    `to its own module, every capped module counting what it shows out of what it holds, the ` +
    `read instant on a 24-hour clock that names its zone, eleven sector baskets on a heat strip ` +
    `ranked on the publisher's ratio with a quiet basket at 0/0 and an unreadable one at an em ` +
    `dash, caveats kept apart from method, a headline tape whose fetch age leads its ` +
    `disclosure and whose vendor strings stay characters, and no visible run of prose longer ` +
    `than six words anywhere on the surface`);
} finally {
  await browser.close();
  await server.stop();
}
