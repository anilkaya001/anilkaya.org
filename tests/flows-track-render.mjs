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

async function open(query = "", viewport = { width: 1440, height: 900 }, init = null) {
  const page = await browser.newPage({ viewport });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => { window.__winErrors = []; addEventListener("error", (e) => window.__winErrors.push(String(e.message))); });
  if (init) await page.addInitScript(init);
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
  ok(edge.late, "a host never connected when the observer first fires draws through redraw() once it is attached");
  eq(edge.strip + "/" + edge.stripSync, "300/true", "a score strip with an explicit width draws synchronously at that width without a host to measure");
  eq(edge.loops, 0, "none of which raised an observer loop error");
  eq(errors.length, 0, "and none threw: " + errors.join(" | "));
  const back = await page.evaluate(async () => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    const C = window.FlowsUI.chart;
    const opts = { x: ["2026-09-01", "2026-09-02", "2026-09-03"], series: [{ values: [1, 2, 3] }], label: "B" };
    const box = document.createElement("div");
    box.style.width = "480px";
    document.body.append(box);
    const sec = document.createElement("section");
    box.append(sec);
    const host = document.createElement("div");
    sec.append(host);
    C.line(host, opts);
    sec.remove();
    await frame();
    const width = (el) => { const svg = el.querySelector("svg"); return svg && svg.getAttribute("width"); };
    const whileOut = host.querySelectorAll("svg").length;
    box.append(sec);
    await frame();
    const svg = host.querySelector("svg");
    const drawn = svg ? [svg.getAttribute("width"), !svg.classList.contains("no-anim")] : null;
    box.style.width = "360px";
    await frame();
    const tracked = width(host);
    const shed = document.createElement("div");
    box.append(shed);
    C.line(shed, opts);
    await frame();
    shed.remove();
    await frame();
    box.append(shed);
    box.style.width = "300px";
    await frame();
    const kept = document.createElement("div");
    box.append(kept);
    const kh = C.line(kept, opts);
    kept.remove();
    kh.set((el, w) => { el.append(Object.assign(document.createElement("b"), { textContent: "K" + w })); });
    await frame();
    box.append(kept);
    await frame();
    return { whileOut, drawn, tracked, shed: width(shed), kept: kept.querySelector("b") && kept.querySelector("b").textContent, loops: window.__winErrors.filter((m) => /ResizeObserver/.test(m)).length };
  });
  eq(back.whileOut, 0, "a host connected at mount and detached in the same task draws nothing while it is out of the document");
  eq(back.drawn && back.drawn.join(","), "480,true",
     "and draws at its width in the frame after it returns, animated as a first draw is, since the delivery that found " +
     "it detached saw nothing of it: a record that has never drawn stays observed through a detach, where the first " +
     "delivery used to release it and the chart never appeared");
  eq(back.tracked, "360", "and the returned host still follows a resize");
  eq(back.shed, "360",
     "a host that had drawn when it was detached is released on that delivery, as before: back in the document it keeps " +
     "its drawing and no longer follows a resize, so a subtree replaced without destroy() holds no observation");
  eq(back.kept, "K300",
     "a set() on a host that is out of the document before its first frame keeps the record too, and the new content " +
     "draws when the host returns");
  eq(back.loops, 0, "and none of them raised an observer loop error");
  eq(errors.length, 0, "or threw: " + errors.join(" | "));
  await page.close();
}

