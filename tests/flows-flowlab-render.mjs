import assert from "node:assert/strict";
import { FX, SESSION, CONTRACT, open, launch, until, settle, memberBody, nightlyBodies } from "./lib/flowlab-world.mjs";

const W = FX.worlds.normal;
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
  [33, "screen-order", FLOWLAB_JS, "have.sort((a, b) => (rankValue(b, k) - rankValue(a, k))", "have.sort((a, b) => (rankValue(a, k) - rankValue(b, k))"],
  [34, "ask-range", FLOWLAB_JS, "Math.ceil(x.askHi * 100 - 1e-9)", "Math.floor(x.askHi * 100 - 1e-9)"],
  [35, "null-ratio", FLOWLAB_JS, 'x.voi === null ? DASH : F.px(x.voi, 2) + "x"', 'x.voi === null ? "0.00x" : F.px(x.voi, 2) + "x"'],
  [36, "failed-state", FLOWLAB_JS, "    const st = why(rec);\n    if (st) {\n      put(id, stateBlock(st), \"\");", "    const st = null;\n    if (st) {\n      put(id, stateBlock(st), \"\");"],
  [37, "drill-focus", DRILL_JS, "if (dlg.showModal && !dlg.open) dlg.showModal();\n      select(\"prints\");", "dlg.setAttribute(\"open\", \"\");\n      select(\"prints\");"],
  [38, "drill-prints", DRILL_JS, "p.canceled ? d.cancelled : sgn(p.side)", "sgn(p.side)"],
  [39, "groups", FLOWLAB_JS, 'if (!entry || entry.status !== "ok") {', 'if (!entry || entry.status === "failed") {'],
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
    parts[file] = (src) => {
      const at = src.split(from).length - 1;
      if (at !== 1) throw new Error("planted build " + n + " matches " + at + " times");
      return src.replace(from, () => to);
    };
    const bad = await CHECKS[check](browser, parts).catch((e) => ["threw " + e.message]);
    ok(bad.length > 0, "planted build " + n + " survived " + check);
  }
} finally {
  await browser.close();
}
console.log("flows-flowlab-render: " + checks + " checks");
