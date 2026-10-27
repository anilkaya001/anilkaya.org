import { readFileSync } from "node:fs";
import path from "node:path";
import { launch } from "./lib/browser.mjs";
import * as W from "./lib/member-render-world.mjs";
import { SCENARIOS } from "./lib/member-render-scenarios.mjs";
import { loadMutated } from "./truth/mutants.mjs";
import { T, ok, eq, killed } from "./lib/member-batteries.mjs";

const browser = await launch();
const failures = [];

async function run(name, fn) {
  const t = Date.now();
  try {
    await fn();
    console.log("  ok   " + name + " (" + ((Date.now() - t) / 1000).toFixed(1) + " s)");
  } catch (error) {
    failures.push(name + ": " + String(error && error.message).split("\n")[0]);
    console.log("  FAIL " + name + ": " + String(error && error.message).split("\n").filter(Boolean).slice(0, 8).join(" | "));
  }
}

const rect = (page, sel) => page.evaluate((q) => { const e = document.querySelector(q); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom }; }, sel);

const HEADERS = {
  moves: "#mvInfoBtn", unusual: "#uaAboutSlot", events: "#evAboutSlot", political: "#plInfoBtn", watch: "#bdModT",
};

const measure = (page, anchor, hasMenu) => page.evaluate(([sel, menu]) => {
  const a = document.querySelector(sel);
  const head = a && a.parentElement;
  const box = (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  const shown = (c) => { const r = c.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const label = (c) => c.id || (typeof c.className === "string" && c.className) || c.tagName;
  const kids = head ? [...head.children].filter(shown).map((c) => ({ id: label(c), mine: c.hasAttribute("data-member"), ...box(c) })) : [];
  const controls = [...document.querySelectorAll(".fx-mem, .fm-act, details[data-member-export] > summary")].filter(shown).map((c) => ({ id: label(c), ...box(c) }));
  const mem = document.querySelector(".fx-mem");
  const bar = mem ? [...mem.parentElement.children].filter(shown).map((c) => ({ id: label(c), ...box(c) })) : [];
  const side = document.getElementById("fxSide");
  const who = document.querySelector(".fx-who");
  return {
    kids, hb: head ? box(head) : null, controls, bar, vw: innerWidth, vh: innerHeight,
    menuBox: menu ? box(document.querySelector(".ui-exp-m")) : null,
    side: side ? [side.scrollHeight, side.clientHeight] : null, who: who ? Math.round(who.getBoundingClientRect().bottom) : null,
  };
}, [anchor, hasMenu]);

const outside = (g) => g.kids.filter((k) => !(k.x >= g.hb.x - 1 && k.r <= g.hb.r + 1 && k.y >= g.hb.y - 1 && k.b <= g.hb.b + 1)).map((k) => k.id);
const overlaps = (list) => {
  const out = [];
  for (let i = 0; i < list.length; i += 1) for (let j = i + 1; j < list.length; j += 1) {
    const a = list[i], c = list[j];
    if (Math.min(a.r, c.r) - Math.max(a.x, c.x) > 1 && Math.min(a.b, c.b) - Math.max(a.y, c.y) > 1) out.push(a.id + " | " + c.id);
  }
  return out;
};

async function onescreen() {
  const slugs = ["moves", "unusual", "events", "political", "watch"];
  for (const slug of slugs) {
    for (const [w, h] of W.VIEWPORTS) {
      const mobile = w <= 430;
      const baseline = await W.open(browser, slug, { w, h, mobile, shell: false, state: W.fakeMe({}) });
      let base;
      try {
        await baseline.page.waitForTimeout(200);
        base = await measure(baseline.page, HEADERS[slug], false);
      } finally { await baseline.close(); }
      for (const exportOpen of slug === "moves" || slug === "unusual" ? [true, false] : [false]) {
        for (const menu of exportOpen ? [false, true] : [false]) {
          const tag = slug + " " + w + "x" + h + " export=" + (exportOpen ? 1 : 0) + " menu=" + (menu ? "open" : "closed");
          const p = await W.open(browser, slug, { w, h, exportOpen, mobile, state: W.fakeMe({ universe: W.UNIVERSE }) });
          try {
            await p.page.waitForTimeout(250);
            if (menu) {
              await p.page.click("details[data-member-export] > summary");
              await p.page.waitForSelector(".ui-exp-i");
              await p.page.waitForTimeout(200);
            }
            const f = await W.fits(p.page);
            ok(f.v && f.h, tag + ": the page does not scroll (" + JSON.stringify(f) + ")");
            const geo = await measure(p.page, HEADERS[slug], menu);
            const own = geo.kids.filter((k) => k.mine);
            const rest = { ...geo, kids: geo.kids.filter((k) => !k.mine) };
            ok(outside(rest).every((id) => outside(base).includes(id)), tag + ": nothing that was inside the header has been pushed out of it");
            ok(overlaps(rest.kids).every((x) => overlaps(base.kids).includes(x)), tag + ": nothing in the header overlaps that did not before");
            for (const k of own) {
              ok(outside({ ...geo, kids: [k] }).length === 0, tag + ": the export button sits inside the header");
              ok(overlaps([k, ...rest.kids]).length === 0, tag + ": and overlaps nothing");
            }
            if (!exportOpen && slug !== "watch") eq(geo.kids.map((k) => [k.id, Math.round(k.x), Math.round(k.y), Math.round(k.w), Math.round(k.h)]).filter((k) => !/fm-act/.test(k[0])), base.kids.map((k) => [k.id, Math.round(k.x), Math.round(k.y), Math.round(k.w), Math.round(k.h)]).filter((k) => !/fm-act/.test(k[0])), tag + ": a header with no export button is laid out exactly as before");
            for (const c of geo.controls) {
              ok(c.x >= -0.5 && c.r <= geo.vw + 0.5 && c.y >= -0.5 && c.b <= geo.vh + 0.5, tag + ": " + c.id + " is on the screen");
              ok(c.w >= (mobile ? 44 : 24) - 0.5 && c.h >= (mobile ? 44 : 24) - 0.5, tag + ": " + c.id + " is a usable target (" + Math.round(c.w) + "x" + Math.round(c.h) + ")");
            }
            ok(overlaps(geo.bar).length === 0, tag + ": the toolbar items do not overlap each other");
            if (geo.menuBox) ok(geo.menuBox.x >= -0.5 && geo.menuBox.r <= geo.vw + 0.5 && geo.menuBox.b <= geo.vh + 0.5, tag + ": the export menu is on the screen");
            if (!mobile && !menu) eq([geo.side, geo.who], [base.side, base.who], tag + ": the sidebar is exactly what it was without the member shell");
          } finally { await p.close(); }
        }
      }
    }
  }
}

async function layout() {
  for (const [w, h] of W.VIEWPORTS) {
    const state = W.fakeMe({ names: ["SYA002"], universe: W.UNIVERSE });
    const p = await W.open(browser, "ticker", { w, h, state, init: [W.INIT.shifts] });
    try {
      const set = (t) => p.page.evaluate((v) => { document.getElementById("ftHeroT").textContent = v; document.getElementById("ftHeroSub").textContent = "Synthetic Alpha Corp"; document.getElementById("ftHeroFlags").textContent = "x"; }, t);
      const boxes = () => p.page.evaluate(() => ["#ftHeroT", "#ftHeroSub", "#ftHeroFlags", ".fm-star-slot"].map((q) => { const r = document.querySelector(q).getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 2) / 2); }));
      const slotBefore = await boxes();
      await set("SYA001");
      await p.page.waitForFunction(() => { const s = document.querySelector(".fm-star"); return s && !s.hidden; });
      await p.page.waitForTimeout(250);
      const base = await boxes();
      const gap = base[3][0] - (base[0][0] + base[0][2]);
      ok(gap >= 4 && gap <= 16, w + ": the slot starts one gap after the title (" + gap + ")");
      ok(base[3][2] === 44 && base[3][3] === 0, w + ": the reserved slot is 44 wide and adds no height");
      const star = await rect(p.page, ".fm-star");
      ok(star.w === 44 && star.h === 44, w + ": the star is 44 by 44");
      await p.page.evaluate(() => { window.__shifts = window.__shifts ? [] : null; });
      await p.page.click(".fm-star");
      await p.page.waitForFunction(() => document.querySelector(".fm-star").getAttribute("aria-pressed") === "true");
      await p.page.waitForTimeout(300);
      eq(await boxes(), base, w + ": pressing the star moves nothing");
      await p.page.evaluate(() => { document.getElementById("ftHeroFlags").replaceChildren(document.createTextNode("y")); });
      await p.page.waitForTimeout(100);
      eq(await p.page.evaluate(() => document.querySelector(".fm-star").parentElement === document.querySelector(".fm-star-slot") && document.querySelector(".fm-star-slot").parentElement === document.getElementById("ftHeroFlags").parentElement), true, w + ": the star stays beside the flags after they are redrawn");
      const shifts = await p.page.evaluate(() => window.__shifts);
      if (shifts) eq(shifts.filter((s) => s.nodes.includes("ft-name")).reduce((a, s) => a + s.v, 0), 0, w + ": no layout shift inside the name block");
      void slotBefore;
    } finally { await p.close(); }
  }
}

