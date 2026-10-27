import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import * as W from "./member-render-world.mjs";
import { ok, eq } from "./member-batteries.mjs";
import { SINCE_COPY, sinceModel } from "../../shared/flows-since.js";

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const T0 = Date.UTC(2026, 9, 24, 8, 0, 0);
const SERVER_NOW = Date.UTC(2026, 9, 24, 11, 0, 0);
const FIXTURE = /SY[A-Z]\d{3}|member\.alpha/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const names = (prefix, n, from = 0) => Array.from({ length: n }, (_, i) => prefix + String(from + i).padStart(3, "0"));
const UNI = names("SYA", 300, 1);

const mergeMutate = (a = {}, c = {}) => { const out = { ...a }; for (const [f, t] of Object.entries(c)) out[f] = (out[f] || []).concat(t); return out; };
export const open = (b, slug, o = {}) => W.open(b.browser, slug, { ...b.opts, ...o, mutate: mergeMutate(b.opts && b.opts.mutate, o.mutate) });

async function using(b, slug, o, fn) {
  const p = await open(b, slug, o);
  try { return await fn(p); } finally { await p.close(); }
}

const tc = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent : null; }, sel);
const attr = (page, sel, name) => page.evaluate(([s, n]) => { const e = document.querySelector(s); return e ? e.getAttribute(n) : null; }, [sel, name]);
const active = (page) => page.evaluate(() => { const a = document.activeElement; return a ? (a.id || a.getAttribute("aria-label") || (a.textContent || "").trim().slice(0, 40) || a.tagName) : null; });
const settle = (page, ms = 170) => page.waitForTimeout(ms);
const advance = async (page, ms) => { for (let t = 0; t < ms; t += 1000) { await page.clock.fastForward(1000); await page.waitForTimeout(80); } };
const until = (page, fn, arg, timeout = 8000) => page.waitForFunction(fn, arg, { timeout });
const putBodies = (p) => p.state.bodies("PUT /api/me/state");
const putCount = (p) => putBodies(p).length;
const setTicker = (page, t) => page.evaluate((v) => { document.getElementById("ftHeroT").textContent = v; }, t);
const live = (page, dialog) => tc(page, "#" + dialog + " > [role=status]");
const pageLive = (page) => tc(page, "#fxLive");
const leaks = (p) => [...p.logs.filter((l) => FIXTURE.test(l.text)), ...p.requests.filter((r) => /SY[A-Z]\d{3}|member\.alpha/.test(r)).map((r) => ({ type: "request", text: r }))];
const junk = (page) => page.evaluate(() => [...document.querySelectorAll("dialog, .ui-exp-m, .fm-star-slot")].map((e) => e.textContent).filter((t) => /\bnull\b|\bundefined\b|\bNaN\b|\[object/.test(t)));
const rowsOf = (page, d = "fmList") => page.evaluate((id) => [...document.querySelectorAll("#" + id + " .fm-row .fm-t")].map((a) => a.textContent), d);

async function openDialog(p, kind) {
  await p.page.locator('.fx-mem[data-member-open="' + kind + '"]:visible').first().click();
  await p.page.waitForSelector("dialog.fm-dlg[open]");
  await settle(p.page, 120);
}

async function add(p, text) {
  await p.page.fill("#fmAdd", text);
  await p.page.press("#fmAdd", "Enter");
}

const SEED = (list) => [W.INIT.seed(list)];
const CLICK = (sel) => (page) => page.click(sel);

export const SCENARIOS = {
  async boot(b) {
    await using(b, "moves", {}, async (p) => {
      await until(p.page, () => document.getElementById("fxMember").dataset.visit === "1");
      eq(p.state.visits, 1, "one ping after load");
      const rec = p.state.log.find((l) => l.path === "/api/me/visit");
      eq([rec.method, rec.body, rec.search], ["POST", null, ""], "a bodiless POST with no query");
      ok(!FIXTURE.test(JSON.stringify(rec)), "and no ticker or member in it");
      eq(p.assets.filter((a) => /^(flows-member|flows-member-ui|storage)\.js$|^flows-member\.css$/.test(a)), [], "no group is requested before a click");
      eq(p.assets.includes("flows-member-boot.js"), true, "the boot is");
    });
  },

  async hidden(b) {
    await using(b, "moves", { init: [W.INIT.hidden] }, async (p) => {
      await settle(p.page, 400);
      eq(p.requests.filter((r) => r.includes("/api/me/")), [], "a page loaded hidden makes no member request");
      await p.page.evaluate(() => { window.__vs = "visible"; document.dispatchEvent(new Event("visibilitychange")); });
      await until(p.page, () => document.getElementById("fxMember").dataset.visit === "1");
      eq(p.state.visits, 1, "and one ping when it becomes visible");
    });
  },

  async guard(b) {
    await using(b, "moves", { clock: T0 }, async (p) => {
      await until(p.page, () => document.getElementById("fxMember").dataset.visit === "1");
      const fire = () => p.page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await p.page.clock.fastForward(59000);
      await fire();
      await settle(p.page, 250);
      eq(p.state.visits, 1, "no second ping at 59 seconds");
      await p.page.clock.fastForward(2000);
      await fire();
      await until(p.page, () => true);
      await settle(p.page, 250);
      eq(p.state.visits, 2, "one at 61 seconds");
    });
  },

  async prerender(b) {
    await using(b, "moves", { init: [W.INIT.prerender] }, async (p) => {
      await settle(p.page, 400);
      eq(p.requests.filter((r) => r.includes("/api/me/")), [], "a prerendering page makes no member request");
      await p.page.evaluate(() => { window.__pre = false; document.dispatchEvent(new Event("prerenderingchange")); });
      await until(p.page, () => document.getElementById("fxMember").dataset.visit === "1");
      eq(p.state.visits, 1, "and one ping when it is shown");
    });
  },

  async resume(b) {
    await using(b, "moves", { clock: T0 }, async (p) => {
      await until(p.page, () => document.getElementById("fxMember").dataset.visit === "1");
      await p.page.evaluate(() => { window.__resumed = 0; document.getElementById("fxMember").addEventListener("member:resume", () => { window.__resumed += 1; }); });
      await p.page.clock.fastForward(61000);
      await p.page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false })));
      await settle(p.page, 200);
      eq([p.state.visits, await p.page.evaluate(() => window.__resumed)], [1, 0], "a pageshow that is not a restore does nothing");
      await p.page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
      await until(p.page, () => window.__resumed === 1);
      await settle(p.page, 250);
      eq(p.state.visits, 2, "a restored page pings again after a minute");
    });
  },

  async failures(b) {
    const state = W.fakeMe({});
    state.failNext = { match: "POST /api/me/visit", status: 500 };
    await using(b, "moves", { state }, async (p) => {
      await settle(p.page, 400);
      eq(await p.page.evaluate(() => document.getElementById("fxMember").dataset.visit || null), null, "a failed ping leaves no flag");
      eq(leaks(p), [], "and nothing about the member in the console");
    });
    const gone = W.fakeMe({});
    gone.unauthorized = true;
    await using(b, "moves", { state: gone, clock: T0 }, async (p) => {
      await settle(p.page, 300);
      for (let i = 0; i < 3; i += 1) {
        await p.page.clock.fastForward(61000);
        await p.page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
        await settle(p.page, 150);
      }
      eq(p.state.count("POST /api/me/visit"), 1, "a 401 stops the pinging");
    });
  },

  async off(b) {
    await using(b, "moves", { shell: false }, async (p) => {
      await settle(p.page, 300);
      eq([p.requests.filter((r) => r.includes("/api/me/")), p.assets.includes("flows-member-boot.js"), await p.page.evaluate(() => document.querySelectorAll("#fxMember, [data-member]").length)], [[], false, 0], "with the switch off nothing is requested and nothing is there");
    });
  },

  async order(b) {
    await using(b, "moves", { exportOpen: true }, async (p) => {
      await settle(p.page, 300);
      await openDialog(p, "list");
      const at = (n) => p.assets.indexOf(n);
      ok(at("flows-export.js") > 0 && at("flows-export.js") < at("flows-member.js") && at("flows-member.js") < at("flows-member-ui.js") && at("flows-member-ui.js") < at("storage.js"), "export, the module, the dialogs and the store load in that order: " + p.assets.join(","));
    });
  },

  async saver(b) {
    await using(b, "ticker", { init: [W.INIT.saveData, W.INIT.shifts] }, async (p) => {
      await setTicker(p.page, "SYA001");
      await settle(p.page, 400);
      eq(p.assets.filter((a) => /^(flows-member|flows-member-ui|storage)\.js$|^flows-member\.css$/.test(a)), [], "Data Saver: no group is fetched on load");
      const boxes = () => p.page.evaluate(() => ["#ftHeroT", "#ftHeroSub", "#ftHeroFlags", ".fm-star-slot"].map((q) => { const r = document.querySelector(q).getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 2) / 2); }));
      const before = await boxes();
      eq(await p.page.evaluate(() => document.querySelectorAll(".fm-star").length), 0, "and the star slot is empty");
      await openDialog(p, "list");
      eq(await p.page.evaluate(() => document.querySelector("#fmList") !== null), true, "a click still opens the dialog");
      await p.page.keyboard.press("Escape");
      await until(p.page, () => document.querySelectorAll(".fm-star").length === 1);
      await settle(p.page, 200);
      eq(await boxes(), before, "and the star arriving moves nothing");
    });
  },

  async list(b) {
    const state = W.fakeMe({ names: ["SYA002", "SYA005", "SYA010"], universe: UNI });
    await using(b, "moves", { state, exportOpen: true }, async (p) => {
      await openDialog(p, "list");
      eq(p.state.count("GET /api/me/state"), 1, "opening reads the state once");
      eq(await tc(p.page, ".fm-count"), "3 of 200 names", "the count");
      eq(await active(p.page), "fmAdd", "a fine pointer starts in the field");
      eq(await p.page.evaluate(() => document.querySelector("dialog.fm-dlg").matches(":modal")), true, "the dialog is modal");
      eq(await attr(p.page, "dialog.fm-dlg", "data-member"), "", "and carries data-member");
      eq(await attr(p.page, "dialog.fm-dlg", "aria-labelledby"), "fmListT", "named by its heading");
      eq(await attr(p.page, "#fmList ul.fm-list", "role"), "list", "the list has an explicit role");
      eq(await junk(p.page), [], "no dialog text says null, undefined, NaN or [object]");
    });
    await using(b, "moves", { state: W.fakeMe({ names: ["SYA002"], universe: UNI }), mobile: true, w: 390, h: 844 }, async (p) => {
      await openDialog(p, "list");
      eq(await active(p.page), "fmListT", "a coarse pointer starts on the title so the keyboard stays down");
    });
  },

  async add(b) {
    const state = W.fakeMe({ names: ["SYA002", "SYA005", "SYA010"], universe: UNI });
    await using(b, "moves", { state }, async (p) => {
      await openDialog(p, "list");
      await add(p, " sya101 ");
      await until(p.page, () => document.querySelectorAll("#fmList .fm-row").length === 4);
      const put = putBodies(p)[0];
      eq(put, { deviceOnly: false, watchlist: ["SYA002", "SYA005", "SYA010", "SYA101"] }, "one PUT, upper case, the whole list");
      const header = p.state.log.filter((l) => l.method === "PUT")[0].headers["if-match"];
      eq(header, '"w0"', "with a strong If-Match built from the version in the body, though the server's ETag was weak");
      eq(await p.page.evaluate(() => document.getElementById("fmAdd").value), "", "the field clears");
      await settle(p.page);
      eq(await live(p.page, "fmList"), "SYA101 added.", "the dialog's own region says so");
      eq((await pageLive(p.page)) || "", "", "and the page's region does not");
      eq(await attr(p.page, "#fmAdd", "autocapitalize"), "characters", "the field asks for capitals");
      eq(await attr(p.page, "#fmAdd", "enterkeyhint"), "done", "and the done key");
    });
  },

  async paste(b) {
    const state = W.fakeMe({ names: ["SYA002"], universe: UNI });
    await using(b, "moves", { state }, async (p) => {
      await openDialog(p, "list");
      await add(p, "SYA102, SYA103 SYA999");
      await until(p.page, () => document.querySelectorAll("#fmList .fm-row").length === 3);
      eq(await rowsOf(p.page), ["SYA002", "SYA102", "SYA103"], "two added");
      eq(await tc(p.page, "#fmErr"), "Added 2 names. Not covered: SYA999.", "and the one outside the universe named");
      eq(putCount(p), 1, "in one PUT");
      await add(p, "SYA104, nope!, sya102");
      await until(p.page, () => document.querySelectorAll("#fmList .fm-row").length === 4);
      eq(await tc(p.page, "#fmErr"), "Added 1 name. Not valid: NOPE!. Already in My list: SYA102.", "invalid and repeated names are reported too");
    });
  },

  async dup(b) {
    const state = W.fakeMe({ names: ["SYA002"], universe: UNI });
    await using(b, "moves", { state }, async (p) => {
      await openDialog(p, "list");
      await add(p, "sya002");
      await settle(p.page);
      eq(putCount(p), 0, "a name already listed sends no PUT");
      eq(await tc(p.page, "#fmErr"), "SYA002 is already in My list.", "and says so");
      eq([await attr(p.page, "#fmAdd", "aria-invalid"), await attr(p.page, "#fmAdd", "aria-describedby")], ["true", "fmHint fmErr"], "the field is invalid and described");
      await p.page.press("#fmAdd", "Backspace");
      await p.page.type("#fmAdd", "x");
      eq([await tc(p.page, "#fmErr"), await attr(p.page, "#fmAdd", "aria-invalid")], ["", "false"], "typing clears the error");
      await add(p, "");
      await settle(p.page);
      await p.page.fill("#fmAdd", "   ");
      await p.page.press("#fmAdd", "Enter");
      eq(await tc(p.page, "#fmErr"), "Type a ticker first.", "an empty field asks for a ticker");
      await add(p, "SYA1@1");
      eq(await tc(p.page, "#fmErr"), "SYA1@1 is not a valid ticker.", "a bad symbol is named");
      await add(p, "SYZ999");
      eq(await tc(p.page, "#fmErr"), "SYZ999 is not a covered ticker.", "an uncovered one too");
    });
  },

  async limit(b) {
    const full = W.fakeMe({ names: names("SYA", 200, 1), universe: UNI });
    await using(b, "moves", { state: full }, async (p) => {
      await openDialog(p, "list");
      await add(p, "SYA250");
      await settle(p.page);
      eq([putCount(p), await tc(p.page, "#fmErr")], [0, "My list holds 200 names. Remove one to add another."], "the 201st name is refused without a PUT");
    });
    const few = W.fakeMe({ names: ["SYA002"], universe: UNI });
    few.failNext = { match: "PUT /api/me/state", status: 400, body: { error: { code: "invalid_watchlist" }, limit: 200, distinct: 201 } };
    await using(b, "moves", { state: few }, async (p) => {
      await openDialog(p, "list");
      await add(p, "SYA003");
      await until(p.page, () => document.getElementById("fmErr").textContent.length > 0);
      eq(await tc(p.page, "#fmErr"), "My list holds 200 names. Remove one to add another.", "a server limit gives the same words");
    });
  },

  async remove(b) {
    const state = W.fakeMe({ names: ["SYA002", "SYA005", "SYA010"], universe: UNI });
    await using(b, "moves", { state }, async (p) => {
      await openDialog(p, "list");
      await p.page.click('#fmList .fm-rm[aria-label="Remove SYA005"]');
      await until(p.page, () => document.querySelectorAll("#fmList .fm-row").length === 2);
      eq(await active(p.page), "Remove SYA010", "focus goes to the next row's remove button");
      await p.page.click('#fmList .fm-rm[aria-label="Remove SYA010"]');
      await until(p.page, () => document.querySelectorAll("#fmList .fm-row").length === 1);
      eq(await active(p.page), "Remove SYA002", "then to the previous one");
      await p.page.click('#fmList .fm-rm[aria-label="Remove SYA002"]');
      await until(p.page, () => document.querySelectorAll("#fmList .fm-row").length === 0);
      eq(await active(p.page), "fmAdd", "then to the field");
      eq(await tc(p.page, ".fm-count"), "No names yet.", "and the count says it is empty");
      await settle(p.page);
      eq(await live(p.page, "fmList"), "SYA002 removed.", "announced in the dialog");
    });
  },

  async stale(b) {
    const state = W.fakeMe({ names: ["SYA002", "SYA005"], universe: UNI, staleTimes: 1, concurrent: ["SYA009"] });
    await using(b, "moves", { state }, async (p) => {
      await openDialog(p, "list");
      await add(p, "SYA003");
      await until(p.page, () => document.querySelectorAll("#fmList .fm-row").length === 4);
      eq(await rowsOf(p.page), ["SYA002", "SYA003", "SYA005", "SYA009"], "the list is the server's plus the add");
      eq([putCount(p), p.state.count("GET /api/me/state")], [2, 2], "one refetch and one retry");
      eq(p.state.names, ["SYA002", "SYA003", "SYA005", "SYA009"], "and the server agrees");
      await settle(p.page);
      eq(await live(p.page, "fmList"), "Updated with changes from another tab or device. SYA003 added.", "the dialog says another device changed it");
    });
    const always = W.fakeMe({ names: ["SYA002"], universe: UNI, staleTimes: 9, concurrent: ["SYA009"] });
    await using(b, "moves", { state: always }, async (p) => {
      await openDialog(p, "list");
      await add(p, "SYA003");
      await until(p.page, () => document.getElementById("fmErr").textContent.length > 0);
      eq(putCount(p), 2, "exactly two PUTs, never more");
      eq(await tc(p.page, "#fmErr"), "My list changed elsewhere. Close it and open it again.", "then the conflict message");
      eq(await rowsOf(p.page), ["SYA002", "SYA009"], "and the dialog shows the server's list");
    });
  },

  async failed(b) {
    const state = W.fakeMe({ names: ["SYA002"], universe: UNI });
    state.failNext = { match: "PUT /api/me/state", status: 500 };
    await using(b, "moves", { state }, async (p) => {
      await openDialog(p, "list");
      await add(p, "SYA003");
      await until(p.page, () => document.getElementById("fmErr").textContent.includes("Not saved."));
      eq(await rowsOf(p.page), ["SYA002"], "a failed save leaves the list as it was");
      eq(await tc(p.page, "#fmErr button"), "Try again", "with a Try again button");
      await p.page.click("#fmErr button");
      await until(p.page, () => document.querySelectorAll("#fmList .fm-row").length === 2);
      eq(p.state.names, ["SYA002", "SYA003"], "which saves");
    });
    const rm = W.fakeMe({ names: ["SYA002", "SYA003"], universe: UNI });
    rm.failNext = { match: "PUT /api/me/state", status: 500 };
    await using(b, "moves", { state: rm }, async (p) => {
      await openDialog(p, "list");
      await p.page.click('#fmList .fm-rm[aria-label="Remove SYA002"]');
      await until(p.page, () => document.getElementById("fmErr").textContent.includes("Not saved."));
      eq(await tc(p.page, "#fmErrT"), "Not saved. SYA002 is still in My list.", "a failed removal says the name is still there");
      eq(await rowsOf(p.page), ["SYA002", "SYA003"], "and it is");
      await p.page.click("#fmErr button");
      await until(p.page, () => document.querySelectorAll("#fmList .fm-row").length === 1);
      eq(rm.names, ["SYA003"], "Try again removes it");
    });
    const gone = W.fakeMe({ names: ["SYA002"], universe: UNI });
    await using(b, "moves", { state: gone }, async (p) => {
      await openDialog(p, "list");
      gone.unauthorized = true;
      await add(p, "SYA003");
      await until(p.page, () => document.getElementById("fmErr").textContent.length > 0);
      eq(await tc(p.page, "#fmErr"), "Your session has ended. Sign in again.", "a 401 says the session ended");
      eq(await p.page.evaluate(() => document.querySelectorAll("#fmErr button").length), 0, "with nothing to retry");
    });
  },

  async departed(b) {
    const state = W.fakeMe({ names: ["SYA002", "SYZ001"], universe: UNI });
    await using(b, "moves", { state }, async (p) => {
      await openDialog(p, "list");
      await until(p.page, () => document.querySelectorAll("#fmList .fm-mut").length === 1);
      eq(await tc(p.page, ".fm-mut"), "Not in today's universe.", "a name outside the universe is marked");
      await add(p, "SYA003");
      await until(p.page, () => document.querySelectorAll("#fmList .fm-row").length === 3);
      eq(state.names, ["SYA002", "SYA003", "SYZ001"], "and does not stop another from being added");
      await p.page.click('#fmList .fm-rm[aria-label="Remove SYZ001"]');
      await until(p.page, () => document.querySelectorAll("#fmList .fm-row").length === 2);
      eq(state.names, ["SYA002", "SYA003"], "or from being removed");
    });
  },

  async uncheckable(b) {
    const device = W.fakeMe({ deviceOnly: true, universe: UNI });
    device.universeFails = true;
    await using(b, "moves", { state: device, init: SEED(["SYA002"]) }, async (p) => {
      await openDialog(p, "list");
      await add(p, "SYA003");
      await settle(p.page);
      eq(await tc(p.page, "#fmErr"), "Could not check the ticker list. Try again.", "on a device list an unchecked ticker is not added");
      eq(await rowsOf(p.page), ["SYA002"], "and the rows stay");
      eq(await p.page.evaluate((k) => JSON.parse(localStorage.getItem(k)).value.names, W.deviceKey()), ["SYA002"], "and the device copy is untouched");
    });
    const server = W.fakeMe({ universe: UNI });
    server.universeFails = true;
    await using(b, "moves", { state: server }, async (p) => {
      await openDialog(p, "list");
      await add(p, "SYA003");
      await until(p.page, () => document.getElementById("fmErr").textContent.length > 0);
      eq(putCount(p), 1, "on a server list the server decides");
      eq(await tc(p.page, "#fmErrT"), "Could not check the ticker list. Try again.", "and when it cannot read its list the member hears the same words");
      eq([await rowsOf(p.page), server.names, await tc(p.page, "#fmErr button")], [[], [], "Try again"], "nothing is added and Try again is offered");
      server.universeFails = false;
      await p.page.click("#fmErr button");
      await until(p.page, () => document.querySelectorAll("#fmList .fm-row").length === 1);
      eq(server.names, ["SYA003"], "which adds the name once the list can be read");
    });
  },

  async toDevice(b) {
    const state = W.fakeMe({ names: ["SYA002", "SYA005"], universe: UNI });
    await using(b, "moves", { state }, async (p) => {
      await openDialog(p, "list");
      await p.page.click("#fmDev");
      await until(p.page, () => document.getElementById("fmDev").getAttribute("aria-checked") === "true");
      eq(putBodies(p), [{ deviceOnly: true }], "one PUT that carries no list");
      eq(JSON.parse(state.putStorage[0]).value.names, ["SYA002", "SYA005"], "after the device copy was written");
      eq(await rowsOf(p.page), ["SYA002", "SYA005"], "the rows stay");
      await add(p, "SYA003");
      await until(p.page, () => document.querySelectorAll("#fmList .fm-row").length === 3);
      eq(putCount(p), 1, "and an edit in device mode sends nothing");
      eq(leaks(p), [], "nothing in the console");
    });
    await using(b, "moves", { state: W.fakeMe({ names: ["SYA002"], universe: UNI }), init: [W.INIT.silentStorage] }, async (p) => {
      await openDialog(p, "list");
      await p.page.click("#fmDev");
      await until(p.page, () => document.getElementById("fmErrT"));
      eq(putCount(p), 0, "a storage write that silently does nothing sends no PUT");
      eq(await attr(p.page, "#fmDev", "aria-checked"), "false", "and the switch stays where it was");
      eq(await tc(p.page, "#fmErr #fmErrT"), "This browser is not keeping data for this site. Your list will be lost when this tab closes.", "with the reason");
    });
  },

  async toServer(b) {
    const state = W.fakeMe({ deviceOnly: true, universe: UNI });
    state.failNext = { match: "PUT /api/me/state", status: 500 };
    await using(b, "moves", { state, init: SEED(["SYA003", "SYA004"]) }, async (p) => {
      await openDialog(p, "list");
      eq(await attr(p.page, "#fmDev", "aria-checked"), "true", "a device list shows the switch on");
      eq(await rowsOf(p.page), ["SYA003", "SYA004"], "and its rows");
      await p.page.click("#fmDev");
      await until(p.page, () => document.querySelectorAll("#fmErr #fmErrT").length === 1);
      eq(await p.page.evaluate((k) => localStorage.getItem(k) !== null, W.deviceKey()), true, "a failed save keeps the device copy");
      await p.page.click("#fmDev");
      await until(p.page, () => document.getElementById("fmDev").getAttribute("aria-checked") === "false");
      eq(putBodies(p).at(-1), { deviceOnly: false, watchlist: ["SYA003", "SYA004"] }, "the save carries the device names");
      eq(await p.page.evaluate((k) => localStorage.getItem(k), W.deviceKey()), null, "and the device copy goes after the 2xx");
    });
  },

  async keyAbsent(b) {
    const state = W.fakeMe({ keyAbsent: true, universe: UNI });
    await using(b, "ticker", { state, init: SEED(["SYA002"]) }, async (p) => {
      await setTicker(p.page, "SYA001");
      await openDialog(p, "list");
      eq([await attr(p.page, "#fmDev", "aria-checked"), await attr(p.page, "#fmDev", "aria-disabled")], ["true", "true"], "the switch is on and disabled");
      const note = await attr(p.page, "#fmDev", "aria-describedby");
      eq(await tc(p.page, "#" + note), "Saving to your account is not available yet. This list stays on this device.", "with its reason, linked");
      await p.page.click("#fmDev", { force: true });
      await settle(p.page, 250);
      await add(p, "SYA003");
      await until(p.page, () => document.querySelectorAll("#fmList .fm-row").length === 2);
      await p.page.keyboard.press("Escape");
      await until(p.page, () => document.querySelectorAll(".fm-star").length === 1);
      await p.page.click(".fm-star");
      await settle(p.page, 300);
      eq(putCount(p), 0, "no PUT of any kind, from the dialog, the switch or the star");
      eq(p.state.log.filter((l) => l.body && /SY[A-Z]\d{3}/.test(l.body)), [], "and no request body ever holds a ticker");
      eq(await p.page.evaluate((k) => JSON.parse(localStorage.getItem(k)).value.names, W.deviceKey()), ["SYA001", "SYA002", "SYA003"], "the names live in this browser");
    });
    const flip = W.fakeMe({ names: ["SYA002"], universe: UNI });
    await using(b, "moves", { state: flip }, async (p) => {
      await openDialog(p, "list");
      flip.keyAbsent = true;
      await add(p, "SYA003");
      await until(p.page, () => document.getElementById("fmErr").textContent.length > 0);
      eq(await tc(p.page, "#fmErrT"), "Not saved. Saving to your account is not available yet. This list stays on this device.", "a write the server refuses for want of its key says it was not saved");
      await settle(p.page, 250);
      eq([await attr(p.page, "#fmDev", "aria-disabled"), putCount(p), await rowsOf(p.page)], ["true", 1, []], "and the dialog repaints as a device list after one PUT, with the name written nowhere");
    });
  },

  async offer(b) {
    const state = W.fakeMe({ universe: UNI });
    await using(b, "moves", { state, init: SEED(["SYA003", "SYA004", "SYA005"]) }, async (p) => {
      await openDialog(p, "list");
      eq(await tc(p.page, ".fm-offer p"), "This device holds 3 names. Save them to your account?", "the offer names the count");
      await settle(p.page, 300);
      eq(putCount(p), 0, "nothing is uploaded until it is accepted");
      await p.page.click(".fm-offer .fm-go");
      await until(p.page, () => document.querySelectorAll("#fmList .fm-row").length === 3);
      eq(putBodies(p), [{ deviceOnly: false, watchlist: ["SYA003", "SYA004", "SYA005"] }], "accepting saves the device names");
      eq(await p.page.evaluate((k) => localStorage.getItem(k), W.deviceKey()), null, "and clears the device copy");
    });
    await using(b, "moves", { state: W.fakeMe({ universe: UNI }), init: SEED(["SYA003"]) }, async (p) => {
      await openDialog(p, "list");
      await p.page.click(".fm-offer .fm-actions .fm-btn:not(.fm-go)");
      await until(p.page, () => document.getElementById("fmDev").getAttribute("aria-checked") === "true");
      eq([putBodies(p), await rowsOf(p.page)], [[{ deviceOnly: true }], ["SYA003"]], "keeping them on the device switches the mode and keeps the rows");
    });
  },

  async device(b) {
    const state = W.fakeMe({ deviceOnly: true, universe: UNI });
    await using(b, "ticker", { state, init: SEED(["SYA002"]) }, async (p) => {
      await setTicker(p.page, "SYA001");
      await until(p.page, () => document.querySelectorAll(".fm-star").length === 1 && !document.querySelector(".fm-star").hidden);
      await p.page.click(".fm-star");
      await until(p.page, (k) => JSON.parse(localStorage.getItem(k)).value.names.includes("SYA001"), W.deviceKey());
      eq(putCount(p), 0, "a device list star sends no write");
      const other = await p.ctx.newPage();
      await p.again(other);
      await setTicker(other, "SYA001");
      await until(other, () => document.querySelectorAll(".fm-star").length === 1 && !document.querySelector(".fm-star").hidden);
      eq(await attr(other, ".fm-star", "aria-pressed"), "true", "a second tab sees it");
      await other.click(".fm-star");
      await until(other, (k) => !JSON.parse(localStorage.getItem(k)).value.names.includes("SYA001"), W.deviceKey());
      await until(p.page, () => document.querySelector(".fm-star").getAttribute("aria-pressed") === "false");
      eq(await attr(p.page, ".fm-star", "aria-pressed"), "false", "and the first tab hears of the removal");
    });
  },

  async delete(b) {
    const state = W.fakeMe({ deviceOnly: true, universe: UNI, latency: 0 });
    state.failNext = { match: "DELETE /api/me/state", status: 500 };
    await using(b, "moves", { state, init: SEED(["SYA002", "SYA003"]) }, async (p) => {
      await openDialog(p, "list");
      await p.page.click(".fm-del .fm-danger-o");
      eq(await p.page.evaluate(() => document.querySelector(".fm-del").textContent.includes("Delete My list and your visit record from our server and this device? This cannot be undone.")), true, "the question names what goes");
      eq(await p.page.evaluate(() => document.querySelector(".fm-del").textContent.includes("Your export history stays 90 days for export limits.")), true, "and what stays");
      eq(await p.page.evaluate(() => document.querySelector(".fm-del").textContent.includes("Copies of your list on other devices stay there until you clear them.")), true, "and that other devices keep their copies");
      eq(await active(p.page), "Cancel", "focus moves to Cancel");
      await p.page.keyboard.press("Escape");
      await settle(p.page, 200);
      eq(await p.page.evaluate(() => document.querySelector("#fmList").open), true, "Escape cancels the question and not the dialog");
      eq(await p.page.evaluate(() => document.querySelector(".fm-del .fm-danger-o") !== null), true, "which is gone");
      await p.page.keyboard.press("Escape");
      await until(p.page, () => document.querySelectorAll("dialog[open]").length === 0);
      eq(state.count("DELETE /api/me/state"), 0, "a second Escape closes the dialog and deletes nothing");
      await openDialog(p, "list");
      eq(await p.page.evaluate(() => document.querySelector(".fm-del .fm-danger-o") !== null && !document.querySelector(".fm-del .fm-danger")), true, "and the dialog opens again at the question's first step");
      await p.page.click(".fm-del .fm-danger-o");
      state.latency = 350;
      await p.page.click(".fm-del .fm-danger");
      await settle(p.page, 120);
      eq(await p.page.evaluate((k) => localStorage.getItem(k) !== null, W.deviceKey()), true, "the device copy stays while the server has not answered");
      await until(p.page, () => document.querySelector(".fm-del").textContent.includes("Not deleted."));
      eq(await p.page.evaluate((k) => JSON.parse(localStorage.getItem(k)).value.names, W.deviceKey()), ["SYA002", "SYA003"], "and after a failure");
      state.latency = 0;
      await p.page.click(".fm-del .fm-btn");
      await p.page.click(".fm-del .fm-danger");
      await until(p.page, () => document.querySelector(".fm-del").textContent.includes("Your saved data is deleted."));
      eq([state.deleted, await p.page.evaluate((k) => localStorage.getItem(k), W.deviceKey()), await rowsOf(p.page)], [1, null, []], "a 2xx clears both");
      await settle(p.page);
      eq(await live(p.page, "fmList"), "Your saved data is deleted.", "and says so in the dialog");
    });
  },

  async deleteCancel(b) {
    await using(b, "moves", { state: W.fakeMe({ names: ["SYA002"], universe: UNI }) }, async (p) => {
      await openDialog(p, "list");
      await p.page.click(".fm-del .fm-danger-o");
      eq(await p.page.evaluate(() => document.querySelector(".fm-del").dataset.state), "ask", "the question is showing");
      await p.page.evaluate(() => document.getElementById("fmList").dispatchEvent(new Event("cancel", { cancelable: false })));
      await settle(p.page, 200);
      eq([await p.page.evaluate(() => document.querySelector(".fm-del").dataset.state), p.state.count("DELETE /api/me/state")], ["idle", 0], "a cancel that cannot be cancelled returns the question to its first step and deletes nothing");
    });
  },

  async deleteCopy(b) {
    const state = W.fakeMe({ names: ["SYA002"], universe: UNI });
    await using(b, "moves", { state, init: SEED(["SYA003"]) }, async (p) => {
      await openDialog(p, "list");
      eq(p.assets.includes("storage.js"), false, "a server member with names has not loaded the store");
      await p.page.click(".fm-del .fm-danger-o");
      await p.page.click(".fm-del .fm-danger");
      await until(p.page, () => document.querySelector(".fm-del").textContent.includes("Your saved data is deleted."));
      eq([state.deleted, await p.page.evaluate((k) => localStorage.getItem(k), W.deviceKey())], [1, null], "deleting loads the store and clears the device copy as well as the server's");
    });
    await using(b, "moves", { state: W.fakeMe({ names: ["SYA002"], universe: UNI }), init: SEED(["SYA003"]), failAssets: ["storage.js"], clock: T0 }, async (p) => {
      await openDialog(p, "list");
      await p.page.click(".fm-del .fm-danger-o");
      await p.page.click(".fm-del .fm-danger");
      await settle(p.page, 200);
      await p.page.clock.fastForward(9000);
      await until(p.page, () => document.querySelector(".fm-del").textContent.includes("Not deleted."));
      eq(p.state.deleted, 0, "a store that will not load stops the deletion before it reaches the server, so nothing is half deleted");
    });
  },

  async storageWarn(b) {
    await using(b, "moves", { state: W.fakeMe({ deviceOnly: true, universe: UNI }), init: [W.INIT.throwingStorage] }, async (p) => {
      await openDialog(p, "list");
      await add(p, "SYA003");
      await until(p.page, () => document.querySelectorAll("#fmList .fm-row").length === 1);
      eq(await p.page.evaluate(() => { const w = document.querySelector(".fm-warn:not([hidden])"); return w ? w.textContent : null; }), "This browser is not keeping data for this site. Your list will be lost when this tab closes.", "the warning appears");
    });
    await using(b, "moves", { state: W.fakeMe({ names: ["SYA002"], universe: UNI }), init: [W.INIT.throwingStorage] }, async (p) => {
      await openDialog(p, "list");
      await p.page.click("#fmDev");
      await until(p.page, () => document.getElementById("fmErrT"));
      eq(putCount(p), 0, "a browser that keeps nothing never sends the device-only switch");
      eq(await tc(p.page, "#fmErrT"), "This browser is not keeping data for this site. Your list will be lost when this tab closes.", "and says why");
    });
  },

  async since(b) {
    const state = W.fakeMe({ names: ["SYA002"], universe: UNI });
    state.failNext = { match: "POST /api/me/visit", status: 500 };
    await using(b, "moves", { state }, async (p) => {
      await settle(p.page, 300);
      eq(await p.page.evaluate(() => document.getElementById("fxMember").dataset.visit || null), null, "the first ping failed");
      state.latency = 350;
      await p.page.evaluate(() => {
        new MutationObserver(() => {
          const s = document.querySelector("#fmSince .fm-status");
          if (s && window.__first === undefined) window.__first = [s.textContent, s.getAttribute("role"), document.activeElement && document.activeElement.id];
        }).observe(document.body, { childList: true, subtree: true });
      });
      await p.page.locator('.fx-mem[data-member-open="since"]:visible').first().click();
      await p.page.waitForSelector("#fmSince[open]");
      eq(await p.page.evaluate(() => window.__first), ["Loading.", "status", "fmSinceT"], "Loading is a status and focus is on the title");
      await until(p.page, () => document.querySelectorAll("#fmSince .fm-g").length > 0);
      const order = p.state.calls.filter((c) => c.startsWith("POST /api/me/visit") || c.startsWith("GET /api/me/since"));
      eq(order, ["POST /api/me/visit", "POST /api/me/visit", "GET /api/me/since"], "the click pings again before it reads");
    });
  },

  async yours(b) {
    const mk = (id, title, prefix, n, kind, rest) => ({ id, title, summary: title + ".", total: n, error: false, more: 0, place: "the " + title + " page", href: "/flows/" + id + "/", lines: names(prefix, n).map((t, i) => ({ t, kind, rest: rest + " " + i })) });
    const model = { v: 1, state: "some", serverNow: SERVER_NOW, lastVisitMs: Date.UTC(2026, 2, 11, 11, 5), status: "x", note: null, groups: [mk("flow", "New flagged windows", "SYB", 1000, "flow", "window"), mk("moves", "Large moves", "SYC", 1000, "move", "move"), mk("board", "Board changes", "SYD", 1000, "cleared", "joined")] };
    model.groups[2].lines = model.groups[2].lines.map((l, i) => ({ ...l, kind: i === 999 ? "faded" : "cleared" }));
    const state = W.fakeMe({ names: ["SYB000", "SYC640", "SYD999", "SYE001"], universe: UNI, since: model });
    await using(b, "moves", { state }, async (p) => {
      await openDialog(p, "since");
      await until(p.page, () => document.querySelectorAll("#fmYours").length === 1);
      const rows = await p.page.evaluate(() => [...document.querySelectorAll("#fmSince .fm-g:first-of-type .fm-lines li")].map((li) => li.textContent));
      eq(rows, ["SYB000window 0new flow", "SYC640move 640large move", "SYD999joined 999score faded"], "each name once, in group order, with its rest and chip");
      eq(await tc(p.page, "#fmSince .fm-status"), "Changes since Wed 11 Mar, 14:05 TRT.", "the status line names the visit in TRT");
    });
    const both = W.fakeMe({ names: ["SYB001", "SYC001"], universe: UNI, since: { ...model, groups: [mk("flow", "New flagged windows", "SYB", 5, "flow", "window"), mk("moves", "Large moves", "SYB", 5, "move", "move")] } });
    await using(b, "moves", { state: both }, async (p) => {
      await openDialog(p, "since");
      await until(p.page, () => document.querySelectorAll("#fmYours").length === 1);
      const rows = await p.page.evaluate(() => [...document.querySelectorAll("#fmSince .fm-g:first-of-type .fm-lines li")].map((li) => li.textContent));
      eq(rows, ["SYB001window 1new flow, large move"], "a name in two groups shows both chips, joined for a screen reader by a spoken comma");
    });
  },

  async partial(b) {
    const g = (id, title, extra) => ({ id, title, summary: title + ".", total: 3, error: false, more: 0, place: "the " + title + " page", href: "/flows/" + id + "/", lines: [{ t: "SYB001", kind: id, rest: "r" }], ...extra });
    const model = { v: 1, state: "some", serverNow: SERVER_NOW, lastVisitMs: Date.UTC(2026, 2, 11, 11, 5), status: "x", note: null, groups: [
      g("flow", "New flagged windows", {}), g("moves", "Large moves", { more: 214, total: 1214 }), { id: "board", title: "Board changes", summary: "Board changes: the score track did not load.", total: 0, error: true, lines: [], more: 0, place: "the Bullish and Bearish pages", href: "/flows/long/" },
      g("entering", "Entering the 21-session window", { more: 5, total: 8, names: ["SYB001", "SYB777"] }),
    ] };
    await using(b, "moves", { state: W.fakeMe({ names: ["SYB001", "SYB777"], universe: UNI, since: model }) }, async (p) => {
      await openDialog(p, "since");
      await until(p.page, () => document.querySelectorAll("#fmYours").length === 1);
      const text = await p.page.evaluate(() => document.querySelector("#fmSince .fm-g").textContent);
      ok(text.includes("Only the first 1 Large moves lines were checked for your names."), "a cut group with no names says it was partly checked: " + text);
      ok(text.includes("Board changes could not be checked for your names."), "a failed group says it could not be checked");
      ok(!text.includes("Entering the 21-session window lines were checked") && !text.includes("Entering the 21-session window could not"), "a cut group that sent its names is complete");
      eq(await p.page.evaluate(() => [...document.querySelectorAll("#fmSince .fm-g")].map((s) => s.querySelector("h3").textContent)), ["Your names", "New flagged windows", "Large moves", "Board changes", "Entering the 21-session window"], "the headings");
      ok((await p.page.evaluate(() => document.querySelectorAll("#fmSince .fm-g")[3].textContent)).includes("— Board changes: the score track did not load."), "a failed group shows a dash where its total would be, with the reason");
      const names3 = await p.page.evaluate(() => [...document.querySelectorAll("#fmSince .fm-g:first-of-type .fm-lines li")].map((li) => li.textContent));
      ok(names3.some((t) => t.startsWith("SYB777") && t.includes("report ahead")), "a name found only in a cut group's names list is still shown, with its chip");
      ok(names3.some((t) => t.startsWith("SYB777") && t.includes("— detail not kept (list cut)")), "and says why there is no detail: a dash with its reason");
      ok(!names3.some((t) => t.startsWith("SYB001") && t.includes("detail not kept")), "while a name that has a line shows the line");
    });
  },

  async handoff(b) {
    const empty = W.fakeMe({ universe: UNI });
    await using(b, "moves", { state: empty }, async (p) => {
      await openDialog(p, "since");
      await until(p.page, () => document.querySelectorAll("#fmYours").length === 1);
      eq(await tc(p.page, "#fmSince .fm-g .fm-note"), "Your list is empty. Star a ticker or add names in My list.", "an empty list says how to start");
      await p.page.click("#fmSince .fm-quiet");
      await p.page.waitForSelector("#fmList[open]");
      eq(await p.page.evaluate(() => document.querySelectorAll("dialog[open]").length), 1, "the first dialog is gone");
      await p.page.keyboard.press("Escape");
      await until(p.page, () => document.querySelectorAll("dialog[open]").length === 0);
      await settle(p.page, 100);
      eq(await p.page.evaluate(() => document.activeElement && document.activeElement.getAttribute("data-member-open")), "since", "focus returns to the button that opened Since, not to body");
    });
    await using(b, "moves", { state: W.fakeMe({ names: ["SYA001"], universe: UNI }) }, async (p) => {
      await openDialog(p, "since");
      await until(p.page, () => document.querySelectorAll("#fmYours").length === 1);
      eq(await tc(p.page, "#fmSince .fm-g .fm-note"), "Your name is not in the lists below.", "one name that matches nothing");
    });
    const lines = [{ t: "SYB001", kind: "flow", rest: "r" }];
    const some = { v: 1, state: "some", serverNow: SERVER_NOW, lastVisitMs: Date.UTC(2026, 2, 11, 11, 5), status: "x", note: null, groups: [
      { id: "flow", title: "New flagged windows", summary: "x", total: 1, error: false, lines, more: 0, place: "the Unusual page", href: "/flows/unusual/" },
    ] };
    await using(b, "moves", { state: W.fakeMe({ names: names("SYA", 12, 1), universe: UNI, since: some }) }, async (p) => {
      await openDialog(p, "since");
      await until(p.page, () => document.querySelectorAll("#fmYours").length === 1);
      eq(await tc(p.page, "#fmSince .fm-g .fm-note"), "None of your 12 names appear below.", "twelve names that match nothing");
    });
  },

  async paging(b) {
    const lines = names("SYC", 1000).map((t, i) => ({ t, kind: "move", rest: "move " + i }));
    const model = { v: 1, state: "some", serverNow: SERVER_NOW, lastVisitMs: Date.UTC(2026, 2, 11, 11, 5), status: "x", note: null, groups: [
      { id: "flow", title: "New flagged windows", summary: "x", total: 1214, error: false, lines, more: 214, place: "the Unusual page", href: "/flows/unusual/" },
    ] };
    await using(b, "moves", { state: W.fakeMe({ names: [], universe: UNI, since: model }) }, async (p) => {
      await openDialog(p, "since");
      await until(p.page, () => document.querySelectorAll("#fmGflow").length === 1);
      const count = () => p.page.evaluate(() => document.querySelectorAll("#fmSince .fm-g:last-of-type .fm-lines li").length);
      const button = () => p.page.evaluate(() => { const g = document.querySelector("#fmSince .fm-g:last-of-type .fm-lw .fm-link"); return g ? g.textContent : null; });
      eq([await count(), await button()], [5, "Show 50 more (995 left)"], "five lines and the first step");
      await p.page.click("#fmSince .fm-g:last-of-type .fm-lw .fm-link");
      eq([await count(), await button()], [55, "Show 50 more (945 left)"], "then fifty more");
      eq(await p.page.evaluate(() => document.activeElement.textContent), "SYC005", "focus lands on the first new line's link");
      for (let i = 0; i < 18; i += 1) await p.page.click("#fmSince .fm-g:last-of-type .fm-lw .fm-link");
      eq([await count(), await button()], [955, "Show the last 45"], "the last step says how many are left");
      await p.page.click("#fmSince .fm-g:last-of-type .fm-lw .fm-link");
      eq([await count(), await button()], [1000, null], "and then the button goes");
      const more = await p.page.evaluate(() => { const a = document.querySelector("#fmSince .fm-g:last-of-type a.fm-pl"); return [a.getAttribute("href"), a.textContent, a.parentElement.textContent]; });
      eq(more, ["/flows/unusual/", "the Unusual page", "214 more on the Unusual page."], "the overflow points at the group's own page");
    });
  },

  async states(b) {
    const base = { v: 1, serverNow: SERVER_NOW, lastVisitMs: Date.UTC(2026, 2, 11, 11, 5), note: null, groups: [] };
    const cases = [
      ["first", { ...base, state: "first", lastVisitMs: null, status: SINCE_COPY.first }, SINCE_COPY.first],
      ["none", { ...base, state: "none", status: "No new nightly data since your last visit at 14:05 TRT." }, "No new nightly data since your last visit at 14:05 TRT."],
      ["unavailable", { ...base, state: "unavailable", status: SINCE_COPY.unavailable }, SINCE_COPY.unavailable],
    ];
    for (const [name, model, want] of cases) {
      await using(b, "moves", { state: W.fakeMe({ names: ["SYA002"], universe: UNI, since: model }) }, async (p) => {
        await openDialog(p, "since");
        await until(p.page, () => document.querySelector("#fmSince .fm-status").textContent !== "Loading.");
        eq(await tc(p.page, "#fmSince .fm-status"), want, name + " copy");
        eq(await p.page.evaluate(() => document.querySelectorAll("#fmSince .fm-g").length), 0, name + " has no groups");
      });
    }
    const quiet = { ...base, state: "quiet", status: "x", quiet: SINCE_COPY.quiet, groups: [] };
    await using(b, "moves", { state: W.fakeMe({ names: ["SYA002"], universe: UNI, since: quiet }) }, async (p) => {
      await openDialog(p, "since");
      await until(p.page, () => document.querySelector("#fmSince .fm-status").textContent !== "Loading.");
      const t = await p.page.evaluate(() => document.querySelector("#fmSince .fm-b").textContent);
      ok(t.includes("Changes since Wed 11 Mar, 14:05 TRT.") && t.includes(SINCE_COPY.quiet) && !t.includes("Your names"), "quiet: the line, the sentence and no Your names block");
    });
    const failing = W.fakeMe({ names: ["SYA002"], universe: UNI });
    failing.sinceFails = true;
    await using(b, "moves", { state: failing }, async (p) => {
      await openDialog(p, "since");
      await until(p.page, () => document.querySelector("#fmSince .fm-status").textContent === "Could not load changes.");
      failing.sinceFails = false;
      await p.page.click("#fmSince .fm-b > .fm-btn");
      await until(p.page, () => document.querySelectorAll("#fmSince .fm-g").length > 0);
      eq(p.state.count("GET /api/me/since"), 2, "Try again asks again");
    });
  },

  async star(b) {
    const state = W.fakeMe({ names: ["SYA002"], universe: UNI });
    await using(b, "ticker", { state, init: [W.INIT.shifts] }, async (p) => {
      await setTicker(p.page, "SYA001");
      await until(p.page, () => { const s = document.querySelector(".fm-star"); return s && !s.hidden; });
      eq([await attr(p.page, ".fm-star", "aria-label"), await attr(p.page, ".fm-star", "aria-pressed")], ["Star SYA001", "false"], "the name and state");
      await p.page.evaluate(() => { window.__shifts = window.__shifts ? [] : null; });
      await p.page.click(".fm-star");
      await until(p.page, () => document.querySelector(".fm-star").getAttribute("aria-pressed") === "true");
      eq(await attr(p.page, ".fm-star", "aria-label"), "Star SYA001", "the name does not change when pressed");
      await settle(p.page, 300);
      eq(await pageLive(p.page), "SYA001 added to My list.", "announced");
      await p.page.click(".fm-star");
      await until(p.page, () => document.querySelector(".fm-star").getAttribute("aria-pressed") === "false");
      await settle(p.page, 300);
      eq([await attr(p.page, ".fm-star", "aria-label"), await pageLive(p.page)], ["Star SYA001", "SYA001 removed from My list."], "and removed");
      eq(leaks(p).filter((l) => l.type !== "request"), [], "no console message names the ticker");
      const shifts = await p.page.evaluate(() => window.__shifts);
      if (shifts) eq(shifts.filter((s) => s.nodes.includes("ft-name")).length, 0, "no layout shift inside the name block");
      await setTicker(p.page, "SYZ777");
      await until(p.page, () => document.querySelector(".fm-star").hidden);
      eq(await p.page.evaluate(() => document.querySelector(".fm-star-slot").getBoundingClientRect().width), 44, "an uncovered, unlisted name hides the star and keeps the slot");
    });
    const listed = W.fakeMe({ names: ["SYZ001"], universe: UNI });
    await using(b, "ticker", { state: listed }, async (p) => {
      await setTicker(p.page, "SYZ001");
      await until(p.page, () => { const s = document.querySelector(".fm-star"); return s && !s.hidden; });
      eq(await attr(p.page, ".fm-star", "aria-pressed"), "true", "an uncovered name that is listed shows pressed");
      await p.page.click(".fm-star");
      await until(p.page, () => document.querySelector(".fm-star").hidden);
      eq(listed.names, [], "and can be removed");
    });
  },

  async starFail(b) {
    const state = W.fakeMe({ names: ["SYA002"], universe: UNI });
    state.failNext = { match: "PUT /api/me/state", status: 500 };
    await using(b, "ticker", { state }, async (p) => {
      await setTicker(p.page, "SYA001");
      await until(p.page, () => { const s = document.querySelector(".fm-star"); return s && !s.hidden; });
      await p.page.click(".fm-star");
      await settle(p.page, 400);
      eq(await attr(p.page, ".fm-star", "aria-pressed"), "false", "a failed save rolls the star back");
      eq(await pageLive(p.page), "Not saved. SYA001 is not in My list.", "and says what is true");
    });
    const slow = W.fakeMe({ names: ["SYA002"], universe: UNI, latency: 300 });
    slow.failNext = { match: "PUT /api/me/state", status: 500 };
    await using(b, "ticker", { state: slow }, async (p) => {
      await setTicker(p.page, "SYA001");
      await until(p.page, () => { const s = document.querySelector(".fm-star"); return s && !s.hidden; });
      await p.page.click(".fm-star");
      await settle(p.page, 100);
      await setTicker(p.page, "SYA003");
      await settle(p.page, 700);
      eq(await pageLive(p.page), "Not saved. SYA001 is not in My list.", "the failure names the ticker that was pressed");
      eq([await attr(p.page, ".fm-star", "aria-label"), await attr(p.page, ".fm-star", "aria-pressed")], ["Star SYA003", "false"], "and the star now describes the new one");
    });
  },

  async serial(b) {
    for (const [clicks, want, pressed, puts] of [[5, ["SYA001", "SYA002"], "true", 1], [4, ["SYA002"], "false", 2], [3, ["SYA001", "SYA002"], "true", 1], [2, ["SYA002"], "false", 2]]) {
      const state = W.fakeMe({ names: ["SYA002"], universe: UNI, latency: 400 });
      await using(b, "ticker", { state }, async (p) => {
        await setTicker(p.page, "SYA001");
        await until(p.page, () => { const s = document.querySelector(".fm-star"); return s && !s.hidden; });
        await p.page.evaluate((n) => { const star = document.querySelector(".fm-star"); for (let i = 0; i < n; i += 1) star.click(); }, clicks);
        await settle(p.page, 1600);
        eq(state.maxInflight, 1, clicks + " presses: never more than one PUT in flight");
        eq(putCount(p), puts, clicks + " presses send " + puts + " PUT" + (puts === 1 ? "" : "s") + ": the first, and one more only if the last press differs from it");
        eq(state.names, want, clicks + " presses: the server ends where the presses leave the star");
        eq(await attr(p.page, ".fm-star", "aria-pressed"), pressed, "and so does the star");
      });
    }
  },

  async loadFail(b) {
    await using(b, "moves", { state: W.fakeMe({ universe: UNI }), failAssets: ["flows-member-ui.js"], clock: T0 }, async (p) => {
      await p.page.locator('.fx-mem[data-member-open="list"]:visible').first().click();
      await settle(p.page, 200);
      eq(await p.page.evaluate(() => document.querySelector('.fx-mem[data-member-open="list"]').getAttribute("aria-busy")), "true", "while the dialogs load the button says it is busy");
      await p.page.clock.fastForward(16000);
      await settle(p.page, 200);
      eq(await p.page.evaluate(() => document.querySelector('.fx-mem[data-member-open="list"]').getAttribute("aria-busy")), null, "a file that never arrives does not leave it busy for good");
      eq(await pageLive(p.page), "Could not load. Reload the page.", "and the page says so");
      eq(await p.page.evaluate(() => document.querySelectorAll("dialog.fm-dlg").length), 0, "with no dialog opened");
    });
  },

  async lazy(b) {
    const listed = W.fakeMe({ names: ["SYA002"], universe: UNI });
    await using(b, "ticker", { state: listed }, async (p) => {
      await setTicker(p.page, "SYA001");
      await until(p.page, () => { const s = document.querySelector(".fm-star"); return s && !s.hidden; });
      await p.page.click(".fm-star");
      await until(p.page, () => document.querySelector(".fm-star").getAttribute("aria-pressed") === "true");
      await settle(p.page, 300);
      eq(p.assets.filter((a) => /^(flows-member|flows-member-ui|storage)\.js$|^flows-member\.css$/.test(a)), ["flows-member.js"], "a server list on the ticker page loads the module and nothing else: no dialogs, no sheet, no store");
      eq(listed.names, ["SYA001", "SYA002"], "and the star still saves");
      await openDialog(p, "list");
      eq(p.assets.filter((a) => /^(flows-member|flows-member-ui|storage)\.js$|^flows-member\.css$/.test(a)).sort(), ["flows-member-ui.js", "flows-member.css", "flows-member.js"], "opening My list for a member whose server list has names adds the dialogs and the sheet, and no store");
    });
    await using(b, "ticker", { state: W.fakeMe({ universe: UNI }), init: SEED(["SYA002"]) }, async (p) => {
      await setTicker(p.page, "SYA001");
      await until(p.page, () => { const s = document.querySelector(".fm-star"); return s && !s.hidden; });
      eq(p.assets.includes("storage.js"), false, "a server member with an empty list does not load the store for the star");
      await openDialog(p, "list");
      eq(p.assets.includes("storage.js"), true, "but opening My list does, because the device copy may be offered");
      await until(p.page, () => document.querySelector("#fmList .fm-offer") && !document.querySelector("#fmList .fm-offer").hidden);
      eq(await tc(p.page, "#fmList .fm-offer p"), "This device holds 1 name. Save them to your account?", "and the offer is there");
    });
    const device = W.fakeMe({ deviceOnly: true, universe: UNI });
    await using(b, "ticker", { state: device, init: SEED(["SYA002"]) }, async (p) => {
      await setTicker(p.page, "SYA001");
      await until(p.page, () => { const s = document.querySelector(".fm-star"); return s && !s.hidden; });
      eq(p.assets.includes("storage.js"), true, "a device list loads the store before the star is drawn, because the star reads it");
      eq(p.assets.includes("flows-member-ui.js"), false, "and still no dialogs");
      await p.page.click(".fm-star");
      await until(p.page, () => document.querySelector(".fm-star").getAttribute("aria-pressed") === "true");
      eq(await p.page.evaluate((k) => JSON.parse(localStorage.getItem(k)).value.names, W.deviceKey()), ["SYA001", "SYA002"], "and a press writes the device copy");
    });
    await using(b, "moves", { state: W.fakeMe({ names: ["SYA002"], universe: UNI }), exportOpen: true }, async (p) => {
      await p.page.click("details[data-member-export] > summary");
      await p.page.waitForSelector(".ui-exp-i");
      eq(p.assets.filter((a) => /^(flows-member|flows-member-ui|storage)\.js$|^flows-member\.css$/.test(a)), ["flows-member.js"], "an export menu loads the module and nothing else");
      await p.page.locator(".ui-exp-i").nth(2).click();
      await p.page.waitForSelector("#fmHist[open]");
      eq(p.assets.includes("flows-member-ui.js") && p.assets.includes("flows-member.css"), true, "and its history row loads the dialogs and the sheet when it is pressed");
    });
  },

  async serialTwo(b) {
    const state = W.fakeMe({ names: ["SYA002"], universe: UNI, latency: 500 });
    await using(b, "ticker", { state }, async (p) => {
      await setTicker(p.page, "SYA001");
      await until(p.page, () => { const s = document.querySelector(".fm-star"); return s && !s.hidden; });
      await p.page.evaluate(() => document.querySelector(".fm-star").click());
      await setTicker(p.page, "SYA003");
      await p.page.evaluate(() => document.querySelector(".fm-star").click());
      await settle(p.page, 2200);
      eq(state.maxInflight, 1, "a press on one name and a press on the next never overlap");
      eq(state.names, ["SYA001", "SYA002", "SYA003"], "and both land");
      eq(putCount(p), 2, "in two writes");
    });
  },

  async starStale(b) {
    const state = W.fakeMe({ names: ["SYA002"], universe: UNI, staleTimes: 1, concurrent: ["SYA009"] });
    await using(b, "ticker", { state }, async (p) => {
      await setTicker(p.page, "SYA001");
      await until(p.page, () => { const s = document.querySelector(".fm-star"); return s && !s.hidden; });
      await p.page.click(".fm-star");
      await until(p.page, () => document.querySelector(".fm-star").getAttribute("aria-pressed") === "true");
      await settle(p.page, 500);
      eq(state.names, ["SYA001", "SYA002", "SYA009"], "a star pressed while another tab added a name keeps that name");
      eq([putCount(p), state.count("GET /api/me/state")], [2, 2], "after one refetch and one retry");
      eq(await pageLive(p.page), "SYA001 added to My list.", "and says what happened");
    });
    const always = W.fakeMe({ names: ["SYA002"], universe: UNI, staleTimes: 9, concurrent: ["SYA009"] });
    await using(b, "ticker", { state: always }, async (p) => {
      await setTicker(p.page, "SYA001");
      await until(p.page, () => { const s = document.querySelector(".fm-star"); return s && !s.hidden; });
      await p.page.click(".fm-star");
      await settle(p.page, 800);
      eq(putCount(p), 2, "two conflicts stop at two PUTs");
      eq(always.names, ["SYA002", "SYA009"], "and the server's list is untouched by the star");
      eq(await attr(p.page, ".fm-star", "aria-pressed"), "false", "the star shows the server's list");
      eq(await pageLive(p.page), "Not saved. SYA001 is not in My list.", "and says it was not saved");
    });
  },

  async unreadable(b) {
    const state = W.fakeMe({ unreadable: true, universe: UNI });
    await using(b, "moves", { state }, async (p) => {
      await openDialog(p, "list");
      const seen = () => p.page.evaluate(() => ({
        count: !document.querySelector("#fmList .fm-count").hidden, fix: !document.querySelector("#fmList .fm-fix").hidden, form: !document.querySelector("#fmList .fm-add").hidden, hint: !document.getElementById("fmHint").hidden,
        sw: document.getElementById("fmDev").getAttribute("aria-disabled"), note: document.getElementById("fmDevNote").textContent,
      }));
      const fixText = () => p.page.evaluate(() => [...document.querySelectorAll("#fmList .fm-fix p, #fmList .fm-fix button")].map((e) => e.textContent));
      eq(await seen(), { count: false, fix: true, form: false, hint: false, sw: "true", note: "Start a new list to change where it is saved." }, "a list the server cannot open hides the add form and says what to do");
      eq(await fixText(), ["Your saved list could not be read.", "Start a new list"], "and names the one way out");
      await p.page.click("#fmDev", { force: true });
      await settle(p.page, 250);
      eq([putCount(p), await live(p.page, "fmList")], [0, "Start a new list to change where it is saved."], "the switch explains and sends nothing");
      await p.page.click("#fmList .fm-fix button");
      eq(await fixText(), ["Your saved list could not be read.", "Replace it with a new, empty list? The old list cannot be recovered after this.", "Replace", "Keep it for now"], "asking first says that the old list is lost");
      eq(await active(p.page), "Keep it for now", "focus starts on the safe choice");
      await p.page.click("#fmList .fm-fix button:last-child");
      eq([await fixText(), await active(p.page), putCount(p)], [["Your saved list could not be read.", "Start a new list"], "Start a new list", 0], "keeping it goes back to the first step, with focus, and sends nothing");
      await p.page.click("#fmList .fm-fix button");
      await p.page.click("#fmList .fm-fix .fm-danger");
      await until(p.page, () => document.querySelector("#fmList .fm-fix").hidden);
      eq(putCount(p), 1, "Replace sends one PUT");
      const sent = putBodies(p)[0];
      eq([sent, p.state.log.find((l) => l.method === "PUT").headers["if-match"]], [{ deviceOnly: false, watchlist: [], replaceUnreadable: true }, '"w0"'], "with the consent flag, an empty list and the version it read");
      eq([state.unreadable, state.names], [false, []], "and the server holds a new list");
      eq([(await seen()).form, await active(p.page)], [true, "fmAdd"], "the add form is back with focus in it");
      await settle(p.page, 250);
      eq(await live(p.page, "fmList"), "A new list is started.", "announced");
      await add(p, "SYA001");
      await until(p.page, () => document.querySelectorAll("#fmList .fm-row").length === 1);
      eq(Object.keys(putBodies(p)[1]).sort(), ["deviceOnly", "watchlist"], "the next save does not carry the flag");
      eq(state.names, ["SYA001"], "and saves");
    });
    const behind = W.fakeMe({ unreadable: true, universe: UNI, staleTimes: 1 });
    await using(b, "moves", { state: behind }, async (p) => {
      await openDialog(p, "list");
      await p.page.click("#fmList .fm-fix button");
      await p.page.click("#fmList .fm-fix .fm-danger");
      await until(p.page, () => document.getElementById("fmErr").textContent.length > 0);
      eq([putCount(p), behind.unreadable], [1, true], "a Replace that finds the version moved sends one PUT and the row is untouched");
      eq(await tc(p.page, "#fmErr"), "My list changed elsewhere. Close it and open it again.", "it says so and offers no retry on its own");
      eq(await p.page.evaluate(() => !document.querySelector("#fmList .fm-fix").hidden && document.querySelector("#fmList .fm-fix").dataset.state), "idle", "and the first step is back");
    });
    const absent = W.fakeMe({ keyAbsent: true, unreadable: true, universe: UNI });
    await using(b, "moves", { state: absent, init: SEED(["SYA002"]) }, async (p) => {
      await openDialog(p, "list");
      eq(await p.page.evaluate(() => [document.querySelector("#fmList .fm-fix").hidden, document.querySelector("#fmList .fm-add").hidden, document.getElementById("fmDevNote").textContent]), [true, false, "Saving to your account is not available yet. This list stays on this device."], "with the key missing a sealed list is not offered a replacement, and the form works on this device");
      await add(p, "SYA003");
      await until(p.page, () => document.querySelectorAll("#fmList .fm-row").length === 2);
      eq(putCount(p), 0, "without a PUT");
    });
  },

  async unreadableStar(b) {
    const pressedSeen = (p) => p.page.evaluate(() => window.__pressed);
    const record = "window.__pressed = []; new MutationObserver((l) => { for (const m of l) if (m.target.getAttribute('aria-pressed') === 'true') window.__pressed.push(1); }).observe(document, { subtree: true, attributes: true, attributeFilter: ['aria-pressed'] });";
    const state = W.fakeMe({ unreadable: true, universe: UNI });
    await using(b, "ticker", { state, init: [record] }, async (p) => {
      await setTicker(p.page, "SYA001");
      await until(p.page, () => { const s = document.querySelector(".fm-star"); return s && !s.hidden; });
      eq([await attr(p.page, ".fm-star", "aria-disabled"), await attr(p.page, ".fm-star", "aria-pressed")], ["true", "false"], "an unreadable list leaves the star unpressable");
      const dim = await p.page.evaluate(() => getComputedStyle(document.querySelector(".fm-star")).color);
      await p.page.click(".fm-star", { force: true });
      await settle(p.page, 300);
      eq([putCount(p), await pageLive(p.page), await pressedSeen(p)], [0, "Your saved list could not be read. Open My list.", []], "a press sends nothing, says where to go and never shows the star pressed");
      await openDialog(p, "list");
      await p.page.click("#fmList .fm-fix button");
      await p.page.click("#fmList .fm-fix .fm-danger");
      await until(p.page, () => document.querySelector("#fmList .fm-fix").hidden);
      await p.page.keyboard.press("Escape");
      await until(p.page, () => document.querySelectorAll("dialog[open]").length === 0);
      eq(await attr(p.page, ".fm-star", "aria-disabled"), "false", "starting a new list frees the star");
      ok(dim !== await p.page.evaluate(() => getComputedStyle(document.querySelector(".fm-star")).color), "and an unpressable star is drawn dimmer than a live one");
      await p.page.click(".fm-star");
      await until(p.page, () => document.querySelector(".fm-star").getAttribute("aria-pressed") === "true");
      eq(state.names, ["SYA001"], "and it saves");
    });
    const flips = W.fakeMe({ names: ["SYA002"], universe: UNI, staleTimes: 1, unreadableOnStale: true });
    await using(b, "ticker", { state: flips }, async (p) => {
      await setTicker(p.page, "SYA001");
      await until(p.page, () => { const s = document.querySelector(".fm-star"); return s && !s.hidden; });
      await p.page.click(".fm-star");
      await settle(p.page, 500);
      eq([putCount(p), flips.count("GET /api/me/state")], [1, 2], "a stale write whose re-read comes back unreadable sends no second PUT");
      eq([await pageLive(p.page), await attr(p.page, ".fm-star", "aria-pressed"), await attr(p.page, ".fm-star", "aria-disabled")], ["Your saved list could not be read. Open My list.", "false", "true"], "and the star says why");
    });
    const racing = W.fakeMe({ names: ["SYA002"], universe: UNI });
    await using(b, "ticker", { state: racing }, async (p) => {
      await setTicker(p.page, "SYA001");
      await until(p.page, () => { const s = document.querySelector(".fm-star"); return s && !s.hidden; });
      racing.unreadable = true;
      await p.page.click(".fm-star");
      await settle(p.page, 500);
      eq([putCount(p), racing.names, await pageLive(p.page)], [1, ["SYA002"], "Your saved list could not be read. Open My list."], "a list that became unreadable after the page loaded is refused by the server, left alone and reported");
      eq(await attr(p.page, ".fm-star", "aria-disabled"), "true", "and the star now knows");
    });
    const moved = W.fakeMe({ names: ["SYA002"], universe: UNI, staleTimes: 1, deviceOnStale: true });
    await using(b, "ticker", { state: moved }, async (p) => {
      await setTicker(p.page, "SYA001");
      await until(p.page, () => { const s = document.querySelector(".fm-star"); return s && !s.hidden; });
      await p.page.click(".fm-star");
      await until(p.page, () => document.querySelector(".fm-star").getAttribute("aria-pressed") === "true");
      await settle(p.page, 300);
      eq(putCount(p), 1, "a stale write whose re-read says the list moved to this device sends no second PUT to the server");
      eq(await p.page.evaluate((k) => JSON.parse(localStorage.getItem(k)).value.names, W.deviceKey()), ["SYA001"], "and the press lands in the device copy");
    });
  },

  async late(b) {
    const gate = () => { let go; const promise = new Promise((r) => { go = r; }); return { promise, go }; };
    const OPEN = '.fx-mem[data-member-open="list"]:visible';
    const g1 = gate();
    const s1 = W.fakeMe({ universe: UNI });
    await using(b, "moves", { state: s1, holdAssets: { "flows-member-ui.js": g1.promise }, clock: T0 }, async (p) => {
      await p.page.locator(OPEN).first().click();
      await settle(p.page, 200);
      await advance(p.page, 17000);
      await settle(p.page, 250);
      eq(await pageLive(p.page), "Could not load. Reload the page.", "the message shows at 15 seconds");
      g1.go();
      await settle(p.page, 700);
      eq([await p.page.evaluate(() => document.querySelectorAll("dialog.fm-dlg").length), s1.count("GET /api/me/state")], [0, 0], "a file that lands afterwards opens nothing and asks for nothing");
      await p.page.locator(OPEN).first().click();
      await p.page.waitForSelector("dialog.fm-dlg[open]", { timeout: 5000 });
      eq(await tc(p.page, "#fmList h2"), "My list", "the next press opens it at once");
    });
    const g2 = gate();
    const s2 = W.fakeMe({ universe: UNI });
    await using(b, "moves", { state: s2, holdAssets: { "flows-member-ui.js": g2.promise } }, async (p) => {
      await p.page.evaluate((q) => { const el = document.querySelector(q); el.click(); el.click(); }, OPEN.replace(":visible", ""));
      await settle(p.page, 300);
      g2.go();
      await p.page.waitForSelector("dialog.fm-dlg[open]", { timeout: 5000 });
      await settle(p.page, 300);
      eq([s2.count("GET /api/me/state"), await p.page.evaluate(() => document.querySelectorAll("dialog.fm-dlg").length)], [1, 1], "a second press while the dialogs load does not open them twice");
    });
    const g6 = gate();
    const g7 = gate();
    await using(b, "moves", { state: W.fakeMe({ universe: UNI }), holdAssets: { "flows-member-ui.js": g6.promise, "flows-member.css": g7.promise }, clock: T0 }, async (p) => {
      await p.page.locator(OPEN).first().click();
      await settle(p.page, 200);
      await advance(p.page, 9000);
      g6.go();
      await settle(p.page, 400);
      for (let i = 0; i < 12 && (await pageLive(p.page)) !== "Could not load. Reload the page."; i += 1) await advance(p.page, 1000);
      eq(await pageLive(p.page), "Could not load. Reload the page.", "the message shows at 15 seconds with the files in and the sheet still out");
      g7.go();
      await settle(p.page, 700);
      eq(await p.page.evaluate(() => document.querySelectorAll("dialog.fm-dlg").length), 0, "a sheet that lands after the message opens nothing either");
    });
    const g3 = gate();
    const s3 = W.fakeMe({ names: ["SYA002"], universe: UNI });
    await using(b, "moves", { state: s3, init: SEED(["SYA003"]), holdAssets: { "storage.js": g3.promise }, clock: T0 }, async (p) => {
      await openDialog(p, "list");
      await p.page.click(".fm-del .fm-danger-o");
      await p.page.click(".fm-del .fm-danger");
      await settle(p.page, 300);
      await advance(p.page, 10000);
      await until(p.page, () => document.querySelector(".fm-del").textContent.includes("Not deleted."));
      eq(await live(p.page, "fmList"), "Not deleted.", "the dialog says it was not deleted");
      g3.go();
      await settle(p.page, 800);
      eq([s3.deleted, s3.count("DELETE /api/me/state"), await p.page.evaluate((k) => JSON.parse(localStorage.getItem(k)).value.names, W.deviceKey())], [0, 0, ["SYA003"]], "a store that lands after the message deletes nothing, ever, and the device copy is intact");
      eq(p.assets.filter((a) => a === "storage.js").length, 1, "and it was requested once");
      await p.page.click(".fm-del .fm-btn");
      await p.page.click(".fm-del .fm-danger");
      await until(p.page, () => document.querySelector(".fm-del").textContent.includes("Your saved data is deleted."));
      eq([s3.deleted, await p.page.evaluate((k) => localStorage.getItem(k), W.deviceKey())], [1, null], "a second try with the store in place deletes both");
    });
    const g4 = gate();
    await using(b, "moves", { state: W.fakeMe({ universe: UNI }), holdAssets: { "flows-member.css": g4.promise } }, async (p) => {
      await p.page.locator(OPEN).first().click();
      await settle(p.page, 700);
      eq([await p.page.evaluate(() => document.querySelectorAll("dialog.fm-dlg").length), await p.page.evaluate(() => document.querySelector('.fx-mem[data-member-open="list"]').getAttribute("aria-busy"))], [0, "true"], "no dialog stands unstyled while the sheet loads, and the button says it is busy");
      g4.go();
      await p.page.waitForSelector("dialog.fm-dlg[open]", { timeout: 5000 });
      eq(await p.page.evaluate(() => getComputedStyle(document.querySelector("dialog.fm-dlg")).borderTopLeftRadius !== "0px"), true, "it opens with the sheet applied");
    });
    const g5 = gate();
    await using(b, "moves", { state: W.fakeMe({ universe: UNI }), holdAssets: { "flows-member.css": g5.promise }, clock: T0 }, async (p) => {
      await p.page.locator(OPEN).first().click();
      await settle(p.page, 300);
      await advance(p.page, 12000);
      await settle(p.page, 300);
      eq([await pageLive(p.page), await p.page.evaluate(() => document.querySelector('.fx-mem[data-member-open="list"]').getAttribute("aria-busy"))], ["Could not load. Reload the page.", null], "a sheet that does not arrive says so and frees the button");
      g5.go();
      await settle(p.page, 700);
      eq(await p.page.evaluate(() => document.querySelectorAll("dialog.fm-dlg").length), 0, "and opens nothing when it does");
      await p.page.locator(OPEN).first().click();
      await p.page.waitForSelector("dialog.fm-dlg[open]", { timeout: 5000 });
    });
    await using(b, "moves", { state: W.fakeMe({ universe: UNI }), failAssets: ["flows-member.css"] }, async (p) => {
      await p.page.locator(OPEN).first().click();
      await settle(p.page, 700);
      eq([await pageLive(p.page), await p.page.evaluate(() => document.querySelectorAll("dialog.fm-dlg").length)], ["Could not load. Reload the page.", 0], "a sheet that fails opens no dialog");
    });
  },

  async kitVersion(b) {
    const mismatch = { "flows-member.js": [["v: 1, ui: null", "v: 2, ui: null"]] };
    await using(b, "moves", { state: W.fakeMe({ universe: UNI }), mutate: mismatch }, async (p) => {
      await p.page.locator('.fx-mem[data-member-open="list"]:visible').first().click();
      await settle(p.page, 800);
      eq([await pageLive(p.page), await p.page.evaluate(() => document.querySelectorAll("dialog.fm-dlg").length), p.logs.filter((l) => l.type === "pageerror")], ["Could not load. Reload the page.", 0, []], "dialogs built for another version of the module do not open, and say so");
    });
  },

  async exportToggle(b) {
    const state = W.fakeMe({ used: 12, serverNow: SERVER_NOW, universe: UNI });
    await using(b, "moves", { state, exportOpen: true }, async (p) => {
      await p.page.click("details[data-member-export] > summary");
      await p.page.waitForSelector(".ui-exp-i");
      await until(p.page, () => document.querySelector(".ui-exp-n") && document.querySelector(".ui-exp-n").textContent.includes("exports left"));
      eq(state.count("GET /api/me/exports"), 1, "one opening reads the limit once");
      await p.page.evaluate(() => { const d = document.querySelector("details[data-member-export]"); const ev = new Event("toggle"); d.dispatchEvent(ev); d.dispatchEvent(ev); });
      await settle(p.page, 300);
      eq(state.count("GET /api/me/exports"), 2, "one toggle event delivered twice reads the limit once more, not twice");
      await p.page.evaluate(() => { document.querySelector("details[data-member-export]").dispatchEvent(new Event("toggle")); });
      await settle(p.page, 300);
      eq(state.count("GET /api/me/exports"), 3, "and a new event reads it again");
    });
    await using(b, "moves", { state: W.fakeMe({ used: 12, serverNow: SERVER_NOW, universe: UNI }), exportOpen: true }, async (p) => {
      await p.page.dblclick("details[data-member-export] > summary");
      await settle(p.page, 600);
      eq(await p.page.evaluate(() => document.querySelector("details[data-member-export]").open), false, "an open and a close in one frame leave the menu closed");
      ok(p.state.count("GET /api/me/exports") <= 1, "and read the limit at most once: " + p.state.count("GET /api/me/exports"));
      await p.page.click("details[data-member-export] > summary");
      await p.page.waitForSelector(".ui-exp-i");
      await until(p.page, () => document.querySelector(".ui-exp-n") && document.querySelector(".ui-exp-n").textContent.includes("exports left"));
      eq(await p.page.evaluate(() => document.querySelectorAll(".ui-exp-i").length), 3, "a later opening still fills the menu");
    });
  },

  async historyRow(b) {
    const exports = [{ page: "moves", rows: 5, cols: ["a", "b"], atMs: Date.UTC(2026, 9, 24, 11, 5) }];
    await using(b, "watch", { state: W.fakeMe({ universe: UNI, exports }), exportsOn: true }, async (p) => {
      await openDialog(p, "list");
      eq(await p.page.evaluate(() => [...document.querySelectorAll("#fmList .fm-actions button")].map((x) => x.textContent)), ["Copy names", "Download list and export log", "Export history"], "a page with no export menu reaches the history from My list");
      await p.page.getByRole("button", { name: "Export history" }).click();
      await p.page.waitForSelector("#fmHist[open] table");
      eq(await p.page.evaluate(() => document.querySelectorAll("dialog[open]").length), 1, "and leaves one dialog open");
      await p.page.keyboard.press("Escape");
      await until(p.page, () => document.querySelectorAll("dialog[open]").length === 0);
      await settle(p.page, 100);
      eq(await active(p.page), "My list", "focus returns to the button that opened My list");
    });
    await using(b, "watch", { state: W.fakeMe({ universe: UNI, exports }), exportsOn: false }, async (p) => {
      await openDialog(p, "list");
      eq(await p.page.evaluate(() => [...document.querySelectorAll("#fmList .fm-actions button")].map((x) => x.textContent)), ["Copy names", "Download list and export log"], "with exports off there is no history row");
    });
  },

  async download(b) {
    const exports = [{ page: "moves", rows: 5, cols: ["a", "b"], atMs: Date.UTC(2026, 9, 24, 11, 5) }];
    await using(b, "moves", { state: W.fakeMe({ names: ["SYA002", "SYA005"], universe: UNI, exports, serverNow: SERVER_NOW }), exportOpen: true }, async (p) => {
      await openDialog(p, "list");
      const dl = p.page.waitForEvent("download", { timeout: 6000 });
      dl.catch(() => 0);
      await p.page.getByRole("button", { name: "Download list and export log" }).click({ timeout: 5000 });
      const file = await dl;
      eq(file.suggestedFilename(), "flows-my-list-2026-10-24.json", "the file is named for the list and the TRT day");
      const payload = JSON.parse(readFileSync(await file.path(), "utf8"));
      eq(Object.keys(payload).sort(), ["export_history", "exported_trt", "member", "my_list"], "it holds four things");
      eq([payload.my_list, payload.export_history, payload.exported_trt], [{ stored: "our server", names: ["SYA002", "SYA005"] }, [{ when_trt: "2026-10-24 14:05 TRT", page: "moves", rows: 5, columns: ["a", "b"] }], "2026-10-24 14:00 TRT"], "the list, the log with its column names, and the time in TRT");
      await settle(p.page, 200);
      eq(await live(p.page, "fmList"), "Your list and export log are downloaded.", "and the dialog says what was downloaded");
    });
  },

  async menu(b) {
    const state = W.fakeMe({ used: 12, serverNow: SERVER_NOW, universe: UNI });
    await using(b, "moves", { state, exportOpen: true, init: [W.INIT.revokes], clock: SERVER_NOW }, async (p) => {
      await p.page.click("details[data-member-export] > summary");
      await p.page.waitForSelector(".ui-exp-i");
      await until(p.page, () => document.querySelector(".ui-exp-n") && document.querySelector(".ui-exp-n").textContent.includes("exports left"));
      eq(await tc(p.page, ".ui-exp-n"), "38 of 50 exports left in 24 hours.", "the quota note");
      eq(await p.page.evaluate(() => [...document.querySelectorAll(".ui-exp-i")].map((x) => x.textContent)), ["CSV, nightly figures", "JSON, nightly figures", "Export history"], "the three items");
      eq(await p.page.evaluate(() => { const id = document.querySelector(".ui-exp-n").id; return [id.length > 0, ...[...document.querySelectorAll(".ui-exp-i")].map((x) => x.getAttribute("aria-describedby") === id ? "note" : x.getAttribute("aria-describedby"))]; }), [true, "note", "note", null], "the two file items are described by the limit line, the history item is not");
      eq(await junk(p.page), [], "and the menu says nothing like null");
      eq(p.state.count("GET /api/me/exports"), 1, "one read of the limit for one opening");
      const download = p.page.waitForEvent("download");
      await p.page.evaluate(() => { const b = document.querySelector(".ui-exp-i"); b.click(); b.click(); });
      const file = await download;
      eq(file.suggestedFilename(), "flows-moves-2026-10-24-TRT.csv", "the file name comes from the header");
      await settle(p.page, 300);
      eq(p.state.count("POST /api/me/export"), 1, "a double activation sends one POST");
      eq(await active(p.page), "Export", "focus returns to the Export button");
      eq(await pageLive(p.page), "Exported 8 rows as CSV.", "the result is announced from the row count");
      eq(await p.page.evaluate(() => window.__revokes.length), 0, "the file's address is kept at first");
      await p.page.clock.fastForward(4100);
      eq(await p.page.evaluate(() => window.__revokes.length), 1, "and let go after four seconds");
    });
    state.dispo = "attachment; filename=\"old.csv\"; filename*=UTF-8''new%20name.csv";
    await using(b, "moves", { state, exportOpen: true }, async (p) => {
      await p.page.click("details[data-member-export] > summary");
      await p.page.waitForSelector(".ui-exp-i");
      const d = p.page.waitForEvent("download");
      await p.page.click(".ui-exp-i");
      eq((await d).suggestedFilename(), "new name.csv", "filename* wins");
    });
    state.dispo = 'attachment; filename="../../x/evil.csv"';
    await using(b, "moves", { state, exportOpen: true }, async (p) => {
      await p.page.click("details[data-member-export] > summary");
      await p.page.waitForSelector(".ui-exp-i");
      const d = p.page.waitForEvent("download");
      await p.page.click(".ui-exp-i");
      eq((await d).suggestedFilename(), "xevil.csv", "path characters never reach the file name");
    });
  },

  async quota(b) {
    const full = W.fakeMe({ used: 50, serverNow: SERVER_NOW, freesAtMs: Date.UTC(2026, 9, 24, 11, 5), universe: UNI });
    await using(b, "moves", { state: full, exportOpen: true }, async (p) => {
      await p.page.click("details[data-member-export] > summary");
      await until(p.page, () => document.querySelector(".ui-exp-n") && document.querySelector(".ui-exp-n").textContent.includes("Export limit reached"));
      eq(await tc(p.page, ".ui-exp-n"), "Export limit reached. Next export available at 14:05 TRT.", "the limit and when it frees, in TRT");
      eq(await p.page.evaluate(() => [...document.querySelectorAll(".ui-exp-i")].map((x) => x.getAttribute("aria-disabled"))), ["true", "true", null], "the file items are disabled, the history is not");
      await p.page.click(".ui-exp-i", { force: true });
      await settle(p.page, 200);
      eq(p.state.count("POST /api/me/export"), 0, "a disabled item sends nothing");
      await p.page.evaluate(AXE);
      eq(await p.page.evaluate(async () => (await window.axe.run(document.querySelector("details[data-member-export]"), { rules: { region: { enabled: false } }, resultTypes: ["violations"] })).violations.map((v) => v.id + ":" + v.nodes.map((n) => n.target.join(" ")).join("|"))), [], "axe finds nothing in the open menu at its limit");
    });
    const late = W.fakeMe({ used: 50, serverNow: Date.UTC(2026, 9, 24, 20, 50), freesAtMs: Date.UTC(2026, 9, 25, 6, 10), universe: UNI });
    await using(b, "moves", { state: late, exportOpen: true }, async (p) => {
      await p.page.click("details[data-member-export] > summary");
      await until(p.page, () => document.querySelector(".ui-exp-n") && document.querySelector(".ui-exp-n").textContent.includes("Export limit reached"));
      eq(await tc(p.page, ".ui-exp-n"), "Export limit reached. Next export available tomorrow at 09:10 TRT.", "past midnight in TRT it says tomorrow");
    });
    await using(b, "moves", { state: late, exportOpen: true, clock: Date.UTC(2026, 9, 25, 1, 50) }, async (p) => {
      await p.page.click("details[data-member-export] > summary");
      await until(p.page, () => document.querySelector(".ui-exp-n") && document.querySelector(".ui-exp-n").textContent.includes("Export limit reached"));
      eq(await tc(p.page, ".ui-exp-n"), "Export limit reached. Next export available tomorrow at 09:10 TRT.", "a device clock five hours fast changes nothing: the day is the server's");
    });
    const zone = W.fakeMe({ used: 50, serverNow: Date.UTC(2026, 9, 24, 20, 50), freesAtMs: Date.UTC(2026, 9, 25, 6, 10), universe: UNI });
    await using(b, "moves", { state: zone, exportOpen: true, clock: Date.UTC(2026, 9, 24, 20, 50), timezoneId: "America/New_York" }, async (p) => {
      await p.page.click("details[data-member-export] > summary");
      await until(p.page, () => document.querySelector(".ui-exp-n") && document.querySelector(".ui-exp-n").textContent.includes("Export limit reached"));
      eq(await tc(p.page, ".ui-exp-n"), "Export limit reached. Next export available tomorrow at 09:10 TRT.", "a right clock in New York says the same, in TRT");
    });
    const edge = W.fakeMe({ used: 50, serverNow: Date.UTC(2026, 9, 24, 20, 59, 59), freesAtMs: Date.UTC(2026, 9, 24, 21, 0, 1), universe: UNI });
    await using(b, "moves", { state: edge, exportOpen: true, timezoneId: "America/New_York" }, async (p) => {
      await p.page.click("details[data-member-export] > summary");
      await until(p.page, () => document.querySelector(".ui-exp-n") && document.querySelector(".ui-exp-n").textContent.includes("Export limit reached"));
      eq(await tc(p.page, ".ui-exp-n"), "Export limit reached. Next export available tomorrow at 00:00 TRT.", "two seconds across TRT midnight is tomorrow, though it is the same afternoon in New York");
    });
    const broken = W.fakeMe({ universe: UNI });
    broken.exportsFails = true;
    await using(b, "moves", { state: broken, exportOpen: true }, async (p) => {
      await p.page.click("details[data-member-export] > summary");
      await until(p.page, () => document.querySelector(".ui-exp-n") && document.querySelector(".ui-exp-n").textContent.includes("could not check"));
      eq(await tc(p.page, ".ui-exp-n"), "Exports left: — (could not check).", "an unreadable limit is a dash with its reason");
      eq(await p.page.evaluate(() => [...document.querySelectorAll(".ui-exp-i")].map((x) => x.getAttribute("aria-disabled"))), [null, null, null], "and the server decides");
    });
  },

  async exportTexts(b) {
    const cases = [
      ["truncated", (s) => { s.truncated = { shown: 1000, available: 1214 }; }, 0, "Exported 1,000 of 1,214 rows. The file holds the first 1,000 by ticker."],
      ["json", () => 0, 1, "Exported 8 rows as JSON."],
      ["held", (s) => { s.failNext = { match: "POST /api/me/export", status: 403, body: { error: { code: "export_held" } } }; }, 0, "Exports from this page are paused."],
      ["limit", (s) => { s.failNext = { match: "POST /api/me/export", status: 429, body: { error: { code: "export_limit" }, freesAtMs: Date.UTC(2026, 9, 24, 11, 5), serverNow: SERVER_NOW } }; }, 0, "Export limit reached. Next export available at 14:05 TRT."],
      ["tomorrow", (s) => { s.failNext = { match: "POST /api/me/export", status: 429, body: { error: { code: "export_limit" }, freesAtMs: Date.UTC(2026, 9, 25, 6, 10), serverNow: Date.UTC(2026, 9, 24, 20, 50) } }; }, 0, "Export limit reached. Next export available tomorrow at 09:10 TRT."],
      ["rate30", (s) => { s.failNext = { match: "POST /api/me/export", status: 429, body: { error: { code: "rate_limited" } }, headers: { "Retry-After": "30" } }; }, 0, "Too many requests. Try again in 30 seconds."],
      ["rate", (s) => { s.failNext = { match: "POST /api/me/export", status: 429, body: { error: { code: "rate_limited" } } }; }, 0, "Too many requests. Try again in a minute."],
      ["off", (s) => { s.failNext = { match: "POST /api/me/export", status: 404, body: { error: { code: "exports_off" } } }; }, 0, "Exports are not available right now."],
      ["ended", (s) => { s.failNext = { match: "POST /api/me/export", status: 401, body: { error: { code: "unauthorized" } } }; }, 0, "Your session has ended. Sign in again."],
      ["offline", (s) => { s.failNext = { match: "POST /api/me/export", abort: true }; }, 0, "Export failed. We could not reach the server."],
      ["server", (s) => { s.failNext = { match: "POST /api/me/export", status: 500 }; }, 0, "Export failed. Try again in a moment."],
    ];
    for (const [name, setup, which, want] of cases) {
      const state = W.fakeMe({ serverNow: SERVER_NOW, universe: UNI });
      setup(state);
      await using(b, "moves", { state, exportOpen: true }, async (p) => {
        await p.page.click("details[data-member-export] > summary");
        await p.page.waitForSelector(".ui-exp-i");
        await p.page.locator(".ui-exp-i").nth(which).click();
        await until(p.page, (t) => document.getElementById("fxLive") && document.getElementById("fxLive").textContent === t, want);
        eq(await pageLive(p.page), want, name + " text");
      });
    }
  },

  async history(b) {
    const exports = [{ page: "moves", rows: 1214, cols: ["asof_trt", "ticker", "z"], atMs: Date.UTC(2026, 9, 24, 11, 5) }, { page: "unusual", rows: 8, cols: ["a", "b"], atMs: Date.UTC(2026, 9, 23, 9, 0) }, { page: "moves", rows: 0, cols: [], atMs: Date.UTC(2026, 9, 22, 9, 0) }];
    await using(b, "moves", { state: W.fakeMe({ exports, universe: UNI }), exportOpen: true }, async (p) => {
      await p.page.click("details[data-member-export] > summary");
      await p.page.waitForSelector(".ui-exp-i");
      await p.page.locator(".ui-exp-i").nth(2).click();
      await p.page.waitForSelector("#fmHist[open] table");
      eq(await p.page.evaluate(() => [...document.querySelectorAll("#fmHist th")].map((x) => [x.textContent, x.getAttribute("scope")])), [["When (TRT)", "col"], ["Page", "col"], ["Rows", "col"], ["Columns", "col"]], "the columns");
      eq(await p.page.evaluate(() => [...document.querySelectorAll("#fmHist tbody tr")].map((r) => [...r.children].map((c) => c.textContent))), [["2026-10-24 14:05", "Moves", "1,214", "3 columnsasof_trt, ticker, z"], ["2026-10-23 12:00", "Unusual", "8", "2 columnsa, b"], ["2026-10-22 12:00", "Moves", "0", "— not recorded"]], "newest first, TRT, counted columns with their names, and a dash with its reason where none were kept");
      eq(await p.page.evaluate(() => [...document.querySelectorAll("#fmHist details.fm-cols")].map((d) => [d.open, d.querySelector("summary").textContent])), [[false, "3 columns"], [false, "2 columns"]], "the names sit behind a disclosure that starts closed");
      await p.page.click("#fmHist details.fm-cols summary");
      eq(await p.page.evaluate(() => document.querySelector("#fmHist details.fm-cols p").getBoundingClientRect().height > 0), true, "and opens to the names the file held");
      eq(await tc(p.page, "#fmHist .fm-status"), "Exports are listed for 90 days.", "the retention line");
      eq(await p.page.evaluate(() => document.querySelector("#fmHist caption").textContent), "Your exports, newest first", "a caption for a screen reader");
      await p.page.keyboard.press("Escape");
      await until(p.page, () => document.querySelectorAll("dialog[open]").length === 0);
      await settle(p.page, 100);
      eq(await active(p.page), "Export", "focus returns to the Export button");
    });
    await using(b, "moves", { state: W.fakeMe({ exports: [], universe: UNI }), exportOpen: true }, async (p) => {
      await p.page.click("details[data-member-export] > summary");
      await p.page.waitForSelector(".ui-exp-i");
      await p.page.locator(".ui-exp-i").nth(2).click();
      await p.page.waitForSelector("#fmHist[open]");
      await until(p.page, () => document.querySelector("#fmHist .fm-status").textContent !== "Loading.");
      eq(await tc(p.page, "#fmHist .fm-status"), "No exports in the last 90 days.", "the empty line");
    });
    const bad = W.fakeMe({ universe: UNI });
    bad.exportsFails = true;
    await using(b, "moves", { state: bad, exportOpen: true }, async (p) => {
      await p.page.click("details[data-member-export] > summary");
      await p.page.waitForSelector(".ui-exp-i");
      await p.page.locator(".ui-exp-i").nth(2).click();
      await p.page.waitForSelector("#fmHist[open]");
      await until(p.page, () => document.querySelector("#fmHist .fm-status").textContent !== "Loading.");
      eq(await tc(p.page, "#fmHist .fm-status"), "Could not load your export history.", "the failure line");
    });
  },

  async detached(b) {
    await using(b, "moves", { state: W.fakeMe({ universe: UNI }), exportOpen: true }, async (p) => {
      await settle(p.page, 300);
      await openDialog(p, "list");
      await p.page.keyboard.press("Escape");
      await until(p.page, () => document.querySelectorAll("dialog[open]").length === 0);
      await p.page.evaluate(() => { const gone = document.createElement("button"); window.FlowsUI.member.open("history", gone); });
      await p.page.waitForSelector("#fmHist[open]");
      await p.page.keyboard.press("Escape");
      await until(p.page, () => document.querySelectorAll("dialog[open]").length === 0);
      await settle(p.page, 100);
      eq(await active(p.page), "Export", "an opener that is gone sends focus to the Export button");
    });
  },

  async dialogs(b) {
    const state = W.fakeMe({ names: ["SYA002", "SYA005"], universe: UNI });
    await using(b, "moves", { state, exportOpen: true }, async (p) => {
      await openDialog(p, "list");
      await p.page.keyboard.press("Escape");
      await until(p.page, () => document.querySelectorAll("dialog.fm-dlg").length === 0);
      eq(await p.page.evaluate(() => document.querySelectorAll("dialog[open]").length), 0, "Escape closes the dialog and removes it");
      await openDialog(p, "list");
      await p.page.mouse.click(4, 4);
      await until(p.page, () => document.querySelectorAll("dialog[open]").length === 0);
      eq(await active(p.page) !== "BODY", true, "a click on the backdrop closes it and focus is not lost");
      await openDialog(p, "list");
      const box = await p.page.locator("#fmAdd").boundingBox();
      await p.page.mouse.move(box.x + 10, box.y + 10);
      await p.page.mouse.down();
      await p.page.mouse.move(4, 4);
      await p.page.mouse.up();
      await settle(p.page, 200);
      eq(await p.page.evaluate(() => document.querySelectorAll("dialog[open]").length), 1, "a drag from the field to the backdrop does not close it");
      for (let i = 0; i < 40; i += 1) {
        await p.page.keyboard.press("Tab");
        const inside = await p.page.evaluate(() => { const a = document.activeElement; return a === document.body || !!(a && a.closest("dialog[open]")); });
        if (!inside) throw new Error("focus left the dialog after " + (i + 1) + " Tabs");
      }
      const targets = await p.page.evaluate(() => [...document.querySelectorAll("#fmList button:not([hidden]), #fmList input, #fmList .fm-t")].map((e) => { const r = e.getBoundingClientRect(); return [e.className || e.id, Math.round(r.width), Math.round(r.height)]; }));
      eq(targets.filter(([, w, h]) => w < 44 || h < 44), [], "every control in the dialog is at least 44 px");
      eq(await p.page.evaluate(() => [...document.querySelectorAll(".fm-dlg, .fm-star, .fm-star-slot, #fxMember, .fx-mem, details[data-member-export]")].filter((e) => !e.hasAttribute("data-member")).length), 0, "every injected root carries data-member");
      eq(leaks(p).filter((l) => l.type !== "request"), [], "no console message names the member or a ticker");
      await p.page.evaluate(AXE);
      const violations = await p.page.evaluate(async () => (await window.axe.run(document.querySelector("dialog[open]"), { rules: { region: { enabled: false } }, resultTypes: ["violations"] })).violations.map((v) => v.id + ":" + v.nodes.map((n) => n.target.join(" ")).join("|")));
      eq(violations, [], "axe finds nothing in the list dialog");
    });
  },

  async refresh(b) {
    const state = W.fakeMe({ names: [], universe: UNI });
    await using(b, "ticker", { state, clock: T0 }, async (p) => {
      await setTicker(p.page, "SYA001");
      await until(p.page, () => { const s = document.querySelector(".fm-star"); return s && !s.hidden; });
      eq(await attr(p.page, ".fm-star", "aria-pressed"), "false", "the star starts unpressed");
      state.names = ["SYA001"];
      state.version = 3;
      await p.page.clock.fastForward(30000);
      await p.page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await settle(p.page, 300);
      eq(p.state.count("GET /api/me/state"), 1, "a page shown again inside a minute does not read the state again");
      await p.page.clock.fastForward(40000);
      await p.page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
      await until(p.page, () => document.querySelector(".fm-star").getAttribute("aria-pressed") === "true");
      eq(p.state.count("GET /api/me/state"), 2, "after a minute it reads again and the star follows the other device");
    });
  },

  async dialogsMore(b) {
    const exports = [{ page: "moves", rows: 5, cols: ["a", "b"], atMs: Date.UTC(2026, 9, 24, 11, 5) }];
    for (const [w, h] of [[1440, 820], [390, 844]]) {
      await using(b, "moves", { state: W.fakeMe({ names: ["SYA002", "SYA003"], universe: UNI, exports }), exportOpen: true, w, h, mobile: w < 500 }, async (p) => {
        await openDialog(p, "since");
        await until(p.page, () => document.querySelectorAll("#fmSince .fm-g").length > 0);
        await p.page.evaluate(AXE);
        const run = () => p.page.evaluate(async () => (await window.axe.run(document.querySelector("dialog[open]"), { rules: { region: { enabled: false } }, resultTypes: ["violations"] })).violations.map((v) => v.id + ":" + v.nodes.map((n) => n.target.join(" ")).join("|")));
        eq(await run(), [], "axe finds nothing in the Since dialog at " + w);
        await p.page.keyboard.press("Escape");
        await until(p.page, () => document.querySelectorAll("dialog[open]").length === 0);
        await p.page.evaluate(() => window.FlowsUI.member.open("history", document.querySelector("details[data-member-export] > summary")));
        await p.page.waitForSelector("#fmHist table");
        eq(await run(), [], "and in the history dialog at " + w);
        await p.page.keyboard.press("Escape");
        await until(p.page, () => document.querySelectorAll("dialog[open]").length === 0);
        await openDialog(p, "list");
        await p.page.click("#fmDev");
        await until(p.page, () => document.getElementById("fmDev").getAttribute("aria-checked") === "true");
        eq(await run(), [], "and in the list dialog in device mode at " + w);
      });
    }
  },

  async motion(b) {
    await using(b, "moves", { state: W.fakeMe({ names: ["SYA002"], universe: UNI }), reduced: true }, async (p) => {
      await openDialog(p, "list");
      const rows = await p.page.evaluate(() => [...document.querySelectorAll(".fm-dlg, .fm-dlg button, .fm-dlg input, .fm-dlg a")].map((e) => { const s = getComputedStyle(e); return [s.transitionDuration, s.animationName]; }));
      eq(rows.filter(([d, a]) => !/^0s(, 0s)*$/.test(d) || a !== "none"), [], "reduced motion: every transition is 0s and no animation runs");
    });
    await using(b, "moves", { state: W.fakeMe({ names: ["SYA002"], universe: UNI }), forced: true }, async (p) => {
      await openDialog(p, "list");
      const w = await p.page.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".fm-dlg")).borderTopWidth));
      ok(w > 0, "forced colours: the dialog has a border");
      await p.page.focus("#fmAdd");
      eq(await p.page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle !== "none"), true, "and focus is an outline");
    });
    await using(b, "ticker", { state: W.fakeMe({ names: ["SYA001"], universe: UNI }), forced: true }, async (p) => {
      await setTicker(p.page, "SYA001");
      await until(p.page, () => { const s = document.querySelector(".fm-star"); return s && !s.hidden; });
      await settle(p.page, 300);
      const shape = await p.page.evaluate(() => getComputedStyle(document.querySelector(".fm-star .ui-g")).fill);
      ok(shape !== "none" && shape !== "rgba(0, 0, 0, 0)", "forced colours: a pressed star is filled, not only coloured: " + shape);
      await p.page.mouse.move(0, 0);
      await settle(p.page, 250);
      const pressed = await p.page.locator(".fm-star").screenshot();
      await p.page.click(".fm-star");
      await until(p.page, () => document.querySelector(".fm-star").getAttribute("aria-pressed") === "false");
      await p.page.mouse.move(0, 0);
      await settle(p.page, 250);
      const plain = await p.page.locator(".fm-star").screenshot();
      ok(!pressed.equals(plain), "forced colours: a pressed and an unpressed star differ in their pixels");
      const outline = await p.page.evaluate(() => getComputedStyle(document.querySelector(".fm-star .ui-g")).fill);
      ok(outline === "none" || outline === "rgba(0, 0, 0, 0)", "forced colours: an unpressed star is an outline, not a filled shape: " + outline);
    });
  },

  async phone(b) {
    const model = sinceModel({ now: W.SN.NOW, prevSeenMs: W.SN.PREV, ...W.SN.worldOf(W.SN.PREV) });
    for (const kind of ["list", "since"]) {
      await using(b, "moves", { state: W.fakeMe({ names: names("SYA", 30, 1), universe: UNI, since: model }), w: 320, h: 568, mobile: true }, async (p) => {
        await openDialog(p, kind);
        await settle(p.page, 300);
        const m = await p.page.evaluate(() => { const d = document.querySelector("dialog[open]"), s = d.querySelector(".fm-b"), r = d.getBoundingClientRect(); return { fits: s.scrollWidth <= s.clientWidth + 1, inside: r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1, over: s.scrollWidth - s.clientWidth }; });
        eq([m.fits, m.inside], [true, true], kind + " dialog at 320x568 has no sideways scroll and sits inside the screen");
        await p.page.addStyleTag({ content: "*{line-height:1.5!important;letter-spacing:0.12em!important;word-spacing:0.16em!important}p{margin-bottom:2em!important}" });
        const spaced = await p.page.evaluate(() => { const s = document.querySelector("dialog[open] .fm-b"); return s.scrollWidth <= s.clientWidth + 1; });
        eq(spaced, true, kind + " dialog holds under the text-spacing overrides");
        const targets = await p.page.evaluate(() => [...document.querySelectorAll("dialog[open] button, dialog[open] input, dialog[open] a:not(.fm-pl)")].map((e) => { const r = e.getBoundingClientRect(); return [e.className || e.id, Math.round(r.width), Math.round(r.height)]; }).filter(([, w, h]) => w > 0 && (w < 44 || h < 44)));
        eq(targets, [], kind + ": every target on a coarse pointer is at least 44 px");
      });
    }
    await using(b, "watch", { state: W.fakeMe({ universe: UNI }), w: 390, h: 844, mobile: true }, async (p) => {
      eq(await p.page.evaluate(() => Math.round(document.querySelector(".fm-act").getBoundingClientRect().height) >= 44), true, "the Watch action is at least 44 px high on a coarse pointer");
    });
    await using(b, "moves", { state: W.fakeMe({ universe: UNI }), exportOpen: true, w: 390, h: 844, mobile: true }, async (p) => {
      eq(await p.page.evaluate(() => matchMedia("(any-pointer: coarse)").matches), true, "the phone reports a coarse pointer to any-pointer too");
      await p.page.click("details[data-member-export] > summary");
      await p.page.waitForSelector(".ui-exp-i");
      const small = await p.page.evaluate(() => [...document.querySelectorAll("details[data-member-export] > summary, .ui-exp-i")].map((e) => [e.className, Math.round(e.getBoundingClientRect().height)]).filter((x) => x[1] < 44));
      eq(small, [], "the Export button and its items are at least 44 px high on a coarse pointer");
    });
  },
};

export const sleepFor = sleep;
export { CLICK };
