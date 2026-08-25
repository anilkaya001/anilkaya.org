import { chromium } from "playwright";
import { startWorker } from "/home/user/anilkaya.org/tests/worker-server.mjs";

const server = await startWorker();
const BASE = server.baseURL;
const browser = await chromium.launch();
const pages = ["/", "/lab/", "/articles/", "/lab/review/", "/lab/placement/", "/lab/challenge/"];
const widths = [481, 500, 540, 600, 660, 720, 768, 794, 820, 900];
for (const p of pages) {
  for (const w of widths) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(BASE + p, { waitUntil: "networkidle" }).catch(()=>{});
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const pill = document.querySelector(".pill");
      const social = document.querySelector(".topbar__social");
      const links = pill ? Array.from(pill.querySelectorAll("a")) : [];
      const last = links[links.length-1];
      return {
        pill: pill ? [pill.getBoundingClientRect().left, pill.getBoundingClientRect().right] : null,
        lastTab: last ? [last.getBoundingClientRect().left, last.getBoundingClientRect().right] : null,
        social: social ? [social.getBoundingClientRect().left, social.getBoundingClientRect().right] : null,
        tabW: links.map(l=>Math.round(l.getBoundingClientRect().width)),
        scrollW: document.documentElement.scrollWidth,
        inner: window.innerWidth,
      };
    });
    const round = a => a ? a.map(x=>Math.round(x*10)/10) : a;
    const clipped = r.social && r.social[1] > w + 0.5;
    console.log(`${p} @${w}  tabs=${r.tabW.join(",")} pill=${round(r.pill)} last=${round(r.lastTab)} social=${round(r.social)} scrollW=${r.scrollW} ${clipped?"  <<< SOCIAL CLIPPED":""}`);
    await ctx.close();
  }
}
await browser.close();
await server.close?.();
process.exit(0);
