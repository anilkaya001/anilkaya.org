import { moneyShort } from "../../shared/flows-sfc-display.js";
import { between } from "./sfc-rng.mjs";
import { liveWorld, serverBook } from "./ledger-live-world.mjs";
import { LIVE_JS, CTL_JS, once, statusOf, mount, mountHooked, shownLedger, expectedLedger, Sim } from "./ledger-live-rig.mjs";

export const PLANTS = [
  { id: "R1-window-missed", title: "every fifth arriving window is dropped", live: [["L.ledger.put(rows, { at: readAt });", "L.ledger.put(rows.filter((r, i) => i % 5 !== 4), { at: readAt });"]], expect: "conservation" },
  { id: "R2-verdict-from-alert", title: "the verdict is read from the newest alert, not the hub", live: [["const hub = T.synced && Number.isFinite(readAtMs) && Number.isFinite(T.at) && T.perf > 0 ? { atMs: T.at, readAtMs, perf: T.perf } : null;", "const newest = L.ledger.engine() ? L.ledger.newestEnd() : null;\n    const hub = T.synced && Number.isFinite(newest) && Number.isFinite(T.at) && T.perf > 0 ? { atMs: T.at, readAtMs: newest, perf: T.perf } : null;"]], expect: "verdict" },
  { id: "R3-count-lands-short", title: "the count stops half way", live: [["rec.raf = p < 1 ? requestAnimationFrame(step) : 0;", "rec.raf = p < 0.5 ? requestAnimationFrame(step) : 0;"]], expect: "countup" },
  { id: "R4-timer-while-hidden", title: "the timers keep running in a hidden tab", live: [["      L.hiddenAt = Date.now();\n      disarm();\n      return;", "      L.hiddenAt = Date.now();\n      return;"], ["    if (L.hidden || !L.strip) return;\n    if (L.active && slept())", "    if (!L.strip) return;\n    if (L.active && slept())"]], expect: "hidden" },
  { id: "R5-attributes-rewritten", title: "every attribute is written on every paint", live: [["if (a.getAttribute(name) !== at.value) { a.setAttribute(name, at.value);", "if (true) { a.setAttribute(name, at.value);"]], expect: "writes" },
  { id: "R6-verification-never-runs", title: "the full recompute is never scheduled", live: [["L.timers.verify = setTimeout(() => { if (runVerify()) armVerify(); }, VERIFY_MS);", "L.timers.verify = setTimeout(() => { armVerify(); }, VERIFY_MS);"]], expect: "verify" },
  { id: "R7-drift-never-pauses", title: "a drift that keeps coming back is counted but never pauses", live: [["    if (L.drift.events >= DRIFT_PAUSE) {\n      pause(\"The live books drifted from a full recompute.\");\n      return false;\n    }\n", ""]], expect: "drift-pause" },
  { id: "R11-drift-not-rebuilt", title: "a drift is counted and the books are left as they are", live: [["    L.ledger.engine().rebuild();\n", ""]], expect: "drift-rebuild" },
  { id: "R8-parity-ignored", title: "a book the browser cannot reproduce is used anyway", live: [["if (!parity.ok) { pause(", "if (false) { pause("]], expect: "parity" },
  { id: "R9-innerhtml-every-paint", title: "every live paint replaces the markup", ctl: [["if (api) api.morph(host, text);\n    else host.innerHTML = text;", "host.innerHTML = text;"]], expect: "writes" },
  { id: "R10-flash-unthrottled", title: "a flash on every repaint, with no gap between them", live: [["const FLASH_GAP_MS = 500;", "const FLASH_GAP_MS = 0;"]], expect: "flash" },
];
export const BASE_LIVE = once(LIVE_JS, "const VERIFY_MS = 15000;", "const VERIFY_MS = 250;");
const tamperBook = () => { const b = JSON.parse(JSON.stringify(serverBook(liveWorld()))); b.viewHash = "00000000"; return b; };
export async function battery(browser, o) {
  const failed = [];
  const note = (name, good) => { if (!good && !failed.includes(name)) failed.push(name); };
  {
    const m = await mountHooked(browser, 1440, 820, { settle: 200, reduced: false, liveJs: o.liveJs, js: o.js });
    const sim = new Sim(m);
    let bad = 0;
    for (let step = 0; step < 6; step++) {
      await sim.send(sim.rows(between(sim.rnd, 3, 9)));
      const mirror = sim.mirror();
      const rows = await shownLedger(m.page);
      const got = rows.map((r) => [r[0].t, ...r.slice(1).map((c) => c.t)]);
      if (JSON.stringify(got) !== JSON.stringify(expectedLedger(mirror.view({ now: sim.readAt + 50, aligned: true })))) bad++;
      if ((await statusOf(m.page)).fingerprint !== mirror.fingerprint()) bad++;
    }
    note("conservation", bad === 0);
    const verdict = async () => (await m.page.evaluate(() => window.FlowsUI.ledgerLive.strip())).verdict.state;
    m.R.now = sim.readAt + 60000;
    m.R.send(m.R.hb(sim.readAt + 59800));
    await m.page.waitForTimeout(150);
    note("verdict", (await verdict()) === "live");
    const armed = await m.page.evaluate(() => { window.__setHidden(true); window.__watch(["#sfLive"]); return window.FlowsUI.ledgerLive.status().timers; });
    await m.page.waitForTimeout(700);
    const ticks = await m.page.evaluate(() => { window.__unwatch(); return window.__muts.length; });
    note("hidden", armed === 0 && ticks === 0);
    await m.page.evaluate(() => window.__setHidden(false));
    await m.page.waitForTimeout(100);
    await m.page.evaluate(() => { window.__seen = []; const step = () => { const el = document.querySelector("#sfScope b.lv-n"); if (el) window.__seen.push(el.textContent); window.__raf = requestAnimationFrame(step); }; step(); });
    await sim.send(sim.rows(3, { prem: 800000, askPrem: 350000, bidPrem: 250000 }));
    await m.page.waitForTimeout(650);
    await m.page.evaluate(() => cancelAnimationFrame(window.__raf));
    const mirror = sim.mirror();
    const cents = [...mirror.engine().snapshot().books.values()].reduce((a, b) => a + b.T, 0);
    note("countup", (await m.page.textContent("#sfScope b.lv-n")) === moneyShort(cents));
    const snapshot = () => m.page.evaluate(() => [...document.querySelectorAll("#sfMatrix td, #sfMatrix th, #sfBody td, #sfBody th")].map((c) => c.innerHTML + "|" + (c.dataset.x || "") + "|" + (c.dataset.s || "") + "|" + (c.getAttribute("title") || "") + "|" + (c.getAttribute("aria-label") || "")));
    let wrote = true;
    let flashed = true;
    for (let i = 0; i < 3; i++) {
      const before = await snapshot();
      await m.page.waitForTimeout(400);
      await m.page.evaluate(() => window.__watch(["#sfMatrix", "#sfBody"]));
      await sim.send(sim.rows(1));
      await m.page.waitForTimeout(100);
      const after = await snapshot();
      const rep = await m.page.evaluate(() => {
        window.__unwatch();
        const cells = new Set();
        const flash = new Set();
        const all = [...document.querySelectorAll("#sfMatrix td, #sfMatrix th, #sfBody td, #sfBody th")];
        for (const mu of window.__muts) {
          const el = mu.target.nodeType === 1 ? mu.target : mu.target.parentElement;
          const cell = el && el.closest("td, th");
          if (mu.type === "attributes" && mu.attributeName === "data-flash") { if (cell) flash.add(all.indexOf(cell)); continue; }
          if (cell) cells.add(all.indexOf(cell));
        }
        return { cells: [...cells].sort((a, b) => a - b), flash: [...flash] };
      });
      const changed = [];
      before.forEach((t, j) => { if (t !== after[j]) changed.push(j); });
      if (JSON.stringify(changed) !== JSON.stringify(rep.cells)) wrote = false;
      if (!rep.flash.every((j) => changed.includes(j))) flashed = false;
    }
    await m.page.waitForTimeout(700);
    await m.page.evaluate(() => window.__watch(["#sfMatrix", "#sfBody"]));
    const t0 = await m.page.evaluate(() => performance.now());
    for (let i = 0; i < 4; i++) await sim.send(sim.rows(1), { quiet: true });
    const burst = await m.page.evaluate(() => {
      window.__unwatch();
      const waves = new Set();
      window.__muts.forEach((mu, i) => { if (mu.type === "attributes" && mu.attributeName === "data-flash") waves.add(window.__mutAt[i]); });
      return { waves: waves.size, now: performance.now() };
    });
    note("writes", wrote);
    note("flash", flashed && burst.waves <= Math.floor((burst.now - t0) / 500) + 1);
    await m.page.waitForTimeout(o.verifyWait || 1000);
    note("verify", (await statusOf(m.page)).drift.runs >= 3);
    await m.ctx.close();
  }
  {
    const m = await mount(browser, 1440, 820, { settle: 100, liveJs: o.liveJs, js: o.js });
    await m.page.waitForTimeout(500);
    await m.page.evaluate(() => { const b = window.FlowsUI.ledgerLive.hold().snapshot().books.values().next().value; b.T += 1; });
    await m.page.waitForTimeout(1000);
    const single = await statusOf(m.page);
    note("drift-rebuild", single.drift.events === 1 && single.active === true && single.paused === null);
    await m.page.evaluate(() => { window.__tamper = setInterval(() => { const b = window.FlowsUI.ledgerLive.hold().snapshot().books.values().next().value; if (b) b.T += 1; }, 90); });
    let paused = false;
    try { await m.page.waitForFunction(() => window.FlowsUI.ledgerLive.status().paused, null, { timeout: 3500 }); paused = true; } catch { paused = false; }
    note("drift-pause", paused);
    await m.ctx.close();
  }
  {
    const m = await mount(browser, 1440, 820, { settle: 700, waitLive: false, liveJs: o.liveJs, js: o.js, book: tamperBook });
    note("parity", (await statusOf(m.page)).active === false);
    await m.ctx.close();
  }
  return failed;
}
export function plantArgs(p) {
  return {
    liveJs: p.live ? p.live.reduce((t, [x, y]) => once(t, x, y), BASE_LIVE) : BASE_LIVE,
    js: p.ctl ? p.ctl.reduce((t, [x, y]) => once(t, x, y), CTL_JS) : undefined,
  };
}
