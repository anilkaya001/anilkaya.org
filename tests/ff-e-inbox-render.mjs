import fs from "node:fs";
import path from "node:path";
import { launch } from "./lib/browser.mjs";
import { COPY_BANNED, LIMITS } from "../shared/ff-contract.js";
import { evidenceRows } from "../shared/ff-sentence.js";
import { INBOX_SHADOW_LINE } from "../shared/ff-pages-inbox.js";
import { mount as mountRaw, apiFor, evidenceOf, health, hitRows, ROOT, SIZES, STANDARD } from "./lib/ff-e-inbox-world.mjs";

let checks = 0;
const failures = [];
const ok = (c, m) => { checks++; if (!c) failures.push(m); };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + " (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")");
let PATCH = {};
const mount = (b, w, h, o = {}) => mountRaw(b, w, h, { ...PATCH, ...o });
const DASH = "—";
const BANNED = new RegExp("\\b(" + COPY_BANNED.join("|") + ")\\b", "i");
const CLOCK = /\b\d{1,2}:\d{2}(?!\d)(?!:)(?! TRT)/;
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const INBOX_JS = "assets/js/flows-ff-inbox.js";
const EVIDENCE_JS = "assets/js/flows-ff-evidence.js";
const INBOX_CSS = "assets/css/flows-ff-inbox.css";
const plant = (file, from, to) => {
  const src = read(file);
  if (src.split(from).length !== 2) throw new Error("plant anchor must occur exactly once in " + file + ": " + from.slice(0, 70));
  return { path: file, body: src.replace(from, to) };
};
const handled = (api) => (x) => api.handle(x);
const SD = (t) => String(t).replace(/\s*σ/g, " SD");

const visibleText = (page) => page.evaluate(() => {
  const out = [];
  const walk = document.createTreeWalker(document.querySelector(".flows-main"), NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const e = n.parentElement;
    if (!e || e.closest("script,style,[hidden],dialog:not([open]),.visually-hidden")) continue;
    const r = e.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    const t = n.textContent.trim();
    if (t) out.push(t);
  }
  return out.join(" | ");
});

const geometry = (page) => page.evaluate(() => {
  const bad = [];
  const root = document.getElementById("ffxInbox");
  if (document.documentElement.scrollHeight > innerHeight + 1) bad.push("page scrolls vertically " + document.documentElement.scrollHeight + " > " + innerHeight);
  if (document.documentElement.scrollWidth > innerWidth + 1) bad.push("page scrolls sideways");
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
  for (const e of root.querySelectorAll(".ffx-ib-panel")) {
    if (!vis(e)) continue;
    const r = e.getBoundingClientRect();
    if (r.bottom > innerHeight + 1 || r.right > innerWidth + 1) bad.push("panel outside the screen: " + e.id);
  }
  for (const e of root.querySelectorAll("*")) {
    if (!vis(e) || e.closest("dialog")) continue;
    const cs = getComputedStyle(e);
    if ((cs.overflowY === "auto" || cs.overflowY === "scroll") && e.scrollHeight > e.clientHeight + 1) bad.push("inner scroll " + e.className);
    if (cs.textOverflow === "ellipsis" && e.scrollWidth > e.clientWidth + 1 && !e.title && !e.closest("[title]")) bad.push("truncated with no title: " + (e.textContent || "").slice(0, 40));
    const panel = e.closest(".ffx-ib-panel");
    if (panel && e !== panel) {
      const p = panel.getBoundingClientRect();
      const r = e.getBoundingClientRect();
      if (r.bottom > p.bottom + 1 && !e.closest(".ffx-cut")) bad.push("leaves its panel: " + e.className + " " + (e.textContent || "").slice(0, 30));
    }
  }
  return bad;
});

const S = {};