{
  const page = await open();
  const before = errors.length;
  const got = await page.evaluate(async () => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    const C = window.FlowsUI.chart;
    const opts = { x: ["2026-09-01", "2026-09-02", "2026-09-03"], series: [{ values: [1, 2, 3] }], label: "T" };
    const box = document.createElement("div");
    box.style.width = "500px";
    document.body.append(box);
    const mk = () => { const d = document.createElement("div"); box.append(d); return d; };
    const a = mk(), bad = mk(), b = mk(), c = mk();
    C.line(a, opts);
    let sync = false;
    try { C.mount(bad, () => { throw new Error("bad payload"); }); } catch { sync = true; }
    C.line(b, opts);
    C.line(c, opts);
    await frame();
    await frame();
    return { sync, drawn: [a, b, c].map((d) => d.querySelectorAll("svg").length).join(","), bad: bad.childElementCount, seen: window.__winErrors.filter((m) => /bad payload/.test(m)).length };
  });
  const thrown = errors.splice(before);
  eq(got.sync + "/" + got.drawn, "false/1,1,1",
     "THROW: a chart whose draw throws inside the observer's delivery starves none of the charts delivered after it: " +
     "the three lines mounted around it in the same task all draw (was: the exception left the callback, the charts " +
     "queued behind the bad one drew nothing, and the observer had already recorded their sizes so never redelivered them)");
  eq(got.bad, 1, "the bad chart's host keeps only its probe");
  eq(thrown.join(" | ") + "/" + got.seen, "bad payload/1",
     "and the error is still reported, once, as an uncaught page error on the window, not swallowed");
  await page.close();
}

{
  const page = await open("", { width: 1440, height: 900 }, () => { window.ResizeObserver = undefined; });
  const got = await page.evaluate(async () => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    const C = window.FlowsUI.chart;
    const opts = { x: ["2026-09-01", "2026-09-02", "2026-09-03"], series: [{ values: [1, 2, 3] }], label: "N" };
    const box = document.createElement("div");
    box.style.width = "600px";
    document.body.append(box);
    const host = document.createElement("div");
    box.append(host);
    const hd = C.line(host, opts);
    const svg = host.querySelector("svg");
    const sync = svg ? svg.getAttribute("width") : null;
    box.style.width = "400px";
    await frame();
    hd.redraw(false);
    const redrawn = host.querySelector("svg").getAttribute("width");
    box.style.width = "320px";
    hd.set((el, w) => { el.append(Object.assign(document.createElement("b"), { textContent: "W" + w })); }, false);
    return { ro: typeof window.ResizeObserver, sync, redrawn, set: host.querySelector("b") && host.querySelector("b").textContent, probes: document.querySelectorAll(".ui-chart-w").length, page: document.querySelectorAll(".st-row").length };
  });
  eq(got.ro + "/" + got.page, "undefined/2", "NO OBSERVER: the page still renders its rows without ResizeObserver");
  eq(got.sync, "600", "a chart mounted where there is no observer draws synchronously at its host's width, as before");
  eq(got.redrawn + "/" + got.set, "400/W320",
     "and redraw() and set() after the container changes read the host's width again each time, as before (was: the " +
     "first width was cached for the chart's lifetime and every later redraw kept it)");
  eq(got.probes, 0, "and no probe is mounted, since nothing would observe it");
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

