import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { openDesk, showView, chain, syxChain, engineBlock, REPO } from "./desk-fixtures.mjs";

const require = createRequire(import.meta.url);
const AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); checks++; };
const flat = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();

const DESK = "assets/js/flows-desk.js";
const serve = (rel, edits) => {
  let text = fs.readFileSync(new URL(rel, REPO), "utf8");
  for (const [a, b] of edits) { assert.equal(text.split(a).length - 1, 1, "mutant applies once: " + a.slice(0, 50)); text = text.replace(a, () => b); }
  return async (p) => { await p.route(new RegExp("/" + rel.replace(/[.]/g, "\\.") + "(\\?.*)?$"), (r) => r.fulfill({ contentType: "text/javascript", body: text })); };
};
const withContext = (ctx) => ({ newPage: () => ctx.newPage() });
const ready = (page, n) => page.waitForFunction((k) => document.querySelectorAll(".desk-chip.is-ok").length >= k, n, { timeout: 20000 });
const rowFacts = async (page, selector) => {
  await showView(page, "lines");
  await page.locator(selector + " .ui-info").first().click();
  await page.waitForSelector("#fxPop:popover-open");
  const facts = await page.$$eval("#fxPop dt", (dts) => Object.fromEntries(dts.map((dt) => [dt.textContent.trim(), dt.nextElementSibling.textContent.trim()])));
  await page.keyboard.press("Escape");
  await page.waitForSelector("#fxPop:not(:popover-open)", { state: "attached" });
  return facts;
};