S.layout = async (b) => {
  for (const [w, h] of SIZES) {
    const api = apiFor({ total: 200, groupOf: 5 });
    const m = await mount(b, w, h, { api: handled(api) });
    const bad = await geometry(m.page);
    eq(bad, [], `${w}x${h}: one screen, nothing cut without a title, no inner scroll`);
    if (w < 1100) {
      await m.page.click("#ffxIbList .ffx-ib-row[data-ff-hit]");
      await m.page.waitForSelector("#ffxIbHit .ffx-ib-ev", { timeout: 6000 });
      await m.page.waitForTimeout(300);
      eq(await geometry(m.page), [], `${w}x${h}: the hit panel fits too`);
    }
    const cut = await m.page.evaluate(() => document.querySelectorAll("#ffxIbList .ffx-cut").length);
    const shown = await m.page.evaluate(() => [...document.querySelectorAll("#ffxIbList .ffx-ib-li")].filter((e) => !e.classList.contains("ffx-cut")).length);
    ok(shown >= 1, `${w}x${h}: at least one row is shown`);
    if (cut) ok(!(await m.page.isHidden("#ffxIbAll")) && /more below/.test(await m.page.textContent("#ffxIbMore")), `${w}x${h}: rows cut to fit are counted and Show all is offered`);
    ok(m.errors.length === 0, `${w}x${h}: no page error ${m.errors.join(";")}`);
    await m.ctx.close();
  }
  for (const [w, h] of STANDARD) {
    for (const [name, o] of [["shadow", { api: handled(apiFor({ shadowApi: true })), shadow: true }], ["empty", { api: handled(apiFor({ total: 0 })) }], ["failed", { api: (x) => (x.path === "/api/ff/hits" ? x.json({ error: { code: "service_unavailable", message: "Service is temporarily unavailable" } }, 503) : apiFor().handle(x)) }]]) {
      const m = await mount(b, w, h, o);
      eq(await geometry(m.page), [], `${w}x${h} ${name}: one screen`);
      await m.ctx.close();
    }
  }
};

S.list = async (b) => {
  const api = apiFor({ total: 40, groupOf: 5, withdrawn: [7] });
  const m = await mount(b, 1440, 820, { api: handled(api) });
  const first = api.world.rows.slice(0, 30).map(api.world.view);
  const rows = await m.page.evaluate(() => [...document.querySelectorAll("#ffxIbList .ffx-ib-row")].map((r) => ({
    id: r.getAttribute("data-ff-hit"), group: r.getAttribute("data-group"), unread: r.hasAttribute("data-unread"), withdrawn: r.hasAttribute("data-withdrawn"),
    sent: r.querySelector(".ffx-ib-sent").textContent, at: r.querySelector(".ffx-ib-at").textContent, chip: r.querySelector(".ffx-ib-chip").textContent,
  })));
  const counts = new Map();
  for (const h of first) counts.set(h.wire.id + "|" + h.session, (counts.get(h.wire.id + "|" + h.session) || 0) + 1);
  const want = [];
  const seen = new Set();
  for (const h of first) {
    const k = h.wire.id + "|" + h.session;
    if (counts.get(k) > LIMITS.groupInboxAfter) { if (!seen.has(k)) { seen.add(k); want.push("group:" + k + ":" + counts.get(k)); } } else want.push(h.id);
  }
  const groupKey = first[0].wire.id + "|" + first[0].session;
  ok(counts.get(groupKey) > LIMITS.groupInboxAfter && rows[0].group === groupKey && rows[0].sent.includes(counts.get(groupKey) + " hits this session"), `more than ${LIMITS.groupInboxAfter} hits of one wire in one session are one group row`);
  eq(rows.map((r) => (r.group ? "group:" + r.group + ":" + counts.get(r.group) : r.id)), want, "the rows keep the API's order with each large group folded where it first appears");
  const groupSize = counts.get(groupKey);
  const byId = new Map(first.map((h) => [h.id, h]));
  for (const r of rows.filter((x) => !x.group)) {
    const h = byId.get(r.id);
    ok(r.sent === SD(h.sentence) && r.at === h.at.text, "a row prints the hit's own sentence and session label " + r.id);
    ok(r.unread === h.unread, "the unread marker follows the stream cursor " + r.id);
    ok(r.chip === (h.kind === "house" ? "House" : "Yours"), "the chip says whose stream " + r.id);
    ok(r.withdrawn === Boolean(h.withdrawn), "a withdrawn hit is marked as withdrawn " + r.id);
  }
  ok(rows.every((r) => !/^0 /.test(r.sent)), "no row is a zero placeholder");
  await m.page.click("#ffxIbList .ffx-ib-group");
  const expanded = await m.page.evaluate(() => [...document.querySelectorAll("#ffxIbList .ffx-ib-row")].map((r) => r.getAttribute("data-ff-hit")));
  eq(expanded.slice(0, groupSize), first.filter((h) => h.wire.id + "|" + h.session === groupKey).map((h) => h.id), "a group opens into its own hits");
  const q = m.calls.filter((c) => c.path === "/api/ff/hits" && !/id=/.test(c.query));
  ok(q.length === 1 && /state=all/.test(q[0].query) && /limit=30/.test(q[0].query), "the list asks for one page of the member's hits");
  await m.page.click("#ffxIbF-unread");
  await m.page.waitForTimeout(300);
  ok(m.calls.some((c) => c.path === "/api/ff/hits" && /state=unread/.test(c.query)), "Unread asks the stream for unread hits");
  await m.page.focus("#ffxIbF-unread");
  await m.page.keyboard.press("ArrowRight");
  await m.page.waitForTimeout(300);
  ok(await m.page.evaluate(() => document.activeElement.id === "ffxIbF-pinned" && document.activeElement.getAttribute("aria-selected") === "true"), "the arrow keys move between the filters");
  ok(m.calls.some((c) => /state=pinned/.test(c.query)), "and read the chosen one");
  await m.page.click("#ffxIbF-all");
  await m.page.waitForTimeout(300);
  await m.page.click("#ffxIbAll");
  await m.page.waitForSelector("#ffxIbAllDlg[open]");
  ok(!(await m.page.isHidden("#ffxIbLoad")), "Show all offers the next page when the stream has more");
  await m.page.click("#ffxIbLoad");
  await m.page.waitForTimeout(400);
  ok(m.calls.some((c) => c.path === "/api/ff/hits" && /cursor=30/.test(c.query)), "Load more sends the API's own cursor");
  ok(await m.page.evaluate(() => window.FlowsUI.ffInbox.page.state().hits) === 40, "and appends the next page");
  ok(m.errors.length === 0, "list: no page error " + m.errors.join(";"));
  await m.ctx.close();
};

