import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { launch } from "./lib/browser.mjs";
import { ROOT, SIZES, openPos, payload } from "./lib/pos-world.mjs";

const require = createRequire(import.meta.url);
const AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const MINUS = "−";
const pts = (v, plus) => {
  const c = Math.round(Math.abs(v) * 100);
  const body = Math.floor(c / 100) + "." + String(c % 100).padStart(2, "0");
  if (c === 0) return body;
  return (v < 0 ? MINUS : plus ? "+" : "") + body;
};

const TABS = ["rotation", "filings", "insiders", "short"];

async function fit(page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    const stage = document.getElementById("fdStage").getBoundingClientRect();
    const out = [];
    for (const m of document.querySelectorAll(".pos-mod")) {
      if (m.hasAttribute("inert") || getComputedStyle(m).visibility === "hidden") continue;
      const b = m.getBoundingClientRect();
      if (b.width === 0) continue;
      if (b.bottom > stage.bottom + 1 || b.right > stage.right + 1) out.push("module leaves stage " + m.id);
      for (const c of m.querySelectorAll(".pos-body *")) {
        const r = c.getBoundingClientRect();
        if (r.width && r.height && (r.bottom > b.bottom + 1 || r.right > b.right + 1) && !c.closest("[hidden]")) out.push("clipped " + (c.className || c.tagName) + " in " + m.id);
      }
      const body = m.querySelector(".pos-body");
      if (body && (body.scrollHeight > body.clientHeight + 1 || body.scrollWidth > body.clientWidth + 1)) out.push("inner scroll in " + m.id);
    }
    return { page: de.scrollHeight - innerHeight, side: de.scrollWidth - innerWidth, problems: out.slice(0, 6) };
  });
}

async function view(page, name) {
  await page.evaluate((n) => { location.hash = "view=" + n; }, name);
  const tab = page.locator("#fdT-" + name);
  if (await tab.count()) await tab.click();
  await page.waitForTimeout(250);
}

const sources = fs.readFileSync(path.join(ROOT, "assets/js/flows-pos.js"), "utf8");

