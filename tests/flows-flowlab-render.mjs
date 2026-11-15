import assert from "node:assert/strict";
import { FX, SESSION, CONTRACT, open, launch, until, settle, memberBody, nightlyBodies } from "./lib/flowlab-world.mjs";
import { HttpError } from "../server/http.js";
import { LABELS, NOTES, STATES } from "../shared/flows-flowlab-copy.js";

const W = FX.worlds.normal;
const CHART_JS = "flows-chart.js";
const tagged = (e, kind, extra = {}) => Object.assign(e, { cause: { kind, status: null, bytes: null, cap: null, ms: 7, ...extra } });
const status503 = () => tagged(Object.assign(new HttpError(502, "chain_upstream", "x"), { upstream: 503 }), "status", { status: 503 });
const tooBig = () => tagged(new HttpError(502, "chain_too_large", "x"), "too_large", { bytes: 2283112 });
const readOf = (cls, extra = {}) => ({ op: "strike-flow-intraday", class: cls, status: null, bytes: null, cap: 4194304, ms: 9, ...extra });
const trtHM = (ms) => { const d = new Date(ms + 3 * 3600000); return String(d.getUTCHours()).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0"); };
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

const FLOWLAB_JS = "flows-flowlab.js";
const DRILL_JS = "flows-drill.js";

const CHECKS = {};

CHECKS["screen-order"] = async (browser, mutate) => {
  const bad = [];
  const s = await open(browser, { mutate });
  await until(s.page, () => !!document.querySelector("#flScreenB tbody tr"));
  const body = await memberBody("/api/flows/flowlab/screen?preset=premium", W);
  const rows = body.x.rows;
  const key = { premium: (r) => r.premC, voi: (r) => r.ratios.voi, nameShare: (r) => r.ratios.nameShare, askLo: (r) => r.ratios.askLo, sweepShare: (r) => r.ratios.sweepShare };
  for (const k of Object.keys(key)) {
    await s.page.evaluate((id) => document.querySelector('#flRank [data-rank="' + id + '"]').click(), k);
    await settle(s.page, 200);
    const got = await s.page.evaluate(() => [...document.querySelectorAll("#flScreenB tbody tr")].map((r) => r.getAttribute("data-c")));
    const have = rows.filter((r) => typeof key[k](r) === "number").sort((a, b) => key[k](b) - key[k](a) || b.premC - a.premC || (a.c < b.c ? -1 : 1));
    const lack = rows.filter((r) => typeof key[k](r) !== "number").sort((a, b) => b.premC - a.premC || (a.c < b.c ? -1 : 1));
    const want = have.concat(lack).map((r) => r.c);
    if (JSON.stringify(got) !== JSON.stringify(want)) bad.push("order by " + k + ": " + got.join() + " not " + want.join());
  }
  if (s.log.errors.length) bad.push("page errors " + s.log.errors[0]);
  await s.close();
  return bad;
};

CHECKS["ask-range"] = async (browser, mutate) => {
  const bad = [];
  const s = await open(browser, { mutate });
  await until(s.page, () => !!document.querySelector("#flScreenB tbody tr"));
  const body = await memberBody("/api/flows/flowlab/screen?preset=premium", W);
  const got = await s.page.evaluate(() => Object.fromEntries([...document.querySelectorAll("#flScreenB tbody tr")].map((r) => [r.getAttribute("data-c"), (r.querySelector(".c-ask .fl-rng-t") || {}).textContent || "none"])));
  for (const r of body.x.rows) {
    const x = r.ratios;
    if (x.askLo === null || x.askHi === null) { if (got[r.c] !== "none") bad.push("unbounded ask drawn for " + r.c); continue; }
    const lo = Math.floor(Number((x.askLo * 100).toFixed(6)));
    const hi = Math.ceil(Number((x.askHi * 100).toFixed(6)));
    const want = lo === hi ? lo + "%" : lo + "–" + hi + "%";
    if (got[r.c] !== want) bad.push("ask range " + r.c + " " + got[r.c] + " not " + want);
  }
  await s.close();
  return bad;
};

CHECKS["null-ratio"] = async (browser, mutate) => {
  const bad = [];
  const s = await open(browser, { mutate });
  await until(s.page, () => !!document.querySelector("#flScreenB tbody tr"));
  const body = await memberBody("/api/flows/flowlab/screen?preset=premium", W);
  const nulls = body.x.rows.filter((r) => r.ratios.voi === null).map((r) => r.c);
  if (!nulls.length) bad.push("fixture has no null ratio");
  const got = await s.page.evaluate((list) => list.map((c) => (document.querySelector('#flScreenB tr[data-c="' + c + '"] .c-voi') || {}).textContent), nulls);
  got.forEach((t, i) => { if (t !== "—") bad.push("null ratio of " + nulls[i] + " printed as " + t); });
  await s.close();
  return bad;
};

CHECKS["failed-state"] = async (browser, mutate) => {
  const bad = [];
  const s = await open(browser, { mutate, failing: ["screen"] });
  await until(s.page, () => !document.querySelector("#flScreenB .fl-wait"));
  await settle(s.page, 200);
  const r = await s.page.evaluate(() => ({ chip: !!document.querySelector('#flScreenB .fl-state[data-code="failed"] .ds-st'), table: !!document.querySelector("#flScreenB table tbody tr"), text: document.querySelector("#flScreenB").textContent }));
  if (!r.chip) bad.push("a failed read shows no state chip");
  if (r.table) bad.push("a failed read still draws rows");
  await s.close();
  return bad;
};

CHECKS["hash"] = async (browser, mutate) => {
  const bad = [];
  const s = await open(browser, { mutate });
  await until(s.page, () => !!document.querySelector("#flScreenB tbody tr"));
  await s.page.evaluate(() => document.querySelector('.fl-tab[data-view="strikes"]').click());
  await settle(s.page, 200);
  const h = await s.page.evaluate(() => location.hash);
  if (!/view=strikes/.test(h)) bad.push("tab not written to the address: " + h);
  const t = await open(browser, { mutate, url: "/flows/flowlab/#view=greeks&t=SYX101" });
  await until(t.page, () => !!document.querySelector("#flGreeksB svg"));
  const v = await t.page.evaluate(() => ({ input: document.getElementById("flT").value, on: document.querySelector(".fl-panel[data-on]").getAttribute("data-view") }));
  if (v.input !== "SYX101" || v.on !== "greeks") bad.push("address not read back: " + JSON.stringify(v));
  await s.close();
  await t.close();
  return bad;
};

CHECKS["drill-focus"] = async (browser, mutate) => {
  const bad = [];
  const s = await open(browser, { mutate });
  await until(s.page, () => !!document.querySelector("#flScreenB .fl-link"));
  await s.page.focus("#flScreenB .fl-link");
  const first = await s.page.evaluate(() => document.activeElement.getAttribute("data-c"));
  await s.page.keyboard.press("Enter");
  await until(s.page, () => !!document.querySelector(".dr-sheet[open] tbody tr"));
  const title = await s.page.evaluate(() => document.getElementById("drT").textContent);
  if (!/^SYX101 Nov 20 120 Call$/.test(title)) bad.push("sheet title " + title);
  const trap = await s.page.evaluate(() => document.querySelector(".dr-sheet").contains(document.activeElement));
  if (!trap) bad.push("focus not inside the sheet");
  await s.page.keyboard.press("Escape");
  await settle(s.page, 200);
  const back = await s.page.evaluate(() => ({ open: !!document.querySelector(".dr-sheet[open]"), c: document.activeElement.getAttribute("data-c") }));
  if (back.open) bad.push("Escape left the sheet open");
  if (back.c !== first) bad.push("focus did not return to " + first + ", it is on " + back.c);
  await s.close();
  return bad;
};

CHECKS["drill-prints"] = async (browser, mutate) => {
  const bad = [];
  const s = await open(browser, { mutate, url: "/flows/flowlab/#view=screen&c=" + CONTRACT });
  await until(s.page, () => !!document.querySelector(".dr-sheet[open] tbody tr"));
  const core = await memberBody("/api/flows/flowlab/contract?c=" + CONTRACT, W);
  const list = core.x.prints.x.list;
  const got = await s.page.evaluate(() => [...document.querySelectorAll(".dr-sheet tbody tr")].map((r) => ({ canceled: r.classList.contains("is-canceled"), side: !!r.querySelector(".ds-sg"), t: r.cells[0].textContent })));
  if (got.length !== list.length) bad.push("print rows " + got.length + " not " + list.length);
  list.forEach((p, i) => {
    if (!got[i]) return;
    if (p.canceled && (!got[i].canceled || got[i].side)) bad.push("canceled print " + i + " shown as live " + JSON.stringify(got[i]));
    if (!p.canceled && !got[i].side) bad.push("live print " + i + " has no side");
  });
  if (!list.some((p) => p.canceled)) bad.push("fixture has no canceled print");
  await s.close();
  return bad;
};

CHECKS["drill-tabs"] = async (browser, mutate) => {
  const bad = [];
  const s = await open(browser, { mutate, url: "/flows/flowlab/#view=screen&c=" + CONTRACT });
  await until(s.page, () => !!document.querySelector(".dr-sheet[open] tbody tr"));
  await s.page.focus('.dr-sheet [data-view="prints"]');
  await s.page.keyboard.press("ArrowRight");
  await until(s.page, () => document.querySelector('.dr-sheet [data-view="minutes"]').getAttribute("aria-selected") === "true");
  await until(s.page, () => !!document.querySelector(".dr-sheet svg path.ln"));
  const sel = await s.page.evaluate(() => [...document.querySelectorAll(".dr-sheet [role=tab]")].filter((b) => b.getAttribute("aria-selected") === "true").length);
  if (sel !== 1) bad.push("selected tabs " + sel);
  for (const k of ["profile", "alerts", "structure", "routing"]) {
    await s.page.evaluate((t) => document.querySelector('.dr-sheet [data-view="' + t + '"]').click(), k);
    await until(s.page, () => !document.querySelector(".dr-sheet .fl-wait"));
    const txt = await s.page.evaluate(() => document.querySelector(".dr-b").textContent);
    if (!txt.trim()) bad.push(k + " tab is empty");
    if (/\bNaN\b|\bundefined\b|\bnull\b|\[object/.test(txt)) bad.push(k + " tab prints a raw value: " + txt.slice(0, 80));
  }
  await s.close();
  return bad;
};

CHECKS["screen-lean"] = async (browser, mutate) => {
  const bad = [];
  const s = await open(browser, { mutate });
  await until(s.page, () => !!document.querySelector("#flScreenB tbody tr"));
  const body = await memberBody("/api/flows/flowlab/screen?preset=premium", W);
  const got = await s.page.evaluate(() => Object.fromEntries([...document.querySelectorAll("#flScreenB tbody tr")].map((r) => { const g = r.querySelector(".c-ask .ds-sg"); return [r.getAttribute("data-c"), g ? g.getAttribute("data-dir") + ":" + g.textContent : "none"]; })));
  const undecided = body.x.rows.filter((r) => r.ratios.lean === 0);
  if (!undecided.length) bad.push("fixture has no undecided row");
  for (const r of body.x.rows) {
    const want = r.ratios.lean === null ? "none" : r.ratios.lean === 0 ? "und:Undecided" : r.ratios.lean === 1 ? "up:Up" : "down:Down";
    if (got[r.c] !== want) bad.push("lean of " + r.c + " drawn " + got[r.c] + " not " + want);
  }
  await s.close();
  return bad;
};

CHECKS["strike-cells"] = async (browser, mutate) => {
  const bad = [];
  const s = await open(browser, { mutate, url: "/flows/flowlab/#view=strikes&t=SYX101" });
  await until(s.page, () => !!document.querySelector("#flStrikesB svg rect"));
  await settle(s.page, 300);
  const body = await memberBody("/api/flows/flowlab/name?t=SYX101&view=strikes", W);
  const map = body.x.map.x;
  let und = 0;
  let filled = 0;
  map.cells.forEach((line, i) => line.forEach((v, j) => { if (v === null || v === 0) return; if (map.decided[i][j]) filled++; else und++; }));
  const r = await s.page.evaluate(() => {
    const rects = [...document.querySelectorAll("#flStrikesB svg rect")];
    return { und: rects.filter((q) => q.getAttribute("class") === "und").length, filled: rects.filter((q) => q.hasAttribute("fill-opacity")).length };
  });
  if (und === 0 || filled === 0) bad.push("fixture lacks decided or undecided cells");
  if (r.und !== und) bad.push("undecided cells drawn hollow " + r.und + " not " + und);
  if (r.filled !== filled) bad.push("coloured cells " + r.filled + " not " + filled);
  const note = await s.page.evaluate(() => document.getElementById("flStrikesN").textContent);
  if (!note.includes(NOTES.strikeCell) || !note.includes(NOTES.strikeMap)) bad.push("the map does not say what a cell holds: " + note);
  await s.close();
  return bad;
};

CHECKS["strike-rail"] = async (browser, mutate) => {
  const bad = [];
  const s = await open(browser, { mutate, url: "/flows/flowlab/#view=strikes&t=SYX101" });
  await until(s.page, () => document.querySelectorAll("#flStrikeRailB g.fl-rail").length > 0);
  await settle(s.page, 300);
  const body = await memberBody("/api/flows/flowlab/name?t=SYX101&view=strikes", W);
  const rail = body.x.rail.x.strikes;
  const got = await s.page.evaluate(() => Object.fromEntries([...document.querySelectorAll("#flStrikeRailB g.fl-rail")].map((g) => [g.getAttribute("data-k"), { dir: g.getAttribute("data-dir"), mark: (g.querySelector("path.pt") || {}).getAttribute ? g.querySelector("path.pt").getAttribute("class") : null }])));
  for (const q of rail) {
    const want = q.net === null ? "none" : !q.decided ? "und" : q.net > 0 ? "up" : q.net < 0 ? "down" : "flat";
    const g = got[String(q.k)];
    if (!g) { bad.push("strike " + q.k + " not drawn"); continue; }
    if (g.dir !== want) bad.push("strike " + q.k + " drawn " + g.dir + " not " + want);
    const mark = want === "und" ? "pt hol" : want === "up" ? "pt up" : want === "down" ? "pt dn" : null;
    if (mark && g.mark && g.mark !== mark) bad.push("strike " + q.k + " mark " + g.mark + " not " + mark);
  }
  if (!rail.some((q) => q.decided === false)) bad.push("fixture has no undecided strike");
  await s.close();
  return bad;
};

CHECKS["strike-classes"] = async (browser, mutate) => {
  const bad = [];
  const world = { ...W, "strike-flow-intraday": () => { throw status503(); } };
  const s = await open(browser, { mutate, world, url: "/flows/flowlab/#view=strikes&t=SYX101" });
  await until(s.page, () => !document.querySelector("#flStrikesB .fl-wait") && !document.querySelector("#flStrikeRailB .fl-wait"));
  await settle(s.page, 300);
  const r = await s.page.evaluate(() => ({ map: (document.querySelector("#flStrikesB .fl-state") || {}).getAttribute ? document.querySelector("#flStrikesB .fl-state").getAttribute("data-code") : null, text: document.getElementById("flStrikesB").textContent, rail: document.querySelectorAll("#flStrikeRailB g.fl-rail").length }));
  if (r.map !== "status_5xx" || !r.text.includes("status 503")) bad.push("a failed minute read names its class and status, not a bare failure: " + r.map + ": " + r.text.slice(0, 80));
  if (!r.rail) bad.push("the day's rail is lost with the minutes");
  await s.close();
  const t = await open(browser, { mutate, url: "/flows/flowlab/#view=strikes&t=SYX101", responses: { "name:strikes": { status: 502, body: { error: { code: "chain_upstream", message: "x" }, read: readOf("status_5xx", { status: 503 }) } } } });
  await until(t.page, () => !document.querySelector("#flStrikesB .fl-wait"));
  await settle(t.page, 200);
  const u = await t.page.evaluate(() => ({ code: (document.querySelector("#flStrikesB .fl-state") || {}).getAttribute ? document.querySelector("#flStrikesB .fl-state").getAttribute("data-code") : null, text: document.getElementById("flStrikesB").textContent }));
  if (u.code !== "status_5xx" || !u.text.includes("status 503")) bad.push("a 502 with its read names the class and status: " + u.code + " " + u.text.slice(0, 80));
  await t.close();
  return bad;
};

CHECKS["recent-net"] = async (browser, mutate) => {
  const bad = [];
  const rows = W["flow-per-expiry"].map((q, i) => (i === 1 ? { ...q, call_premium: "1.00" } : q));
  const world = { ...W, "flow-per-expiry": rows };
  const s = await open(browser, { mutate, world, url: "/flows/flowlab/#view=greeks&t=SYX101" });
  await until(s.page, () => !!document.querySelector("#flRecentB tbody tr"));
  await settle(s.page, 200);
  const body = await memberBody("/api/flows/flowlab/name?t=SYX101&view=recent", world);
  const got = await s.page.evaluate(() => Object.fromEntries([...document.querySelectorAll("#flRecentB tbody tr")].map((r) => { const c = r.querySelector("td.c-net"); return [r.getAttribute("data-e"), { dir: c.getAttribute("data-dir"), sg: !!c.querySelector(".ds-sg"), text: c.textContent, title: c.getAttribute("title") || "" }]; })));
  const nul = body.x.rows.find((q) => q.netC === null);
  if (!nul) bad.push("fixture has no row without a net");
  for (const q of body.x.rows) {
    const g = got[q.e];
    if (!g) continue;
    if (q.netC === null) {
      if (g.sg || g.text !== "—" || !g.title) bad.push("a row with no net draws " + JSON.stringify(g));
      continue;
    }
    const want = !q.decided ? "und" : q.netC > 0 ? "up" : "down";
    if (g.dir !== want) bad.push("expiry " + q.e + " drawn " + g.dir + " not " + want);
    if (q.loC !== q.hiC && !g.text.includes("±")) bad.push("expiry " + q.e + " net is not a range: " + g.text);
  }
  const note = await s.page.evaluate(() => document.getElementById("flRecentN").textContent);
  if (!note.includes(NOTES.premiumNet) || !/Sided share \d+% of premium/.test(note)) bad.push("the expiry note does not define the net and its sided share: " + note);
  await s.close();
  return bad;
};

CHECKS["greek-after-failure"] = async (browser, mutate) => {
  const bad = [];
  const s = await open(browser, { mutate, url: "/flows/flowlab/#view=greeks&t=SYX101", responses: { "name:recent": { status: 502, body: { error: { code: "chain_upstream", message: "x" }, read: { ...readOf("status_5xx", { status: 503 }), op: "flow-per-expiry" } } } } });
  await until(s.page, () => !document.querySelector("#flRecentB .fl-wait") && !document.querySelector("#flGreeksB .fl-wait"));
  await settle(s.page, 300);
  const r = await s.page.evaluate(() => ({ code: (document.querySelector("#flGreeksB .fl-state") || {}).getAttribute ? document.querySelector("#flGreeksB .fl-state").getAttribute("data-code") : null, text: document.getElementById("flGreeks").textContent }));
  if (r.code !== "status_5xx") bad.push("Greek flow after a failed expiry read shows " + r.code);
  if (/Choose a ticker/.test(r.text)) bad.push("Greek flow asks for a ticker that is chosen");
  await s.close();
  return bad;
};

CHECKS["greek-ticks"] = async (browser, mutate) => {
  const bad = [];
  const base = Date.UTC(2026, 9, 23, 13, 30);
  const rows = W["greek-flow-expiry"].data.map((q, i) => ({ ...q, timestamp: new Date(base + (i < 30 ? i : 30 + (i - 30) * 40) * 60000).toISOString().replace(".000", "") }));
  const world = { ...W, "greek-flow-expiry": { data: rows } };
  const s = await open(browser, { mutate, world, url: "/flows/flowlab/#view=greeks&t=SYX101" });
  await until(s.page, () => !!document.querySelector("#flGreeksB svg text.tick"));
  await settle(s.page, 300);
  const body = await memberBody("/api/flows/flowlab/name?t=SYX101&view=greek&exp=2026-11-20", world);
  const t0 = body.x.t[0];
  const t1 = body.x.t[body.x.t.length - 1];
  const r = await s.page.evaluate(() => {
    const svg = document.querySelector("#flGreeksB svg");
    return { w: Number(svg.getAttribute("width")), ticks: [...svg.querySelectorAll("text.tick")].map((q) => ({ x: Number(q.getAttribute("x")), text: q.textContent })) };
  });
  if (r.ticks.length < 3) bad.push("fewer than three time ticks");
  for (const q of r.ticks) {
    const at = t0 + ((q.x - 8) / (r.w - 16)) * (t1 - t0);
    const label = q.text.replace(" TRT", "");
    const near = [-60000, 0, 60000].some((d) => trtHM(at + d) === label);
    if (!near) bad.push("tick " + q.text + " stands where the time is " + trtHM(at));
  }
  await s.close();
  return bad;
};

CHECKS["levels-halves"] = async (browser, mutate) => {
  const bad = [];
  const world = { ...W, "darkpool-levels": () => { throw status503(); } };
  const s = await open(browser, { mutate, world, url: "/flows/flowlab/#view=ladders&t=SYX101" });
  await until(s.page, () => !!document.querySelector("#flLadderB svg"));
  await settle(s.page, 300);
  const note = await s.page.evaluate(() => document.getElementById("flLadderN").textContent);
  if (!note.includes("Stock levels: The feed answered with an error, status 503.")) bad.push("a failed stock half is not named: " + note);
  if (/Option levels:/.test(note)) bad.push("the read option half is named as failed: " + note);
  await s.close();
  return bad;
};

CHECKS["routing-codes"] = async (browser, mutate) => {
  const bad = [];
  const s = await open(browser, { mutate, url: "/flows/flowlab/#view=routing" });
  await until(s.page, () => !document.querySelector("#flCodesB .fl-wait") && !!document.querySelector("#flRouteB table"));
  await settle(s.page, 200);
  const r = await s.page.evaluate(() => document.getElementById("flCodesB").textContent);
  if (!r.includes(STATES["choose-ticker-codes"])) bad.push("trade codes with no ticker do not ask for one: " + r.slice(0, 80));
  const t = await open(browser, { mutate, url: "/flows/flowlab/#view=routing&t=SYX101" });
  await until(t.page, () => !!document.querySelector("#flCodesB tbody tr"));
  const q = await t.page.evaluate(() => ({ codes: [...document.querySelectorAll("#flCodesB tbody tr")].map((x) => x.getAttribute("data-code")) }));
  if (!q.codes.length) bad.push("a ticker's codes are not drawn");
  const asked = t.log.requests.filter((u) => u.startsWith("/api/flows/flowlab/"));
  if (asked.some((u) => u.includes("nightly?k=venues"))) bad.push("a ticker's routing still reads the whole universe: " + asked.join());
  if (asked.filter((u) => u.startsWith("/api/flows/flowlab/venues?t=SYX101")).length !== 1) bad.push("one read serves exchanges and codes: " + asked.join());
  await s.close();
  await t.close();
  return bad;
};

CHECKS["lit-title"] = async (browser, mutate) => {
  const bad = [];
  const s = await open(browser, { mutate, url: "/flows/flowlab/#view=lit" });
  await until(s.page, () => !!document.querySelector("#flLitMarketB tbody tr"));
  const r = await s.page.evaluate(() => ({ title: document.getElementById("flLitMarketT").textContent, note: document.getElementById("flLitMarketN").textContent }));
  if (r.title !== LABELS.litMarket) bad.push("lit title " + r.title);
  if (!/newest/.test(r.note) || !/\$500K/.test(r.note)) bad.push("lit note does not say what was read: " + r.note);
  await s.close();
  return bad;
};

CHECKS["relations-off"] = async (browser, mutate) => {
  const bad = [];
  const s = await open(browser, { mutate, url: "/flows/flowlab/#view=relations" });
  await until(s.page, () => !document.querySelector("#flRelB .fl-wait"));
  await settle(s.page, 200);
  const r = await s.page.evaluate(() => ({ code: (document.querySelector("#flRelB .fl-state") || {}).getAttribute ? document.querySelector("#flRelB .fl-state").getAttribute("data-code") : null, text: document.getElementById("flRelB").textContent }));
  if (r.code !== "off" || !r.text.includes(STATES.off)) bad.push("relations off reads " + r.code + ": " + r.text.slice(0, 80));
  if (/has not landed/.test(r.text)) bad.push("relations off says the read has not landed");
  await s.close();
  return bad;
};

CHECKS["banners"] = async (browser, mutate) => {
  const bad = [];
  const body = await memberBody("/api/flows/flowlab/lit", W);
  const s = await open(browser, { mutate, url: "/flows/flowlab/#view=lit", responses: { lit: { status: 200, headers: { "X-Fresh-State": "stale", "X-Fresh-Reason": "too_large", "X-Chain-Age": "600" }, body } } });
  await until(s.page, () => !!document.querySelector("#flLitMarketB tbody tr"));
  const r = await s.page.evaluate(() => (document.querySelector('#flLitMarketB .fl-state-top[data-code="kept"]') || {}).textContent || "");
  if (!r.includes("The latest read failed") || !r.includes(STATES.too_large)) bad.push("a kept copy does not say why: " + r);
  await s.close();
  const nightly = await nightlyBodies(W);
  const t = await open(browser, { mutate, nightly, held: { groups: "chain_upstream" }, url: "/flows/flowlab/#view=groups" });
  await until(t.page, () => document.querySelectorAll(".fl-tile").length === 25);
  const q = await t.page.evaluate(() => (document.querySelector('#flGroupsB .fl-state-top[data-code="earlier"]') || {}).textContent || "");
  if (!q.includes("From the " + SESSION + " session") || !q.includes(STATES.failed)) bad.push("an earlier copy is not named: " + q);
  await t.close();
  return bad;
};

CHECKS["drill-classes"] = async (browser, mutate) => {
  const bad = [];
  const world = { ...W, "contract-intraday": () => { throw tooBig(); }, "multi-leg": { data: W["multi-leg"].data.map((q) => ({ ...q, strikes: ["999"] })) } };
  const s = await open(browser, { mutate, world, url: "/flows/flowlab/#view=screen&c=" + CONTRACT });
  await until(s.page, () => !!document.querySelector(".dr-sheet[open] tbody tr"));
  await s.page.evaluate(() => document.querySelector('.dr-sheet [data-view="minutes"]').click());
  await until(s.page, () => !document.querySelector(".dr-sheet .fl-wait"));
  const m = await s.page.evaluate(() => ({ code: (document.querySelector(".dr-b .fl-state") || {}).getAttribute ? document.querySelector(".dr-b .fl-state").getAttribute("data-code") : null, text: document.querySelector(".dr-b").textContent }));
  if (m.code !== "too_large" || !m.text.includes(STATES.too_large)) bad.push("a drill part past its cap reads " + m.code + ": " + m.text.slice(0, 80));
  await s.page.evaluate(() => document.querySelector('.dr-sheet [data-view="structure"]').click());
  await until(s.page, () => !document.querySelector(".dr-sheet .fl-wait"));
  const t = await s.page.evaluate(() => document.querySelector(".dr-b").textContent);
  const n = W["multi-leg"].data.length;
  if (!t.includes("None of the " + n + " packages read matched this contract.")) bad.push("an empty structure does not count the packages read: " + t.slice(0, 80));
  await s.close();
  return bad;
};

CHECKS["groups"] = async (browser, mutate) => {
  const bad = [];
  const nightly = await nightlyBodies(W);
  nightly["flowlab-groups"].groups.uranium = { status: "plan" };
  const s = await open(browser, { mutate, nightly, url: "/flows/flowlab/#view=groups" });
  await until(s.page, () => document.querySelectorAll(".fl-tile").length === 25);
  const r = await s.page.evaluate(() => ({ n: document.querySelectorAll(".fl-tile").length, u: (() => { const t = document.querySelector('.fl-tile[data-g="uranium"]'); return t ? { chip: !!t.querySelector(".ds-st"), figure: !!t.querySelector(".ds-sg"), text: t.textContent } : null; })() }));
  if (r.n !== 25) bad.push("tiles " + r.n);
  if (!r.u || !r.u.chip || r.u.figure) bad.push("a refused group shows a figure or no state: " + JSON.stringify(r.u));
  if (r.u && /\$0|0\.00/.test(r.u.text)) bad.push("a refused group prints a zero");
  if (s.log.errors.length) bad.push("page errors " + s.log.errors[0]);
  await s.close();
  const t = await open(browser, { mutate, url: "/flows/flowlab/#view=groups" });
  await until(t.page, () => document.querySelectorAll(".fl-tile").length === 25);
  const q = await t.page.evaluate(() => {
    const wrap = document.querySelector("#flGroupsB .fl-groups");
    return { first: wrap && wrap.firstElementChild ? wrap.firstElementChild.className + ":" + wrap.firstElementChild.textContent : null, second: wrap && wrap.children[1] ? wrap.children[1].className : null, glyphs: document.querySelectorAll("#flGroupsB .fl-tile .ds-sg").length, note: document.getElementById("flGroupsN").textContent };
  });
  if (!q.first || !/^fl-read:Read from the feed at \d\d:\d\d TRT\./.test(q.first) || q.second !== "fl-tiles") bad.push("groups do not open with the reading line: " + JSON.stringify(q));
  if (q.glyphs) bad.push("a group tile draws a direction from a net with no sided share (" + q.glyphs + ")");
  if (!q.note.includes(NOTES.groupSided)) bad.push("the groups note does not say no sided share is sent: " + q.note);
  const asked = t.log.requests.filter((u) => u.startsWith("/api/flows/flowlab/group?"));
  await t.page.evaluate(() => document.querySelector('.fl-tile[data-g="mag7"]').click());
  await until(t.page, () => !!document.querySelector("#flAllB svg path.ln"));
  const d = await t.page.evaluate(() => ({ glyphs: document.querySelectorAll("#flAllB .ds-sg").length, open: document.getElementById("flAll").open }));
  if (!d.open || d.glyphs) bad.push("the group dialog does not open, or draws a direction: " + JSON.stringify(d));
  if (asked.length) bad.push("a group was read before its dialog opened");
  await t.close();
  return bad;
};

CHECKS["phone-modules"] = async (browser, mutate) => {
  const bad = [];
  const s = await open(browser, { mutate, width: 390, height: 844 });
  await until(s.page, () => !!document.querySelector("#flScreenB tbody tr"));
  const r = await s.page.evaluate(() => ({ vis: [...document.querySelectorAll(".fl-panel[data-on] .fl-mod")].filter((m) => m.offsetParent !== null).map((m) => m.id), tabs: document.querySelectorAll("#flMods [role=tab]").length }));
  if (r.vis.length !== 1) bad.push("modules visible at 390: " + r.vis.join());
  if (r.tabs !== 3) bad.push("module tabs " + r.tabs);
  await s.page.evaluate(() => document.querySelectorAll("#flMods [role=tab]")[2].click());
  await settle(s.page, 200);
  const v = await s.page.evaluate(() => [...document.querySelectorAll(".fl-panel[data-on] .fl-mod")].filter((m) => m.offsetParent !== null).map((m) => m.id));
  if (v.join() !== "flScatter") bad.push("the third module did not show: " + v.join());
  await s.close();
  return bad;
};

CHECKS["ticker-field"] = async (browser, mutate) => {
  const bad = [];
  const s = await open(browser, { mutate });
  await until(s.page, () => !!document.querySelector("#flScreenB tbody tr"));
  await s.page.fill("#flT", "bad ticker!");
  await s.page.press("#flT", "Enter");
  await settle(s.page, 200);
  const r = await s.page.evaluate(() => ({ h: location.hash, say: document.getElementById("flStatus").textContent }));
  if (/t=/.test(r.h)) bad.push("a bad ticker reached the address: " + r.h);
  if (!/Unknown ticker/.test(r.say)) bad.push("no spoken refusal");
  await s.close();
  return bad;
};

const MUTANTS = [
  [75, "screen-lean", FLOWLAB_JS, 'const dir = x.lean === 1 ? "up" : x.lean === -1 ? "down" : "und";', 'const dir = x.lean === 1 ? "up" : x.lean === -1 ? "down" : "flat";'],
  [76, "strike-cells", CHART_JS, "if (open(r, c)) {", "if (false) {"],
  [77, "strike-cells", FLOWLAB_JS, "undecided: map.decided.map((line) => line.map((d) => d === false)), ", ""],
  [78, "strike-rail", FLOWLAB_JS, "class: q.decided ? (q.net > 0 ? \"bar up\" : \"bar dn\") : \"bar und\" }, g);", "class: q.net > 0 ? \"bar up\" : \"bar dn\" }, g);\n        q.decided = true;"],
  [79, "strike-classes", FLOWLAB_JS, "    if (read && CLASSES[read.class]) return { error: CLASSES[read.class], read, body: null };\n    if (code && ERRS[code]) return { error: ERRS[code], read, body: null };", ""],
  [80, "strike-classes", FLOWLAB_JS, "    if (p.read && CLASSES[p.read.class]) return CLASSES[p.read.class];", ""],
  [81, "recent-net", FLOWLAB_JS, "    if (num(r.netC) === null) {", "    if (false) {"],
  [82, "greek-after-failure", FLOWLAB_JS, "      put(\"flGreeks\", blockOf(DATA[key]), h(\"span\", null, NOTES.greekNeeds));", "      tickerNeeded(\"flGreeks\");"],
  [83, "greek-ticks", FLOWLAB_JS, [["const ticks = timeTicks(t0, t1);", "const ticks = [t0, x.t[Math.floor(x.t.length / 2)], t1];"], ["x: geo(at(t)), y: H - 24", "x: geo(L + (i / 2) * (W - L - R)), y: H - 24"]]],
  [84, "levels-halves", FLOWLAB_JS, "    const notes = [halfLine(\"Option levels\", reads.options), halfLine(\"Stock levels\", reads.stock),", "    const notes = ["],
  [85, "routing-codes", FLOWLAB_JS, "    put(\"flCodes\", emptyBlock(STATES[\"choose-ticker-codes\"]), \"\");\n", ""],
  [86, "relations-off", FLOWLAB_JS, "if (b.status === \"off\") {", "if (b.status === \"offline\") {"],
  [87, "banners", FLOWLAB_JS, "    else if (rec.stale) top.push(topBlock(\"kept\", fill(STATES.kept, { TRT: at }) + reasonText(rec.stale)));\n", "\n"],
  [88, "banners", FLOWLAB_JS, "    if (rec.held) top.push(topBlock(\"earlier\", fill(STATES.earlier, { date: sessionOf(rec.body) }) + reasonText(rec.held)));\n", ""],
  [89, "drill-classes", DRILL_JS, "    if (p.ok === false) return { st: partState(p) || \"failed\", vars: varsOf(p) };", "    if (p.ok === false) return { st: p.why === \"empty\" ? \"quiet\" : p.why === \"plan\" ? \"plan\" : \"unshaped\" };"],
  [90, "drill-classes", DRILL_JS, "fill(d.noStructure, { n: F.num(res.body.x.searched) })", "d.noStructure"],
  [91, "groups", FLOWLAB_JS, "b.append(svg, h(\"span\", { class: \"fl-tile-v\" }, money(net, true)));", "b.append(svg, h(\"span\", { class: \"ds-sg\", \"data-dir\": net > 0 ? \"up\" : \"down\" }, h(\"i\"), money(net, true)));"],
  [92, "groups", FLOWLAB_JS, "    const wrap = h(\"div\", { class: \"fl-groups\" }, groupLine(rec), grid);", "    const wrap = h(\"div\", { class: \"fl-groups\" }, grid, groupLine(rec));"],
  [33, "screen-order", FLOWLAB_JS, "have.sort((a, b) => (rankValue(b, k) - rankValue(a, k))", "have.sort((a, b) => (rankValue(a, k) - rankValue(b, k))"],
  [34, "ask-range", FLOWLAB_JS, "Math.ceil(x.askHi * 100 - 1e-9)", "Math.floor(x.askHi * 100 - 1e-9)"],
  [35, "null-ratio", FLOWLAB_JS, 'x.voi === null ? DASH : F.px(x.voi, 2) + "x"', 'x.voi === null ? "0.00x" : F.px(x.voi, 2) + "x"'],
  [36, "failed-state", FLOWLAB_JS, "    const st = why(rec);\n    if (st) {\n      put(id, blockOf(rec), \"\");", "    const st = null;\n    if (st) {\n      put(id, blockOf(rec), \"\");"],
  [37, "drill-focus", DRILL_JS, "if (dlg.showModal && !dlg.open) dlg.showModal();\n      select(\"prints\");", "dlg.setAttribute(\"open\", \"\");\n      select(\"prints\");"],
  [38, "drill-prints", DRILL_JS, "p.canceled ? d.cancelled : sgn(p.side)", "sgn(p.side)"],
  [39, "groups", FLOWLAB_JS, 'const st = entry ? groupState(entry.status) : "failed";', 'const st = entry && entry.status === "failed" ? "failed" : null;'],
  [40, "hash", FLOWLAB_JS, "function writeHash() {", "function writeHash() { return;"],
  [41, "phone-modules", FLOWLAB_JS, "mods.forEach((m, i) => m.classList.toggle(\"is-on\", i === idx));", ""],
  [42, "ticker-field", FLOWLAB_JS, 'if (v && !TICKER_RE.test(v)) { $("flStatus").textContent = "Unknown ticker"; return false; }', ""],
];

const browser = await launch();
try {
  for (const name of Object.keys(CHECKS)) {
    const bad = await CHECKS[name](browser, {});
    ok(bad.length === 0, name + ": " + bad.join("; "));
  }
  for (const [n, check, file, from, to] of MUTANTS) {
    const parts = {};
    const pairs = Array.isArray(from) ? from : [[from, to]];
    parts[file] = (src) => {
      let out = src;
      for (const [a, b] of pairs) {
        const at = out.split(a).length - 1;
        if (at !== 1) throw new Error("planted build " + n + " matches " + at + " times");
        out = out.replace(a, () => b);
      }
      return out;
    };
    const bad = await CHECKS[check](browser, parts).catch((e) => ["threw " + e.message]);
    ok(bad.length > 0, "planted build " + n + " survived " + check);
  }
} finally {
  await browser.close();
}
console.log("flows-flowlab-render: " + checks + " checks");
