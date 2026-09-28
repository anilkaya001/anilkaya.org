import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { trackPage } from "../shared/flows-pages.js";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.equal(a, b, m); checks++; };

const ROOT = new URL("../", import.meta.url);
const DAYS = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"];
const CLOSES = [["2026-08-31", 99], ["2026-09-01", 100], ["2026-09-02", 102], ["2026-09-03", 101],
  ["2026-09-04", 99], ["2026-09-05", 98], ["2026-09-08", 100], ["2026-09-09", 103], ["2026-09-10", 97]];

const TRACK = {
  v: 2, generatedAt: "2026-09-06T02:00:00.000Z", sessionDate: "2026-09-05", status: "ok",
  windowSessions: 5, deadBand: 1, epoch: null, namesSeen: 2, namesShed: 0, shedBy: null,
  archive: { probed: 10, failed: 0, abandoned: false }, sources: { full: 5, boardsOnly: 0 },
  sessions: DAYS.map((d) => ({ d, source: "scores", names: 2, preEpoch: false })),
  names: [
    { t: "AAA", s: [10, null, -30, 0, 40], n: 4, last: 40, lastAt: 4, d1: { v: 40, gap: 1, qv: 800, cross: "cleared" }, run: 1, ext: { hi: 40, hiAt: 4, lo: -30, loAt: 2 } },
    { t: "BBB", s: [null, 40, null, -40, null], n: 2, last: -40, lastAt: 3, d1: { v: -80, gap: 2, qv: -900, cross: "flipped" }, run: 1, ext: { hi: 40, hiAt: 1, lo: -40, loAt: 3 } },
  ],
  change: { session: "2026-09-05", prior: "2026-09-04", comparable: 1, consecutive: 1, moved: 1, held: 0, current: 1,
    entered: 0, left: 1, crossings: { cleared: 1, faded: 0, flipped: 0 }, status: "ok" },
  notes: {
    score: "The score is the board's own composite, unchanged.",
    gaps: "A gap means the name was not scored that session. It never means zero.",
  },
};
const CARD = {
  ticker: "AAA", sessionDate: "2026-09-05", generatedAt: "2026-09-06T02:00:00.000Z",
  panels: { context: { status: "ok", candleKeys: ["date", "open", "high", "low", "close", "volume"],
    candles: CLOSES.map(([d, c]) => [d, c, c, c, c, 1000]) } },
};

const browser = await chromium.launch();
const errors = [];
let trackBody = TRACK;

async function open(query = "", viewport = { width: 1440, height: 900 }) {
  const page = await browser.newPage({ viewport });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => { window.__winErrors = []; addEventListener("error", (e) => window.__winErrors.push(String(e.message))); });
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    const json = (b) => route.fulfill({ contentType: "application/json", body: JSON.stringify(b) });
    if (u.pathname === "/api/flows/scoretrack") return json(trackBody);
    if (u.pathname === "/api/flows/card") return json(u.searchParams.get("t") === "AAA" ? CARD : { ticker: u.searchParams.get("t"), status: "pending" });
    if (u.pathname.startsWith("/api/")) return json({ status: "pending" });
    if (u.pathname.startsWith("/assets/")) {
      const body = await readFile(new URL("." + u.pathname, ROOT)).catch(() => null);
      if (body === null) return route.fulfill({ status: 404, body: "" });
      const type = u.pathname.endsWith(".css") ? "text/css" : u.pathname.endsWith(".js") ? "text/javascript" : "application/octet-stream";
      return route.fulfill({ contentType: type + "; charset=utf-8", body });
    }
    return route.fulfill({ contentType: "text/html; charset=utf-8", body: trackPage({ username: "tester" }) });
  });
  await page.goto("https://x.test/flows/track/" + query);
  await page.waitForFunction(() => { const s = document.getElementById("stStatus"); return s && !/^Loading/.test(s.textContent); });
  await page.waitForTimeout(250);
  return page;
}

