/* =============================================================
   flows-political-render.mjs — the disclosure page, in a browser.

   THE PAGE RANKS PEOPLE BY MONEY FROM DATA THAT STATES NEITHER AN
   AMOUNT NOR A CURRENT DATE, and the shaper's own suite
   (flows-political-contract.mjs) already pins the arithmetic. What
   this file pins is everything the arithmetic cannot reach: whether
   the honesty survives the trip through the DOM.

   The expensive defects here are all silent. A band drawn on its own
   scale instead of the bar's would still look like a whisker and
   would place the midpoint outside its own range. A holder figure
   given a currency mark would read as dollars when the vendor calls
   it shares. A "Receive" relabelled "Buy" by a renderer that trusted
   our classification over the filing's would turn a gift into a
   purchase in the one panel that shows the filing verbatim. None of
   those throws; each is asserted.

   THE GEOMETRY ASSERTION IS THE HEART OF IT. The bar is a midpoint
   and the whisker is the low and high of THE SAME filings, so the
   bar's end must fall inside its own whisker. Measured from the
   rendered box, not from the numbers that produced it.
   ============================================================= */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { signSession } from "../shared/session.js";
import { startWorker, SESSION_SECRET, FLOWS_TEST_USER } from "./worker-server.mjs";
import { POLITICAL_NOTES, HOLDER_QTY_UNIT } from "../shared/flows-political.js";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const near = (a, b, eps, msg) => {
  assert.ok(Math.abs(a - b) <= eps, `${msg} — got ${a}, want ${b} (±${eps})`);
  checks++;
};

const TOKEN = "political-token-aaaaaaaa";
const server = await startWorker({ extraVars: [`FLOWS_INGEST_TOKEN:${TOKEN}`] });
const url = (p) => server.baseURL + p;
const token = await signSession(
  { sub: FLOWS_TEST_USER, aud: "flows", epoch: "1", exp: Date.now() + 600000 }, SESSION_SECRET);
const auth = { Cookie: "flows_session=" + token };
const put = (key, bodyObj) => fetch(url("/api/flows/ingest?key=" + encodeURIComponent(key)), {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
  body: JSON.stringify(bodyObj),
});

/* THE FIXTURE IS BUILT AROUND FOUR TRAPS, one per assertion block below.

   - Ada and Ben are the top two and their bands OVERLAP: Ada's summed low
     ($9M) sits below Ben's summed high ($11M). The ranking puts Ada first;
     the whiskers say the filings cannot separate them, and the page has to
     say so too.
   - Cara disclosed one open-ended purchase. It contributes nothing to any
     total and its $50M floor must reach the page as a number.
   - The recent panel carries a "Receive" — a gift — and a filing 92 days
     late.
   - The holder rows are share quantities and one has no stated owner. */