{
  const page = await open();
  await page.evaluate(async () => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    const C = window.FlowsUI.chart;
    const days = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10"];
    const vals = [3, 5, 4, 6, 2, 7, 1, 9];
    window.__opts = (n, extra) => Object.assign({ x: days.slice(0, n), series: [{ values: vals.slice(0, n) }], yFormat: (v) => "v" + v, label: "Live line",
      readout: (i, d) => [C.part(d, "k"), C.part("v" + vals[i], "k")] }, extra || null);
    const host = document.createElement("div");
    host.style.cssText = "width:640px;margin:40px 0 0 40px";
    document.body.prepend(host);
    window.__host = host;
    window.__starts = 0;
    host.addEventListener("animationstart", () => { window.__starts++; });
    host.addEventListener("transitionrun", () => { window.__starts++; });
    window.__chart = C.line(host, window.__opts(5));
    await frame();
    await frame();
  });
  const first = await page.evaluate(() => {
    const svg = window.__host.querySelector(":scope > svg");
    const out = { noAnim: svg.classList.contains("no-anim"), anims: window.__host.getAnimations({ subtree: true }).length };
    for (const a of document.getAnimations()) { const t = a.effect && a.effect.getComputedTiming(); if (t && Number.isFinite(t.endTime)) a.finish(); }
    window.__svg = svg;
    const b = svg.getBoundingClientRect();
    const w = svg.viewBox.baseVal.width, x2 = 2 + (w - 62 - 2) * 2 / 4;
    return { ...out, x: b.left + x2 * (b.width / w), y: b.top + b.height / 2 };
  });
  ok(!first.noAnim && first.anims > 0, `IN PLACE: a live line's first paint still animates (${first.anims} animations, no no-anim flag)`);
  await page.mouse.move(first.x, first.y);
  await page.waitForFunction(() => window.__host.querySelector(".ui-readout.is-on"));
  const hovered = await page.evaluate(() => ({ at: window.__host._scrubAt, text: window.__host.querySelector(".ui-readout").textContent }));
  ok(hovered.text.includes("2026-09-03") && hovered.text.includes("v4"), `the reader's pointer rests on the third reading and its readout shows it (${hovered.text})`);
  await page.evaluate(() => window.__host.focus());
  const updates = [];
  for (const n of [6, 7, 8]) {
    updates.push(await page.evaluate(async (n) => {
      const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      const host = window.__host;
      window.__starts = 0;
      let threw = null;
      try { window.__chart.set(window.__opts(n)); } catch (e) { threw = String(e && e.message || e); }
      const sync = host.getAnimations({ subtree: true }).length;
      await frame();
      await frame();
      const svg = host.querySelector(":scope > svg") || document.createElementNS("http://www.w3.org/2000/svg", "svg");
      const xh = svg.querySelector("line.xh");
      const ro = host.querySelector(".ui-readout");
      const tags = [...svg.querySelectorAll("text.tx-1.tx-b")].map((t) => t.textContent);
      const ring = [...svg.querySelectorAll(":scope > circle.ring")].pop();
      return {
        same: svg === window.__svg, svgs: host.querySelectorAll("svg").length, noAnim: svg.classList.contains("no-anim"),
        sync, anims: host.getAnimations({ subtree: true }).length, mine: host.getAnimations({ subtree: true }).map((a) => (a.animationName || a.transitionProperty) + "@" + (a.effect.target.getAttribute("class") || a.effect.target.tagName)).join(","), other: document.getAnimations().filter((a) => !host.contains(a.effect && a.effect.target)).map((a) => a.animationName || a.transitionProperty).slice(0, 4).join(","), starts: window.__starts, at: host._scrubAt,
        readout: ro && ro.classList.contains("is-on") ? ro.textContent : null, line: xh ? +xh.getAttribute("opacity") : null,
        xhX: xh ? +xh.getAttribute("x1") : null, endTag: tags.join(" "), endX: ring ? +ring.getAttribute("cx") : null,
        w: svg.viewBox.baseVal.width || 0, focused: document.activeElement === host, threw,
      };
    }, n));
  }
  updates.forEach((u, k) => {
    const n = 6 + k;
    eq(u.threw, null, `IN PLACE: update ${k + 2} is one set(options) call on the handle the first paint returned (${u.threw})`);
    ok(u.same, `IN PLACE: update ${k + 2} keeps the same svg node instead of tearing the chart down and building another`);
    eq(u.svgs, 1, `update ${k + 2}: one svg in the host`);
    ok(u.noAnim, `update ${k + 2}: set() draws with no-anim, so no line redraws and no label fades in again`);
    eq(u.sync + u.anims, 0, `update ${k + 2}: no animation runs in the chart after the update (its getAnimations is empty: ${u.mine}; elsewhere: ${u.other || "none"})`);
    eq(u.starts, 0, `update ${k + 2}: and no animationstart or transitionrun fired in the chart`);
    eq(u.endTag, "v" + [3, 5, 4, 6, 2, 7, 1, 9][n - 1], `update ${k + 2}: the newest point is drawn and labelled (${u.endTag})`);
    ok(Math.abs(u.endX - (u.w - 62)) < 0.5, `update ${k + 2}: at the right edge of the plot (${u.endX})`);
    ok(u.readout && u.readout.includes("2026-09-03") && u.readout.includes("v4"), `update ${k + 2}: the hover readout survives, still on the reading the reader was on (${u.readout})`);
    eq(u.at, 2, `update ${k + 2}: the crosshair keeps the reader's index`);
    ok(u.line > 0 && Math.abs(u.xhX - (2 + (u.w - 62 - 2) * 2 / (n - 1))) < 0.5, `update ${k + 2}: the crosshair is drawn at that reading's new x (${u.xhX})`);
    ok(u.focused, `update ${k + 2}: keyboard focus stays on the chart`);
  });
  const later = await page.evaluate(async () => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    const host = window.__host;
    host.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    const end = host._scrubAt;
    host.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    window.__chart.set(window.__opts(8));
    await frame();
    const hidden = { at: host._scrubAt, on: !!host.querySelector(".ui-readout.is-on") };
    window.__chart.set(window.__opts(8), true);
    await frame();
    const asked = host.querySelector(":scope > svg").classList.contains("no-anim");
    window.__chart.destroy();
    const again = window.FlowsUI.chart.line(host, window.__opts(8));
    await frame();
    await frame();
    const remount = host.querySelector(":scope > svg").classList.contains("no-anim");
    again.destroy();
    const live = document.createElement("div");
    live.style.width = "640px";
    document.body.append(live);
    const lc = window.FlowsUI.chart.line(live, window.__opts(5, { live: true }));
    await frame();
    await frame();
    for (const a of document.getAnimations()) { const t = a.effect && a.effect.getComputedTiming(); if (t && Number.isFinite(t.endTime)) a.finish(); }
    const phase = () => {
      const a = live.getAnimations({ subtree: true }).find((x) => x.animationName === "ui-pulse");
      if (!a) return null;
      const t = a.effect.getComputedTiming();
      return (((t.localTime - t.delay) - document.timeline.currentTime) % 2400 + 2400) % 2400;
    };
    const p0 = phase();
    await new Promise((r) => setTimeout(r, 1000));
    lc.set(window.__opts(6, { live: true }));
    await frame();
    await frame();
    const p = p0 === null ? null : { p0, p1: phase() };
    const others = live.getAnimations({ subtree: true }).filter((x) => x.animationName !== "ui-pulse").length;
    const pulses = live.querySelectorAll("circle.pulse").length;
    lc.destroy();
    live.remove();
    return { end, hidden, asked, remount, p, others, pulses };
  });
  eq(later.end, 7, "the End key still moves the crosshair to the newest reading");
  ok(later.hidden.at === -1 && !later.hidden.on, "a readout the reader dismissed with Escape is not brought back by an update");
  ok(!later.asked, "set(next, true) still animates when a caller asks for it");
  ok(later.remount, "and a host that has been drawn once does not replay its entrance when a chart is mounted on it again");
  eq(later.pulses, 1, "a live line keeps one pulse on its newest point");
  eq(later.others, 0, "and nothing but that pulse is animating after an update");
  const drift = later.p && later.p.p1 !== null ? Math.min(Math.abs(later.p.p1 - later.p.p0), 2400 - Math.abs(later.p.p1 - later.p.p0)) : Infinity;
  ok(drift < 150, `the pulse continues on the document clock's phase instead of restarting at zero on every update (${Math.round(drift)} ms off)`);
  await page.close();
}