const popOf = (page, sel) => page.evaluate((sel) => {
  const t = document.querySelector(sel);
  if (!t) return null;
  t.click();
  const text = document.getElementById("fxPop").textContent;
  window.FlowsUI.closeInfo();
  return text;
}, sel);

{
  const page = await open();
  eq(await page.evaluate(() => document.querySelector(".st-row[aria-pressed='true']").dataset.t), "AAA",
     "the page opens on the strongest score in the latest session: AAA's +40 is today's, while " +
     "BBB's −40 is a reading from an older session and is not promoted over a measured one");
  eq(await page.evaluate(() => new URL(location.href).searchParams.get("t")), "AAA",
     "and the selection is written into the address, so the view can be linked");

  const bars = await page.evaluate(() => {
    const svg = document.querySelector("#stChart svg");
    return {
      bars: svg.querySelectorAll("rect.st-pos, rect.st-neg, rect.st-in").length,
      gaps: svg.querySelectorAll("circle.st-gap").length,
      zero: svg.querySelectorAll("rect.st-in").length,
    };
  });
  eq(bars.bars, 4,
     "the score chart draws one bar per scored session and no bar for the session AAA was not " +
     "scored: four measurements, four bars");
  eq(bars.gaps, 1, "and the unscored session is a gap dot on the rule, never a zero-height bar");
  eq(bars.zero, 1,
     "while a measured zero IS drawn, as a mark inside the dead band — an absence must not " +
     "borrow a pixel a measurement could own, and a measurement must not lose one");

  const strips = await page.evaluate(() => {
    const h = (t, i) => {
      const rects = [...document.querySelectorAll(`.st-row[data-t="${t}"] .st-strip rect`)];
      return rects.map((r) => +r.getAttribute("height"));
    };
    return { aaa: h("AAA"), bbb: h("BBB") };
  });
  ok(Math.abs(Math.max(...strips.aaa) - Math.max(...strips.bbb)) < 0.01,
     "every strip in the list is drawn on ONE scale for the whole page: AAA's +40 and BBB's " +
     "±40 are bars of the same height, so two names can be compared by eye (" +
     JSON.stringify(strips) + ")");

  const out = await page.evaluate(() => {
    const m = (id) => { const n = document.querySelector(`#stOutcomes [data-metric="${id}"]`); return n ? n.textContent : null; };
    return { hit: m("hit"), calls: document.querySelectorAll("#stOutcomes .st-calls rect.grow").length,
      open: !!document.querySelector("#stOutcomes .st-m-wh.is-open"),
      tone: document.querySelector('#stOutcomes [data-metric="hit"] .ui-metric-v').getAttribute("data-tone") };
  });
  ok(out.open && !out.tone,
     "two closed calls at a five-session horizon are under two independent windows, so the adjusted " +
     "interval is drawn unbounded across the whole meter and the hit rate stays uncoloured — not a " +
     "Wilson interval on a sample rounded up to one (" + JSON.stringify({ open: out.open, tone: out.tone }) + ")");
  ok(/50%/.test(out.hit) && /1 of 2 calls/.test(out.hit),
     "five sessions after each call, AAA was right once in two closed calls: the bullish call on " +
     "Sep 1 closed flat (100 → 100, not a hit), the bearish call on Sep 3 fell 101 → 97 (a hit) — " +
     "and the zero on Sep 4 is inside the band, so it is no call at all (" + out.hit + ")");
  ok(/1 open/.test(out.hit) && !/of 3 calls/.test(out.hit),
     "the call on Sep 5 has no close five sessions later yet, so it is counted open beside the hit rate, " +
     "not added to its denominator as a miss (" + out.hit + ")");

  const settled = (before) => page.waitForFunction((b) => {
    const n = document.querySelector('#stOutcomes [data-metric="hit"]');
    return n && n.textContent !== b;
  }, before, { timeout: 4000 }).catch(() => {});
  await page.click("#stOutcomes .ui-seg-i >> nth=0");
  await settled(out.hit);
  const one = await page.evaluate(() => document.querySelector('#stOutcomes [data-metric="hit"]').textContent);
  ok(await page.evaluate(() => !document.querySelector("#stOutcomes .st-m-wh.is-open") && !!document.querySelector("#stOutcomes .st-m-wh")),
     "while three one-session calls are three independent windows, and the adjusted interval is bounded");
  ok(/100%/.test(one) && /3 of 3 calls/.test(one),
     "one session after each call all three were right: +2.0% after the bullish Sep 1, −2.0% " +
     "after the bearish Sep 3, +2.0% after the bullish Sep 5 (" + one + ")");
  await page.click("#stOutcomes .ui-seg-i >> nth=2");
  await settled(one);
  const ten = await page.evaluate(() => document.querySelector('#stOutcomes [data-metric="hit"] .ui-state') !== null);
  ok(ten, "and at ten sessions no call has closed yet, so the hit rate is a pending glyph rather than 0%");

  const outInfo = await popOf(page, "#stOutcomes .ui-mod-h .ui-info");
  ok(/adjusted 95% interval/i.test(outInfo) && /divided by the horizon/.test(outInfo),
     "the outcomes disclosure states both intervals and why the adjusted one is wider");

  const basis = await popOf(page, "#stBasis");
  ok(/never zero/i.test(basis),
     "the page's own disclosure states that a gap is not a zero — the one sentence a reader must " +
     "not have to infer, one tap from the title");
  ok(/What a gap means/.test(basis) && /It never means zero/.test(basis),
     "and it carries the pipeline's own basis notes, under their labels");
  ok(/1 of the 1 names with two scored sessions moved|1 names with two scored sessions moved|1 of the 1/.test(basis),
     "and the session's change summary with its population");
  await page.close();
}