const payload = {
  v: 2,
  generatedAt: "2026-09-01T06:00:00.000Z",
  sessionDate: "2026-08-31",
  readAt: "2026-09-01T06:02:00.000Z",
  window: { from: "2026-06-02", to: "2026-08-31", days: 90 },
  source: { route: "congress-trader", pages: 4, pageLimit: 200, paginated: true, windowed: true },
  filings: 431,
  unusable: 3,
  buyers: {
    status: "ok", seen: 31, cap: 25, shed: 6, basis: "band midpoint: stated convention",
    rows: [
      { who: "Ada Reyes", id: "p1", memberType: "senate", bought: 10_000_000,
        boughtLo: 9_000_000, boughtHi: 12_000_000, sold: 250_000, buys: 14, sells: 2,
        names: 9, medianLagDays: 38, openBands: 0, openFloor: 0, unclassified: 0 },
      { who: "Ben Osei", id: "p2", memberType: "house", bought: 9_500_000,
        boughtLo: 8_000_000, boughtHi: 11_000_000, sold: 0, buys: 11, sells: 0,
        names: 7, medianLagDays: 61, openBands: 0, openFloor: 0, unclassified: 0 },
      { who: "Cara Lindqvist", id: "p3", memberType: "house", bought: 1_200_000,
        boughtLo: 900_000, boughtHi: 1_500_000, sold: 0, buys: 3, sells: 0,
        names: 3, medianLagDays: 96, openBands: 1, openFloor: 50_000_000, unclassified: 0 },
    ],
  },
  assets: {
    status: "ok", seen: 12, cap: 25, shed: 0, basis: "band midpoint: stated convention",
    rows: [
      { t: "NVDA", issuer: "NVIDIA Corporation", bought: 8_000_000, boughtLo: 6_000_000,
        boughtHi: 10_000_000, sold: 100_000, buys: 9, sells: 1, filers: 6,
        medianLagDays: 44, openBands: 0, openFloor: 0 },
      { t: "PFE", issuer: "Pfizer Inc", bought: 1_000_000, boughtLo: 800_000,
        boughtHi: 1_300_000, sold: 0, buys: 2, sells: 0, filers: 2,
        medianLagDays: 51, openBands: 0, openFloor: 0 },
    ],
  },
  recent: {
    status: "ok", seen: 4, cap: 60, shed: 0,
    rows: [
      { who: "Ada Reyes", t: "NVDA", txnType: "Purchase", side: "buy",
        lo: 15_001, hi: 50_000, mid: 32_500.5,
        txnDate: "2026-08-01", filedDate: "2026-08-30", lagDays: 29 },
      { who: "Ben Osei", t: "PFE", txnType: "Receive", side: null,
        lo: 1_000, hi: 15_000, mid: 8_000,
        txnDate: "2026-05-20", filedDate: "2026-08-20", lagDays: 92 },
      { who: "Cara Lindqvist", t: "AAPL", txnType: "Sale (Partial)", side: "sell",
        lo: 50_001, hi: 100_000, mid: 75_000.5,
        txnDate: "2026-07-01", filedDate: "2026-08-15", lagDays: 45 },
      { who: "Dev Patel", t: "MSFT", txnType: "Purchase", side: "buy",
        lo: 50_000_000, hi: null, mid: null,
        txnDate: "2026-06-01", filedDate: "2026-08-10", lagDays: 70 },
    ],
  },
  holders: {
    status: "ok", seen: 3, cap: 40, shed: 0, names: 2,
    qtyUnit: HOLDER_QTY_UNIT, selfFiled: 1, ownerKnown: 2,
    rows: [
      { t: "NVDA", who: "Zoe Lofgren", id: "h1", owner: "spouse",
        minQty: 151, midQty: 328, maxQty: 505 },
      { t: "NVDA", who: "Ada Reyes", id: "h2", owner: "self",
        minQty: 9, midQty: 76, maxQty: 143 },
      { t: "PFE", who: "Ben Osei", id: "h3", owner: null,
        minQty: 1, midQty: 20, maxQty: 40 },
    ],
  },
  notes: POLITICAL_NOTES,
};

