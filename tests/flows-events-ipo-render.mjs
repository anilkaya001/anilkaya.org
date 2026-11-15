import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./lib/browser.mjs";
import { buildEvents } from "../shared/flows-events.js";
import { eventsPage } from "../shared/flows-pages.js";
import { shapeIpoCalendar } from "../shared/flows-ipo.js";
import { ipoOn, IPO_SWITCH } from "../server/routes/flows-pages.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };
const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };

const FIX = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures-intel.json"), "utf8"));
const SESSION = FIX.provenance.session;
const NOW = Date.parse(SESSION + "T15:25:00.000Z");
const SIZES = [{ width: 1920, height: 1080 }, { width: 1440, height: 820 }, { width: 1024, height: 768 }, { width: 390, height: 844 }];
const SHOTS = process.env.SHOTS || null;

const base = () => {
  const p = buildEvents([], { gateOrigin: SESSION, sessionDate: SESSION });
  p.generatedAt = SESSION + "T21:45:00.000Z";
  p.macro = { status: "quiet", rows: [] };
  p.fda = { status: "quiet", rows: [] };
  p.catalysts = { status: "ok", rows: [] };
  return p;
};
const IPO = shapeIpoCalendar(FIX.bodies["ipo-calendar"], { sessionDate: SESSION });
const withIpo = (ipo) => { const p = base(); if (ipo !== undefined) p.ipo = ipo; return p; };

{
  const on = eventsPage({ username: "t", ipo: true });
  const off = eventsPage({ username: "t" });
  ok(on.includes('id="fdT-ipo"') && on.includes('id="evIpo"'), "with the switch the page carries the IPOs tab and its module");
  ok(!off.includes("fdT-ipo") && !off.includes("evIpo") && !off.includes("IPOs"), "SWITCHED OFF: the page names no IPO tab, module or word");
  eq(off, eventsPage({ username: "t", ipo: false }), "and is the page it was without the argument");
  const tabs = [...on.matchAll(/data-tab="([a-z]+)"/g)].map((m) => m[1]).filter((t, i, a) => a.indexOf(t) === i);
  eq(tabs.slice(0, 6), ["week", "earn", "macro", "fda", "ipo", "react"], "the IPOs tab sits after FDA and before Reaction");
  eq([ipoOn({}, true), ipoOn({ [IPO_SWITCH]: "owner" }, false), ipoOn({ [IPO_SWITCH]: "owner" }, true), ipoOn({ [IPO_SWITCH]: "on" }, false), ipoOn({ [IPO_SWITCH]: "On " }, false), ipoOn({ [IPO_SWITCH]: "yes" }, true)],
    [false, false, true, true, true, false], "THE SWITCH: unset or unknown is off for everyone, owner opens it to owners, on to every member");
  const toml = fs.readFileSync(path.join(ROOT, "wrangler.toml"), "utf8");
  ok(/^FLOWS_IPO = "owner"$/m.test(toml), "and it ships owner: members see it only once it has been read on real data");
}

async function open(browser, viewport, payload, patch = null) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: SHOTS ? 2 : 1, reducedMotion: "reduce" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.clock.install({ time: NOW });
  const html = eventsPage({ username: "test", ipo: true });
  await page.routeWebSocket(/\/api\/rt\/ws/, (ws) => ws.close({ code: 4011, reason: "off" }));
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
      if (patch && patch[u.pathname]) {
        let src = fs.readFileSync(f, "utf8");
        for (const [from, to] of patch[u.pathname]) {
          if (src.split(from).length !== 2) throw new Error("planted build anchor must match exactly once: " + from);
          src = src.replace(from, () => to);
        }
        return route.fulfill({ body: src, contentType: MIME[path.extname(f)] });
      }
      return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname === "/api/flows/events") return route.fulfill({ contentType: "application/json", headers: { "X-Payload-Updated": String(NOW - 6e4) }, body: JSON.stringify(payload) });
    if (u.pathname.startsWith("/api/rt/")) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "rt_off", message: "off" } }) });
    if (u.pathname.startsWith("/api/")) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "pending", rows: [] }) });
    if (u.pathname.startsWith("/flows/")) return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
    return route.fulfill({ status: 404, body: "" });
  });
  await page.goto("https://example.test/flows/events/#view=ipo");
  await page.waitForFunction(() => !/^Loading/.test(document.getElementById("evStatus").textContent), null, { timeout: 20000 });
  await page.waitForTimeout(600);
  return { context, page, errors };
}