{
  const page = await open("?t=BBB");
  eq(await page.evaluate(() => document.querySelector(".st-row[aria-pressed='true']").dataset.t), "BBB",
     "a link that names a ticker opens on that name");
  await page.waitForTimeout(300);
  const sil = await page.evaluate(() => {
    const s = document.querySelector("#stOutcomes .ui-silent");
    return s ? s.getAttribute("data-state") : null;
  });
  eq(sil, "unavailable",
     "a name with no published card has no closes on hand, so its outcomes are drawn as the " +
     "unavailable state rather than as zero calls or an empty chart");
  const why = await popOf(page, "#stOutcomes .ui-silent [data-info]");
  ok(/BBB/.test(why) && /closes/.test(why),
     "and the reason names the name and what is missing (" + why + ")");
  await page.close();
}

{
  trackBody = { status: "pending" };
  const page = await open();
  eq(await page.evaluate(() => document.querySelector("#stTrack .ui-silent").getAttribute("data-state")), "pending",
     "an unpublished track is the pending state");
  ok(/not published this key yet/.test(await page.evaluate(() => document.getElementById("stStatus").textContent)),
     "and says it has not been published, not that the pool was empty");
  await page.close();
  trackBody = TRACK;
}

{
  const page = await open("", { width: 390, height: 844 });
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(over <= 1, "nothing widens the document at 390px (" + over + "px)");
  const order = await page.evaluate(() => [...document.querySelectorAll("#stTrack > .ui-mod")].map((m) => m.id));
  ok(order.indexOf("stName") < order.indexOf("stOutcomes") && order.indexOf("stOutcomes") < order.indexOf("stNames"),
     "on a phone the selected name and its outcomes come before the list of every name (" + order.join(", ") + ")");
  await page.close();
}

