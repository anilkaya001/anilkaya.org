import { chromium } from "playwright";
import { startWorker } from "/home/user/anilkaya.org/tests/worker-server.mjs";
const server = await startWorker();
const BASE = server.baseURL;
const browser = await chromium.launch();
for (const p of ["/", "/lab/", "/articles/"]) {
  for (const w of [481,500,540,600,660,720,768,820,900,1024]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(BASE + p, { waitUntil: "networkidle" }).catch(()=>{});
    // strip the Flows tab and re-run nav layout by dispatching resize
    await page.evaluate(() => {
      document.querySelectorAll('.pill a[href="/flows/"]').forEach(a => a.remove());
      window.dispatchEvent(new Event("resize"));
    });
    await page.waitForTimeout(250);
    const r = await page.evaluate(() => {
      const pill=document.querySelector(".pill"), social=document.querySelector(".topbar__social");
      const links=Array.from(pill.querySelectorAll("a"));
      return { tabW: links.map(l=>Math.round(l.getBoundingClientRect().width)),
        pill:[pill.getBoundingClientRect().left,pill.getBoundingClientRect().right],
        social: social?[social.getBoundingClientRect().left,social.getBoundingClientRect().right]:null };
    });
    const rd=a=>a?a.map(x=>Math.round(x*10)/10):a;
    console.log(`3TAB ${p} @${w} tabs=${r.tabW.join(",")} pill=${rd(r.pill)} social=${rd(r.social)} ${r.social&&r.social[1]>w+0.5?"<<<CLIP "+Math.round(r.social[1]-w)+"px":""}`);
    await ctx.close();
  }
}
await browser.close(); process.exit(0);