const READ = () => {
  const host = document.getElementById("evIpo");
  const card = host.closest(".fd-mod");
  const rows = [...host.querySelectorAll(".fe-irow:not(.fu-head)")].map((r) => {
    const c = [...r.children];
    return { when: c[0].textContent.trim(), whenTitle: c[0].title, t: c[1].querySelector("b").textContent.trim(), name: (c[1].querySelector("small") || { textContent: "" }).textContent.trim(),
      ex: c[2].textContent.trim(), range: c[3].textContent.trim(), rangeTitle: c[3].title, rangeLabel: c[3].getAttribute("aria-label") };
  });
  return { state: card.dataset.state, rows, text: host.textContent, on: card.hasAttribute("data-on"), view: document.getElementById("fdStage").dataset.view };
};

const MEASURE = () => {
  const d = document.documentElement;
  const m = document.querySelector(".fd-mod[data-on]");
  const r = m.getBoundingClientRect();
  const clip = [];
  for (const e of m.querySelectorAll("*")) {
    if (e.closest("dialog, [hidden], .fd-cut, svg")) continue;
    const q = e.getBoundingClientRect();
    if (q.height && q.width && (q.bottom > r.bottom + 1 || q.right > r.right + 1)) clip.push(e.tagName.toLowerCase() + "." + String(e.className).slice(0, 24));
    const cs = getComputedStyle(e);
    if (e.children.length === 0 && e.textContent.trim() && cs.overflow === "hidden" && cs.textOverflow !== "ellipsis" && (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1)) clip.push("cut text " + e.textContent.trim().slice(0, 20));
  }
  const lefts = (row) => row ? [...row.children].filter((c) => getComputedStyle(c).display !== "none").map((c) => Math.round(c.getBoundingClientRect().left)) : [];
  const head = lefts(document.querySelector("#evIpo .fe-irow.fu-head"));
  const first = lefts(document.querySelector("#evIpo .fe-irow:not(.fu-head)"));
  return { sh: d.scrollHeight, ih: innerHeight, sw: d.scrollWidth, iw: innerWidth, inner: m.scrollHeight > m.clientHeight + 1, clip, aligned: head.length === first.length && head.every((x, i) => Math.abs(x - first[i]) <= 1), head, first };
};

const EXPECT = IPO.rows.map((r) => r.t);
const dollars = (lo, hi) => "$" + lo.toFixed(2) + "–$" + hi.toFixed(2);

async function battery(browser, patch = null, size = SIZES[1]) {
  const bad = [];
  const { context, page, errors } = await open(browser, size, withIpo(IPO), patch);
  const shape = await page.evaluate(MEASURE);
  if (!shape.aligned) bad.push("headings off their columns " + shape.head + " / " + shape.first);
  const got = await page.evaluate(READ);
  if (!got.on || got.view !== "ipo") bad.push("the address opens the IPOs tab");
  if (got.state !== "ok") bad.push("state " + got.state);
  if (got.rows.map((r) => r.t).join() !== EXPECT.join()) bad.push("rows " + got.rows.map((r) => r.t).join());
  for (const [i, r] of got.rows.entries()) {
    const x = IPO.rows[i];
    if (!x) continue;
    if (x.why === null && x.cur === "USD" && r.range !== dollars(x.lo, x.hi)) bad.push(x.t + " range " + r.range);
    if (x.why === null && x.cur !== "USD" && r.range !== x.lo.toFixed(2) + "–" + x.hi.toFixed(2) + " " + x.cur) bad.push(x.t + " range " + r.range);
    if (x.why !== null && (r.range !== "—" || !r.rangeTitle || !/^None: /.test(r.rangeLabel || ""))) bad.push(x.t + " withheld range " + r.range + " / " + r.rangeTitle);
    if (r.whenTitle !== "In " + x.dd + " calendar " + (x.dd === 1 ? "day" : "days")) bad.push(x.t + " days " + r.whenTitle);
    if (r.name !== x.name) bad.push(x.t + " name " + r.name);
  }
  if (errors.length) bad.push("page error " + errors.join(" | "));
  await context.close();
  return bad;
}

