import { chromium } from "playwright";
import fs from "node:fs";
const HERE = "/home/user/anilkaya.org/tests";
const { startWorker, FLOWS_PASSWORD, FLOWS_TEST_USER } = await import(HERE + "/worker-server.mjs");
const TOKEN = "shot-token-aaaaaaaaaaaaaaaaaaaaaa";
const server = await startWorker({ extraVars: [`FLOWS_INGEST_TOKEN:${TOKEN}`] });
const url = (p) => server.baseURL + p;
const post = (key, body) => fetch(url("/api/flows/ingest?key=" + encodeURIComponent(key)), {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
  body: JSON.stringify(body) });
const live = JSON.parse(fs.readFileSync("/tmp/claude-0/-home-user-anilkaya-org/8b724476-a608-5cd4-8082-5d2bfd2a4504/scratchpad/live-card.json","utf8"));
console.log("card v:", live.v, "ticker:", live.ticker, "regime:", JSON.stringify(live.regime));
live.generatedAt = new Date().toISOString();
const board = { side:"long", generatedAt:new Date().toISOString(), sessionDate:"2026-08-25", status:"ok",
  universe:264, enriched:60, rows:[{ t:"INTC", r:1, s:84, cnv:79, px:87.26, chg:0.012, purity:0.006,
  gRegime:"short", gFlipDist:-0.1087, netPrem:-1.3e7, fam:{F:-73,P:-78,D:-69,V:0,O:53} }] };
console.log("post board", (await post("board:long", board)).status);
console.log("post card", (await post("card:INTC", live)).status);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport:{width:1280,height:1000} });
const errors=[]; page.on("pageerror",e=>errors.push(e.message));
await page.goto(url("/flows/"), { waitUntil:"networkidle" });
await page.fill("#u", FLOWS_TEST_USER); await page.fill("#p", FLOWS_PASSWORD);
await Promise.all([page.waitForNavigation({waitUntil:"networkidle"}), page.click(".flows-submit")]);
await page.waitForSelector(".fd-card");
await page.click('.fd-card[data-t="INTC"]');
await page.waitForSelector("#fcGamma");
const out = await page.evaluate(() => {
  const g = document.querySelector("#fcGamma");
  const note = g && g.querySelector(".fc-note");
  return { note: note ? note.textContent : null,
           head: (document.querySelector("#flowsCard")||{textContent:""}).textContent.slice(0,300) };
});
console.log("=== #fcGamma note ===\n" + out.note);
console.log("=== head ===\n" + out.head);
console.log("errors:", errors);
await browser.close(); await server.stop();