S.detail = async (b) => {
  const api = apiFor({ total: 12 });
  const m = await mount(b, 1440, 820, { api: handled(api) });
  await m.page.waitForSelector("#ffxIbHit .ffx-ib-ev");
  const r0 = api.world.rows[0];
  const d = api.world.detail(r0);
  ok((await m.page.textContent("#ffxIbHit .ffx-ib-big")) === SD(d.sentence), "the hit shows the sentence of the version that fired it");
  ok(/version 2 · the wire is at version 3 now/.test(await m.page.textContent("#ffxIbHit .ffx-ib-facts")), "an old version's hit says the wire has moved on");
  const want = evidenceRows(evidenceOf(0)).map((r) => [r.label, SD(r.value), SD(r.op + " " + r.threshold), r.baseline === null ? DASH : r.baseline + (r.floored ? " · denominator floored" : "")]);
  const got = await m.page.evaluate(() => [...document.querySelectorAll("#ffxIbHit .ffx-ib-ev tbody tr")].map((tr) => [...tr.children].map((c) => c.textContent)));
  eq(got, want, "the evidence table equals the server's formatting of the frozen clauses");
  const recs = await m.page.evaluate(() => [...document.querySelectorAll("#ffxIbHit .ffx-ib-rc")].filter((e) => !e.classList.contains("ffx-cut")).map((e) => e.querySelector(".ffx-ib-rl").textContent));
  ok(recs[0] === "evaluated · 1 hit, 2 more over the cap" && recs[1] === DASH + " not evaluated: run_late", "receipts say evaluated or not evaluated with the reason, and the hits over the cap");
  ok(m.calls.some((c) => c.path === "/api/ff/receipts" && c.query.includes("wire=" + r0.wire_id)), "the receipts are the selected hit's wire");
  ok(new URL(m.page.url()).searchParams.get("hit") === r0.hit_id, "the address carries the selected hit");
  await m.page.click("#ffxIbHit .ffx-ib-act >> text=Pin");
  await m.page.waitForTimeout(300);
  const pin = m.calls.find((c) => c.path === "/api/ff/hits" && c.method === "POST");
  eq(pin && pin.body, { id: r0.hit_id, mark: "pinned" }, "Pin sends the hit's id and the mark");
  ok((await m.page.getAttribute("#ffxIbHit .ffx-ib-act >> text=Pin", "aria-pressed")) === "true", "and the button says it is pressed");
  ok(m.calls.every((c) => !c.body || !("member" in c.body) && !("member_id" in c.body)), "no request names the member");
  ok(m.errors.length === 0, "detail: no page error " + m.errors.join(";"));
  await m.ctx.close();
  const target = api.world.rows[9].hit_id;
  const m2 = await mount(b, 390, 844, { api: handled(apiFor({ total: 12 })), search: "?hit=" + target });
  await m2.page.waitForSelector("#ffxIbHit .ffx-ib-ev");
  ok((await m2.page.getAttribute("#ffxInbox", "data-view")) === "hit" && (await m2.page.textContent("#ffxIbHit .ffx-ib-hsym")) === api.world.rows[9].symbol, "a deep link opens that hit, on a phone in the hit panel");
  await m2.ctx.close();
  const m3 = await mount(b, 1440, 820, { api: handled(apiFor({ total: 3 })), search: "?hit=" + "z".repeat(20) });
  await m3.page.waitForTimeout(300);
  ok(/— unavailable: no such hit/.test(await m3.page.textContent("#ffxIbHit")), "a hit that is not on the account says so");
  await m3.ctx.close();
};