const browser = await chromium.launch();
try {
  /* ---------- §1 the empty store, before this file's own writes --- */
  {
    const anon = await fetch(url("/api/flows/political"), { redirect: "manual" });
    eq(anon.status, 401, "the disclosure feed needs a session like every other flows API");
    const pending = await (await fetch(url("/api/flows/political"), { headers: auth })).json();
    eq(pending.status, "pending", "an unpublished window reports pending, not an error");

    const page = await browser.newPage();
    await page.context().addCookies([{
      name: "flows_session", value: token, url: server.baseURL,
    }]);
    await page.goto(url("/flows/political/"), { waitUntil: "networkidle" });
    const text = await page.textContent("#plStatus");
    ok(/no disclosure window has been read yet/i.test(text || ""),
      "and the page says so as a fact about the store rather than drawing an empty ranking");
    const panels = await page.evaluate(() =>
      [...document.querySelectorAll(".fc-panel")].filter((p) => !p.hidden).length);
    eq(panels, 0, "with no panel drawn at all, rather than panels full of dashes");

    /* THE LAG WARNING IS NOT CONDITIONAL ON DATA. It is the frame the page is
       read in, so it is in the document rather than painted by the renderer —
       a reader who arrives before the first run still learns what this page
       is before they learn what it says. */
    const warn = await page.textContent(".pl-lede-warn");
    ok(/45 days/.test(warn || "") && /disclosed/i.test(warn || ""),
      "and the lag frame is already on the page, above where the first number will land");
    await page.close();
  }

  eq((await put("political", payload)).status, 200,
    "the ingest route accepts the political key — it did not, for one commit");

  const page = await browser.newPage();
  await page.context().addCookies([{ name: "flows_session", value: token, url: server.baseURL }]);
  await page.goto(url("/flows/political/"), { waitUntil: "networkidle" });
  await page.waitForSelector("#plBuyers tbody tr");

  /* ---------- §2 THE GEOMETRY: the midpoint inside its own band --- */
  {
    const geo = await page.evaluate(() => {
      const out = [];
      for (const tr of document.querySelectorAll("#plBuyers tbody tr")) {
        const host = tr.querySelector(".pl-bar");
        const fill = tr.querySelector(".pl-bar-fill");
        const band = tr.querySelector(".pl-bar-band");
        if (!host) continue;
        const h = host.getBoundingClientRect();
        out.push({
          who: tr.querySelector(".pl-name").textContent,
          host: h.width,
          barEnd: fill ? fill.getBoundingClientRect().right - h.left : null,
          bandStart: band ? band.getBoundingClientRect().left - h.left : null,
          bandEnd: band ? band.getBoundingClientRect().right - h.left : null,
        });
      }
      return out;
    });
    eq(geo.length, 3, "one bar per ranked filer");

    const scale = 12_000_000;   // the largest boughtHi in the fixture
    for (const g of geo) {
      const row = payload.buyers.rows.find((r) => r.who === g.who);
      ok(g.host > 40, `${g.who}: the bar host has real width to measure against`);
      near(g.barEnd / g.host, row.bought / scale, 0.02,
        `${g.who}: THE BAR IS THE MIDPOINT ON A SHARED AXIS — its length is that ` +
        "filer's summed midpoint over the largest summed high in the panel, so " +
        "lengths are comparable down the column rather than each row filling itself");
      near(g.bandStart / g.host, row.boughtLo / scale, 0.02,
        `${g.who}: the whisker starts at the summed LOW on that same axis`);
      near(g.bandEnd / g.host, row.boughtHi / scale, 0.02,
        `${g.who}: and ends at the summed HIGH`);
      ok(g.barEnd >= g.bandStart - 2 && g.barEnd <= g.bandEnd + 2,
        `${g.who}: AND THE BAR ENDS INSIDE ITS OWN WHISKER. A band drawn on a ` +
        "separate scale would still look like a whisker while placing the " +
        "midpoint outside the range it is the midpoint of — this is the one " +
        "defect on this page that would render perfectly and mean nothing");
    }

    /* THE OVERLAP IS VISIBLE, not merely computable. Ada ranks above Ben and
       their whiskers cross; a reader who trusts the order is reading more
       than the filings say. */
    ok(geo[1].bandEnd > geo[0].bandStart,
      "the top two whiskers overlap on screen, as the fixture intends");
    const note = await page.textContent("#plBuyersNote");
    ok(/1 of the 2 neighbouring pairs have overlapping bands/.test(note || ""),
      "and the note COUNTS the neighbours the ranking cannot separate, rather " +
      `than warning in general terms — got: ${JSON.stringify(note)}`);
    ok(/Top 25 of 31/.test(note || "") && /6 ranked below the cut/.test(note || ""),
      "with what the cap kept and what it dropped");
  }

  /* ---------- §3 the open band's floor reaches the page ----------- */
  {
    const note = await page.textContent("#plBuyersNote");
    ok(/floor and no ceiling/.test(note || ""),
      "the open-ended bands are named for what makes them unsummable");
    ok(/\$50\.0M/.test(note || ""),
      "AND THE HELD-BACK SIZE IS A NUMBER. $50M of disclosed purchasing sits " +
      "in no bar on the panel; a caveat that does not say how much is a " +
      `different object from one that does — got: ${JSON.stringify(note)}`);
  }

  /* ---------- §4 the ranking is of purchases, end to end ---------- */
  {
    const order = await page.evaluate(() =>
      [...document.querySelectorAll("#plBuyers tbody .pl-name")].map((n) => n.textContent));
    assert.deepEqual(order, ["Ada Reyes", "Ben Osei", "Cara Lindqvist"],
      "the payload's own order survives the renderer — a re-sort here would be " +
      "a second opinion about a ranking the shaper already took");
    checks++;
    const sold = await page.evaluate(() =>
      [...document.querySelectorAll("#plBuyers tbody .pl-sold")].map((n) => n.textContent));
    eq(sold[1], "—",
      "a filer who disclosed no sale gets an em dash, not $0 — nothing sold and " +
      "nothing disclosed are different facts");
  }

  /* ---------- §5 the filing's own word, and the late mark --------- */
  {
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll("#plRecent tbody tr")].map((tr) => {
        const cells = [...tr.children].map((c) => c.textContent);
        const side = tr.querySelector(".pl-side");
        const lag = tr.children[2];
        return {
          filed: cells[0], side: side.textContent, sideClass: side.className,
          lagClass: lag.className, lagTitle: lag.getAttribute("title"),
          band: cells[6],
        };
      }));
    eq(rows[0].filed, "2026-08-30", "newest disclosure first, as published");
    eq(rows[1].side, "Receive",
      "THE VENDOR'S OWN WORD. A gift is neither a purchase nor a sale, and " +
      "printing our classification instead of the filing's would turn an " +
      "acquisition nobody paid for into a buy in the one panel that shows the " +
      "filing verbatim");
    ok(/is-neither/.test(rows[1].sideClass),
      "and it is styled as neither, rather than borrowing a buy or sell treatment");
    ok(/is-buy/.test(rows[0].sideClass) && /is-sell/.test(rows[2].sideClass),
      "while the two that are classifiable carry their sides");
    ok(/pl-late/.test(rows[1].lagClass),
      "a filing 92 days after the trade is marked as past the statutory window");
    ok(/45 days/.test(rows[1].lagTitle || ""),
      "with the reason on the mark rather than only in the footer");
    ok(!/pl-late/.test(rows[2].lagClass),
      "and a filing at exactly 45 days is NOT late — the boundary is the " +
      "statute's, not a rounded one");
    ok(/over \$50\.0M/i.test(rows[3].band),
      "an open-ended filing reads as 'over' its floor rather than being " +
      "collapsed to a midpoint it does not have");
  }

  /* ---------- §6 the holder unit survives the DOM ----------------- */
  {
    const h = await page.evaluate(() => {
      const t = document.querySelector("#plHolders table");
      return {
        body: t.querySelector("tbody").textContent,
        caption: t.querySelector("caption").textContent,
        owners: [...t.querySelectorAll(".pl-owner")].map((n) => ({
          text: n.textContent, cls: n.className,
        })),
        note: document.getElementById("plHoldersNote").textContent,
      };
    });
    ok(!h.body.includes("$"),
      "NO CURRENCY MARK ANYWHERE IN THE HOLDER TABLE. The vendor describes " +
      "these three numbers as share quantities while every other number on " +
      "this page is dollars; a single dollar sign here restates the units " +
      "defect that produced '1352% of its year'");
    ok(/share quantity/.test(h.caption) && /not dollars/.test(h.caption),
      "and the unit is printed from the payload's own sentence, not a reworded one");
    eq(h.owners[2].text, "not stated",
      "a row the vendor sent no owner for says so");
    ok(/is-unknown/.test(h.owners[2].cls),
      "and is marked as unknown rather than rendering as an ordinary value");
    ok(/1 of the 2 holdings with a stated account/.test(h.note),
      "the self-filed share is reported over the rows that HAVE an owner, not " +
      `over all of them — got: ${JSON.stringify(h.note)}`);
  }

  /* ---------- §7 how wide the read was ---------------------------- */
  {
    const status = await page.textContent("#plStatus");
    ok(/431 disclosures/.test(status), "the population is stated");
    ok(/2026-06-02/.test(status) && /2026-08-31/.test(status), "and the window it was read over");
    ok(/4 pages/.test(status) && /congress-trader/.test(status),
      "AND HOW IT WAS OBTAINED. A ranking is only as wide as its population, " +
      "and one page against eight is the difference between a thin week and a " +
      "broken walk — a distinction no reader can make from the ranking itself");
    ok(/3 carried no filer or name/.test(status),
      "with the rows that were dropped counted rather than silently absent");
    const banner = await page.evaluate(() => document.getElementById("plSource").hidden);
    eq(banner, true, "and no pagination warning when pagination answered");
  }

  /* ---------- §8 the notes reach the page, one paragraph each ----- */
  {
    const foot = await page.evaluate(() =>
      [...document.querySelectorAll("#plFoot .flows-foot-p")].map((p) => p.textContent));
    eq(foot.length, 5, "all five published notes are drawn, one paragraph each");
    ok(foot.some((t) => t === POLITICAL_NOTES.refusals),
      "VERBATIM. The prose is published beside the arithmetic that produced it, " +
      "so a renderer cannot soften a refusal into a claim by rewording it");
    ok(foot.some((t) => /spouse/.test(t)),
      "including the attribution note, which names the account it will not assume");

    /* The vocabulary ban, over everything the page actually renders rather
       than over the payload alone — a heading or a caption written in this
       file is prose the shaper's suite never sees. */
    const body = await page.textContent("body");
    const BAN = /\b(returns?|outperform|track record|profits?|gains|alpha|insider|tipped|front-?run)\b/i;
    const hit = BAN.exec(body || "");
    ok(!hit, `the rendered page says "${hit && hit[0]}" — a claim a disclosure ` +
      "cannot support, and the headings and captions in the renderer are not " +
      "covered by the shaper's own scan");
  }

  /* ---------- §9 the pagination verdict, when it is bad ----------- */
  {
    await put("political", { ...payload,
      source: { ...payload.source, pages: 1, paginated: false } });
    const p2 = await browser.newPage();
    await p2.context().addCookies([{ name: "flows_session", value: token, url: server.baseURL }]);
    await p2.goto(url("/flows/political/"), { waitUntil: "networkidle" });
    await p2.waitForSelector("#plBuyers tbody tr");
    const hidden = await p2.evaluate(() => document.getElementById("plSource").hidden);
    eq(hidden, false,
      "A VENDOR THAT IGNORED `page` IS SAID ON THE PAGE. Summing repeated pages " +
      "would inflate every total by the page count while every internal check " +
      "still passed, so the walk keeps one page — and the reader is told the " +
      "ranking is over the narrower population rather than left to assume it");
    const text = await p2.textContent("#plSource");
    ok(/one page deep/.test(text || ""), "in words, not as a status code");
    await p2.close();
  }

  /* ---------- §10 the three silences, three sentences ------------- */
  {
    await put("political", {
      ...payload,
      buyers: { status: "unavailable", reason: "HTTP 500" },
      assets: { status: "quiet", rows: [], seen: 0, cap: 25, shed: 0 },
      holders: undefined,
    });
    const p3 = await browser.newPage();
    await p3.context().addCookies([{ name: "flows_session", value: token, url: server.baseURL }]);
    await p3.goto(url("/flows/political/"), { waitUntil: "networkidle" });
    await p3.waitForSelector("#plRecent tbody tr");
    const kinds = await p3.evaluate(() => ({
      buyers: document.querySelector("#plBuyers [data-empty]")?.getAttribute("data-empty"),
      assets: document.querySelector("#plAssets [data-empty]")?.getAttribute("data-empty"),
      holders: document.querySelector("#plHolders [data-empty]")?.getAttribute("data-empty"),
      buyersText: document.querySelector("#plBuyers [data-empty]")?.textContent,
      holdersText: document.querySelector("#plHolders [data-empty]")?.textContent,
    }));
    eq(kinds.buyers, "unavailable", "a failed feed is tagged unavailable");
    eq(kinds.assets, "quiet", "a feed that answered with nothing is tagged quiet");
    eq(kinds.holders, "absent", "and a feed the payload never carried is tagged absent");
    ok(/HTTP 500/.test(kinds.buyersText || ""),
      "the unavailable sentence carries the reason it was handed");
    ok(/about the request, not about/.test(kinds.buyersText || ""),
      "AND SAYS WHOSE FAULT IT IS. 'The vendor did not answer' and 'nobody " +
      "disclosed anything' are the same blank space and opposite facts");
    ok(/has not been published yet/.test(kinds.holdersText || ""),
      "while an absent feed is a fact about this deployment, not about the vendor");
    ok(!(await p3.textContent("body")).includes("undefined"),
      "and no silence leaks the word undefined onto the page");
    await p3.close();
  }

  /* ---------- §11 the phone --------------------------------------- */
  {
    await put("political", payload);
    const p4 = await browser.newPage({ viewport: { width: 320, height: 900 } });
    await p4.context().addCookies([{ name: "flows_session", value: token, url: server.baseURL }]);
    await p4.goto(url("/flows/political/"), { waitUntil: "networkidle" });
    await p4.waitForSelector("#plBuyers tbody tr");
    const over = await p4.evaluate(() =>
      document.documentElement.scrollWidth - window.innerWidth);
    ok(over <= 1,
      `the page overflows nothing at 320px (over by ${over}px) — the tables scroll ` +
      "inside their own wrappers, which is the repository's tested invariant");
    await p4.close();
  }

  await page.close();
} finally {
  await browser.close();
  await server.stop();
}

console.log(`✓ flows-political-render: ${checks} assertions — a midpoint bar that ends inside ` +
  `its own whisker on a shared axis, overlapping neighbours counted rather than warned about, ` +
  `an open band's held-back floor published as a number, the filing's own word for a gift, a ` +
  `late mark that is not carried by hue alone, a holder table with no currency mark anywhere ` +
  `in it, the width of the read in the status line, a vendor that ignored pagination said out ` +
  `loud, three silences in three sentences, and nothing overflowing at 320px`);