{
  const page = await open();
  const zero = await page.evaluate(async () => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    const C = window.FlowsUI.chart, cssVar = window.FlowsUI.cssVar;
    const mk = () => { const d = document.createElement("div"); d.style.cssText = "width:640px;margin:40px 0 0 40px"; document.body.prepend(d); return d; };
    const tokens = { up: cssVar("--up-mark"), down: cssVar("--down-mark"), long: cssVar("--g-long"), short: cssVar("--g-short"), neutral: cssVar("--label-3"), fill4: cssVar("--fill-4"), absent: cssVar("--label-4") };
    const values = [2, 0, -1, null, 0.5];
    const read = (host) => {
      const svg = host.querySelector(":scope > svg");
      const base = svg.querySelector("line.base");
      const mid = +base.getAttribute("y1");
      const bars = [...svg.querySelectorAll("rect.grow")].map((r) => ({ fill: r.getAttribute("fill"), y: +r.getAttribute("y"), h: +r.getAttribute("height") }));
      const z = svg.querySelector("rect.zero");
      const dot = svg.querySelector("circle:not(.ring)");
      return { mid, bars, zero: z ? { fill: z.getAttribute("fill"), y: +z.getAttribute("y"), h: +z.getAttribute("height"), x: +z.getAttribute("x"), w: +z.getAttribute("width") } : null, absent: dot ? dot.getAttribute("fill") : null, rects: svg.querySelectorAll("rect").length };
    };
    const dir = mk();
    window.__div = C.diverging(dir, { values, label: "Diverging" });
    const gam = mk();
    C.diverging(gam, { values, palette: "gamma", label: "Gamma" });
    const heat = mk();
    C.heatmap(heat, { rows: ["A"], cols: ["x", "y", "z"], grid: [[1, 0, null]], label: "Heat" });
    await frame();
    await frame();
    for (const a of document.getAnimations()) { const t = a.effect && a.effect.getComputedTiming(); if (t && Number.isFinite(t.endTime)) a.finish(); }
    dir.scrollIntoView({ block: "center", behavior: "instant" });
    const svg = dir.querySelector(":scope > svg");
    const b = svg.getBoundingClientRect();
    const vw = svg.viewBox.baseVal.width, vh = svg.viewBox.baseVal.height;
    const d = read(dir);
    const cells = [...heat.querySelector(":scope > svg").querySelectorAll("rect")].slice(0, 3).map((r) => ({ cls: r.getAttribute("class"), fill: r.getAttribute("fill"), stroke: r.getAttribute("stroke"), dash: r.getAttribute("stroke-dasharray"), op: r.getAttribute("fill-opacity") }));
    heat.focus();
    heat.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    const hr = heat.querySelector(".ui-readout");
    const heatReadout = { on: hr.classList.contains("is-on"), text: hr.textContent, value: hr.lastElementChild && hr.lastElementChild.textContent, toned: hr.querySelectorAll("[data-tone]").length };
    heat.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    const nullReadout = { on: hr.classList.contains("is-on"), text: hr.textContent, value: hr.lastElementChild && hr.lastElementChild.textContent };
    const voidRect = heat.querySelector(":scope > svg rect.void");
    const legend = window.FlowsUI.legend([window.FlowsUI.key("--label-4", "void", "Not quoted")]);
    document.body.append(legend);
    const ki = getComputedStyle(legend.querySelector(".ui-key > i"));
    const vs = getComputedStyle(voidRect);
    const notQuoted = { bg: ki.backgroundColor, image: ki.backgroundImage, style: ki.borderTopStyle, width: ki.borderTopWidth, color: ki.borderTopColor, voidStroke: vs.stroke, voidFill: vs.fill };
    window.__dir = dir;
    return { tokens, dir: d, gam: read(gam), cells, heatReadout, nullReadout, notQuoted, at: { x: b.left + (d.zero ? d.zero.x + d.zero.w / 2 : 0) * (b.width / vw), y: b.top + d.mid * (b.height / vh) }, plus: { x: b.left + (8 + ((vw - 16) / 5) * 0.5) * (b.width / vw) } };
  });
  const T = zero.tokens;
  ok(T.up && T.down && T.long && T.short && T.neutral && T.fill4 && T.up !== T.neutral && T.down !== T.neutral && T.fill4 !== T.neutral, "the palette and neutral tokens resolve to distinct colours");
  for (const [name, d] of [["direction", zero.dir], ["gamma", zero.gam]]) {
    const pos = name === "direction" ? T.up : T.long, neg = name === "direction" ? T.down : T.short;
    eq(d.bars.length, 3, `ZERO (${name}): three signed readings draw three bars`);
    eq(d.bars[0].fill, pos, `ZERO (${name}): the positive reading keeps the positive fill`);
    eq(d.bars[1].fill, neg, `ZERO (${name}): the negative reading keeps the negative fill`);
    ok(d.bars[0].y < d.mid && d.bars[1].y >= d.mid, `ZERO (${name}): and they sit on their own sides of the axis`);
    ok(d.zero, `ZERO (${name}): an exact zero is drawn as its own element, not as a bar`);
    ok(d.zero.fill !== pos && d.zero.fill !== neg, `ZERO (${name}): the zero has neither the positive nor the negative fill (${d.zero.fill})`);
    eq(d.zero.fill, T.neutral, `ZERO (${name}): it is the neutral --label-3`);
    eq(d.zero.h, 1, `ZERO (${name}): one pixel tall`);
    ok(Math.abs(d.zero.y + 0.5 - d.mid) < 1e-9, `ZERO (${name}): centred on the axis (y ${d.zero.y}, axis ${d.mid})`);
    eq(d.absent, T.absent, `ZERO (${name}): and the null reading is still the absent dot, which the zero is not`);
  }
  await page.mouse.move(zero.at.x, zero.at.y);
  await page.waitForFunction(() => window.__dir.querySelector(".ui-readout.is-on"));
  const hover = await page.evaluate(() => {
    const host = window.__dir;
    const ring = host.querySelector(":scope > svg circle.ring");
    const ro = host.querySelector(".ui-readout");
    const base = host.querySelector("line.base");
    return { at: host._scrubAt, text: ro.textContent, value: ro.querySelector("b") && ro.querySelector("b").textContent, toned: ro.querySelectorAll("[data-tone]").length, dot: ring ? { fill: ring.getAttribute("fill"), cy: +ring.getAttribute("cy") } : null, mid: +base.getAttribute("y1") };
  });
  eq(hover.at, 1, `the pointer rests on the zero reading (${hover.text})`);
  eq(hover.value, "0", `its readout prints the zero, unsigned (${hover.text})`);
  eq(hover.toned, 0, "with no direction tone on it");
  ok(hover.dot && hover.dot.fill === T.neutral, `and the scrub dot follows: neutral, not up or down (${hover.dot && hover.dot.fill})`);
  ok(hover.dot && Math.abs(hover.dot.cy - hover.mid) < 1e-9, `on the axis (cy ${hover.dot && hover.dot.cy}, axis ${hover.mid})`);
  await page.mouse.move(zero.plus.x, zero.at.y);
  await page.waitForFunction(() => window.__dir._scrubAt === 0);
  const plus = await page.evaluate(() => { const r = window.__dir.querySelector(":scope > svg circle.ring"); return r && r.getAttribute("fill"); });
  eq(plus, T.up, "while the dot on the positive reading beside it is the positive colour, so the neutral is not a lost token");
  const [pos, zc, nc] = zero.cells;
  eq(pos.fill, T.long, `HEAT: a positive cell is the gamma palette's long fill at its own opacity (${pos.op})`);
  eq(zc.cls, "zero", "HEAT: an exact zero is a drawn cell");
  eq(zc.fill, T.fill4, "HEAT: in the neutral --fill-4");
  eq(nc.cls, "void", "HEAT: a null is a void");
  eq(nc.fill, "none", "HEAT: with no fill");
  ok(nc.dash && nc.stroke === T.absent, `HEAT: and a dashed outline in --label-4 (${nc.dash})`);
  ok(zc.fill !== nc.fill, "HEAT: so the zero cell and the null cell no longer draw the same");
  ok(zero.heatReadout.on && zero.heatReadout.value === "0", `HEAT: the keyboard readout of the zero cell prints the reading 0 (${zero.heatReadout.text})`);
  eq(zero.heatReadout.toned, 0, "HEAT: with no long or short tone");
  ok(zero.nullReadout.on && zero.nullReadout.value === "no reading", `HEAT: while the null cell beside it reads "no reading", so the readout keeps the zero and the absence apart as the cells do (${zero.nullReadout.text})`);
  const K = zero.notQuoted;
  ok(K.bg === "rgba(0, 0, 0, 0)" && K.image === "none", `HEAT legend: the "Not quoted" key is unfilled, like the void cell it names (${K.bg}, cell fill ${K.voidFill})`);
  ok(K.style === "dashed" && K.width === "1px", `HEAT legend: with a 1px dashed outline, like the void cell's dashed stroke (${K.style} ${K.width})`);
  eq(K.color, K.voidStroke, "HEAT legend: in the void's own colour, --label-4");
  await page.close();
}