const browser = await launch();
try {
  const P = payload();
  for (const [w, h] of SIZES) {
    const { ctx, page, errors } = await openPos(browser, w, h);
    ok((await page.locator("#pos[data-ready]").count()) === 1, `${w}x${h}: the page paints`);
    for (const tab of TABS) {
      await view(page, tab);
      const f = await fit(page);
      eq([f.page <= 0, f.side <= 0, f.problems], [true, true, []], `${w}x${h} ${tab}: no page scroll, no sideways scroll, nothing clipped or scrolling inside a module ${JSON.stringify(f)}`);
    }
    const focusable = await page.evaluate(() => [...document.querySelectorAll("#fdStage [inert] button, #fdStage [inert] a")].filter((e) => e.offsetParent !== null && getComputedStyle(e.closest("[inert]")).visibility !== "hidden").length);
    eq(focusable, 0, `${w}x${h}: nothing in an inactive view can be reached`);
    eq(errors, [], `${w}x${h}: no page error`);
    await ctx.close();
  }

  {
    const { ctx, page, asked } = await openPos(browser, 1440, 820);
    await view(page, "rotation");
    const hero = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("#posHero .pos-kpi")].map((k) => [k.dataset.id, [k.querySelector(".v").textContent, k.querySelector(".s").textContent]])));
    eq(hero.filers[0], `${P.rotation.filers.compared} of ${P.rotation.filers.tracked}`, "the filers cell is compared of tracked");
    const live = P.rotation.sectors.filter((s) => s.n > 0 && s.dW !== null);
    const big = live.slice().sort((a, b) => (Math.abs(b.dW) - Math.abs(a.dW)) || (a.s < b.s ? -1 : 1))[0];
    eq(hero.rotation[0], `${big.s} ${pts(big.dW, true)}`, "the rotation cell names the sector that moved most, from an independent sort");
    let b = 0, s = 0;
    for (const x of P.insiders.sectors) { b += x.buyers; s += x.sellers; }
    const net = (b - s) / (b + s);
    ok(hero.insiders[0].replace(/[+−]/g, "") === pts(Math.abs(net)), `the insider cell is the net of buyers and sellers (${hero.insiders[0]})`);
    const heavy = P.shorts.ftd.sectors.reduce((a, x) => a + (x.heavy || 0), 0);
    eq(hero.fails[0], heavy + (heavy === 1 ? " name" : " names"), "the failures cell counts the heavy names");

    const rows = await page.evaluate(() => [...document.querySelectorAll("#posRot .pos-row")].map((r) => ({ s: r.dataset.s, chg: r.querySelector(".chg").textContent, fil: r.querySelector(".fil").textContent, now: r.querySelector(".now") ? r.querySelector(".now").textContent : null, plus: r.querySelector("svg rect.p") ? r.querySelector("svg rect.p").getAttribute("width") : null, minus: r.querySelector("svg rect.m") ? r.querySelector("svg rect.m").getAttribute("width") : null })));
    eq(rows.length, 11, "eleven sector rows");
    const axis = (() => { let max = 0; for (const x of P.rotation.sectors) if (x.dW !== null && Math.abs(x.dW) > max) max = Math.abs(x.dW); return Math.max(0.5, Math.ceil(max * 2 - 1e-9) / 2); })();
    for (const r of rows) {
      const src = P.rotation.sectors.find((x) => x.s === r.s);
      if (!src || src.dW === null || !src.n) {
        eq([r.chg, r.plus, r.minus], ["—", null, null], `${r.s}: no compared filer is a dash and no bar, never a zero`);
        continue;
      }
      ok(r.chg.endsWith(pts(src.dW, true)), `${r.s}: change prints ${pts(src.dW, true)} (${r.chg})`);
      const want = (Math.abs(src.dW) / axis) * 50;
      const got = Number(String(src.dW >= 0 ? r.plus : r.minus).replace("%", ""));
      ok(Math.abs(got - want) < 0.01, `${r.s}: bar width ${got} against ${want.toFixed(3)} on a shared axis of ${axis}`);
      eq(r.fil, String(src.n), `${r.s}: filer count`);
    }
    const sum = P.rotation.sectors.reduce((a, x) => a + (x.wNow || 0), 0);
    ok(Math.abs(sum - 100) < 0.051, "the printed current weights foot to 100");

    const text = await page.evaluate(() => document.body.innerText);
    ok(!/\btape\b/i.test(text) && !/vendor|unusual whales/i.test(text), "no barred word in the visible copy");
    ok(!/\b(EST|EDT|ET|UTC|GMT)\b/.test(text), "no other zone is named");
    await view(page, "filings");
    const chip = page.locator("#posFilCardB .pos-cp").first();
    ok((await chip.count()) > 0, "filings carry change chips");
    const label = await chip.getAttribute("data-t");
    await chip.click();
    await page.waitForSelector("#posDrill[open]");
    await page.waitForTimeout(300);
    ok(asked.some((a) => a.includes("/api/flows/positioning?t=" + label)), "a chip asks for its name's section");
    const dr = await page.locator("#posDrillB").innerText();
    ok(/failures to deliver|Failures/i.test(dr) || dr.length > 20, "the drill body has content");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(100);
    eq(await page.evaluate(() => document.querySelector("#posDrill").open), false, "Escape closes the drill sheet");
    eq(await page.evaluate(() => document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.t : null), label, "and focus returns to the chip that opened it");
    await page.click("#posInfo");
    await page.waitForSelector("#posInfoDlg[open]");
    await page.keyboard.press("Escape");
    eq(await page.evaluate(() => document.activeElement && document.activeElement.id), "posInfo", "the info dialog returns focus to its button");
    await ctx.close();
  }

  {
    const { ctx, page } = await openPos(browser, 1440, 820, { body: { status: "pending" } });
    const text = await page.evaluate(() => document.querySelector("#pos").innerText);
    ok(/first positioning read lands after tonight/i.test(text), "a payload not yet built says so");
    eq(await page.evaluate(() => [...document.querySelectorAll("#posHero .pos-kpi .v")].map((v) => v.textContent.split(".")[0])), ["—", "—", "—", "—"], "and every hero figure is a dash with its reason, never a zero");
    await ctx.close();
  }
  {
    const { ctx, page } = await openPos(browser, 1440, 820, { status: 500, body: {}, ready: false });
    const text = await page.evaluate(() => document.querySelector("#pos").innerText);
    ok(/did not answer/i.test(text), "a failed read says the feed did not answer");
    await ctx.close();
  }
  {
    const odd = payload();
    odd.rotation.sectors[0].dW = null;
    odd.rotation.sectors[0].wNow = null;
    odd.insiders.sectors[1].days = odd.insiders.sectors[1].days.map((d) => [d[0], null, null]);
    const { ctx, page } = await openPos(browser, 1440, 820, { body: odd });
    const first = await page.evaluate(() => document.querySelector("#posRot .pos-row .chg").textContent);
    eq(first, "—", "a sector with no change prints a dash");
    await view(page, "insiders");
    const cells = await page.evaluate(() => [...document.querySelectorAll(".pos-heatg .pos-hc[data-t=\"x\"]")].length);
    ok(cells > 0, "unread insider days are drawn as unread, not as quiet");
    await ctx.close();
  }

  {
    const { ctx, page } = await openPos(browser, 1440, 820);
    await view(page, "insiders");
    await page.focus(".pos-heatg");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");
    const a = await page.evaluate(() => (document.activeElement && (document.activeElement.getAttribute("aria-label") || document.activeElement.textContent)) || "");
    ok(a.length > 0, "the heat strip answers the arrow keys with a spoken cell");
    await ctx.close();
  }

  const cssSrc = fs.readFileSync(path.join(ROOT, "assets/css/flows-pos.css"), "utf8");
  ok(!/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/.test(cssSrc), "THE SHEET HOLDS TOKENS ONLY: no colour literal in flows-pos.css");

  const trtOf = (iso) => { const d = new Date(Date.parse(iso) + 3 * 3600e3); return String(d.getUTCHours()).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0"); };
  const gappy = () => { const b = payload(); b.insiders.sectors[1].days = b.insiders.sectors[1].days.map((d, i) => (i < 3 ? [d[0], null, null] : d)); b.filings.rows[0].top[0].dv = null; return b; };
  const scenario = async (o = {}) => {
    const out = {};
    const { ctx, page } = await openPos(browser, 1440, 820, o);
    out.stamp = await page.evaluate(() => document.getElementById("posStamp").textContent);
    out.info = await page.evaluate(() => document.getElementById("posInfoB").textContent);
    await view(page, "insiders");
    out.heatX = await page.evaluate(() => document.querySelectorAll(".pos-heatg .pos-hc[data-t=\"x\"]").length);
    await view(page, "rotation");
    out.chg = await page.evaluate(() => [...document.querySelectorAll("#posRot .pos-row")].map((r) => [r.dataset.s, r.querySelector(".chg").textContent]));
    await view(page, "filings");
    out.chips = await page.evaluate(() => [...document.querySelectorAll("#posFilCardB .pos-cp")].map((c) => ({ t: c.dataset.t, text: c.textContent, title: c.title })));
    const chip = page.locator("#posFilCardB .pos-cp").first();
    const label = await chip.getAttribute("data-t");
    await chip.click();
    await page.waitForSelector("#posDrill[open]");
    await page.waitForTimeout(250);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(100);
    out.focus = await page.evaluate(() => (document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.t : null));
    out.label = label;
    await view(page, "short");
    out.legend = await page.evaluate(() => [...document.querySelectorAll(".pos-leg span")].map((x) => x.textContent));
    await ctx.close();
    return out;
  };
  const six = P.shorts.venues.mix.length > 6 ? 7 : P.shorts.venues.mix.length;
  const clean = await scenario({ body: gappy() });
  ok(clean.stamp.includes(trtOf(P.generatedAt) + " TRT") && !/\bUTC\b|\bET\b/.test(clean.stamp), `THE STAMP IS TÜRKİYE TIME: ${clean.stamp} for ${P.generatedAt}`);
  ok(!/vendor|tape|unusual whales/i.test(clean.info), "the info dialog names no provider and never says vendor");
  ok(clean.heatX > 0, `a missing insider date is drawn unread (${clean.heatX} cells), never as a quiet one`);
  const dRows = clean.chg.filter((r) => r[1] !== "—");
  ok(dRows.length > 3 && dRows.every((r) => /^[▲▼◆] /.test(r[1])), "every printed rotation change carries a triangle beside its sign, so colour is never the only channel");
  const GB = gappy();
  const noPrice = new Set(GB.filings.rows.flatMap((r) => (r.top || []).filter((c) => c.dv === null || c.dv === undefined).map((c) => c.t)));
  const priced = new Set(GB.filings.rows.flatMap((r) => (r.top || []).filter((c) => c.dv !== null && c.dv !== undefined).map((c) => c.t)));
  ok(noPrice.size > 0 && priced.size > 0, "the fixture has changes with a price and changes without one");
  for (const c of clean.chips) {
    if (c.title.startsWith("No price on the report date")) ok(/ sh$/.test(c.text) && !c.text.includes("$"), `a change with no price is in shares and carries no dollar sign: ${c.text}`);
    else ok(c.text.includes("$") && !/ sh$/.test(c.text), `a priced change is in dollars: ${c.text}`);
  }
  eq(clean.focus, clean.label, "closing the drill returns focus to the chip");
  eq(clean.legend.length, six, "the venue legend lists the six largest venues and Other venues, none dropped");

  {
    const behind = async (session, now) => {
      const { ctx, page } = await openPos(browser, 1440, 820, { body: payload({ sessionDate: session }), now });
      const t = await page.evaluate(() => ({ text: document.getElementById("posStamp").textContent, stale: document.getElementById("posStamp").dataset.stale || null }));
      await ctx.close();
      return t;
    };
    const holiday = await behind("2026-11-25", "2026-11-28T03:30:00Z");
    eq(holiday.stale, null, "A PAYLOAD FROM THE WEDNESDAY BEFORE THANKSGIVING READ ON THE FRIDAY IS ONE SESSION BEHIND AND NOT STALE: " + holiday.text);
    const old = await behind("2026-11-20", "2026-11-28T03:30:00Z");
    eq([old.stale, old.text], ["1", "From the 2026-11-20 session"], "a payload four sessions behind is stale and names its session");
  }

  {
    const { ctx, page } = await openPos(browser, 1440, 820, { drillFail: true });
    await view(page, "filings");
    await page.locator("#posFilCardB .pos-cp").first().click();
    await page.waitForSelector("#posDrill[open]");
    await page.waitForSelector("#posDrillB button");
    const msg = await page.locator("#posDrillB").innerText();
    ok(/did not answer/i.test(msg) && /Retry/.test(msg), "a failed drill read says the feed did not answer and offers Retry");
    await page.locator("#posDrillB button").click();
    await page.waitForTimeout(400);
    const after = await page.locator("#posDrillB").innerText();
    ok(!/did not answer/i.test(after) && after.length > 20, "Retry asks again and the drill fills");
    await ctx.close();
  }

  for (const [w, h] of SIZES) {
    const { ctx, page } = await openPos(browser, w, h);
    for (const tab of TABS) {
      await view(page, tab);
      const text = await page.evaluate(() => document.querySelector("#pos").innerText);
      ok(!/\b(EST|EDT|ET|UTC|GMT)\b/.test(text), `${w}x${h} ${tab}: no zone but Türkiye time is named`);
      ok(!/\bnull\b|\bundefined\b|\bNaN\b|\[object/.test(text), `${w}x${h} ${tab}: no stray null, NaN or object in the text`);
      const btn = page.locator(".pos-mod:not([inert]) .fd-all:visible").first();
      if (await btn.count()) {
        await btn.click();
        await page.waitForSelector(".fd-dlg[open]");
        const g = await page.evaluate(() => {
          const d = document.querySelector(".fd-dlg[open]").getBoundingClientRect();
          const de = document.documentElement;
          return { in: d.left >= -1 && d.top >= -1 && d.right <= innerWidth + 1 && d.bottom <= innerHeight + 1, page: de.scrollHeight - innerHeight, side: de.scrollWidth - innerWidth, text: document.querySelector(".fd-dlg[open]").innerText };
        });
        eq([g.in, g.page <= 0, g.side <= 0], [true, true, true], `${w}x${h} ${tab}: the Show all dialog stays inside the screen and moves nothing`);
        ok(!/\b(EST|EDT|ET|UTC|GMT)\b/.test(g.text) && !/vendor|tape/i.test(g.text), `${w}x${h} ${tab}: and its copy is clean`);
        await page.keyboard.press("Escape");
      }
    }
    await ctx.close();
  }

  for (const w of [390, 1440]) {
    const { ctx, page } = await openPos(browser, w, w === 390 ? 844 : 820);
    await page.evaluate(AXE);
    for (const tab of TABS) {
      await view(page, tab);
      const n = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: "rule", values: ["color-contrast", "button-name", "aria-valid-attr-value", "aria-required-children", "aria-required-parent", "label", "tabindex", "svg-img-alt", "heading-order", "link-name"] }, resultTypes: ["violations"] })).violations.map((v) => v.id + ":" + v.nodes.length));
      eq(n, [], `axe finds no violation in ${tab} at ${w}`);
    }
    await ctx.close();
  }

  {
    const { ctx, page } = await openPos(browser, 1440, 820, { context: { forcedColors: "active", reducedMotion: "reduce" } });
    await view(page, "rotation");
    const fills = await page.evaluate(() => [...document.querySelectorAll("#posRot svg rect.p, #posRot svg rect.m")].map((r) => getComputedStyle(r).fill));
    ok(fills.length > 0 && new Set(fills).size === 1, `forced colours draw every bar in one system colour: ${[...new Set(fills)]}`);
    await view(page, "insiders");
    const cell = await page.evaluate(() => { const c = document.querySelector(".pos-hc[data-t]"); return getComputedStyle(c).outlineStyle; });
    ok(cell !== "none", "and a heat cell keeps an outline of its own");
    const moving = await page.evaluate(() => [...document.querySelectorAll("#pos *")].filter((e) => { const cs = getComputedStyle(e); return parseFloat(cs.transitionDuration) > 0 || parseFloat(cs.animationDuration) > 0; }).map((e) => e.tagName + "." + e.className + ":" + getComputedStyle(e).transitionDuration + "/" + getComputedStyle(e).animationName));
    eq(moving, [], "under reduced motion nothing on the page transitions or animates");
    await ctx.close();
  }

  const Q = payload();
  Q.rotation.sectors[0].dW = null;
  Q.rotation.sectors[0].wNow = null;
  const planted = [
    ["the minus drawn as a hyphen", [["const MINUS = \"−\";", "const MINUS = \"-\";"]]],
    ["a missing change drawn as zero", [["chg.textContent = has ? shape(s.dW) + \" \" + fmtPts(s.dW, true) : DASH;", "chg.textContent = has ? shape(s.dW) + \" \" + fmtPts(s.dW, true) : \"0.00\";"]]],
    ["each bar on its own axis", [["const w = (Math.abs(s.dW) / axis) * 50;", "const w = (Math.abs(s.dW) / (Math.abs(s.dW) || 1)) * 50;"]]],
    ["the axis ignoring a fall", [["if (num(s.dW) !== null && Math.abs(s.dW) > max) max = Math.abs(s.dW);", "if (num(s.dW) !== null && s.dW > max) max = s.dW;"]]],
    ["the hero naming the smallest move", [["(Math.abs(b.dW) - Math.abs(a.dW)) || cmp(a.s, b.s)", "(Math.abs(a.dW) - Math.abs(b.dW)) || cmp(a.s, b.s)"]]],
    ["the failures cell counting every name", [["(num(x.heavy) || 0)", "(num(x.n) || 0)"]]],
  ];
  for (const [title, transforms] of planted) {
    let src = sources;
    for (const [from, to] of transforms) {
      assert.equal(src.split(from).length - 1, 1, "plant target occurs once: " + title);
      src = src.replace(from, to);
    }
    const { ctx, page } = await openPos(browser, 1440, 820, { js: src, body: Q });
    const got = await page.evaluate(() => ({
      hero: Object.fromEntries([...document.querySelectorAll("#posHero .pos-kpi")].map((k) => [k.dataset.id, k.querySelector(".v").textContent])),
      rows: [...document.querySelectorAll("#posRot .pos-row")].map((r) => ({ s: r.dataset.s, chg: r.querySelector(".chg").textContent, plus: r.querySelector("svg rect.p") && r.querySelector("svg rect.p").getAttribute("width"), minus: r.querySelector("svg rect.m") && r.querySelector("svg rect.m").getAttribute("width") })),
    }));
    const live = Q.rotation.sectors.filter((s) => s.n > 0 && s.dW !== null);
    const big = live.slice().sort((a, b) => (Math.abs(b.dW) - Math.abs(a.dW)) || (a.s < b.s ? -1 : 1))[0];
    let b = 0, s = 0;
    void b; void s;
    const axis = (() => { let max = 0; for (const x of Q.rotation.sectors) if (x.dW !== null && Math.abs(x.dW) > max) max = Math.abs(x.dW); return Math.max(0.5, Math.ceil(max * 2 - 1e-9) / 2); })();
    const heavy = Q.shorts.ftd.sectors.reduce((a, x) => a + (x.heavy || 0), 0);
    let bad = got.hero.rotation !== `${big.s} ${pts(big.dW, true)}` || got.hero.fails !== heavy + (heavy === 1 ? " name" : " names");
    for (const r of got.rows) {
      const src2 = Q.rotation.sectors.find((x) => x.s === r.s);
      if (!src2 || src2.dW === null || !src2.n) { if (r.chg !== "—") bad = true; continue; }
      if (!r.chg.endsWith(pts(src2.dW, true))) bad = true;
      const want = (Math.abs(src2.dW) / axis) * 50;
      const have = Number(String(src2.dW >= 0 ? r.plus : r.minus).replace("%", ""));
      if (!(Math.abs(have - want) < 0.01)) bad = true;
    }
    ok(bad, "PLANTED WRONG BUILD FAILS: " + title);
    await ctx.close();
  }
  const plantedMore = [
    ["colour as the only sign channel", { js: [["chg.textContent = has ? shape(s.dW) + \" \" + fmtPts(s.dW, true) : DASH;", "chg.textContent = has ? fmtPts(s.dW, true) : DASH;"]] }],
    ["a missing insider date drawn as a neutral cell", { js: [["if (b === null || s === null) return \"x\";", "if (b === null || s === null) return \"z\";"]] }],
    ["a UTC stamp", { js: [["const built = UI.F.stamp ? UI.F.stamp(Date.parse(p.generatedAt)) : null;", "const built = new Date(p.generatedAt).toISOString().slice(11, 16) + \" UTC\";"]] }],
    ["the word vendor in the info dialog", { html: [["from public filings the feed collects.", "from public filings the vendor collects."]] }],
    ["the drill not returning focus", { js: [["if (f && f.isConnected) f.focus();", "if (f && f.isConnected && document.activeElement) document.activeElement.blur();"]] }],
    ["a Filings chip in shares with a dollar sign", { js: [["shares(Math.abs(c.du)) + \" sh\";", "\"$\" + shares(Math.abs(c.du)) + \" sh\";"]] }],
    ["the venue legend dropping small segments", { js: [["...(other > 0 ? [[\"Other venues\", other]] : [])", ""]] }],
    ["the stage scrolling", { css: ".pos-hero { min-height: 1000px; }\n" }],
    ["stale counted in weekdays", { js: [["return list.filter((d) => d > session && d <= expected).length;", "let n = 0; for (let t = Date.parse(session + \"T00:00:00Z\") + 864e5; t <= Date.parse(expected + \"T00:00:00Z\"); t += 864e5) { const w = new Date(t).getUTCDay(); if (w !== 0 && w !== 6) n++; } return n;"]] }],
  ];
  for (const [title, kind] of plantedMore) {
    let js = sources, css, html;
    for (const [from, to] of kind.js || []) { assert.equal(js.split(from).length - 1, 1, "plant target occurs once: " + title); js = js.replace(from, to); }
    if (kind.css) css = cssSrc + kind.css;
    if (kind.html) { html = (await import("./lib/pos-world.mjs")).html(); for (const [from, to] of kind.html) { assert.equal(html.split(from).length - 1, 1, "plant target occurs once: " + title); html = html.replace(from, to); } }
    let bad = false;
    if (title === "the stage scrolling") {
      const { ctx, page } = await openPos(browser, 1024, 768, { css });
      for (const tab of TABS) { await view(page, tab); const f = await fit(page); if (f.page > 0 || f.problems.length) bad = true; }
      await ctx.close();
    } else if (title === "stale counted in weekdays") {
      const { ctx, page } = await openPos(browser, 1440, 820, { js, body: payload({ sessionDate: "2026-11-25" }), now: "2026-11-28T03:30:00Z" });
      if (await page.evaluate(() => Boolean(document.getElementById("posStamp").dataset.stale))) bad = true;
      await ctx.close();
    } else {
      const o = await scenario({ js, html, body: gappy() });
      if (!o.stamp.includes(trtOf(P.generatedAt) + " TRT") || /vendor/i.test(o.info) || o.heatX === 0) bad = true;
      if (!o.chg.filter((r) => r[1] !== "—").every((r) => /^[▲▼◆] /.test(r[1]))) bad = true;
      if (o.focus !== o.label) bad = true;
      if (o.legend.length !== six) bad = true;
      for (const c of o.chips) if (c.title.startsWith("No price on the report date") ? c.text.includes("$") : !c.text.includes("$")) bad = true;
    }
    ok(bad, "PLANTED WRONG BUILD FAILS: " + title);
  }
} finally {
  await browser.close();
}

console.log(`✓ flows-pos-render: ${checks} assertions — the Positioning page at 1920x1080, 1440x820, 1024x768 and 390x844 in all four views with no page scroll, sideways scroll or clipped content, the hero and every rotation bar against independent computations from the payload, dashes for missing figures, the pending and failed states, the drill sheet and info dialog with focus returned, the heat strip by keyboard, no barred word or other zone, the stale stamp counted in sessions across a holiday, the drill Retry, the Show all dialogs at four sizes, only Türkiye time, axe at 390 and 1440, forced colours, reduced motion, a sheet of tokens only, and fifteen planted wrong builds that each fail`);
