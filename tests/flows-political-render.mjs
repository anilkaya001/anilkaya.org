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
    status: "ok", seen: 9, cap: 25, shed: 6, basis: "band midpoint: stated convention",
    rows: [
      { who: "Ada Reyes", id: "p1", memberType: "senate", bought: 10_000_000,
        boughtLo: 9_000_000, boughtHi: 12_000_000, sold: 250_000, buys: 14, sells: 2,
        boughtListed: 10_000_000, boughtOther: 0, buysListed: 14, buysOther: 0,
        names: 9, medianLagDays: 38, openBands: 0, openFloor: 0, unclassified: 0,
        ownerKnown: 14, selfFiled: 9, freshBuys: 2 },
      { who: "Ben Osei", id: "p2", memberType: "house", bought: 9_500_000,
        boughtLo: 8_000_000, boughtHi: 11_000_000, sold: 0, buys: 11, sells: 0,
        boughtListed: 9_500_000, boughtOther: 0, buysListed: 11, buysOther: 0,
        names: 7, medianLagDays: 61, openBands: 0, openFloor: 0, unclassified: 0,
        ownerKnown: 11, selfFiled: 4, freshBuys: 0 },
      /* THE UNTICKERED FILER. Every one of Cara's disclosures is a Treasury
         bill or a fund: real disclosed size, and no listed security anywhere
         in it. The old renderer printed "0" in the Names column beside $1.2M,
         which reads as a filer who bought nothing identifiable. */
      { who: "Cara Lindqvist", id: "p3", memberType: "house", bought: 1_200_000,
        boughtLo: 900_000, boughtHi: 1_500_000, sold: 0, buys: 3, sells: 0,
        boughtListed: 0, boughtOther: 1_200_000, buysListed: 0, buysOther: 3,
        names: null, medianLagDays: 96, openBands: 1, openFloor: 50_000_000,
        unclassified: 0, ownerKnown: 0, selfFiled: null, freshBuys: 0 },
    ],
  },
  assets: {
    status: "ok", seen: 12, cap: 25, shed: 0, basis: "band midpoint: stated convention",
    rows: [
      { t: "NVDA", asset: "NVIDIA Corporation", bought: 8_000_000, boughtLo: 6_000_000,
        boughtHi: 10_000_000, sold: 100_000, buys: 9, sells: 1, filers: 6,
        medianLagDays: 44, openBands: 0, openFloor: 0,
        ownerKnown: 9, selfFiled: 5, freshBuys: 1 },
      { t: "PFE", asset: "Pfizer Inc", bought: 1_000_000, boughtLo: 800_000,
        boughtHi: 1_300_000, sold: 0, buys: 2, sells: 0, filers: 2,
        medianLagDays: 51, openBands: 0, openFloor: 0,
        ownerKnown: 2, selfFiled: 0, freshBuys: 0 },
    ],
  },
  recent: {
    status: "ok", seen: 4, cap: 60, shed: 0,
    rows: [
      { who: "Ada Reyes", t: "NVDA", txnType: "Purchase", side: "buy",
        lo: 15_001, hi: 50_000, mid: 32_500.5, executedBy: "spouse",
        notes: "NVIDIA Corporation - Common Stock (NVDA) [ST]",
        txnDate: "2026-08-01", filedDate: "2026-08-30", lagDays: 29 },
      /* NO EXECUTING ACCOUNT ON THE WIRE. Absent is not "self", and the cell
         must say so rather than leaving the reader to assume the member. */
      { who: "Ben Osei", t: "PFE", txnType: "Receive", side: null,
        lo: 1_000, hi: 15_000, mid: 8_000, executedBy: null,
        txnDate: "2026-05-20", filedDate: "2026-08-20", lagDays: 92 },
      { who: "Cara Lindqvist", t: "AAPL", txnType: "Sale (Partial)", side: "sell",
        lo: 50_001, hi: 100_000, mid: 75_000.5,
        txnDate: "2026-07-01", filedDate: "2026-08-15", lagDays: 45 },
      { who: "Dev Patel", t: "MSFT", txnType: "Purchase", side: "buy",
        lo: 50_000_000, hi: null, mid: null,
        txnDate: "2026-06-01", filedDate: "2026-08-10", lagDays: 70 },
      /* THE DOTTED SYMBOL, WHICH IS THE WHOLE REASON cardKey() EXISTS.

         The disclosure feed spells this name "BRK.B" and the card store keys
         it "BRKB", so a link built from the symbol as filed 404s on exactly
         the largest names. `carded` below lists BRKB and no fixture row
         carried a dot until this one — the normalisation was argued for in a
         comment, asserted in a caption, and reachable by no test in the
         suite. Seated LAST so every index the assertions above use is
         unchanged. */
      { who: "Eve Nakamura", t: "BRK.B", txnType: "Purchase", side: "buy",
        lo: 15_001, hi: 50_000, mid: 32_500.5, executedBy: "self",
        txnDate: "2026-06-01", filedDate: "2026-08-05", lagDays: 65 },
    ],
  },
  /* THE BREADTH ORDERING, AND IT DISAGREES WITH THE SIZE ORDERING ON PURPOSE.
     SPCX is third by dollars and first by filers; a block that merely re-sorted
     the size ranking would put NVDA on top and prove nothing. */
  clusters: {
    status: "ok", seen: 2, cap: 25, shed: 0, minFilers: 3, namesSeen: 4,
    basis: "ordered by the number of DISTINCT filers who disclosed a purchase, then by " +
      "median disclosure lag, then by summed midpoint. No weighting is applied and no " +
      "composite is computed: each key breaks ties in the one before it.",
    rows: [
      { t: "SPCX", asset: "Spectral Systems", bought: 156_002, boughtLo: 120_000,
        boughtHi: 190_000, sold: 0, buys: 5, sells: 0, filers: 5, medianLagDays: 24,
        openBands: 0, openFloor: 0, ownerKnown: 5, selfFiled: 5, freshBuys: 3 },
      { t: "NVDA", asset: "NVIDIA Corporation", bought: 8_000_000, boughtLo: 6_000_000,
        boughtHi: 10_000_000, sold: 100_000, buys: 9, sells: 1, filers: 6,
        medianLagDays: 44, openBands: 0, openFloor: 0,
        ownerKnown: 9, selfFiled: 5, freshBuys: 1 },
    ],
  },
  latestFiled: "2026-08-30",
  freshFilings: 1,
  /* The names a detail card exists for, as the pipeline publishes them. BRK.B
     is deliberately absent from the ranking and BRKB present here: the set is
     keyed the way the card store keys it, and the renderer must normalise the
     filed symbol before it looks anything up. */
  carded: ["NVDA", "BRKB"],
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
    ok(/1 of the 2 comparable neighbouring pairs have overlapping bands/.test(note || ""),
      "and the note COUNTS the neighbours the ranking cannot separate, rather " +
      `than warning in general terms — got: ${JSON.stringify(note)}`);
    ok(/comparable/.test(note || ""),
      "over a denominator of COMPARABLE pairs — a proportion whose denominator " +
      "counts pairs it could not measure is not a proportion of anything");
    ok(/Top 3 of 9 filers in the window/.test(note || "")
      && /6 ranked below the cut/.test(note || ""),
      "with what the cap kept and what it dropped — and the count is of the rows " +
      "ACTUALLY DRAWN rather than of the cap, since a note reading 'top 25' above " +
      `three rows describes a page nobody is looking at — got: ${JSON.stringify(note)}`);
  }

  /* ---------- §2b a pair that cannot be compared is not counted --- */
  {
    /* Cara's high is absent, so neither the Ben/Cara pair nor any pair using
       her bounds can be tested for overlap. Such a pair must fall out of BOTH
       the numerator and the denominator: counting it as "not overlapping"
       would report the ranking as better separated than it was measured to
       be, which is the flattering direction and therefore the dangerous one. */
    await put("political", { ...payload, buyers: { ...payload.buyers,
      rows: payload.buyers.rows.map((r, i) =>
        (i === 2 ? { ...r, boughtHi: null } : r)) } });
    const p = await browser.newPage();
    await p.context().addCookies([{ name: "flows_session", value: token, url: server.baseURL }]);
    await p.goto(url("/flows/political/"), { waitUntil: "networkidle" });
    await p.waitForSelector("#plBuyers tbody tr");
    const note = await p.textContent("#plBuyersNote");
    ok(/1 of the 1 comparable neighbouring pairs/.test(note || ""),
      "THE DENOMINATOR DROPS TO ONE. Three rows make two neighbouring pairs, " +
      "but the row with no stated high cannot be compared to its neighbour, so " +
      "only one pair was measured and the note says one — not '1 of 2', which " +
      `would credit the ranking with a separation nobody checked — got: ${JSON.stringify(note)}`);
    await p.close();
    await put("political", payload);
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
          /* THE ACCOUNT COLUMN SITS BETWEEN THE FILER AND THE NAME, so the
             disclosed range is the eighth cell and no longer the seventh. */
          account: cells[4], accountClass: tr.children[4].className,
          band: cells[7],
        };
      }));
    ok(/2026-08-30$/.test(rows[0].filed), "newest disclosure first, as published");
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

  /* ---------- §5b the account, the split and the new-today mark --- */
  {
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll("#plRecent tbody tr")].map((tr) => ({
        filed: tr.children[0].textContent,
        freshMark: !!tr.querySelector(".pl-fresh"),
        account: tr.children[4].textContent,
        accountClass: tr.children[4].className,
        asset: (tr.querySelector(".pl-asset") || {}).textContent || null,
        link: (tr.querySelector(".pl-tick") || {}).tagName || null,
        href: (tr.querySelector(".pl-tick") || {}).getAttribute
          ? tr.querySelector(".pl-tick").getAttribute("href") : null,
      })));

    /* THE VENDOR'S `issuer` IS THE ACCOUNT, AND IT NOW HAS A COLUMN.
       It used to be printed under the ticker as if it were the company, so
       the live page read "BE / spouse" and "FWONK / child". */
    eq(rows[0].account, "spouse",
      "the executing account is drawn in its own column, not under the ticker where a " +
      "company name belongs");
    eq(rows[1].account, "not stated",
      "and a filing the vendor sent no account for says so — absent is not 'self'");
    ok(/is-unknown/.test(rows[1].accountClass),
      "carrying the same unknown treatment the holders table gives the same missing fact");
    ok(!/is-unknown/.test(rows[0].accountClass),
      "while a stated account does not");

    /* THE SECURITY'S DESCRIPTION, from the field that carries one. On the
       congress spelling it arrives in `notes` and was shaped and discarded. */
    ok(/NVIDIA/.test(rows[0].asset || ""),
      "the company description reaches the page from the filing that carried it");

    /* NEW SINCE YESTERDAY, IN A GLYPH AND A POSITION. */
    eq(rows[0].freshMark, true, "the filing on the window's newest date carries the mark");
    eq(rows[1].freshMark, false, "an older filing does not");
    ok(/^◆/.test(rows[0].filed),
      "and the mark leads the date cell — a fixed position, so it survives greyscale " +
      "and a monochrome printout where a tint would not");

    /* THE LINK EXISTS EXACTLY WHERE THE PAYLOAD SAYS A CARD DOES. */
    eq(rows[0].link, "A", "a name the payload lists as carded is a link");
    eq(rows[0].href, "/flows/ticker/?t=NVDA", "to that name's card");
    eq(rows[2].link, "SPAN", "and a name it does not list is plain text, not a hopeful link");

    /* THE DOT, WHICH IS WHAT THE NORMALISATION IS FOR. `carded` lists BRKB
       and the filing spells it BRK.B; a lookup on the filed spelling misses,
       and a link built on the filed spelling 404s. Both halves — the
       membership test and the href — go through one function so they cannot
       disagree, and this is the row that proves it. */
    eq(rows[4].link, "A",
      "a dotted symbol resolves against the carded list once it is normalised the way " +
      "the card store keys it");
    eq(rows[4].href, "/flows/ticker/?t=BRKB",
      "and the href is built from the SAME normalisation, so the test that found the " +
      "card and the link that opens it can never spell the name differently");

    const buyers = await page.evaluate(() =>
      [...document.querySelectorAll("#plBuyers tbody tr")].map((tr) => ({
        other: tr.children[6].textContent,
        otherTitle: tr.children[6].getAttribute("title"),
        names: tr.children[8].textContent,
        namesTitle: tr.children[8].getAttribute("title"),
        fresh: !!tr.querySelector(".pl-fresh"),
      })));
    /* THE CONFIDENT ZERO THIS COLUMN EXISTED TO PUBLISH. Cara's whole
       disclosure is Treasury bills: $1.2M of real disclosed size naming no
       listed security, printed for months as "0 names". */
    eq(buyers[2].names, "—",
      "a filer whose disclosures named no listed security gets an em dash, never a 0 — " +
      "'bought nothing identifiable' is not what the filings say");
    ok(/not a count of zero/.test(buyers[2].namesTitle || ""),
      "and the cell says which of the two it means");
    eq(buyers[0].names, "9", "while a filer who named nine keeps the count");
    ok(/\$1\.2M/.test(buyers[2].other),
      "the size that named no listed security is drawn beside the total that contains it");
    ok(/Treasury bills/.test(buyers[2].otherTitle || ""),
      "with the reason on the cell");
    eq(buyers[0].other, "—",
      "and a filer whose every purchase named a security gets a dash there instead");
    ok(/named a listed security/.test(buyers[0].otherTitle || ""),
      "whose title says the dash means none rather than unmeasured");
    eq(buyers[0].fresh, true, "the filer with purchases on the newest date is marked");
    eq(buyers[1].fresh, false, "and one without them is not");

    const buyersNote = await page.evaluate(() =>
      document.getElementById("plBuyersNote").textContent);
    ok(/13 of the 25 filings that state an executing account are the filer’s own/.test(buyersNote),
      "THE SELF-FILED SHARE, WHICH THE ATTRIBUTION NOTE HAS PROMISED SINCE THIS MODULE " +
      "SHIPPED and only the holders block delivered — got: " + buyersNote);
    ok(/named no listed security/.test(buyersNote),
      "and the panel says how much of its ranked size the assets panel cannot show");
    ok(/2026-08-30/.test(buyersNote),
      "and names the date the new-today mark refers to rather than saying 'today'");
  }

  /* ---------- §5c breadth, ordered against size ------------------- */
  {
    const cl = await page.evaluate(() => {
      const box = document.querySelector(".pl-clusters");
      if (!box) return null;
      return {
        rows: [...box.querySelectorAll("tbody tr")].map((tr) => ({
          name: tr.querySelector(".pl-tick").textContent,
          filers: tr.children[2].textContent,
          mid: tr.children[4].textContent,
        })),
        caption: box.querySelector("caption").textContent,
        note: box.querySelector(".fc-note").textContent,
      };
    });
    ok(cl, "the breadth block is drawn beside the size ranking, not in place of it");
    /* THE TWO ORDERS DISAGREE, WHICH IS THE ENTIRE POINT. NVDA is eight
       million dollars and SPCX is a hundred and fifty thousand; five separate
       filers converged on the smaller one, and the size ranking buries it. */
    eq(cl.rows[0].name, "SPCX",
      "the name with the most separate filers leads, though it is the smallest by dollars");
    eq(cl.rows[0].filers, "5", "with its filer count drawn as a column, not a hover");
    ok(/\$8\.0M/.test(cl.rows[1].mid) && /\$156K/.test(cl.rows[0].mid),
      "and the sizes are shown, so a reader can see the order is not by them");
    ok(/DISTINCT filers/.test(cl.caption),
      "the caption names the key rather than leaving the ordering to be inferred");
    ok(/breaks ties in the one before it/.test(cl.note),
      "and states that nothing here is a weighted composite");
    ok(/floor is 3 separate filers/.test(cl.note),
      "with the floor named, so 'no clusters' can be read against the threshold that " +
      "produced it");
  }

  /* ---------- §5d a quoted number is still a number ---------------- */
  {
    /* THE STRING PATH NEITHER POLITICAL SUITE WALKED. Both fixtures in this
       repository are JS object literals, so every number in them arrives
       already typed and this renderer's isNum() is never handed anything
       else. The live feed is JSON from a vendor that QUOTES several of these
       fields, and the strict form the function used to carry — `typeof v ===
       "number" && isFinite(v)` — answered null for every quoted one: a reading
       that was present in the payload printed as an em dash, which is this
       page's word for something the filings do not say. flows-panels.js:56-70
       diagnosed exactly this divergence after it shipped — "one payload field
       rendered as a value on the board and as an em dash in the card panel,
       for the same card, in the same session" — and shared/flows-market.js's
       numOrNull coerces the same way on the payload side, so the strict copy
       here was the one surface in the product holding a narrower contract
       than every other one.

       Ada's row is re-sent with its total, its filing count and its median
       lag quoted the way the vendor sends them. Ben's keeps two fields
       genuinely absent, so what this fixture proves is the COERCION and not
       merely that a table drew something. */
    await put("political", { ...payload, buyers: { ...payload.buyers, rows: [
      { ...payload.buyers.rows[0], bought: "10000000", boughtLo: "9000000",
        boughtHi: "12000000", buys: "14", medianLagDays: "38" },
      /* AND AN EMPTY STRING IS STILL NOT A ZERO. `Number("")` is 0, so a
         coercion that does not exclude it turns a field the vendor left blank
         into a disclosed sale of $0 — the confident zero the strict form was
         right to be afraid of, and the reason the guard runs before Number()
         rather than the fix being a plain call to it. */
      { ...payload.buyers.rows[1], sells: 2, sold: "", medianLagDays: null },
      payload.buyers.rows[2],
    ] } });
    const p9 = await browser.newPage();
    await p9.context().addCookies([{ name: "flows_session", value: token, url: server.baseURL }]);
    await p9.goto(url("/flows/political/"), { waitUntil: "networkidle" });
    await p9.waitForSelector("#plBuyers tbody tr");
    const quoted = await p9.evaluate(() =>
      [...document.querySelectorAll("#plBuyers tbody tr")].map((tr) => ({
        mid: tr.children[3].textContent,
        filings: tr.children[7].textContent,
        lag: tr.children[9].textContent,
        sold: tr.children[10].textContent,
      })));
    eq(quoted[0].mid, "$10.0M",
      "A QUOTED TOTAL IS FORMATTED AS MONEY. The vendor sends this figure as the " +
      "string \"10000000\", and the strict form read it as no reading at all and " +
      "printed the em dash this page reserves for what the filings do not state — " +
      "the harm running the opposite way from the zero the strictness guarded against");
    eq(quoted[0].filings, "14",
      "and a quoted count is drawn as the count, rather than as a dash beside a " +
      "total it is the population of");
    eq(quoted[0].lag, "38d",
      "and a quoted median lag keeps its unit, so the column that says how late " +
      "these filings were still says it");
    eq(quoted[1].lag, "—",
      "while a row that genuinely states no lag still prints the em dash — the " +
      "coercion widened what counts as a reading, it did not invent one");
    eq(quoted[1].sold, "—",
      "and a field the vendor sent as an empty string reads as absent rather than " +
      "as a disclosed sale of $0, which is what Number(\"\") on its own makes it");
    await p9.close();
    await put("political", payload);
  }

  /* ---------- §8 the notes reach the page, one paragraph each ----- */
  {
    const foot = await page.evaluate(() =>
      [...document.querySelectorAll("#plFoot .flows-foot-p")].map((p) => p.textContent));
    eq(foot.length, 8, "all eight published notes are drawn, one paragraph each");
    ok(foot.some((t) => t === POLITICAL_NOTES.refusals),
      "VERBATIM. The prose is published beside the arithmetic that produced it, " +
      "so a renderer cannot soften a refusal into a claim by rewording it");
    ok(foot.some((t) => /spouse/.test(t)),
      "including the attribution note, which names the account it will not assume");

    /* The vocabulary ban, over everything THIS PAGE renders rather than over
       the payload alone — a heading or a caption written in the renderer is
       prose the shaper's suite never sees.

       SCOPED PAST THE RAIL, and the first run is why. The rail links to
       /flows/history/ under the label "Track record", which tripped this ban
       on every page it appears on. That page measures whether the board's own
       published rankings went on to be right, which is a record it HAS the
       sessions to compute — the phrase is banned here because a disclosure
       has no closing print, not because the words are unsayable on the site.
       A ban that reached into shared chrome would be pressure to rename
       another page's honest heading. */
    const body = await page.evaluate(() => {
      const main = document.querySelector(".flows-main") || document.body;
      return [...main.children]
        .filter((n) => !n.classList.contains("flows-rail") && !n.querySelector(".flows-rail"))
        .map((n) => n.textContent).join(" ");
    });
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

    /* AND A THIN WEEK IS NOT AN ACCUSATION. `paginated: null` means one page
       answered the whole window, which is the ordinary case and says nothing
       about the vendor. This shipped as `false` — the pipeline set it from
       `pagesRead > 1` on a short first page — so an ordinary window under 200
       filings would have printed "the vendor returned the same page twice"
       about a vendor that did exactly what it was asked. */
    await put("political", { ...payload,
      source: { ...payload.source, pages: 1, paginated: null } });
    const p2b = await browser.newPage();
    await p2b.context().addCookies([{ name: "flows_session", value: token, url: server.baseURL }]);
    await p2b.goto(url("/flows/political/"), { waitUntil: "networkidle" });
    await p2b.waitForSelector("#plBuyers tbody tr");
    eq(await p2b.evaluate(() => document.getElementById("plSource").hidden), true,
      "one page that answered the whole window raises NO banner — null and false " +
      "are different facts about the vendor, and only one of them is a complaint");
    ok(/1 page/.test(await p2b.textContent("#plStatus")),
      "while the status line still reports how wide the read was");
    await p2b.close();
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

    /* THE BREADTH BLOCK OUTLIVES THE SIZE RANKING'S SILENCE. It used to be
       painted at the tail of paintAssets, after an early return on exactly
       this state — so the block that reports convergence vanished whenever
       the panel it sits under had nothing to rank, and its own unavailable
       branch could not be reached by any payload the pipeline can build. */
    const clustersUnderQuiet = await p3.evaluate(() =>
      [...document.querySelectorAll(".pl-clusters tbody tr .pl-tick")].map((n) => n.textContent));
    eq(clustersUnderQuiet[0], "SPCX",
      "the breadth block is drawn even when the size ranking beside it is quiet — the two " +
      "read the same feed and answer different questions about it");
    await p3.close();
  }

  /* ---------- §10b the breadth block's own two silences ----------- */
  {
    /* THE UNAVAILABLE BRANCH, REACHED FOR THE FIRST TIME. buildPolitical marks
       assets and clusters unavailable together, so this state is exactly what
       a failed feed produces — and until the block was hoisted above the size
       panel's early return, nothing could draw it. */
    await put("political", {
      ...payload,
      assets: { status: "unavailable", reason: "HTTP 502" },
      clusters: { status: "unavailable", reason: "HTTP 502" },
    });
    const p5 = await browser.newPage();
    await p5.context().addCookies([{ name: "flows_session", value: token, url: server.baseURL }]);
    await p5.goto(url("/flows/political/"), { waitUntil: "networkidle" });
    await p5.waitForSelector("#plBuyers tbody tr");
    const gone = await p5.evaluate(() => {
      const q = document.querySelector(".pl-clusters [data-empty]");
      return q ? { kind: q.getAttribute("data-empty"), text: q.textContent } : null;
    });
    ok(gone, "a breadth feed the vendor did not answer for still draws its own block");
    eq(gone.kind, "unavailable", "tagged unavailable rather than quiet");
    ok(/HTTP 502/.test(gone.text || ""), "carrying the reason it was handed");
    await p5.close();

    /* AND A PAYLOAD THAT STATES NO FLOOR IS NOT GIVEN ONE. The quiet sentence
       and the note under the table both used to print `minFilers || 3` — a
       renderer asserting a constant the shaper owns, which is how two
       spellings of one number drift apart. */
    await put("political", {
      ...payload,
      clusters: { status: "quiet", rows: [], seen: 0, cap: 25, shed: 0 },
    });
    const p6 = await browser.newPage();
    await p6.context().addCookies([{ name: "flows_session", value: token, url: server.baseURL }]);
    await p6.goto(url("/flows/political/"), { waitUntil: "networkidle" });
    await p6.waitForSelector("#plBuyers tbody tr");
    const quiet = await p6.textContent(".pl-clusters [data-empty]");
    ok(/does not state what that floor was/.test(quiet || ""),
      "a payload carrying no floor gets a sentence that names none — got: " + quiet);
    ok(!/from 3 or more/.test(quiet || ""),
      "and specifically not the literal 3 the renderer used to supply for it");
    await p6.close();

    /* WHILE A STATED FLOOR IS STILL PRINTED, so the fix did not trade one
       silence for a permanently vaguer sentence. */
    await put("political", {
      ...payload,
      clusters: { status: "quiet", rows: [], seen: 0, cap: 25, shed: 0,
                  minFilers: 4, namesSeen: 11 },
    });
    const p7 = await browser.newPage();
    await p7.context().addCookies([{ name: "flows_session", value: token, url: server.baseURL }]);
    await p7.goto(url("/flows/political/"), { waitUntil: "networkidle" });
    await p7.waitForSelector("#plBuyers tbody tr");
    const stated = await p7.textContent(".pl-clusters [data-empty]");
    ok(/from 4 or more separate filers/.test(stated || ""),
      "THE PAYLOAD'S OWN NUMBER, not the renderer's — a shaper that moves its floor to " +
      "4 moves this sentence with it, which is the property the literal destroyed");
    ok(/across the 11 names that drew any/.test(stated || ""),
      "with the population the floor was applied to beside it");
    await p7.close();
  }

  /* ---------- §10c the three sentences that were one ------------- */
  {
    /* A PAYLOAD PUBLISHED BEFORE THE ACCOUNT COUNTER SHIPPED. A missing key
       and a counted zero both leave a running total at 0, and the note read
       both as "the vendor stated an account on none of these filings" — a
       claim about the vendor built from a field the vendor was never asked
       for, which is what the page would have said on the morning after this
       deploy while last night's payload was still the one being served. */
    const stripped = (rows) => rows.map((r) => {
      const o = { ...r };
      delete o.ownerKnown; delete o.selfFiled; delete o.freshBuys;
      return o;
    });
    await put("political", {
      ...payload,
      buyers: { ...payload.buyers, rows: stripped(payload.buyers.rows) },
      /* The newest filing is AFTER the last completed session, which is the
         ordinary case on any morning something is actually filed — and the
         sentence used to call it "before". */
      latestFiled: "2026-09-01",
    });
    const p8 = await browser.newPage();
    await p8.context().addCookies([{ name: "flows_session", value: token, url: server.baseURL }]);
    await p8.goto(url("/flows/political/"), { waitUntil: "networkidle" });
    await p8.waitForSelector("#plBuyers tbody tr");
    const note = await p8.textContent("#plBuyersNote");
    ok(/does not carry the executing account/.test(note || ""),
      "a payload without the counter says the field is missing — got: " + note);
    ok(!/stated an executing account on none/.test(note || ""),
      "and does not turn that absence into a statement about what the vendor sent");

    /* AND NOTHING DRAWN CARRIES THE NEWEST DATE, so the legend does not
       introduce a glyph the reader will hunt for and never find. */
    ok(/no row drawn here carries it/.test(note || ""),
      "with the mark's legend replaced by the fact that nothing is marked");
    ok(/after the last completed session on 2026-08-31/.test(note || ""),
      "AND THE DATE IS PLACED CORRECTLY AGAINST THE SESSION. 2026-09-01 is after " +
      "2026-08-31, and the note said 'before' for every date that merely differed");
    ok(!/before the last completed session/.test(note || ""),
      "so the sentence is not the one it used to print regardless of direction");
    await p8.close();
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
  `in it, an executing account in its own column where a company name used to sit, an em ` +
  `dash where a filer named no listed security, a new-today mark carried by a glyph in a ` +
  `fixed position, a card link built from the payload's own list of carded names with the ` +
  `symbol normalised before the lookup, a breadth block whose first row is third by ` +
  `dollars, the width of the read in the status line, a vendor that ignored pagination said out ` +
  `loud, three silences in three sentences, a breadth block that draws its own silence rather than vanishing with the panel above it, a floor printed from the payload and never from a literal, an account share that says "not published" rather than "none stated", a newest filing placed AFTER the session it is after, a number the vendor quoted formatted rather than dashed while an empty string stays a dash, and nothing overflowing at 320px`);