{
  const page = await open();
  const got = await page.evaluate(async () => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    const orig = EventTarget.prototype.addEventListener;
    const recs = [];
    EventTarget.prototype.addEventListener = function (type, fn, opts) {
      if (this.dataset && this.dataset.leak) recs.push({ host: this.dataset.leak, type, signal: (opts && opts.signal) || null });
      return orig.call(this, type, fn, opts);
    };
    const live = (host, types) => types.map((t) => recs.filter((r) => r.host === host && r.type === t && !(r.signal && r.signal.aborted)).length);
    const HEAT = ["pointermove", "pointerleave", "blur", "keydown"];
    const SCRUB = ["pointermove", "pointerdown", "pointerleave", "pointercancel", "blur", "keydown"];
    const mk = (name) => { const d = document.createElement("div"); d.dataset.leak = name; d.style.width = "640px"; document.body.append(d); return d; };
    const C = window.FlowsUI.chart;
    const grid = { rows: ["AAA", "BBB"], cols: ["Jan", "Feb", "Mar"], grid: [[0.01, -0.02, 0], [0.005, null, -0.01]], label: "Grid" };
    const heat = C.heatmap(mk("heat"), grid);
    for (let i = 0; i < 5; i++) heat.redraw(false);
    const heatAfter = live("heat", HEAT);
    heat.destroy();
    const heatGone = live("heat", HEAT);
    const lineOpts = { x: ["2026-09-01", "2026-09-02", "2026-09-03"], series: [{ values: [1, 2, 3] }], label: "Line" };
    const line = C.line(mk("line"), lineOpts);
    for (let i = 0; i < 5; i++) line.redraw(false);
    const lineAfter = live("line", SCRUB);
    line.destroy();
    const lineGone = live("line", SCRUB);
    const swap = mk("swap");
    C.line(swap, lineOpts);
    await frame();
    const swapBefore = live("swap", ["pointerdown"])[0];
    C.heatmap(swap, grid);
    await frame();
    const swapped = [swapBefore, live("swap", ["pointerdown"])[0], live("swap", ["pointermove"])[0]];
    EventTarget.prototype.addEventListener = orig;
    return { heatAfter, heatGone, lineAfter, lineGone, swapped };
  });
  eq(got.heatAfter.join(","), "1,1,1,1",
     "LISTENERS: five repaints of a heatmap leave one live pointermove, pointerleave, blur and keydown listener on its " +
     "host, not six of each — every repaint (a resize, a set, a redraw) used to add four more closures over a detached grid");
  eq(got.heatGone.join(","), "0,0,0,0", "and destroy() releases them");
  eq(got.lineAfter.join(","), "1,1,1,1,1,1", "a scrubbed line keeps one of each of its six listeners across repaints");
  eq(got.lineGone.join(","), "0,0,0,0,0,0", "and destroy() now releases the scrub's too, which it never did");
  const knob = await page.evaluate(() => {
    const box = document.createElement("div");
    box.style.width = "600px";
    document.body.append(box);
    const seg = window.FlowsUI.segmented("Mode", [{ label: "Average" }, { label: "Up months" }, { label: "Range" }], null, 2);
    box.append(seg);
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
      const k = seg.querySelector(".ui-seg-knob");
      const wide = [k.getBoundingClientRect().right, seg.getBoundingClientRect().right];
      box.style.width = "180px";
      seg.style.width = "100%";
      seg.style.gridAutoColumns = "minmax(0, 1fr)";
      const narrow = [k.getBoundingClientRect().right, seg.getBoundingClientRect().right];
      box.remove();
      resolve({ wide, narrow });
    })));
  });
  ok(Math.abs(knob.wide[0] - knob.wide[1]) <= 3,
     `the segmented knob sits on its selected (last) segment (${knob.wide.map(Math.round).join(" vs ")})`);
  ok(knob.narrow[0] <= knob.narrow[1] + 1,
     "and when its control narrows it stays inside it in the SAME frame, before any ResizeObserver runs " +
     `(${knob.narrow.map(Math.round).join(" vs ")}): a knob measured in pixels kept its desktop width and offset ` +
     "until the observer fired, and on a loaded machine that was long enough to push the page 148px past a 320px screen");
  const before = errors.length;
  const vt = await page.evaluate(async () => {
    const real = document.startViewTransition;
    const seen = [];
    let handled = false;
    document.startViewTransition = (update) => {
      const failed = Promise.reject(new DOMException("Transition was aborted because of timeout in DOM update", "TimeoutError"));
      const ready = {
        then: (ok, no) => { if (typeof no === "function") handled = true; return failed.then(ok, no); },
        catch: (no) => { handled = true; return failed.catch(no); },
        finally: (f) => failed.finally(f),
      };
      update();
      return { ready, updateCallbackDone: Promise.resolve(), finished: Promise.resolve(), skipTransition() {} };
    };
    const seg = window.FlowsUI.segmented("Mode", [{ label: "One" }, { label: "Two" }], (i) => seen.push(i), 0);
    document.body.append(seg);
    seg.querySelectorAll(".ui-seg-i")[1].click();
    await new Promise((r) => setTimeout(r, 100));
    seg.remove();
    document.startViewTransition = real;
    return { seen, handled };
  });
  ok(vt.seen.join(",") === "1",
     "a pick made while a view transition times out still reaches its handler: the DOM update runs, only the animation is lost");
  ok(vt.handled,
     "and the segmented control handles the transition's ready promise, which is the one a skipped or timed-out " +
     "transition rejects (\"Transition was aborted because of timeout in DOM update\"). Left unhandled, the CI runner's " +
     "Chromium reports it as an uncaught page error, and that failed the market suite on a busy runner");
  eq(errors.length - before, 0, "so no page error follows from it: " + errors.slice(before).join(" | "));
  eq(got.swapped.join(","), "1,0,1",
     "a host that changes chart kind drops the old kind's listeners: a heatmap mounted where a line was drawn keeps no " +
     "scrub pointerdown, and one pointermove of its own");
  await page.close();
}