S.readAll = async (b) => {
  const api = apiFor({ total: 20 });
  const m = await mount(b, 1440, 820, { api: handled(api) });
  ok(!(await m.page.isDisabled("#ffxIbRead")), "Mark all read is offered while hits are unread");
  await m.page.click("#ffxIbRead");
  await m.page.waitForTimeout(400);
  eq(api.state.read, { readSeq: api.world.heads.m, houseReadSeq: api.world.heads.h }, "Mark all read moves both cursors to the stream heads this page read, never past them");
  const ev = await m.page.evaluate(() => window.__ffEvents.filter((e) => e.name === "ff:read").map((e) => e.detail));
  eq(ev, [{ stream: "member", seq: api.world.heads.m }, { stream: "house", seq: api.world.heads.h }], "it announces ff:read for each stream with its sequence");
  ok(await m.page.evaluate(() => document.querySelectorAll("#ffxIbList [data-unread]").length) === 0, "and no row is unread afterwards");
  ok((await m.page.textContent("#ffxIbCap")) === "Nothing unread" && (await m.page.isDisabled("#ffxIbRead")), "the caption reads the server's unread count");
  await m.ctx.close();
};

S.states = async (b) => {
  {
    const m = await mount(b, 1440, 820, { api: handled(apiFor({ shadowApi: true })), shadow: true });
    ok((await m.page.textContent("#ffxIbBanner")) === INBOX_SHADOW_LINE && !(await m.page.isHidden("#ffxIbBanner")), "in shadow the banner says hits are held");
    const st = await m.page.textContent("#ffxIbState");
    ok(/^— held: running in shadow/.test(st) && (await m.page.getAttribute("#ffxIbState", "data-ff-absent")) === "held", "the list says hits are held, never that there are none");
    ok(await m.page.isDisabled("#ffxIbRead"), "nothing is marked read in shadow");
    ok((await m.page.textContent("#ffxIbCap")) === "Shadow · hits are held", "the caption says held");
    ok(!m.calls.some((c) => c.path === "/api/ff/read"), "and no cursor is written");
    await m.ctx.close();
  }
  {
    const m = await mount(b, 1440, 820, { api: handled(apiFor({ shadowApi: true })) });
    ok(/^— held/.test(await m.page.textContent("#ffxIbState")) && !(await m.page.isHidden("#ffxIbBanner")), "an API that answers in shadow turns the page to held too");
    await m.ctx.close();
  }
  {
    const m = await mount(b, 1440, 820, { api: handled(apiFor({ total: 0 })) });
    ok(/^No hits yet\./.test(await m.page.textContent("#ffxIbState")) && (await m.page.textContent("#ffxIbCount")) === "0 hits", "an empty stream says so plainly");
    await m.page.click("#ffxIbF-pinned");
    await m.page.waitForTimeout(300);
    ok((await m.page.textContent("#ffxIbState")) === "No pinned hits.", "each filter has its own empty line");
    await m.ctx.close();
  }
  {
    let fail = true;
    const api = apiFor({ total: 6 });
    const m = await mount(b, 1440, 820, { api: (x) => (fail && x.path === "/api/ff/hits" && x.method === "GET" && !/id=/.test(x.query) ? x.json({ error: { code: "service_unavailable", message: "Service is temporarily unavailable" } }, 503) : api.handle(x)) });
    const st = await m.page.textContent("#ffxIbState");
    ok(/^— unavailable: /.test(st) && !(await m.page.isHidden("#ffxIbRetry")), "a failed read is a dash with its reason and a Retry");
    ok(!/\b0\b/.test(st), "and never a zero");
    fail = false;
    await m.page.click("#ffxIbRetry");
    await m.page.waitForTimeout(400);
    ok((await m.page.evaluate(() => document.querySelectorAll("#ffxIbList .ffx-ib-row").length)) === 6, "Retry reads again");
    await m.ctx.close();
  }
  {
    const api = apiFor({ total: 6 });
    let release;
    const gate = new Promise((r) => { release = r; });
    const m = await mount(b, 1440, 820, { wait: false, settle: 200, api: async (x) => { if (x.path === "/api/ff/hits" && !/id=/.test(x.query)) await gate; return api.handle(x); } });
    ok((await m.page.textContent("#ffxIbState")) === DASH + " reading your hits" && (await m.page.getAttribute("#ffxIbState", "data-ff-absent")) === "reading", "while loading the list says it is reading");
    ok(!/\b0 hits\b/.test(await visibleText(m.page)), "loading shows no count of zero");
    release();
    await m.page.waitForTimeout(400);
    await m.ctx.close();
  }
  {
    const m = await mount(b, 1440, 820, { api: (x) => (x.path === "/api/ff/hits" ? x.json({ error: { code: "ff_off", message: "Fire & Forget is off", details: { reason: "route_off" } } }, 404) : apiFor().handle(x)) });
    ok(/^— unavailable: Fire & Forget is off \(route off\)/.test(await m.page.textContent("#ffxIbState")), "an off route says it is off, never an empty list");
    await m.ctx.close();
  }
};