{
  trackBody = { ...TRACK, deadBand: null };
  const page = await open();
  await page.waitForFunction(() => document.querySelector("#stChart svg line.base") && document.querySelector('.st-row[data-t="AAA"] .st-strip'), null, { timeout: 15000 });
  const z = await page.evaluate(() => {
    const svg = document.querySelector("#stChart svg");
    const mid = +svg.querySelector("line.base").getAttribute("y1");
    const bars = [...svg.querySelectorAll("rect.grow")].map((r) => ({ cls: r.getAttribute("class"), y: +r.getAttribute("y"), h: +r.getAttribute("height"), fill: getComputedStyle(r).fill }));
    const strip = document.querySelector('.st-row[data-t="AAA"] .st-strip');
    const smid = +strip.querySelector("line.st-zero").getAttribute("y1");
    const srects = [...strip.querySelectorAll("rect")].map((r) => ({ cls: r.getAttribute("class"), y: +r.getAttribute("y"), h: +r.getAttribute("height"), fill: getComputedStyle(r).fill }));
    const probe = document.createElement("i");
    probe.style.color = "var(--label-3)";
    document.body.append(probe);
    const neutral = getComputedStyle(probe).color;
    probe.style.color = "var(--up-mark)";
    const up = getComputedStyle(probe).color;
    probe.remove();
    return { mid, bars, smid, srects, neutral, up };
  });
  trackBody = TRACK;
  eq(z.bars.length, 4, "NO BAND: AAA's chart still draws its four measurements when the payload carries no dead band");
  const zc = z.bars[2], sz = z.srects[2];
  ok(/\bst-in\b/.test(zc.cls) && !/st-pos|st-neg/.test(zc.cls), `NO BAND: the measured zero is the neutral mark, not a positive bar (${zc.cls})`);
  eq(zc.fill, z.neutral, "NO BAND: drawn in --label-3, like the score dot above it");
  ok(zc.fill !== z.up, "NO BAND: and not in the up colour");
  ok(Math.abs(zc.y + zc.h / 2 - z.mid) < 1e-9, `NO BAND: centred on the axis rather than standing above it (y ${zc.y}, h ${zc.h}, axis ${z.mid})`);
  ok(/\bst-pos\b/.test(z.bars[3].cls) && /\bst-neg\b/.test(z.bars[1].cls), "NO BAND: while the signed readings keep their sides");
  ok(sz && sz.cls === "st-in" && sz.fill === z.neutral, `NO BAND: the row's strip draws the same zero neutral (${sz && sz.cls})`);
  ok(sz && Math.abs(sz.y + sz.h / 2 - z.smid) < 1e-9, "NO BAND: centred on the strip's rule");
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
  `at mount and no observer loop error, one throwing draw starving no other chart, a host that leaves and ` +
  `returns before its first frame still drawn, the width re-read where no observer keeps it, and root tokens ` +
  `read from one computed style; a live line updated in place, its svg, crosshair, readout and focus kept, ` +
  `the newest point drawn and nothing re-animated; an exact zero drawn neutral by diverging and heatmap, ` +
  `its dot and readout without a side, and apart from an absence in the cell, the readout and the legend key; ` +
  `and a score track with no published dead band still draws its zero neutral on the axis`);