async function sidebar(shellFn) {
  const baseline = await W.open(browser, "moves", { shell: false, state: W.fakeMe({}) });
  let base;
  try {
    await baseline.page.waitForTimeout(200);
    base = await measure(baseline.page, HEADERS.moves, false);
  } finally { await baseline.close(); }
  const p = await W.open(browser, "moves", { shellFn, state: W.fakeMe({ universe: W.UNIVERSE }) });
  try {
    await p.page.waitForTimeout(250);
    const geo = await measure(p.page, HEADERS.moves, false);
    eq([geo.side, geo.who], [base.side, base.who], "the sidebar is exactly what it was without the member shell");
  } finally { await p.close(); }
}

const EXTRA = { sidebar: (b) => sidebar(b.opts.shellFn) };

const only = (process.env.MEMBER_ONLY || "").split(",").filter(Boolean);
const part = (process.argv.find((x) => x.startsWith("--part=")) || "--part=all").slice(7);
if (!["all", "scenarios", "onescreen", "mutants"].includes(part)) throw new Error("flows-member-render: an unknown part: " + part);
const wants = (name) => part === "all" || part === name;
const finish = async () => {
  await browser.close();
  if (failures.length) {
    console.log("\n" + failures.length + " failure(s):\n" + failures.join("\n"));
    process.exit(1);
  }
  console.log("flows-member-render: " + T.checks + " checks");
  process.exit(0);
};
console.log("flows-member-render " + part);
if (wants("scenarios")) for (const [name, fn] of Object.entries(SCENARIOS)) if (!only.length || only.includes(name)) await run(name, () => fn({ browser, opts: {} }));
if (wants("onescreen")) {
  if (!only.length || only.includes("onescreen")) await run("one-screen invariants", onescreen);
  if (!only.length || only.includes("layout")) await run("star layout", layout);
  if (!only.length || only.includes("sidebar")) await run("sidebar", () => sidebar());
}
if ((only.length && !process.env.MEMBER_MUTANTS) || !wants("mutants")) await finish();

