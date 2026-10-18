const NOW = () => {
  const TRIGGERS = ["hmChg", "uaTimelineCard", "mkSectorsCard"];
  const Native = window.IntersectionObserver;
  if (Native && !Native.__belowFold) {
    class Seen extends Native {
      constructor(callback, options) {
        super(callback, options);
        this.__callback = callback;
      }
      observe(el) {
        super.observe(el);
        if (el && TRIGGERS.includes(el.id)) Promise.resolve().then(() => this.__callback([{ isIntersecting: true, target: el }], this));
      }
    }
    Seen.__belowFold = true;
    window.IntersectionObserver = Seen;
  }
  window.requestIdleCallback = (fn) => {
    Promise.resolve().then(() => fn({ didTimeout: true, timeRemaining: () => 0 }));
    return 0;
  };
  addEventListener("DOMContentLoaded", () => {
    if (!document.getElementById("hmStage") || window.__stage) return;
    const st = document.createElement("style");
    st.textContent = ".hm-stage{position:static!important;height:auto!important}.hm-panel{position:static!important;visibility:visible!important;display:block!important}.hm-panel>.hm-mod,.hm-panel>.hm-hero,.hm-panel>.hm-verdict{position:static!important;visibility:visible!important;display:block!important;height:auto!important;overflow:visible!important}.hm-panel .hm-body{overflow:visible!important}";
    document.head.append(st);
    setInterval(() => { for (const p of document.querySelectorAll(".hm-panel, .hm-panel > *")) p.inert = false; }, 40);
  });
  addEventListener("load", () => { const u = window.FlowsUI, m = document.getElementById("hmChg"); if (u && u.defer && m) u.defer("home-below", { when: "idle", el: m, label: "The lower modules" }); });
};

export const BELOW_NOW = NOW;

const attached = () => {
  if (!["hmChg", "uaTimelineCard", "mkSectorsCard"].some((id) => document.getElementById(id))) return true;
  const ui = window.FlowsUI || {};
  const kit = ui.homeKit || ui.flowKit || ui.marketKit;
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