S.health = async (b) => {
  {
    const m = await mount(b, 1440, 820, { api: handled(apiFor()) });
    const hv = health();
    ok((await m.page.getAttribute("#ffxIbHealth", "data-ff-state")) === hv.state && hv.state === "resting", "the health strip carries the evaluator's state");
    ok((await m.page.textContent("#ffxIbHealthLine")) === hv.line, "and its line");
    ok((await m.page.textContent("#ffxIbHealthNightly")) === "Nightly " + hv.evaluator.nightly.finishedAt.text, "and the last nightly run");
    ok((await m.page.textContent("#ffxIbHealthLive")) === "Live " + DASH + " " + hv.evaluator.live.lastOkAt.reasonText, "and the live loop as a dash with its reason");
    ok((await m.page.textContent("#ffxIbCap")) === hv.unread.label + " unread · " + hv.unread.member + " yours · " + hv.unread.house + " house", "the caption reads the unread counts");
    await m.page.evaluate(() => document.dispatchEvent(new CustomEvent("ff:health", { detail: { state: "degraded", evaluator: {} } })));
    ok((await m.page.getAttribute("#ffxIbHealth", "data-ff-state")) === "degraded", "the strip listens to ff:health");
    await m.page.evaluate(() => document.dispatchEvent(new CustomEvent("ff:unread", { detail: { house: 1, member: 2, total: 3 } })));
    ok((await m.page.textContent("#ffxIbCap")) === "3 unread · 2 yours · 1 house", "and the caption to ff:unread");
    ok(m.calls.filter((c) => c.path === "/api/ff/health").length === 1, "the inbox reads health once and does not poll");
    await m.ctx.close();
  }
  {
    const m = await mount(b, 1440, 820, { api: (x) => (x.path === "/api/ff/health" ? x.json({ error: { code: "internal_error", message: "Internal server error" } }, 500) : apiFor().handle(x)) });
    ok((await m.page.getAttribute("#ffxIbHealth", "data-ff-state")) === "down" && /^— health unavailable/.test(await m.page.textContent("#ffxIbHealthLine")), "an unreachable health endpoint is down, with its reason");
    await m.ctx.close();
  }
};