{
  const page = await open();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable", { timeDomain: "timeTicks" });
  const count = async (name) => (await cdp.send("Performance.getMetrics")).metrics.find((m) => m.name === name).value;
  const layout0 = await count("LayoutCount");
  const mounted = await page.evaluate(() => new Promise((done) => {
    const C = window.FlowsUI.chart;
    const hosts = [];
    for (let i = 0; i < 12; i++) {
      const box = document.createElement("div");
      box.style.width = 400 + i * 20 + "px";
      document.body.append(box);
      const d = document.createElement("div");
      box.append(d);
      hosts.push(d);
      C.line(d, { x: ["2026-09-01", "2026-09-02", "2026-09-03"], series: [{ values: [1, 2 + i, 3] }], label: "L" + i });
    }
    window.__hosts = hosts;
    const drawn = () => hosts.filter((d) => d.querySelector("svg")).length;
    const sync = drawn();
    requestAnimationFrame(() => {
      const atRaf = drawn();
      setTimeout(() => done({
        sync, atRaf, afterFrame: drawn(),
        widths: hosts.map((d) => [Math.round(d.clientWidth), Number(d.querySelector("svg").getAttribute("width"))]),
        probes: hosts.map((d) => { const p = d.querySelector(".ui-chart-w"); const r = p ? p.getBoundingClientRect() : null; return r ? [Math.round(r.width), r.height] : null; }),
        loops: window.__winErrors.filter((m) => /ResizeObserver/.test(m)).length,
      }), 0);
    });
  }));
  const layout1 = await count("LayoutCount");
  eq(mounted.sync, 0,
     "MOUNT: twelve charts mounted in one task draw nothing synchronously, so the task that builds a page reads no " +
     "layout for them — each mount used to read host.clientWidth on a tree its own previous writes had dirtied, " +
     "which is one forced synchronous layout per chart");
  ok(layout1 - layout0 < 6,
     `and the twelve mounts plus the frame that draws them cost the page fewer than six layouts (${layout1 - layout0}); ` +
     "the old mount cost one per chart, twelve here, before that frame");
  eq(mounted.atRaf + "/" + mounted.afterFrame, "0/12",
     "the first draw runs inside the frame that follows the mount, after layout and before paint: absent at that " +
     "frame's animation callbacks, present in the task after it, so the first paint carries the charts and a later " +
     "frame does not shift the page down by their height");
  ok(mounted.widths.every(([host, svg]) => host === svg),
     `each chart is drawn at its host's own width without reading it (${mounted.widths.map((w) => w.join("=")).join(" ")})`);
  ok(mounted.probes.every((p) => p && p[0] > 0 && p[1] === 0),
     "the width the observer reports comes from a zero-height probe inside the host, so drawing the chart changes " +
     `no observed box (${mounted.probes.map((p) => p && p.join("x")).join(" ")})`);
  eq(mounted.loops, 0,
     "and the window saw no \"ResizeObserver loop completed with undelivered notifications\" error, which drawing into " +
     "the observed host itself raises on every page load, in every DevTools console, unseen by Playwright's pageerror");
  const resized = await page.evaluate(() => new Promise((done) => {
    const d = window.__hosts[0];
    const before = Number(d.querySelector("svg").getAttribute("width"));
    d.parentNode.style.width = "300px";
    requestAnimationFrame(() => {
      const atRaf = Number(d.querySelector("svg").getAttribute("width"));
      setTimeout(() => done({ before, atRaf, after: Number(d.querySelector("svg").getAttribute("width")), loops: window.__winErrors.filter((m) => /ResizeObserver/.test(m)).length }), 0);
    });
  }));
  eq([resized.before, resized.atRaf, resized.after].join(" "), "400 400 300",
     "a resize redraws in the same frame the observer reports it, not one animation frame later");
  eq(resized.loops, 0, "and a resize redraw raises no observer loop error either");
  const edge = await page.evaluate(() => new Promise((done) => {
    const C = window.FlowsUI.chart;
    const opts = { x: ["2026-09-01", "2026-09-02", "2026-09-03"], series: [{ values: [1, 2, 3] }], label: "E" };
    const box = document.createElement("div");
    box.style.width = "500px";
    document.body.append(box);
    const mk = () => { const d = document.createElement("div"); box.append(d); return d; };
    const gone = mk();
    C.line(gone, opts).destroy();
    const detached = document.createElement("div");
    const late = C.line(detached, opts);
    const twice = mk();
    C.line(twice, opts);
    const second = C.heatmap(twice, { rows: ["A"], cols: ["x", "y"], grid: [[1, -1]], label: "H" });
    const hidden = mk();
    const hid = C.line(hidden, opts);
    const explicit = document.createElement("div");
    const strip = window.FlowsUI.scoreStrip(explicit, { values: [1, -1, 2], width: 300, height: 20 });
    requestAnimationFrame(() => setTimeout(() => {
      const r1 = { gone: gone.childElementCount, goneRec: gone._fxChart, twice: [twice.querySelectorAll("svg").length, twice.querySelectorAll(".ui-chart-w").length, twice._fxChart === second.el._fxChart && !!twice.querySelector(".cell-hl")],
        hiddenDrawn: !!hidden.querySelector("svg"), strip: strip && strip.getAttribute("width"), stripSync: explicit.firstChild === strip };
      hidden.style.display = "none";
      requestAnimationFrame(() => setTimeout(() => {
        hid.set((el, w) => { el.append(Object.assign(document.createElement("b"), { textContent: "W" + w })); });
        const setHidden = !!hidden.querySelector("b");
        hidden.style.display = "";
        requestAnimationFrame(() => setTimeout(() => {
          const shown = hidden.querySelector("b");
          box.append(detached);
          late.redraw(false);
          done({ ...r1, setHidden, shown: shown ? shown.textContent : null, late: !!detached.querySelector("svg"), loops: window.__winErrors.filter((m) => /ResizeObserver/.test(m)).length });
        }, 0));
      }, 0));
    }, 0));
  }));
  eq(edge.gone + "/" + String(edge.goneRec), "0/null", "a chart destroyed in the task that mounted it leaves its host empty and unclaimed when the observer fires");
  eq(edge.twice.join(","), "1,1,true", "a host mounted twice in one task draws the second chart once, with one probe, and the second record owns the host");
  ok(edge.hiddenDrawn, "a visible host draws");
  ok(!edge.setHidden && edge.shown === "W500",
     "a set() on a host hidden at the time draws nothing then, and draws the new content at the host's width when it is shown again " +
     `(${edge.shown}); the old code kept the stale drawing because the shown width matched the one it had drawn at`);
  ok(edge.late, "a host detached when the observer first fires is not observed, and its redraw() after attachment still draws it");
  eq(edge.strip + "/" + edge.stripSync, "300/true", "a score strip with an explicit width draws synchronously at that width without a host to measure");
  eq(edge.loops, 0, "none of which raised an observer loop error");
  eq(errors.length, 0, "and none threw: " + errors.join(" | "));
  await page.close();
}

