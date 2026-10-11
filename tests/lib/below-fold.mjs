const NOW = () => {
  const Native = window.IntersectionObserver;
  if (Native && !Native.__belowFold) {
    class Seen extends Native {
      constructor(callback, options) {
        super(callback, options);
        this.__callback = callback;
      }
      observe(el) {
        super.observe(el);
        if (el && (el.id === "hmChg" || el.id === "uaTimelineCard")) Promise.resolve().then(() => this.__callback([{ isIntersecting: true, target: el }], this));
      }
    }
    Seen.__belowFold = true;
    window.IntersectionObserver = Seen;
  }
  window.requestIdleCallback = (fn) => {
    Promise.resolve().then(() => fn({ didTimeout: true, timeRemaining: () => 0 }));
    return 0;
  };
};

export const BELOW_NOW = NOW;

const attached = () => {
  if (!document.getElementById("hmChg") && !document.getElementById("uaTimelineCard")) return true;
  const ui = window.FlowsUI || {};
  const kit = ui.homeKit || ui.flowKit;
  return Boolean(kit && kit.attached);
};

function patch(page) {
  const goto = page.goto.bind(page);
  const reload = page.reload.bind(page);
  const settle = async (result) => {
    await page.waitForFunction(attached, null, { timeout: 8000 }).catch(() => {});
    return result;
  };
  page.goto = async (...args) => settle(await goto(...args));
  page.reload = async (...args) => settle(await reload(...args));
  return page;
}

export function revealBelow(browser) {
  const newPage = browser.newPage.bind(browser);
  const newContext = browser.newContext.bind(browser);
  browser.newPage = async (...args) => {
    const p = await newPage(...args);
    await p.addInitScript(NOW);
    return patch(p);
  };
  browser.newContext = async (...args) => {
    const c = await newContext(...args);
    await c.addInitScript(NOW);
    const make = c.newPage.bind(c);
    c.newPage = async (...a) => patch(await make(...a));
    return c;
  };
  return browser;
}