S.copy = async (b) => {
  for (const o of [{ api: handled(apiFor({ total: 30, groupOf: 5 })) }, { api: handled(apiFor({ shadowApi: true })), shadow: true }]) {
    const m = await mount(b, 1440, 820, o);
    await m.page.waitForTimeout(300);
    const text = await visibleText(m.page);
    const banned = text.match(BANNED);
    ok(!banned, "no banned word in the copy: " + (banned && banned[0]));
    const clock = text.match(CLOCK);
    ok(!clock, "every clock time is in TRT: " + (clock && text.slice(Math.max(0, clock.index - 30), clock.index + 20)));
    const info = await m.page.evaluate(() => document.getElementById("ffxIbInfo").textContent);
    ok(!BANNED.test(info) && !/\btape\b/i.test(text + info), "the info sheet holds no banned word");
    await m.ctx.close();
  }
};

S.keys = async (b) => {
  const m = await mount(b, 1440, 820, { api: handled(apiFor({ total: 10 })) });
  await m.page.focus("#ffxIbList .ffx-ib-row");
  await m.page.keyboard.press("ArrowDown");
  const second = await m.page.evaluate(() => document.querySelectorAll("#ffxIbList .ffx-ib-row")[1].getAttribute("data-ff-hit"));
  ok(await m.page.evaluate((id) => document.activeElement.getAttribute("data-ff-hit") === id, second), "the arrow keys move down the list");
  await m.page.keyboard.press("Enter");
  await m.page.waitForTimeout(300);
  ok(new URL(m.page.url()).searchParams.get("hit") === second, "Enter opens the focused hit");
  await m.page.click("#ffxIbInfoBtn");
  ok(await m.page.evaluate(() => document.getElementById("ffxIbInfo").open && document.activeElement && document.getElementById("ffxIbInfo").contains(document.activeElement)), "the info sheet is a modal dialog that takes focus");
  await m.page.keyboard.press("Escape");
  ok(await m.page.evaluate(() => document.activeElement.id === "ffxIbInfoBtn"), "Escape returns focus to its button");
  await m.ctx.close();
  const p = await mount(b, 390, 844, { api: handled(apiFor({ total: 10 })) });
  await p.page.focus("#ffxIbTabHits");
  await p.page.keyboard.press("ArrowRight");
  ok((await p.page.getAttribute("#ffxInbox", "data-view")) === "hit", "on a phone the arrow keys switch the panels");
  await p.ctx.close();
};