const browser = await launch({});
try {
  {
    const bad = await battery(browser);
    eq(bad, [], "THE IPO TAB PRINTS THE SHAPED CALENDAR: every row in order, each range in its currency or a dash with its reason, each day count");
    const { context, page } = await open(browser, SIZES[1], withIpo(IPO));
    const got = await page.evaluate(READ);
    eq(got.rows[0].range, "$14.00–$16.00", "a dollar range reads as two prices");
    eq(got.rows[5].range, "4.00–5.00 EUR", "a range in another currency names it and carries no dollar sign");
    ok(/no currency/.test(got.rows[3].rangeTitle) && /not two positive, ordered ends/.test(got.rows[4].rangeTitle) && /no price range/.test(got.rows[2].rangeTitle), "each withheld range says why");
    ok(!/\b0\.00\b/.test(got.text), "no withheld range is printed as zero");
    ok(!/vendor|\btape\b|Eastern|\bET\b/.test(got.text), "the module's copy names no vendor, no barred word and no other clock");
    await page.click("#evIpoCard .ui-info");
    await page.waitForTimeout(250);
    const info = await page.evaluate(() => (document.querySelector("#fxPop") || document.querySelector("dialog[open]") || document.body).textContent);
    ok(/Inside the horizon/.test(info) && /moved or pulled/.test(info) && !/vendor/.test(info), "the info panel states the counts and that a date can move, in the site's own words");
    await context.close();
  }

  for (const [label, ipo, state, why] of [
    ["not on the payload", undefined, "pending", /pending/],
    ["switched off", { status: "unavailable", reason: "not_read", why: "off" }, "unavailable", /switch is off/],
    ["unreadable", { status: "unavailable", reason: "unreadable", http: 503 }, "unavailable", /not measured \(unreadable, HTTP 503\)/],
    ["quiet", { status: "quiet", reason: "absent", rows: [] }, "quiet", /dates no listing inside the horizon/],
  ]) {
    const { context, page } = await open(browser, SIZES[1], withIpo(ipo));
    const got = await page.evaluate(READ);
    eq(got.state, state, `${label}: the module is ${state}`);
    ok(got.rows.length === 0 && !/\b0\b/.test(got.text), `${label}: it draws no rows and no zero`);
    await page.click("#evIpo .ui-silent button");
    await page.waitForTimeout(250);
    const said = await page.evaluate(() => (document.querySelector("#fxPop") || document.body).textContent);
    ok(why.test(said) && !/vendor/.test(said), `${label}: its Why says so in the site's own words (${said.slice(0, 120)})`);
    await page.keyboard.press("Escape");
    await context.close();
  }

  for (const size of SIZES) {
    const { context, page, errors } = await open(browser, size, withIpo(IPO));
    const m = await page.evaluate(MEASURE);
    const label = `${size.width}x${size.height}`;
    ok(m.sh <= m.ih + 1 && m.sw <= m.iw, `ONE SCREEN ${label}: the page does not scroll (${m.sh}/${m.ih}, ${m.sw}/${m.iw})`);
    ok(!m.inner, `${label}: the module does not scroll inside`);
    eq(m.clip, [], `${label}: nothing in the module is cut`);
    ok(m.aligned, `${label}: each column heading stands over its column (${m.head} against ${m.first})`);
    ok(!errors.length, `${label}: no page error`);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `events-ipo-${label}.png`) });
    await context.close();
  }

  const PLANTS = [
    ["listings with a withheld range dropped", { "/assets/js/flows-events.js": [["const rows = (payload.ipo.rows || []).filter((r) => r && ISO.test(String(r.d || \"\")));", "const rows = (payload.ipo.rows || []).filter((r) => r && !r.why && ISO.test(String(r.d || \"\")));"]] }],
    ["a withheld range with no reason", { "/assets/js/flows-events.js": [["return h(\"span\", { class: \"fu-v\", title: why, \"aria-label\": \"None: \" + why }, DASH);", "return h(\"span\", { class: \"fu-v\" }, DASH);"]] }],
    ["every range read as dollars", { "/assets/js/flows-events.js": [["const text = r.cur === \"USD\" ?", "const text = true ?"]] }],
    ["the tab never painted", { "/assets/js/flows-events.js": [["    paintIpo(payload);\n", ""]] }],
    ["the venue heading left on a phone", { "/assets/css/flows-feeds.css": [[".fe-irow > .fe-iex, .fe-irow.fu-head > :nth-child(3) { display: none; }", ".fe-irow > .fe-iex { display: none; }"]] }, SIZES[3]],
    ["the day count off by one", { "/assets/js/flows-events.js": [["title: dd === null ? null : \"In \" + days(dd) }", "title: dd === null ? null : \"In \" + days(dd + 1) }"]] }],
  ];
  eq(await battery(browser, null, SIZES[3]), [], "the battery passes the correct build on a phone too");
  for (const [name, patch, size] of PLANTS) {
    const bad = await battery(browser, patch, size);
    ok(bad.length > 0, `PLANTED: ${name} fails the battery`);
  }
} finally {
  await browser.close();
}

console.log(`✓ flows-events-ipo-render: ${checks} assertions — the Events page's IPOs tab behind FLOWS_IPO (owner by default, absent and byte-identical off), every row printed from the shaped calendar with its range in its own currency or a dash with its reason, the pending, off, unreadable and quiet states, one screen at four sizes with nothing cut, and planted wrong builds of the served script that each fail`);