const CSS_RM = ".fm-rm { display: inline-grid; place-items: center; flex: none; width: 44px; height: 44px;";
const MUTANTS = [
  ["a star named for its state", "flows-member.js", [['star.setAttribute("aria-label", "Star " + t);', 'star.setAttribute("aria-label", (listed ? "Unstar " : "Star ") + t);']], ["star"]],
  ["a failed star never rolled back", "flows-member.js", [["      pending.delete(t);\n      paint();\n      U.announce(", "      paint();\n      U.announce("]], ["starFail"]],
  ["the failure naming the current ticker", "flows-member.js", [["S.names.includes(t) ? TEXT.starStill(t) : TEXT.starNot(t)", "S.names.includes(t) ? TEXT.starStill(current() || t) : TEXT.starNot(current() || t)"]], ["starFail"]],
  ["presses not merged", "flows-member.js", [["      if (held) {\n        held.want = want;\n        held.dirty = true;\n        paint();\n        return;\n      }\n", ""]], ["serial"]],
  ["a merged press sent although it cancels out", "flows-member.js", [["while (r.ok && entry.dirty && entry.want !== sent);", "while (r.ok && entry.dirty);"]], ["serial"]],
  ["a merged press never sent", "flows-member.js", [["while (r.ok && entry.dirty && entry.want !== sent);", "while (false);"]], ["serial"]],
  ["the list worked out before the retry", "flows-member.js", [["        const list = next(S.names);\n        if (attempt > 0", "        if (attempt > 0"], ["      let again = false;\n      for (let attempt", "      let again = false;\n      const list = next(S.names);\n      for (let attempt"]], ["starStale", "stale"]],
  ["one toggle event read twice", "flows-export.js", [["      if (seen.has(e)) return;\n      seen.add(e);\n      render();", "      render();"]], ["exportToggle"]],
  ["the limit line not tied to the items", "flows-export.js", [["i.limited && remote.quota ? noteId : null", "null"]], ["menu"]],
  ["the history row for every member", "flows-member.js", [["const hist = EXPORTS ? button(", "const hist = true ? button("]], ["historyRow"]],
  ["the history row for no member", "flows-member.js", [["const hist = EXPORTS ? button(", "const hist = false ? button("]], ["historyRow"]],
  ["a cut group's name with no reason", "flows-member.js", [['first ? first.line.rest : DASH + " detail not kept (list cut)"', 'first ? first.line.rest : ""']], ["partial"]],
  ["the column names left out of the log", "flows-member.js", [['h("p", null, cols.join(", "))', 'h("p", null, "")']], ["history"]],
  ["a log row with no columns left blank", "flows-member.js", [['DASH + " not recorded"', '""']], ["history"]],
  ["an unreadable ticker list called a failed save", "flows-member.js", [['    if (code === "universe_unreadable") return { ok: false, text: TEXT.cannotCheck, retry: true };\n', ""]], ["uncheckable"]],
  ["the download named for the old title", "flows-member.js", [['save("flows-my-list-"', 'save("flows-my-data-"']], ["download"]],
  ["the download button under its old name", "flows-member.js", [['button("Download list and export log"', 'button("Download my data"']], ["download", "historyRow"]],
  ["the old chip words", "flows-member.js", [['entering: "report ahead"', 'entering: "report in window"']], ["partial"]],
  ["the new-flow chip as windows", "flows-member.js", [['flow: "new flow"', 'flow: "new windows"']], ["yours"]],
  ["twenty attempts at a stale write", "flows-member.js", [["for (let attempt = 0; attempt < 2; attempt += 1) {\n        if (S.mode !== \"server\") return writeDevice(next);", "for (let attempt = 0; attempt < 20; attempt += 1) {\n        if (S.mode !== \"server\") return writeDevice(next);"]], ["stale"]],
  ["If-Match built as a weak tag", "flows-member.js", [["ifMatch: (version) => '\"w' + version + '\"',", "ifMatch: (version) => 'W/\"w' + version + '\"',"]], ["add"]],
  ["the device switch sending the list", "flows-member.js", [['{ body: { deviceOnly: true }, version: S.version }', '{ body: { deviceOnly: true, watchlist: names }, version: S.version }']], ["toDevice"]],
  ["key_absent misspelt", "flows-member.js", [['const keyAbsent = S.reason === "key_absent";', 'const keyAbsent = S.reason === "key-absent";']], ["keyAbsent"]],
  ["a ticker in the console", "flows-member.js", [["(sent ? TEXT.starOn(t) : TEXT.starOff(t))", "(sent ? (console.info(t), TEXT.starOn(t)) : TEXT.starOff(t))"]], ["star"]],
  ["Escape cancelling the question without stopping the dialog", "flows-member.js", [["      if (e.cancelable) e.preventDefault();\n", ""]], ["delete"]],
  ["Escape never closing", "flows-member.js", [['      if (del.dataset.state !== "ask") return;\n', ""]], ["delete", "dialogs"]],
  ["focus not returned to a gone opener", "flows-member.js", [['const spots = [opener, document.querySelector("details[data-member-export] > summary"), document.querySelector("[data-member-open]")];', "const spots = [opener];"]], ["detached"]],
  ["focus not returned at all", "flows-member.js", [["if (current === d) { current = null; back(opener); }", "if (current === d) { current = null; }"]], ["detached"]],
  ["a dialog that is not modal", "flows-member.js", [["d.showModal();", "d.show();"]], ["list"]],
  ["a drag from the field closing the dialog", "flows-member.js", [["if (down === d && e.target === d) d.close(); down = null;", "if (e.target === d) d.close(); down = null;"]], ["dialogs"]],
  ["a remove button of 30 px", "flows-member.css", [[CSS_RM, CSS_RM.replace("width: 44px; height: 44px;", "width: 30px; height: 30px;")]], ["dialogs"]],
  ["focus lost after a removal", "flows-member.js", [["(rows[index] || rows[index - 1] || input).focus();", ""]], ["remove"]],
  ["the dialog speaking through the page's region", "flows-member.js", [["timer = setTimeout(() => { live.textContent = text; }, 50);", "timer = setTimeout(() => { U.announce(text); }, 50);"]], ["add"]],
  ["a duplicate sent to the server", "flows-member.js", [["if (seen.has(n.name)) { if (!skip.has(n.name))", "if (false) { if (!skip.has(n.name))"]], ["dup"]],
  ["the device copy cleared before the server answered", "flows-member.js", [['const r = await call("DELETE", "/api/me/state");', 'device.clear(S.member);\n      const r = await call("DELETE", "/api/me/state");']], ["delete"]],
  ["the persisted check skipped", "flows-member.js", [["saved: ok && window.IEWTStorage.flowsWatchlistSaved(member)", "saved: ok"]], ["toDevice"]],
  ["every name counted as yours", "flows-member.js", [["if (line || (Array.isArray(g.names) && g.names.includes(t))) hits.push(", "if (true) hits.push("]], ["yours"]],
  ["a second export while one runs", "flows-member.js", [["if (exporting) return;\n    exporting = true;", "exporting = true;"]], ["menu"]],
  ["one export too few counted", "flows-member.js", [["const left = Math.max(0, win.cap - win.used);", "const left = Math.max(0, win.cap - win.used - 1);"]], ["menu"]],
  ["the truncation header misspelt", "flows-member.js", [['header.get("X-Export-Truncated") === "1"', 'header.get("X-Export-Truncate") === "1"']], ["exportTexts"]],
  ["a ping on every event", "flows-member-boot.js", [["(!force && n - last < 6e4)", "(!force && n - last < 0)"]], ["guard"]],
  ["lower-case names sent", "flows-member.js", [["{ ok: true, name: t.toUpperCase() }", "{ ok: true, name: t }"]], ["add"]],
  ["a ping while hidden", "flows-member-boot.js", [['document.visibilityState !== "visible" || ', ""]], ["hidden"]],
  ["a busy button that never clears", "flows-member-boot.js", [["late = 1; done(); U().announce(\"Could not load. Reload the page.\");", "late = 1; U().announce(\"Could not load. Reload the page.\");"]], ["loadFail"]],
  ["a file that lands after the message still opening", "flows-member-boot.js", [[".then(() => late || U().member.open(k, b, () => late))", ".then(() => U().member.open(k, b))"]], ["late"]],
  ["the late flag not passed to the dialogs", "flows-member-boot.js", [["U().member.open(k, b, () => late)", "U().member.open(k, b)"]], ["late"]],
  ["a second press while loading opening twice", "flows-member-boot.js", [["    if (b.matches(\"[aria-busy]\")) return;\n", ""]], ["late"]],
  ["the dialogs opened before the sheet", "flows-member.js", [["if (!(await stylesheet())) { U.announce(TEXT.load); return null; }", "stylesheet();"]], ["late"]],
  ["a sheet that fails opening an unstyled dialog", "flows-member.js", [["onerror: give }", "onerror: () => { clearTimeout(timer); ok(true); } }"]], ["late"]],
  ["a sheet wait with no limit", "flows-member.js", [["const timer = setTimeout(give, 8000);", "const timer = 0;"]], ["late"]],
  ["the module version not checked", "flows-member.js", [["if (!kit || kit.ui || kit.v !== 1) return;", "if (!kit || kit.ui) return;"]], ["kitVersion"]],
  ["a missing dialogs file that says nothing", "flows-member.js", [["      U.announce(TEXT.load);\n      return null;", "      return null;"]], ["kitVersion"]],
  ["a press on an unreadable list showing the star pressed", "flows-member.js", [["      if (blocked()) { U.announce(TEXT.starUnreadable); return; }\n", ""]], ["unreadableStar"]],
  ["the unreadable guard missing from the write", "flows-member.js", [["        if (S.unreadable) { changed(); return { ok: false, unreadable: true, text: TEXT.unreadable }; }\n", ""]], ["unreadableStar"]],
  ["an unreadable row reported as a failed save", "flows-member.js", [['if (code === "unreadable_row") {', "if (false) {"]], ["unreadableStar"]],
  ["a refused save reported without saying it was not saved", "flows-member.js", [["text: TEXT.notSaved + \" \" + TEXT.keyAbsent", "text: TEXT.keyAbsent"]], ["keyAbsent"]],
  ["a refused save that leaves the dialog as it was", "flows-member.js", [["await pull();\n      changed();\n      return { ok: false, text: TEXT.notSaved + \" \" + TEXT.keyAbsent };", "await pull();\n      return { ok: false, text: TEXT.notSaved + \" \" + TEXT.keyAbsent };"]], ["keyAbsent"]],
  ["a mode change answered with a server write", "flows-member.js", [['        if (S.mode !== "server") return writeDevice(next);\n', ""]], ["unreadableStar", "device"]],
  ["a disabled star drawn like a live one", "flows-ticker.css", [['.fm-star[aria-disabled="true"] { color: var(--label-3); cursor: default; }\n', ""]], ["unreadableStar"]],
  ["the consent flag sent with every write", "flows-member.js", [["{ body: { deviceOnly: false, watchlist: list }, version: S.version }", "{ body: { deviceOnly: false, watchlist: list, replaceUnreadable: true }, version: S.version }"]], ["unreadable"]],
  ["a count of no names for an unreadable list", "flows-member.js", [["      count.hidden = block;\n", ""]], ["unreadable"]],
  ["a replacement sent without the flag", "flows-member.js", [["watchlist: [], replaceUnreadable: true }", "watchlist: [] }"]], ["unreadable"]],
  ["a replacement with no question", "flows-member.js", [['button("Start a new list", () => fixAsk(), "fm-quiet")', 'button("Start a new list", () => restart().then(() => paint()), "fm-quiet")']], ["unreadable"]],
  ["keeping the list replacing it", "flows-member.js", [['const keep = button("Keep it for now", () => { fixIdle();', 'const keep = button("Keep it for now", () => { restart(); fixIdle();']], ["unreadable"]],
  ["the unreadable notice in device mode", "flows-member.js", [['const block = S.mode === "server" && S.unreadable;', "const block = S.unreadable;"]], ["unreadable"]],
  ["a failed removal reporting the press", "flows-member.js", [["S.names.includes(name) ? TEXT.starStill(name) : TEXT.starNot(name)", "TEXT.starNot(name)"]], ["failed"]],
  ["the delete question without the other-device line", "flows-member.js", [['h("p", { class: "fm-note" }, TEXT.deleteOther), ', ""]], ["delete"]],
  ["a cancel that cannot be cancelled leaving the question", "flows-member.js", [["      if (e.cancelable) e.preventDefault();\n      idle().focus();", "      if (e.cancelable) { e.preventDefault(); idle().focus(); }"]], ["deleteCancel"]],
  ["tomorrow decided on the device calendar", "flows-member.js", [["F.trtDay(win.freesAtMs) !== F.trtDay(serverNow)", "new Date(win.freesAtMs).getDate() !== new Date(serverNow).getDate()"]], ["quota"]],
  ["a load failure that says nothing", "flows-member-boot.js", [['U().announce("Could not load. Reload the page.");', ""]], ["loadFail"]],
  ["the store loaded for every opening of My list", "flows-member.js", [['if (ready && S.mode === "server" && S.names.length === 0) await storeReady();', "await storeReady();"]], ["lazy"]],
  ["no store for an empty server list", "flows-member.js", [['if (ready && S.mode === "server" && S.names.length === 0) await storeReady();', ""]], ["lazy"]],
  ["a device switch that does not wait for the store", "flows-member.js", [['      if (!(await storeReady())) return { ok: false, text: TEXT.notSaved, retry: true };\n', ""]], ["toDevice"]],
  ["a deletion that does not wait for the store", "flows-member.js", [['      if (!(await storeReady())) return { ok: false, text: TEXT.notDeleted, retry: true };\n', ""]], ["deleteCopy"]],
  ["the store loaded for every list", "flows-member.js", [['if (r.json.mode !== "server") await storeReady();', "await storeReady();"]], ["lazy"]],
  ["the store not waited for before a device list is read", "flows-member.js", [['if (r.json.mode !== "server") await storeReady();', ""]], ["lazy"]],
  ["the dialogs loaded with the module", "flows-member-boot.js", [['const load = () => g || (g = U().defer("member"));', 'const load = () => g || (g = U().defer("member").then(() => U().defer("member-ui")));']], ["lazy"]],
  ["tomorrow decided on the device clock", "flows-member.js", [["F.trtDay(win.freesAtMs) !== F.trtDay(serverNow)", "F.trtDay(win.freesAtMs) !== F.trtDay(Date.now())"]], ["quota"]],
  ["a pressed star that is not filled", "flows-ticker.css", [['.fm-star[aria-pressed="true"] .ui-g { fill: currentColor; }', ""]], ["motion"]],
  ["an unpressed star as filled as a pressed one", "flows-ticker.css", [['.fm-star .ui-g { font-size: 22px; }', '.fm-star .ui-g { font-size: 22px; fill: currentColor; }']], ["motion"]],
  ["an add blocked by an unreadable ticker list in server mode", "flows-member.js", [['if (plan.adds.length && !known && S.mode !== "server") { showError(TEXT.cannotCheck); return; }', 'if (plan.adds.length && !known) { showError(TEXT.cannotCheck); return; }']], ["uncheckable"]],
  ["native disabled on the limited export items", "flows-export.js", [['buttons[k].setAttribute("aria-disabled", "true");', "buttons[k].disabled = true;"]], ["quota"]],
  ["36 px for the Watch action on a coarse pointer", "flows.css", [["@media (any-pointer: coarse) { .ui-mod-h>.fm-act { height: 44px; }", "@media (any-pointer: coarse) { .ui-mod-h>.fm-act { height: 36px; }"]], ["phone"]],
  ["36 px for the member menu on a coarse pointer", "flows.css", [["@media (any-pointer: coarse) { .ui-exp[data-member] .ui-exp-b, .ui-exp[data-member] .ui-exp-i { min-height: 44px; } }", "@media (any-pointer: coarse) { .ui-exp[data-member] .ui-exp-b, .ui-exp[data-member] .ui-exp-i { min-height: 36px; } }"]], ["phone"]],
  ["a prerendered page pinging at once", "flows-member-boot.js", [["const boot = () => (document.prerendering ? document.addEventListener(\"prerenderingchange\", start, { once: true }) : start());", "const boot = () => start();"]], ["prerender"]],
  ["a dialog without data-member", "flows-member.js", [['class: "fm-dlg", id, "aria-labelledby": id + "T", "data-member": "" }', 'class: "fm-dlg", id, "aria-labelledby": id + "T" }']], ["dialogs"]],
  ["the incompleteness disclosure dropped", "flows-member.js", [['for (const t of model.partial(groups)) sec.append(h("p", { class: "fm-note" }, t));', ""]], ["partial"]],
  ["every overflow sent to the Moves page", "flows-member.js", [['h("a", { href: g.href, class: "fm-pl" }, g.place)', 'h("a", { href: "/flows/moves/", class: "fm-pl" }, "the Moves page")']], ["paging"]],
  ["fifty lines a step turned into five hundred", "flows-member.js", [["const STEP = 50;", "const STEP = 500;"]], ["paging"]],
  ["writes not queued", "flows-member.js", [["const run = queue.then(fn, fn);", "const run = fn();"]], ["serialTwo"]],
  ["an unchecked ticker added on a device list", "flows-member.js", [['if (plan.adds.length && !known && S.mode !== "server") { showError(TEXT.cannotCheck); return; }', ""]], ["uncheckable"]],
  ["the device copy cleared before the save", "flows-member.js", [['const r = await call("PUT", "/api/me/state", { body: { deviceOnly: false, watchlist: names }, version: S.version });', 'device.clear(S.member);\n        const r = await call("PUT", "/api/me/state", { body: { deviceOnly: false, watchlist: names }, version: S.version });']], ["toServer"]],
  ["tomorrow never said", "flows-member.js", [['(later ? "tomorrow at " : "at ")', '"at "']], ["quota"]],
  ["Retry-After ignored", "flows-member.js", [['if (!Number.isFinite(s) || s < 1 || s > 3600) return "Too many requests. Try again in a minute.";', 'if (true) return "Too many requests. Try again in a minute.";']], ["exportTexts"]],
  ["filename* ignored", "flows-member.js", [["const star = /filename\\*\\s*=\\s*UTF-8''([^;]+)/i.exec(d);", "const star = null;"]], ["menu"]],
  ["a device list ignored on load", "flows-member.js", [["S.names = S.mode === \"server\" ? (Array.isArray(j.watchlist) ? j.watchlist.slice() : []) : device.read(j.member);", "S.names = Array.isArray(j.watchlist) ? j.watchlist.slice() : [];"]], ["device"]],
  ["the offer uploading on its own", "flows-member.js", [["offer.hidden = held.length === 0;", "offer.hidden = held.length === 0;\n      if (held.length) toServer(held);"]], ["offer"]],
  ["a refused storage write still sending the switch", "flows-member.js", [["if (!w.saved) { device.clear(S.member); return { ok: false, text: TEXT.noStore }; }", ""]], ["storageWarn"]],
];