const PLANTS = [
  ["Mark all read sends all and swallows hits that arrived after the read", ["readAll"], () => ({ js: plant(INBOX_JS, "var asked = { readSeq: S.heads.m, houseReadSeq: S.heads.h };", "var asked = { all: true, readSeq: 1e15, houseReadSeq: 1e15 };") })],
  ["the house cursor is not moved", ["readAll"], () => ({ js: plant(INBOX_JS, "var asked = { readSeq: S.heads.m, houseReadSeq: S.heads.h };", "var asked = { readSeq: S.heads.m, houseReadSeq: 0 };") })],
  ["ff:read is never announced", ["readAll"], () => ({ js: plant(INBOX_JS, 'hooks.emit("ff:read", { stream: "house", seq: c.houseReadSeq });', "void 0;") })],
  ["shadow prints an empty inbox", ["states"], () => ({ js: plant(INBOX_JS, 'setState(DASH + " held: running in shadow. Hits are evaluated and stored as held; none is delivered yet.", "shadow", "held");', 'setState(emptyText(), "empty", null);') })],
  ["a failed read is an empty inbox", ["states"], () => ({ js: plant(INBOX_JS, 'setState(errText(S.error), "failed", S.error && S.error.code === "ff_off" ? "off" : "unavailable");', 'setState(emptyText(), "empty", null);') })],
  ["loading counts zero hits", ["states"], () => ({ js: plant(INBOX_JS, 'setState(DASH + " reading your hits", "loading", "reading");\n      count.textContent = "";', 'setState(DASH + " reading your hits", "loading", "reading");\n      count.textContent = "0 hits";') })],
  ["hits are never grouped", ["list"], () => ({ js: plant(INBOX_JS, "if (groups[k].length > GROUP_AFTER && !S.expanded[k]) {", "if (false) {") })],
  ["the unread marker is drawn on every row", ["list"], () => ({ js: plant(INBOX_JS, '"data-unread": h.unread ? "1" : null,', '"data-unread": "1",') })],
  ["Load more restarts from the top", ["list"], () => ({ js: plant(INBOX_JS, '(append && S.next ? "&cursor=" + encodeURIComponent(S.next) : "")', '""') })],
  ["the current version's sentence is shown for an old hit", ["detail"], () => ({ js: plant(INBOX_JS, 'if (w.isCurrent === false && w.currentVersion) wireLine += " · the wire is at version " + w.currentVersion + " now";', "void 0;") })],
  ["the evidence is printed raw", ["detail"], () => ({ js2: plant(EVIDENCE_JS, 'case "sigma": return F.px(v, 2) + " SD";', 'case "sigma": return String(v) + " SD";') })],
  ["an absent baseline is a zero", ["detail"], () => ({ js2: plant(EVIDENCE_JS, "baseline: n === null ? null :", 'baseline: n === null ? "0/20 sessions" :') })],
  ["receipts drop the not-evaluated reason", ["detail"], () => ({ js: plant(INBOX_JS, 'el("span", { class: "ffx-ib-rl", title: r.line || DASH, text: (r.line || DASH)', 'el("span", { class: "ffx-ib-rl", title: r.line || DASH, text: (r.status === "evaluated" ? r.line : "no hit")') })],
  ["health is never read", ["health"], () => ({ js: plant(INBOX_JS, "  paintCap();\n  readHealth();", "  paintCap();") })],
  ["an unreachable health endpoint looks fine", ["health"], () => ({ js: plant(INBOX_JS, '      if (hooks) hooks.state(healthBox, "down");\n      else healthBox.setAttribute("data-ff-state", "down");', "      void 0;") })],
  ["every row is drawn and the list scrolls", ["layout"], () => ({ css: plant(INBOX_CSS, ".ffx-ib-list { list-style: none; margin: 0; padding: 2px 6px; flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 2px; overflow: hidden; }", ".ffx-ib-list { list-style: none; margin: 0; padding: 2px 6px; flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 2px; overflow: auto; }"), js: plant(INBOX_JS, "var r = fit.rows(list, { keep: 1 });", "var r = { cut: 0 };") })],
  ["the phone shows both panels at once", ["layout"], () => ({ css: plant(INBOX_CSS, '.ffx-ib[data-view="hits"] .ffx-ib-hp, .ffx-ib[data-view="hit"] .ffx-ib-lp { display: none; }', "") })],
  ["the filters ignore the arrow keys", ["list"], () => ({ js: plant(INBOX_JS, 'var j = e.key === "ArrowRight" ? i + 1 :', 'var j = e.key === "ArrowRightX" ? i + 1 :') })],
  ["the member is sent with a mark", ["detail"], () => ({ js: plant(INBOX_JS, "var body = { id: h.id };", 'var body = { id: h.id, member: "x" };') })],
  ["a time without TRT in the copy", ["copy", "readAll"], () => ({ js: plant(INBOX_JS, 'if (!u.total) return { text: "Nothing unread", absent: null };', 'if (!u.total) return { text: "Nothing unread at 09:30", absent: null };') })],
];

const browser = await launch();
const production = process.env.FF_E_SKIPPROD ? [] : Object.keys(S);
const only = process.env.FF_E_ONLY ? process.env.FF_E_ONLY.split(",") : null;
for (const name of production) {
  if (only && !only.includes(name)) continue;
  const before = failures.length;
  try { await S[name](browser); } catch (e) { failures.push(name + " threw: " + (e.stack || e)); }
  console.log((failures.length === before ? "ok   " : "FAIL ") + name);
}
let survivors = 0;
if (process.env.FF_E_PLANTS && production.length === 0) {
  for (const [name, scenarios, opts] of PLANTS) {
    let patch;
    try { patch = opts(); } catch (err) { console.log("PLANT DID NOT APPLY: " + name + ": " + err.message); survivors++; continue; }
    PATCH = patch;
    const before = failures.length;
    const savedChecks = checks;
    for (const s of scenarios) { try { await S[s](browser); } catch (e) { failures.push("threw " + e.message); } }
    const caught = failures.length > before;
    failures.length = before;
    checks = savedChecks;
    PATCH = {};
    if (!caught) survivors++;
    console.log((caught ? "killed   " : "SURVIVED ") + name);
  }
  console.log(PLANTS.length + " planted wrong builds, " + survivors + " survived");
}
await browser.close();
for (const f of failures) console.log("not ok - " + f);
console.log(checks + " checks, " + failures.length + " failures");
process.exit(failures.length || survivors ? 1 : 0);