const browser = await chromium.launch();
const errors = [];
try {
  {
    const NAMES = ["SYA", "SYB", "SYC", "SYD", "SYE"];
    const mk = (t, strat) => {
      const p = syxChain(t, { spot: 100 });
      p.rows = p.rows.map((r) => ({ ...r, strategy: strat, type: strat === "csp" ? "P" : "C" }));
      return p;
    };
    const probe = async (before) => {
      const held = [], held2 = [], seen = [];
      const page = await openDesk(browser, {
        payloads: Object.fromEntries(NAMES.map((t) => [t, (q) => mk(t, q.get("strategy"))])), query: "?t=SYA,SYB,SYC,SYD,SYE&strategy=csp", errors, before,
        onChain: async (route, u) => {
          const t = u.searchParams.get("t"), strat = u.searchParams.get("strategy");
          if (strat === "csp" && (t === "SYD" || t === "SYE")) { await new Promise((res) => held.push(res)); await route.fulfill({ status: 200, contentType: "application/json", headers: { "x-chain-age": "0" }, body: JSON.stringify(mk(t, "csp")) }); return true; }
          if (strat === "cc" && ["SYA", "SYB", "SYC"].includes(t)) await new Promise((res) => held2.push(res));
          return false;
        },
      });
      await page.waitForFunction(() => document.querySelectorAll(".desk-chip.is-ok").length >= 3, null, { timeout: 15000 });
      await showView(page, "lines");
      await page.locator("#deskStrategy .ui-seg-i", { hasText: /^Calls$/ }).click();
      await page.waitForTimeout(250);
      held.forEach((r) => r());
      await page.waitForTimeout(300);
      seen.push(...await page.evaluate(() => [...document.querySelectorAll("#dkList .dk-row")].map((r) => r.dataset.t + ":" + r.dataset.strategy)));
      held2.forEach((r) => r());
      await page.waitForTimeout(600);
      const after = await page.evaluate(() => [...new Set([...document.querySelectorAll("#dkList .dk-row")].map((r) => r.dataset.strategy))]);
      await page.close();
      return { wrong: [...new Set(seen)].filter((x) => !x.endsWith(":cc")), after };
    };
    const good = await probe(null);
    eq(good.wrong, [], "SWITCHING PUTS TO CALLS WHILE TWO NAMES ARE STILL IN FLIGHT: a late response for the old side never reaches the Calls list");
    eq(good.after, ["cc"], "and when the new side lands every row is a call");
    const bad = await probe(serve(DESK, [["    invalidate(book.values());\n", ""]]));
    ok(bad.wrong.length > 0, "PLANTED WRONG BUILD IS CAUGHT: without the invalidation the old side's rows are listed under Calls (" + bad.wrong.join(",") + ")");
  }

  {
    const payload = (extra = {}) => chain({ ticker: "SYX101", spot: 100, asOf: "2026-09-29", lines: [{ type: "C", strike: 100, expiry: "2026-10-09", bid: 2.5 }, { type: "C", strike: 105, expiry: "2026-10-09", bid: 0.9 }], engine: engineBlock("SYX101", "2026-09-29", 50), source: "stock-state", extra: { generatedAt: "2026-09-29T15:00:00.000Z", ...extra } });
    const probe = async (before) => {
      let calls = 0;
      const page = await openDesk(browser, { payloads: { SYX101: payload() }, query: "?t=SYX101&strategy=cc", errors, before,
        onChain: async (route) => {
          calls++;
          if (calls === 1) { await route.fulfill({ status: 200, contentType: "application/json", headers: { "x-chain-age": "7200", "x-fresh-state": "stale", "x-fresh-reason": "throttled", "x-fresh-throttled": "1" }, body: JSON.stringify(payload()) }); return true; }
          return false;
        } });
      await ready(page, 1);
      const first = flat(await page.locator("#deskStatus").textContent());
      const title = await page.locator(".dk-chip-t").first().getAttribute("title");
      await page.click("#deskRefresh");
      await page.waitForFunction(() => !/kept at/.test(document.getElementById("deskStatus").textContent), null, { timeout: 5000 }).catch(() => {});
      const second = flat(await page.locator("#deskStatus").textContent());
      await page.close();
      return { first, second, title };
    };
    const good = await probe(null);
    ok(/SYX101 is shown from the copy kept at 2026-09-29 18:00 TRT: the rate limit refused a fresh read, so Refresh returns the same copy until it lifts\./.test(good.first), "A KEPT COPY SERVED BECAUSE THE LIMITER REFUSED says so, with the copy's own read time in TRT: " + good.first.slice(0, 200));
    ok(!/Refresh requotes it/.test(good.first) && /older than this desk will call a price/.test(good.first), "and no longer promises that Refresh requotes it");
    ok(/kept copy/.test(good.title), "the chip says it too: " + good.title);
    ok(!/kept at/.test(good.second) && !/rate limit refused/.test(good.second), "the notice clears when a fresh copy arrives");
    const bad = await probe(serve(DESK, [['const kept = res.headers.get("X-Fresh-State") === "stale" ? String(res.headers.get("X-Fresh-Reason") || "") : null;', "const kept = null;"]]));
    ok(!/kept at/.test(bad.first), "PLANTED WRONG BUILD IS CAUGHT: a desk that ignores the header shows only the age");
  }

  {
    const mkChain = (earnings, lineEarn, extra = {}) => chain({ ticker: "SYX101", spot: 100, asOf: "2026-09-29", earnings,
      lines: lineEarn.map((e, i) => ({ type: "C", strike: 100 + i * 5, expiry: "2026-10-09", bid: 2.5 - i * 0.5, earnings: e })), engine: engineBlock("SYX101", "2026-09-29", 50), source: "stock-state", extra });
    const status = async (payload, before = null) => {
      const page = await openDesk(browser, { payloads: { SYX101: payload }, query: "?t=SYX101&strategy=cc", errors, before });
      await ready(page, 1);
      const t = flat(await page.locator("#deskStatus").textContent());
      await page.close();
      return t;
    };
    const E = (over) => ({ date: "2026-10-20", announceTime: "premarket", issueType: "Common Stock", past: false, precedesSale: false, ...over });
    const cases = [
      ["a date that has passed", mkChain(E({ date: "2026-09-15", past: true, precedesSale: true }), [null, null]), /SYX101: its last listed report date, 09-15, has passed and the next one is not published, so whether a line outlives the next report is not determined\./, /reports 09-15/],
      ["a report that precedes the next sale", mkChain(E({ date: "2026-09-29", precedesSale: true }), [null, null]), /SYX101: the report dated 09-29 comes before the next sale can be made/, /no line expires after it/],
      ["every line clear", mkChain(E({ date: "2026-10-20" }), [false, false]), /SYX101 reports 10-20 — no line expires after it/, /not determined/],
      ["a mix of clear and undetermined lines", mkChain(E({ date: "2026-10-20" }), [false, null]), /SYX101 reports 10-20 — whether a line expires after it is not determined, for 1 line\./, /no line expires after it/],
      ["no company read at all", mkChain(null, [null, null]), /SYX101 earnings date not read: the data provider's company read did not answer/, /no known earnings date|no line expires after it/],
      ["a line that crosses", mkChain(E({ date: "2026-10-05" }), [true, false]), /SYX101 reports 10-05 — 1 of 2 lines expire after it/, /not determined/],
    ];
    for (const [label, payload, want, never] of cases) {
      const t = await status(payload);
      ok(want.test(t) && !never.test(t), `${label}: ${t.slice(0, 160)}`);
    }
    const mixed = await status(cases[3][1], serve(DESK, [['if (unknown) return T("earn-undetermined"', 'if (unknown === rows.length) return T("earn-undetermined"']]));
    ok(/no line expires after it/.test(mixed), "PLANTED WRONG BUILD IS CAUGHT: reading 'all lines undetermined' instead of 'any' claims no line expires after the report");
    const stale = await status(cases[0][1], serve(DESK, [['if (e.past === true) return T("earn-past", { sym, md });\n', ""]]));
    ok(!/has passed/.test(stale), "PLANTED WRONG BUILD IS CAUGHT: ignoring the passed date prints a present-tense report date and no sentence about it having passed");
  }

  {
    const line = (type, strike, bid) => ({ type, strike, expiry: "2026-10-09", bid });
    const mk = (lines) => chain({ ticker: "SYX101", spot: 100, asOf: "2026-09-29", lines, engine: engineBlock("SYX101", "2026-09-29", 50), source: "stock-state" });
    const probe = async (payload, before = null, rank = "annualized") => {
      const page = await openDesk(browser, { payloads: { SYX101: payload }, query: "?t=SYX101&strategy=cc&bp=50000&rank=" + rank, errors, before, viewport: { width: 1440, height: 900 } });
      await ready(page, 1);
      await page.waitForFunction(() => document.getElementById("deskPlan").dataset.plan, null, { timeout: 15000 });
      const out = {
        sentence: await page.$eval("#deskPlan", (n) => n.dataset.plan),
        head: await page.locator("#deskPlan .dk-plan-v b").count() ? flat(await page.locator("#deskPlan .dk-plan-v b").textContent()) : null,
        collects: await page.locator("#deskPlan .dk-plan-v b").count() ? flat(await page.locator("#deskPlan .ui-metric").first().locator(".ui-metric-v").textContent()) : null,
        itm: await page.locator("#deskPlan .dk-itm").count() ? flat(await page.locator("#deskPlan .dk-itm").textContent()) : null,
      };
      await showView(page, "lines");
      out.order = await page.$$eval("#dkList .dk-row", (rs) => rs.map((r) => r.dataset.strike));
      out.collectTip = await page.$$eval("#dkList .dk-row .dk-col", (cs) => cs.map((c) => c.title));
      await page.close();
      return out;
    };
    const both = mk([line("C", 80, 20.05), line("C", 105, 0.6)]);
    const good = await probe(both);
    ok(/earns \$300 of time value/.test(good.sentence) && /call expiring 2026-10-09/.test(good.sentence), "the best deployment is the 105 call that earns $300 of time value: " + good.sentence.slice(0, 150));
    eq(good.head, "5× SYX101 105 call", "not the 80 call that brings in $10,025 of cash");
    eq(good.itm, null, "an out-of-the-money best line carries no in-the-money note");
    const only = await probe(mk([line("C", 80, 20.05)]));
    ok(/earns \$25 of time value/.test(only.sentence), "a deep in-the-money line earns its time value only: " + only.sentence.slice(0, 120));
    eq(only.collects, "$25", "its Earns is the time value, not the $10,025 cash in");
    ok(/Of the cash in, \$10,000 is the option's in-the-money value at today's price, not income; the time value is \$25\./.test(only.itm || ""), "and the card says how much of that is not income: " + only.itm);
    ok(only.collectTip.some((t) => /in-the-money value at today's price, which is not income/.test(t)) && only.collectTip.every((t) => /in time value on the capital/.test(t)), "and so does the Collect tooltip, whose return is a time-value return");
    const ranked = await probe(both, null, "collectible");
    eq(ranked.order, ["105", "80"], "the Time value collectible rank puts the line that earns more first, whatever it brings in as cash");
    const zero = await probe(mk([line("C", 80, 20.0)]));
    ok(/none has time value left at these quotes/.test(zero.sentence), "when every line is at its intrinsic value there is no best line and the plan says why: " + zero.sentence.slice(0, 120));
    const noTv0 = await probe(mk([line("C", 80, 20.0)]), serve(DESK, [['z.timeValueC > 0 && (!best', 'z.collectible > 0 && (!best']]));
    ok(!/none has time value left/.test(noTv0.sentence), "PLANTED WRONG BUILD IS CAUGHT: a best line chosen on any cash at all names a line that earns nothing");
    const gross = await probe(both, serve(DESK, [["if (z.timeValueC > 0 && (!best || betterDeployment(z, best.__sizing))) best = r;", "if (!best || z.collectible > best.__sizing.collectible) best = r;"]]));
    ok(/80/.test(gross.head), "PLANTED WRONG BUILD IS CAUGHT: choosing by gross cash picks the 80 call");
  }

  {
    const calls = (page) => page.asked.map((q) => q.get("rank"));
    const payloads = { SYX101: syxChain("SYX101", { spot: 100 }) };
    const probe = async (before) => {
      const page = await openDesk(browser, { payloads, query: "?t=SYX101&strategy=sc&rank=ratio", errors, before });
      await ready(page, 1);
      const asked = calls(page);
      await page.close();
      return asked;
    };
    eq(await probe(null), ["yieldOnCollateral"], "the short-call rank 'Premium ÷ collateral' asks the server for its top 120 by per-trip yield, the metric it is ranked by (the annualised cut held none of the true top ten)");
    const bad = await probe(serve(DESK, [['k === "edge" || k === "ratio" ? "yieldOnCollateral" : k', 'k === "edge" ? "yieldOnCollateral" : k === "ratio" ? "annualized" : k']]));
    eq(bad, ["annualized"], "PLANTED WRONG BUILD IS CAUGHT: mapping it back to the annualised cut is visible in the request");
  }

  {
    const mk = (forwards) => chain({ ticker: "SYX101", spot: 100, asOf: "2026-09-29", lines: [{ type: "C", strike: 100, expiry: "2026-10-09", bid: 2.5 }], engine: engineBlock("SYX101", "2026-09-29", 50), source: "stock-state", extra: { forwards } });
    const text = async (forwards, before = null) => {
      const page = await openDesk(browser, { payloads: { SYX101: mk(forwards) }, query: "?t=SYX101&strategy=cc", errors, before });
      await ready(page, 1);
      const facts = await rowFacts(page, "#dkList .dk-row");
      await page.close();
      return String(facts.Forward);
    };
    const own = async (f) => (await text(f)).replace(/ The engine prices delta, win % and EV on [\d.]+ \(the card's carry\)(, [\d.]+% from it)?\.$/, "");
    const engine = await text([{ expiry: "2026-10-09", method: "parity", pairs: 9, F: 100.1234 }]);
    ok(/ The engine prices delta, win % and EV on 100\.\d\d \(the card's carry\), \d+\.\d\d% from it\.$/.test(engine), "the line says which forward the engine priced delta, win % and EV on, and how far that is from the cushion's: " + engine);
    ok(/ The engine prices delta, win % and EV on 100\.\d\d \(the card's carry\)\.$/.test(await text([{ expiry: "2026-10-09", method: "rate-only", pairs: 0, F: null }])), "and when no forward figure is named it still names the engine's");
    eq(await own([{ expiry: "2026-10-09", method: "parity", pairs: 9, F: 100.1234 }]), "100.12, the chain's own put-call parity over 9 strikes. The cushion's volatility is inverted at it.", "a parity forward is named with its figure and the number of strikes that placed it");
    eq(await own([{ expiry: "2026-10-09", method: "carry", pairs: 0, F: 99.95 }]), "99.95, from the card's implied carry: the chain placed no parity forward for this expiry.", "a carry forward says so");
    eq(await own([{ expiry: "2026-10-09", method: "rate-only", pairs: 0, F: null }]), "the interest rate alone: the chain placed no parity forward for this expiry and the card holds no usable carry.", "the rate alone says so");
    eq(await text([]), "— this payload did not name a forward for this expiry.", "no entry is a dash with its reason");
    const cushionPage = await openDesk(browser, { payloads: { SYX101: mk([]) }, query: "?t=SYX101&strategy=cc", errors });
    await ready(cushionPage, 1);
    const cushion = await cushionPage.$eval('#dkCopy [data-k="cushion"]', (n) => String(n.textContent).replace(/\s+/g, " ").trim());
    await cushionPage.close();
    ok(/forward the chain's own put-call parity places for that expiry \(else the card's implied carry, else the interest rate alone\)/.test(cushion) && !/the forward the interest rate alone gives/.test(cushion), "the cushion copy names the forward the server really uses");
    const bad = await text([{ expiry: "2026-10-09", method: "parity", pairs: 9, F: 100.1234 }], serve(DESK, [['f.method === "parity" && isNum(f.F) !== null ? T("fwd-parity"', 'false ? T("fwd-parity"']]));
    ok(!/put-call parity over 9/.test(bad), "PLANTED WRONG BUILD IS CAUGHT: a desk that drops the parity branch no longer says where its forward came from");
  }

  {
    const row = (assigned, cushion) => {
      const p = chain({ ticker: "SYX101", spot: 100, asOf: "2026-09-29", lines: [{ type: "C", strike: 100, expiry: "2026-10-09", bid: 2.5 }], engine: engineBlock("SYX101", "2026-09-29", 50), source: "stock-state" });
      p.rows[0].assignedReturn = assigned;
      p.rows[0].cushionSigmas = cushion;
      return p;
    };
    const read = async (before) => {
      const page = await openDesk(browser, { payloads: { SYX101: row(-1e-16, -0.001) }, query: "?t=SYX101&strategy=cc", errors, before });
      await ready(page, 1);
      const f = await rowFacts(page, "#dkList .dk-row");
      await page.close();
      return [f["If called"], f.Cushion];
    };
    const [called, cushion] = await read(null);
    ok(/^0\.0%/.test(called) && /^0\.00 SD/.test(cushion), `a magnitude that rounds to zero prints unsigned, never −0.0% or −0.00 SD (${called} | ${cushion})`);
    const [badCalled] = await read(serve(DESK, [['const minusOf = (n, magnitude) => (n < 0 && Number(magnitude) !== 0 ? MINUS : "");', 'const minusOf = (n, magnitude) => (n < 0 ? MINUS : "");']]));
    ok(/^−0\.0%/.test(badCalled), "PLANTED WRONG BUILD IS CAUGHT: a sign decided before rounding prints −0.0%");
  }

  {
    const payloads = { SYA: syxChain("SYA", { spot: 100 }), SYB: syxChain("SYB", { spot: 48.5, start: 30 }) };
    const state = async (page) => ({ tenor: await page.$eval("#dkTenor [aria-selected=true]", (n) => n.textContent), url: await page.evaluate(() => location.search) });
    const run = async (before) => {
      const page = await openDesk(browser, { payloads, query: "?t=SYA,SYB&strategy=cc", errors, before });
      await ready(page, 2);
      await page.locator("#dkTenor .ui-seg-i", { hasText: "2–6w" }).click();
      await page.waitForFunction(() => /tenor=/.test(location.search), null, { timeout: 2000 }).catch(() => {});
      const url = (await state(page)).url;
      await page.reload();
      await ready(page, 2);
      const back = await state(page);
      await page.close();
      return { url, back };
    };
    const good = await run(null);
    ok(/tenor=6w/.test(good.url), "the days-to-expiry window is in the address: " + good.url);
    eq(good.back.tenor, "2–6w", "and a reload, or a link sent to someone, keeps it");
    const bad = await run(serve(DESK, [['if (tenor !== 0) url.searchParams.set("tenor", TENOR_KEYS[tenor]); else url.searchParams.delete("tenor");', ""]]));
    eq(bad.back.tenor, "All", "PLANTED WRONG BUILD IS CAUGHT: a desk that does not write the window loses it on reload");
  }

  {
    const payloads = { SYA: syxChain("SYA", { spot: 100 }) };
    const seen = [];
    for (const tz of ["UTC", "Europe/Istanbul", "America/New_York", "Pacific/Auckland", "Pacific/Kiritimati", "Pacific/Pago_Pago"]) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 820 }, timezoneId: tz });
      const page = await openDesk(withContext(ctx), { payloads, query: "?t=SYA&strategy=cc", errors });
      await ready(page, 1);
      await showView(page, "lines");
      seen.push((await page.$$eval("#dkList .dk-row .dk-meta", (n) => n.slice(0, 3).map((x) => x.textContent))).join("|"));
      await ctx.close();
    }
    eq([...new Set(seen)].length, 1, "THE SAME EXPIRY AND DAY COUNT IN SIX PROCESS TIME ZONES, from UTC-11 to UTC+14: " + seen[0]);
    ok(/^Oct 2 · 3d/.test(seen[0]), "Oct 2, three days out");
  }

  {
    const payloads = { SYA: syxChain("SYA", { spot: 100 }), SYB: syxChain("SYB", { spot: 48.5, start: 30 }) };
    const geometry = () => {
      const visible = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && !e.closest("[inert]") && !e.closest(".visually-hidden"); };
      const els = [...document.querySelectorAll("a[href], button, input:not([type=hidden]), select, summary, [role=tab]")].filter(visible).map((e) => ({ e, r: e.getBoundingClientRect() }));
      const small = els.filter(({ r }) => r.width < 24 || r.height < 24);
      const bad = [];
      for (const a of small) {
        const cx = a.r.left + a.r.width / 2, cy = a.r.top + a.r.height / 2;
        for (const b of els) {
          if (b === a) continue;
          const dx = Math.max(b.r.left - cx, 0, cx - b.r.right), dy = Math.max(b.r.top - cy, 0, cy - b.r.bottom);
          if (Math.hypot(dx, dy) < 12 - 1e-6) bad.push((a.e.className || a.e.tagName) + " vs " + (b.e.className || b.e.tagName));
          if (small.includes(b)) { const bx = b.r.left + b.r.width / 2, by = b.r.top + b.r.height / 2; if (Math.hypot(bx - cx, by - cy) < 24 - 1e-6) bad.push((a.e.className || a.e.tagName) + " circle meets " + (b.e.className || b.e.tagName)); }
        }
      }
      return { n: els.length, small: small.length, bad: [...new Set(bad)].slice(0, 5) };
    };
    for (const width of [320, 640, 768, 1280]) {
      const page = await openDesk(browser, { payloads, query: "?t=SYA,SYB&strategy=csp&bp=100000", errors, viewport: { width, height: 900 } });
      await ready(page, 2);
      await showView(page, "lines");
      const g = await page.evaluate(geometry);
      eq(g.bad, [], `${width}px: every target under 24px keeps the WCAG 2.5.8 spacing (${g.small} undersized of ${g.n})`);
      await page.close();
    }
    for (const width of [390, 1440]) {
      const page = await openDesk(browser, { payloads, query: "?t=SYA,SYB&strategy=csp&bp=100000", errors, viewport: { width, height: 844 } });
      await ready(page, 2);
      for (const view of width < 900 ? ["frontier", "lines", "plan"] : ["frontier", "lines"]) {
        await showView(page, view);
        await page.addScriptTag({ content: AXE });
        const v = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ["violations"] })).violations.map((x) => x.id));
        eq(v, [], `${width}px ${view}: axe finds nothing on the populated desk`);
      }
      await page.close();
    }
  }

  eq(errors.length, 0, `no uncaught page error across the whole session (${errors[0] || ""})`);
} finally {
  await browser.close();
}

console.log(`✓ flows-desk-audit-render: ${checks} assertions — a late response for the old side never reaches the list, a kept copy served under the rate limit says so in TRT, the earnings line never claims what it cannot know, the best deployment is the line that earns the most time value, the short-call rank asks the server for the metric it ranks by, the forward each line used is named, no signed zero, one answer in six time zones, and the targets keep their 2.5.8 spacing with axe clean`);