const WRAPPER_MUTANTS = [
  ["the star slot missing from the server HTML", [['if (slug === "ticker" && once(out, HERO)) out = after(out, HERO, STAR_SLOT);', ""]], ["star"]],
  ["the member buttons in the sidebar", [["let out = before(html, FRESH, BAR);", "let out = before(html, '<div class=\"fx-who\">', BAR);"]], ["sidebar"]],
];

console.log("  planted wrong builds");
const SPLIT = Object.fromEntries(["flows-member.js", "flows-member-ui.js"].map((f) => [f, readFileSync(path.join(W.ROOT, "assets", "js", f), "utf8")]));
const resolveFile = (file, transforms, label) => {
  if (file !== "flows-member.js") return file;
  const hits = Object.entries(SPLIT).filter(([, text]) => transforms.every(([from]) => text.includes(from))).map(([f]) => f);
  if (hits.length !== 1) throw new Error("a planted build names " + hits.length + " files: " + label);
  return hits[0];
};
const picked = process.env.MEMBER_MUTANT || "";
const queue = MUTANTS.filter(([label]) => label.includes(picked)).map(([label, named, transforms, scenarios]) => async () => {
  const file = resolveFile(named, transforms, label);
  W.mutateText(readFileSync(path.join(W.ROOT, "assets", file.endsWith(".css") ? "css" : "js", file), "utf8"), transforms, label);
  const b = { browser, opts: { mutate: { [file]: transforms } } };
  let dead = false;
  for (const name of scenarios) {
    if (await killed(() => SCENARIOS[name](b))) { dead = true; break; }
  }
  ok(dead, "PLANTED " + label + " fails " + scenarios.join(" or "));
});
for (const [label, transforms, scenarios] of picked ? [] : WRAPPER_MUTANTS) {
  queue.push(async () => {
    const mutated = await loadMutated("shared/flows-member-shell.js", transforms);
    const b = { browser, opts: { shellFn: mutated.memberShell } };
    let dead = false;
    for (const name of scenarios) if (await killed(() => (SCENARIOS[name] || EXTRA[name])(b))) { dead = true; break; }
    ok(dead, "PLANTED " + label + " fails " + scenarios.join(" or "));
  });
}
const LANES = 3;
let next = 0;
await Promise.all(Array.from({ length: LANES }, async () => {
  while (next < queue.length) {
    const job = queue[next++];
    try { await job(); } catch (error) { failures.push("mutant: " + String(error && error.message).split("\n")[0]); console.log("  FAIL mutant: " + String(error && error.message).split("\n")[0]); }
  }
}));

await finish();