{
  const page = await open();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable", { timeDomain: "timeTicks" });
  const count = async (name) => (await cdp.send("Performance.getMetrics")).metrics.find((m) => m.name === name).value;
  const style0 = await count("RecalcStyleCount");
  const vars = await page.evaluate(() => {
    const names = new Set();
    const walk = (rules) => { for (const r of rules) { if (r.cssRules) walk(r.cssRules); if (r.selectorText === ":root") for (const p of r.style) if (p.startsWith("--")) names.add(p); } };
    for (const sh of document.styleSheets) { try { walk(sh.cssRules); } catch {} }
    const list = [...names].filter((n) => /^--(s-|up|down|label|fill|sep|accent|lvl|g-|sect)/.test(n)).slice(0, 40);
    const out = [];
    for (const n of list) {
      document.body.append(document.createElement("i"));
      out.push([n, window.FlowsUI.cssVar(n)]);
    }
    return { total: names.size, read: out.length, empty: out.filter(([, v]) => !v).length, fallback: out.filter(([, v]) => v === "#888").length, unknown: window.FlowsUI.cssVar("--no-such-token-here") };
  });
  const style1 = await count("RecalcStyleCount");
  ok(vars.total >= 150 && vars.read >= 30, `the page declares ${vars.total} custom properties on :root and the probe read ${vars.read} of them`);
  eq(vars.empty + vars.fallback, 0, "every one resolved to its declared value");
  ok(style1 - style0 <= 3,
     `TOKENS: reading ${vars.read} tokens for the first time, each on a tree dirtied since the last, costs at most three style ` +
     `recalculations (${style1 - style0}): the first cssVar call reads every :root token from one computed style, so the ` +
     "old cost of one recalc per token per page is gone");
  eq(vars.unknown, "#888", "a token no stylesheet declares still falls back to #888");
  await page.close();
}

eq(errors.length, 0, "and the page threw nothing: " + errors.join(" | "));
await browser.close();

console.log(`✓ flows-track-render: ${checks} assertions — a score track that draws a bar per ` +
  `measurement and a gap per absence, a measured zero kept, one scale shared by every strip, a ` +
  `page that opens on today's strongest reading and on any linked name, calls scored against ` +
  `the closes that followed them at 1, 5 and 10 sessions with open calls left open, a name ` +
  `without closes drawn unavailable rather than empty, and the gap-is-not-zero sentence one tap ` +
  `from the title; chart hosts that hold one set of listeners across repaints, remounts and destroy, ` +
  `that draw at the width the observer reports, after layout and before paint, with no forced layout ` +
  `at mount and no observer loop error, and root tokens read from one computed style`);
