import { chromium } from "playwright";
import fs from "node:fs";
import { startWorker, FLOWS_PASSWORD, FLOWS_TEST_USER } from "/home/user/anilkaya.org/tests/worker-server.mjs";

const SP = "/tmp/claude-0/-home-user-anilkaya-org/8b724476-a608-5cd4-8082-5d2bfd2a4504/scratchpad/";
const TOKEN = "shot-token-aaaaaaaaaaaaaaaaaaaaaa";
const server = await startWorker({ extraVars: [`FLOWS_INGEST_TOKEN:${TOKEN}`] });
const url = (p) => server.baseURL + p;

const v2 = JSON.parse(fs.readFileSync(SP + "dry-board-long.json", "utf8"));
v2.generatedAt = new Date().toISOString();
const v1 = JSON.parse(JSON.stringify(v2));
v1.v = 1; v1.side = "short";
v2.side = "long";

const post = (key, body) => fetch(url("/api/flows/ingest?key=" + encodeURIComponent(key)), {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
  body: JSON.stringify(body),
});
console.log("ingest v2", (await post("board:long", v2)).status);
console.log("ingest v1", (await post("board:short", v1)).status);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
await page.goto(url("/flows/"), { waitUntil: "networkidle" });
await page.fill("#u", FLOWS_TEST_USER);
await page.fill("#p", FLOWS_PASSWORD);
await Promise.all([page.waitForNavigation({ waitUntil: "networkidle" }), page.click(".flows-submit")]);

for (const side of ["long", "short"]) {
  await page.goto(url(`/flows/?view=table&side=${side}`), { waitUntil: "networkidle" });
  await page.waitForSelector(".fb-fam");
  const out = await page.evaluate(() => {
    const cell = document.querySelector(".fb-fam");
    const row = document.querySelector("#flowsBody tr");
    const keys = ["F","P","D","V","O"];
    const bars = [...cell.querySelectorAll("i")].map((i, n) => {
      const cs = getComputedStyle(i, "::before");
      return { k: keys[n], cls: i.className || "-", h: cs.height, bottom: cs.bottom, top: cs.top, bg: cs.backgroundColor };
    });
    return { t: row.children[1].textContent.trim(), label: cell.getAttribute("aria-label"), title: cell.title, bars };
  });
  console.log("=== payload", side === "long" ? "v=2" : "v=1", "===");
  console.log(out.t, "|", out.label);
  for (const b of out.bars) console.log("  ", JSON.stringify(b));
}
const hdr = await page.evaluate(() => {
  const a = document.querySelector("thead abbr[title]");
  return a ? a.title : null;
});
console.log("header:", hdr);
await browser.close();
await server.close?.();
process.exit(0);
