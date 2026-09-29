export const SHIFT_VIEWS = [
  { width: 1440, height: 900, coarse: false },
  { width: 768, height: 1024, coarse: false },
  { width: 390, height: 844, coarse: false },
  { width: 320, height: 640, coarse: false },
  { width: 390, height: 844, coarse: true },
  { width: 768, height: 1024, coarse: true },
];

const IDS = ["bdHero", "bdModT", "bdMod", "bdTools", "bdTable"];

export async function boardShift(browser, { baseURL, cookie, route, width, height, coarse = false, settled }) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: coarse });
  await ctx.addCookies([{ name: "flows_session", value: cookie, url: baseURL }]);
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.__shifts = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.hadRecentInput) continue;
        window.__shifts.push({ v: e.value, src: (e.sources || []).map((s) => (s.node && (s.node.id || String(s.node.className || s.node.nodeName).split(" ")[0])) || "?").join("+") });
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  let release;
  const gate = new Promise((r) => { release = r; });
  await page.route(/\/api\/flows\/board\?/, async (r) => { await gate; await r.continue(); });
  const tops = () => page.evaluate((ids) => Object.fromEntries(ids.map((id) => {
    const e = document.getElementById(id);
    const r = e && e.getBoundingClientRect();
    return [id, r && r.height ? Math.round((r.top + window.scrollY) * 10) / 10 : null];
  })), IDS);
  try {
    await page.goto(baseURL + route, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const before = await tops();
    const busyBefore = await page.evaluate(() => {
      const f = document.querySelector(".bd-foot");
      return f ? getComputedStyle(f).visibility : null;
    });
    release();
    await page.waitForSelector(settled);
    await page.waitForFunction(() => !document.querySelector('.bd-body[aria-busy="true"]'));
    await page.waitForTimeout(500);
    const after = await tops();
    const shifts = await page.evaluate(() => window.__shifts);
    const pointer = await page.evaluate(() => (matchMedia("(pointer: coarse)").matches ? "coarse" : "fine"));
    const footAfter = await page.evaluate(() => getComputedStyle(document.querySelector(".bd-foot")).visibility);
    return { before, after, shifts, pointer, busyBefore, footAfter, cls: shifts.reduce((a, s) => a + s.v, 0) };
  } finally {
    await ctx.close();
  }
}

export function moved(shot, ids) {
  return ids.filter((id) => shot.before[id] !== null && shot.after[id] !== null && Math.abs(shot.before[id] - shot.after[id]) > 0.6)
    .map((id) => `${id} ${shot.before[id]}->${shot.after[id]}`);
}
