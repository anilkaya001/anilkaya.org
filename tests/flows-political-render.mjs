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

      { who: "Ben Osei", t: "PFE", txnType: "Receive", side: null,
        lo: 1_000, hi: 15_000, mid: 8_000, executedBy: null,
        txnDate: "2026-05-20", filedDate: "2026-08-20", lagDays: 92 },
      { who: "Cara Lindqvist", t: "AAPL", txnType: "Sale (Partial)", side: "sell",
        lo: 50_001, hi: 100_000, mid: 75_000.5,
        txnDate: "2026-07-01", filedDate: "2026-08-15", lagDays: 45 },
      { who: "Dev Patel", t: "MSFT", txnType: "Purchase", side: "buy",
        lo: 50_000_000, hi: null, mid: null,
        txnDate: "2026-06-01", filedDate: "2026-08-10", lagDays: 70 },

      { who: "Eve Nakamura", t: "BRK.B", txnType: "Purchase", side: "buy",
        lo: 15_001, hi: 50_000, mid: 32_500.5, executedBy: "self",
        txnDate: "2026-06-01", filedDate: "2026-08-05", lagDays: 65 },
    ],
  },

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
const open = async (opts = {}) => {
  const page = await browser.newPage({ reducedMotion: "reduce", ...opts });
  await page.context().addCookies([{ name: "flows_session", value: token, url: server.baseURL }]);
  await page.goto(url("/flows/political/"), { waitUntil: "networkidle" });
  await page.waitForFunction(() => !/^Loading/.test(document.getElementById("plStatus").textContent));
  return page;
};
const disclose = (page, selector) => page.evaluate(async (sel) => {
  const b = document.querySelector(sel);
  if (!b) return null;
  b.click();
  await new Promise((r) => setTimeout(r, 30));
  const text = document.getElementById("fxPop") ? document.getElementById("fxPop").textContent : null;
  window.FlowsUI.closeInfo();
  return text;
}, selector);
const info = (page, card) => disclose(page, "#" + card + " .ui-mod-h > .ui-info");
const breadth = (page) => page.evaluate(() => {
  const b = [...document.querySelectorAll("#plAssetsCard .ui-seg-i")].find((x) => x.textContent === "Breadth");
  if (b) b.click();
  return !!b;
});
const ROWS = (host, kind) => `#${host} .pl-row.${kind}:not(.fu-head)`;

try {

  {
    const anon = await fetch(url("/api/flows/political"), { redirect: "manual" });
    eq(anon.status, 401, "the disclosure feed needs a session like every other flows API");
    const pending = await (await fetch(url("/api/flows/political"), { headers: auth })).json();
    eq(pending.status, "pending", "an unpublished window reports pending, not an error");

    const page = await open();
    const text = await page.textContent("#plStatus");
    ok(/no disclosure window has been read yet/i.test(text || ""),
      "and the page says so as a fact about the store rather than drawing an empty ranking");
    const drawn = await page.evaluate(() => ({
      rows: document.querySelectorAll(".pl-row:not(.fu-head)").length,
      states: [...document.querySelectorAll(".fd-mod")].map((m) => m.dataset.state),
    }));
    eq(drawn.rows, 0, "with no ledger row drawn at all, rather than rows full of dashes");
    ok(drawn.states.length === 4 && drawn.states.every((s) => s === "pending"),
      `and every module wears the pending ring (${drawn.states.join(", ")}), the one silence that says come back`);

    const warn = await disclose(page, "#plAboutSlot .ui-info");
    ok(/45 days/.test(warn || "") && /disclosed/i.test(warn || ""),
      "and the lag frame is already one tap away on the page, before the first number lands");
    await page.close();
  }

  eq((await put("political", payload)).status, 200,
    "the ingest route accepts the political key — it did not, for one commit");

  const page = await open();
  await page.waitForSelector(ROWS("plBuyers", "pl-buyer"));

  {
    const geo = await page.evaluate((sel) => {
      const out = [];
      for (const row of document.querySelectorAll(sel)) {
        const hostEl = row.querySelector(".pl-bar");
        const fill = row.querySelector(".pl-bar-fill");
        const band = row.querySelector(".pl-bar-band");
        const hb = hostEl.getBoundingClientRect();
        out.push({
          who: row.querySelector(".pl-name").textContent,
          host: hb.width,
          barEnd: fill ? fill.getBoundingClientRect().right - hb.left : null,
          bandStart: band ? band.getBoundingClientRect().left - hb.left : null,
          bandEnd: band ? band.getBoundingClientRect().right - hb.left : null,
        });
      }
      return out;
    }, ROWS("plBuyers", "pl-buyer"));
    eq(geo.length, 3, "one bar per ranked filer");

    const scale = 12_000_000;
    for (const g of geo) {
      const row = payload.buyers.rows.find((r) => r.who === g.who);
      ok(g.host > 40, `${g.who}: the bar host has real width to measure against`);
      near(g.barEnd / g.host, row.bought / scale, 0.02,
        `${g.who}: THE BAR IS THE MIDPOINT ON A SHARED AXIS — its length is that ` +
        "filer's summed midpoint over the largest summed high in the panel, so " +
        "lengths are comparable down the column rather than each row filling itself");
      near(g.bandStart / g.host, row.boughtLo / scale, 0.02,
        `${g.who}: the band starts at the summed LOW on that same axis`);
      near(g.bandEnd / g.host, row.boughtHi / scale, 0.02,
        `${g.who}: and ends at the summed HIGH`);
      ok(g.barEnd >= g.bandStart - 2 && g.barEnd <= g.bandEnd + 2,
        `${g.who}: AND THE BAR ENDS INSIDE ITS OWN BAND. A band drawn on a ` +
        "separate scale would still look like a range while placing the " +
        "midpoint outside the range it is the midpoint of — this is the one " +
        "defect on this page that would render perfectly and mean nothing");
    }

    ok(geo[1].bandEnd > geo[0].bandStart,
      "the top two bands overlap on screen, as the fixture intends");
    const note = await info(page, "plBuyersCard");
    ok(/1 of the 2 comparable neighbouring pairs have overlapping bands/.test(note || ""),
      "and the disclosure COUNTS the neighbours the ranking cannot separate, rather " +
      `than warning in general terms — got: ${JSON.stringify(note)}`);
    ok(/Top 3 of 9 filers in the window/.test(note || "") && /6 ranked below the cut/.test(note || ""),
      "with what the cap kept and what it dropped — and the count is of the rows " +
      `ACTUALLY DRAWN rather than of the cap — got: ${JSON.stringify(note)}`);
    ok(/floor and no ceiling/.test(note || ""),
      "the open-ended bands are named for what makes them unsummable");
    ok(/\$50\.0M/.test(note || ""),
      "AND THE HELD-BACK SIZE IS A NUMBER. $50M of disclosed purchasing sits " +
      `in no bar on the panel — got: ${JSON.stringify(note)}`);
  }

  {
    await put("political", { ...payload, buyers: { ...payload.buyers,
      rows: payload.buyers.rows.map((r, i) => (i === 2 ? { ...r, boughtHi: null } : r)) } });
    const p = await open();
    const note = await info(p, "plBuyersCard");
    ok(/1 of the 1 comparable neighbouring pairs/.test(note || ""),
      "THE DENOMINATOR DROPS TO ONE. Three rows make two neighbouring pairs, " +
      "but the row with no stated high cannot be compared to its neighbour, so " +
      `only one pair was measured and the disclosure says one — got: ${JSON.stringify(note)}`);
    await p.close();
    await put("political", payload);
  }

  {
    const order = await page.evaluate((sel) =>
      [...document.querySelectorAll(sel + " .pl-name")].map((n) => n.textContent), ROWS("plBuyers", "pl-buyer"));
    assert.deepEqual(order, ["Ada Reyes", "Ben Osei", "Cara Lindqvist"],
      "the payload's own order survives the renderer — a re-sort here would be " +
      "a second opinion about a ranking the shaper already took");
    checks++;
    const sold = await page.evaluate((sel) =>
      [...document.querySelectorAll(sel + " .pl-sold")].map((n) => n.textContent), ROWS("plBuyers", "pl-buyer"));
    eq(sold[1], "—",
      "a filer who disclosed no sale gets an em dash, not $0 — nothing sold and " +
      "nothing disclosed are different facts");
  }

  {
    const rows = await page.evaluate((sel) =>
      [...document.querySelectorAll(sel)].map((row) => {
        const side = row.querySelector(".pl-side");
        const lag = row.querySelector(".pl-lagv");
        const filed = row.querySelector(".pl-filed");
        return {
          filed: filed.querySelector("b").dataset.date, freshLeads: !!filed.firstElementChild && filed.firstElementChild.classList.contains("pl-fresh"),
          side: side.textContent, sideClass: side.className,
          lagClass: lag.className, lagTitle: lag.getAttribute("title"),
          lateBar: !!row.querySelector(".pl-lag-b"),
          band: row.querySelector(".pl-band").textContent,
          account: row.querySelector(".pl-owner").textContent, accountClass: row.querySelector(".pl-owner").className,
          asset: (row.querySelector(".pl-asset") || {}).textContent || null,
          link: (row.querySelector(".pl-tick") || {}).tagName || null,
          href: row.querySelector(".pl-tick") ? row.querySelector(".pl-tick").getAttribute("href") : null,
        };
      }), ROWS("plRecent", "pl-recent"));
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
      "with the reason on the mark rather than only in a note");
    ok(rows[1].lateBar, "and its delay bar carries a late segment past the 45-day mark");
    ok(!/pl-late/.test(rows[2].lagClass) && !rows[2].lateBar,
      "and a filing at exactly 45 days is NOT late — the boundary is the " +
      "statute's, not a rounded one, on the number and on the bar alike");
    ok(/over \$50\.0M/i.test(rows[3].band),
      "an open-ended filing reads as 'over' its floor rather than being " +
      "collapsed to a midpoint it does not have");

    eq(rows[0].account, "spouse",
      "the executing account is drawn under the filer, not under the ticker where a company name belongs");
    eq(rows[1].account, "not stated",
      "and a filing the vendor sent no account for says so — absent is not 'self'");
    ok(/is-unknown/.test(rows[1].accountClass),
      "carrying the same unknown treatment the holders ledger gives the same missing fact");
    ok(!/is-unknown/.test(rows[0].accountClass), "while a stated account does not");
    ok(/NVIDIA/.test(rows[0].asset || ""),
      "the company description reaches the page from the filing that carried it");
    ok(rows[0].freshLeads, "the filing on the window's newest date carries the mark, leading its date cell — " +
      "a fixed position, so it survives greyscale where a tint would not");
    eq(rows[1].freshLeads, false, "an older filing does not");
    eq(rows[0].link, "A", "a name the payload lists as carded is a link");
    eq(rows[0].href, "/flows/ticker/?t=NVDA", "to that name's card");
    eq(rows[2].link, "SPAN", "and a name it does not list is plain text, not a hopeful link");
    eq(rows[4].link, "A",
      "a dotted symbol resolves against the carded list once it is normalised the way " +
      "the card store keys it");
    eq(rows[4].href, "/flows/ticker/?t=BRKB",
      "and the href is built from the SAME normalisation, so the test that found the " +
      "card and the link that opens it can never spell the name differently");
  }

  {
    const h = await page.evaluate(() => {
      const box = document.getElementById("plHolders");
      return {
        body: box.textContent,
        owners: [...box.querySelectorAll(".pl-owner")].map((n) => ({ text: n.textContent, cls: n.className })),
      };
    });
    const hn = await info(page, "plHoldersCard");
    ok(!h.body.includes("$"),
      "NO CURRENCY MARK ANYWHERE IN THE HOLDER LEDGER. The vendor describes " +
      "these three numbers as share quantities while every other number on " +
      "this page is dollars; a single dollar sign here restates the units " +
      "defect that produced '1352% of its year'");
    ok(/share quantity/.test(hn || "") && /not dollars/.test(hn || ""),
      "and the unit is printed from the payload's own sentence, not a reworded one");
    eq(h.owners[2].text, "not stated", "a row the vendor sent no owner for says so");
    ok(/is-unknown/.test(h.owners[2].cls),
      "and is marked as unknown rather than rendering as an ordinary value");
    ok(/1 of the 2 holdings with a stated account/.test(hn || ""),
      "the self-filed share is reported over the rows that HAVE an owner, not " +
      `over all of them — got: ${JSON.stringify(hn)}`);
  }

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
    const about = await disclose(page, "#plAboutSlot .ui-info");
    ok((about || "").includes("431 disclosures"), "and the page's own disclosure carries the same sentence");
    eq(await page.evaluate(() => document.getElementById("plSource").hidden), true,
      "and no partial-read pill when pagination answered");
  }

  {
    const buyers = await page.evaluate((sel) =>
      [...document.querySelectorAll(sel)].map((row) => ({
        names: row.dataset.names, other: row.dataset.other, title: row.getAttribute("title") || "",
        fresh: !!row.querySelector(".pl-fresh"),
      })), ROWS("plBuyers", "pl-buyer"));
    eq(buyers[2].names, "—",
      "a filer whose disclosures named no listed security gets an em dash, never a 0 — " +
      "'bought nothing identifiable' is not what the filings say");
    ok(/not a count of zero/.test(buyers[2].title), "and the row's detail says which of the two it means");
    eq(buyers[0].names, "9", "while a filer who named nine keeps the count");
    ok(/\$1\.2M/.test(buyers[2].other),
      "the size that named no listed security is carried beside the total that contains it");
    ok(/Treasury bills/.test(buyers[2].title), "with the reason in the row's detail");
    eq(buyers[0].other, "—", "and a filer whose every purchase named a security gets a dash there instead");
    ok(/named a listed security/.test(buyers[0].title), "whose detail says the dash means none rather than unmeasured");
    eq(buyers[0].fresh, true, "the filer with purchases on the newest date is marked");
    eq(buyers[1].fresh, false, "and one without them is not");

    const buyersNote = await info(page, "plBuyersCard");
    ok(/13 of the 25 filings that state an executing account are the filer’s own/.test(buyersNote),
      "THE SELF-FILED SHARE, WHICH THE ATTRIBUTION NOTE HAS PROMISED SINCE THIS MODULE " +
      "SHIPPED — got: " + buyersNote);
    ok(/named no listed security/.test(buyersNote),
      "and the panel says how much of its ranked size the names ranking cannot show");
    ok(/2026-08-30/.test(buyersNote),
      "and names the date the new mark refers to rather than saying 'today'");
  }

  {
    ok(await breadth(page), "the Names module offers a Breadth view beside Size");
    const cl = await page.evaluate(() => {
      const box = document.querySelector(".pl-clusters");
      if (!box) return null;
      return [...box.querySelectorAll(".pl-row.pl-cluster:not(.fu-head)")].map((row) => ({
        name: row.querySelector(".pl-tick").textContent,
        filers: row.querySelector(".pl-filers").textContent,
        dots: row.querySelectorAll(".pl-dots > i").length,
        mid: row.querySelector(".pl-mid").textContent,
      }));
    });
    ok(cl, "the breadth ordering is drawn beside the size ranking, not in place of it");
    eq(cl[0].name, "SPCX",
      "the name with the most separate filers leads, though it is the smallest by dollars");
    eq(cl[0].filers, "5", "with its filer count drawn as a number, not a hover");
    eq(cl[0].dots, 5, "and as five dots, one per distinct filer");
    ok(/\$8\.0M/.test(cl[1].mid) && /\$156K/.test(cl[0].mid),
      "and the sizes are shown, so a reader can see the order is not by them");
    const note = await info(page, "plAssetsCard");
    ok(/DISTINCT filers/.test(note), "the disclosure names the key rather than leaving the ordering to be inferred");
    ok(/breaks ties in the one before it/.test(note), "and states that nothing here is a weighted composite");
    ok(/floor is 3 separate filers/.test(note),
      "with the floor named, so 'no clusters' can be read against the threshold that produced it");
  }

  {
    await put("political", { ...payload, buyers: { ...payload.buyers, rows: [
      { ...payload.buyers.rows[0], bought: "10000000", boughtLo: "9000000",
        boughtHi: "12000000", buys: "14", medianLagDays: "38" },
      { ...payload.buyers.rows[1], sells: 2, sold: "", medianLagDays: null },
      payload.buyers.rows[2],
    ] } });
    const p9 = await open();
    const quoted = await p9.evaluate((sel) =>
      [...document.querySelectorAll(sel)].map((row) => ({
        mid: row.querySelector(".pl-mid").textContent,
        title: row.getAttribute("title") || "",
        lag: row.querySelector(".pl-lagv").textContent,
        sold: row.querySelector(".pl-sold").textContent,
      })), ROWS("plBuyers", "pl-buyer"));
    eq(quoted[0].mid, "$10.0M",
      "A QUOTED TOTAL IS FORMATTED AS MONEY. The vendor sends this figure as the " +
      "string \"10000000\", and the strict form read it as no reading at all and " +
      "printed the em dash this page reserves for what the filings do not state");
    ok(/\b14 filings\b/.test(quoted[0].title),
      "and a quoted count is carried as the count, rather than as a dash beside a " +
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

  {
    await put("political", { ...payload, filings: "1" });
    const pa = await open();
    const one = (await pa.textContent("#plStatus")) || "";
    ok(/\b1 disclosure\b/.test(one) && !/1 disclosures/.test(one),
      `a vendor-quoted count of "1" is drawn as "1 disclosure" and takes the singular with ` +
      `it (${one.slice(0, 70)})`);
    await pa.close();

    const noCount = { ...payload };
    delete noCount.filings;
    await put("political", noCount);
    const pb = await open();
    const none = (await pb.textContent("#plStatus")) || "";
    ok(!/\b0 disclosures\b/.test(none),
      `a filings key that never arrived does not print "0 disclosures" (${none.slice(0, 70)}) ` +
      "— that is an absence wearing a measurement's clothes");
    ok(/filed between/.test(none),
      "while the window it was filed over is still stated, because those dates DID arrive");
    await pb.close();

    await put("political", { ...payload, buyers: { ...payload.buyers, rows: [
      { ...payload.buyers.rows[0], sells: 2, sold: " " },
      ...payload.buyers.rows.slice(1),
    ] } });
    const pc = await open();
    const blank = await pc.evaluate((sel) => document.querySelector(sel + " .pl-sold").textContent, ROWS("plBuyers", "pl-buyer"));
    eq(blank, "—",
      "and a field the vendor sent as a single space reads as absent rather than as a " +
      "disclosed sale of $0 — Number(\" \") is 0 exactly as Number(\"\") is");
    await pc.close();
    await put("political", payload);
  }

  {
    const about = await disclose(page, "#plAboutSlot .ui-info");
    const notes = Object.values(POLITICAL_NOTES);
    eq(notes.filter((t) => (about || "").includes(t)).length, 8,
      "all eight published notes are carried by the page's own disclosure, each one VERBATIM: the prose " +
      "is published beside the arithmetic that produced it, so a renderer cannot soften a refusal into a " +
      "claim by rewording it");
    ok(/spouse/.test(about || ""), "including the attribution note, which names the account it will not assume");

    const body = await page.evaluate(() => {
      const main = document.querySelector(".flows-main") || document.body;
      return [...main.children].map((n) => n.textContent).join(" ");
    });
    const BAN = /\b(returns?|outperform|track record|profits?|gains|alpha|insider|tipped|front-?run)\b/i;
    const hit = BAN.exec(body || "");
    ok(!hit, `the rendered page says "${hit && hit[0]}" — a claim a disclosure ` +
      "cannot support, and the headings and labels in the renderer are not " +
      "covered by the shaper's own scan");
  }

  {
    await put("political", { ...payload, source: { ...payload.source, pages: 1, paginated: false } });
    const p2 = await open();
    eq(await p2.evaluate(() => document.getElementById("plSource").hidden), false,
      "A VENDOR THAT IGNORED `page` IS SAID ON THE PAGE, as a pill beside the window. Summing " +
      "repeated pages would inflate every total by the page count while every internal check " +
      "still passed, so the walk keeps one page — and the reader is told the ranking is over " +
      "the narrower population rather than left to assume it");
    ok(/one page deep/.test((await disclose(p2, "#plSource")) || ""), "in words, one tap away, not as a status code");
    await p2.close();

    await put("political", { ...payload, source: { ...payload.source, pages: 1, paginated: null } });
    const p2b = await open();
    eq(await p2b.evaluate(() => document.getElementById("plSource").hidden), true,
      "one page that answered the whole window raises NO pill — null and false " +
      "are different facts about the vendor, and only one of them is a complaint");
    ok(/1 page/.test(await p2b.textContent("#plStatus")),
      "while the status still reports how wide the read was");
    await p2b.close();
  }

  {
    await put("political", {
      ...payload,
      buyers: { status: "unavailable", reason: "HTTP 500" },
      assets: { status: "quiet", rows: [], seen: 0, cap: 25, shed: 0 },
      holders: undefined,
    });
    const p3 = await open();
    await p3.waitForSelector(ROWS("plRecent", "pl-recent"));
    const kinds = await p3.evaluate(() => ({
      buyers: document.querySelector("#plBuyers [data-empty]")?.getAttribute("data-empty"),
      assets: document.querySelector("#plAssets [data-empty]")?.getAttribute("data-empty"),
      holders: document.querySelector("#plHolders [data-empty]")?.getAttribute("data-empty"),
      buyersState: document.getElementById("plBuyersCard").dataset.state,
      holdersState: document.getElementById("plHoldersCard").dataset.state,
    }));
    eq(kinds.buyers, "unavailable", "a failed feed is tagged unavailable");
    eq(kinds.assets, "quiet", "a feed that answered with nothing is tagged quiet");
    eq(kinds.holders, "absent", "and a feed the payload never carried is tagged absent");
    eq(kinds.buyersState, "unavailable", "the failed feed's module wears the unavailable glyph");
    eq(kinds.holdersState, "pending", "and the never-carried feed's module the pending ring — it will exist, it has not been published");
    const buyersWhy = await disclose(p3, "#plBuyers .ui-silent button");
    const holdersWhy = await disclose(p3, "#plHolders .ui-silent button");
    ok(/HTTP 500/.test(buyersWhy || ""), "the unavailable reason carries the status it was handed");
    ok(/about the request, not about/.test(buyersWhy || ""),
      "AND SAYS WHOSE FAULT IT IS. 'The vendor did not answer' and 'nobody " +
      "disclosed anything' are the same blank space and opposite facts");
    ok(/has not been published yet/.test(holdersWhy || ""),
      "while an absent feed is a fact about this deployment, not about the vendor");
    ok(!(await p3.textContent("body")).includes("undefined"),
      "and no silence leaks the word undefined onto the page");
    await breadth(p3);
    const clustersUnderQuiet = await p3.evaluate(() =>
      [...document.querySelectorAll(".pl-clusters .pl-row.pl-cluster:not(.fu-head) .pl-tick")].map((n) => n.textContent));
    eq(clustersUnderQuiet[0], "SPCX",
      "the breadth view is drawn even when the size ranking beside it is quiet — the two " +
      "read the same feed and answer different questions about it");
    await p3.close();
  }

  {
    await put("political", { ...payload, holders: { status: "unavailable", reason: "not requested this run: the vendor answered this route with HTTP 422, refused since 2026-09-21, and a refusal that is a property of the plan is not bought again every night — it is asked once more 7 days after 2026-09-21" } });
    const p4 = await open();
    await p4.waitForSelector(ROWS("plRecent", "pl-recent"));
    const refused = await p4.evaluate(() => {
      const card = document.getElementById("plHoldersCard");
      return { hidden: card.hidden, shown: card.getClientRects().length };
    });
    eq(refused.hidden, true,
      "a holdings route the plan refuses (a 4xx other than 408 or 429, the pipeline's own test in holdersRefusal) " +
      "leaves the module out of the page — a permanent unavailable tile is a waiting sign with nothing to wait for");
    eq(refused.shown, 0, "and nothing of it is laid out");
    await p4.close();

    await put("political", { ...payload, holders: { status: "unavailable", reason: "HTTP 503" } });
    const p4b = await open();
    await p4b.waitForSelector("#plHolders [data-empty]");
    const failed = await p4b.evaluate(() => ({
      hidden: document.getElementById("plHoldersCard").hidden,
      kind: document.querySelector("#plHolders [data-empty]").getAttribute("data-empty"),
    }));
    eq(failed.hidden, false, "while a holdings read that FAILED stays on the page");
    eq(failed.kind, "unavailable", "wearing the unavailable silence, because a failure is a fact the reader should see");
    await p4b.close();
  }

  {
    await put("political", { ...payload, assets: { status: "unavailable", reason: "HTTP 502" }, clusters: { status: "unavailable", reason: "HTTP 502" } });
    const p5 = await open();
    await breadth(p5);
    const gone = await p5.evaluate(() => {
      const q = document.querySelector(".pl-clusters [data-empty]");
      return q ? q.getAttribute("data-empty") : null;
    });
    eq(gone, "unavailable", "a breadth feed the vendor did not answer for draws its own unavailable silence");
    ok(/HTTP 502/.test((await disclose(p5, ".pl-clusters .ui-silent button")) || ""), "carrying the reason it was handed");
    await p5.close();

    await put("political", { ...payload, clusters: { status: "quiet", rows: [], seen: 0, cap: 25, shed: 0 } });
    const p6 = await open();
    await breadth(p6);
    const quiet = await disclose(p6, ".pl-clusters .ui-silent button");
    ok(/does not state what that floor was/.test(quiet || ""),
      "a payload carrying no floor gets a sentence that names none — got: " + quiet);
    ok(!/from 3 or more/.test(quiet || ""), "and specifically not the literal 3 the renderer used to supply for it");
    await p6.close();

    await put("political", { ...payload, clusters: { status: "quiet", rows: [], seen: 0, cap: 25, shed: 0, minFilers: 4, namesSeen: 11 } });
    const p7 = await open();
    await breadth(p7);
    const stated = await disclose(p7, ".pl-clusters .ui-silent button");
    ok(/from 4 or more separate filers/.test(stated || ""),
      "THE PAYLOAD'S OWN NUMBER, not the renderer's — a shaper that moves its floor to " +
      "4 moves this sentence with it, which is the property the literal destroyed");
    ok(/across the 11 names that drew any/.test(stated || ""), "with the population the floor was applied to beside it");
    await p7.close();
  }

  {
    const stripped = (rows) => rows.map((r) => {
      const o = { ...r };
      delete o.ownerKnown; delete o.selfFiled; delete o.freshBuys;
      return o;
    });
    await put("political", { ...payload, buyers: { ...payload.buyers, rows: stripped(payload.buyers.rows) }, latestFiled: "2026-09-01" });
    const p8 = await open();
    const note = await info(p8, "plBuyersCard");
    ok(/does not carry the executing account/.test(note || ""),
      "a payload without the counter says the field is missing — got: " + note);
    ok(!/stated an executing account on none/.test(note || ""),
      "and does not turn that absence into a statement about what the vendor sent");
    ok(/no row drawn here carries it/.test(note || ""),
      "with the mark's legend replaced by the fact that nothing is marked");
    ok(/after the last completed session on 2026-08-31/.test(note || ""),
      "AND THE DATE IS PLACED CORRECTLY AGAINST THE SESSION. 2026-09-01 is after 2026-08-31");
    ok(!/before the last completed session/.test(note || ""),
      "so the sentence is not the one it used to print regardless of direction");
    await p8.close();
  }

  {
    await put("political", payload);
    const p4 = await open({ viewport: { width: 320, height: 900 } });
    await p4.waitForSelector(ROWS("plBuyers", "pl-buyer"));
    const over = await p4.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(over <= 1, `the page overflows nothing at 320px (over by ${over}px) — the ledger rows reflow ` +
      "inside their modules, which is the repository's tested invariant");
    await p4.close();
  }

  await page.close();
} finally {
  await browser.close();
  await server.stop();
}

console.log(`✓ flows-political-render: ${checks} assertions — a midpoint bar that ends inside ` +
  `its own band on a shared axis, overlapping neighbours counted rather than warned about, ` +
  `an open band's held-back floor published as a number, the filing's own word for a gift, a ` +
  `late mark carried by the number AND by a delay bar past the 45-day line, never by hue alone, ` +
  `a holder ledger with no currency mark anywhere in it, an executing account under its filer ` +
  `where a company name used to sit, an em dash where a filer named no listed security, a new ` +
  `mark carried by a glyph in a fixed position, a card link built from the payload's own list of ` +
  `carded names with the symbol normalised before the lookup, a breadth view whose first row is ` +
  `third by dollars with one dot per filer, the width of the read in the status, a vendor that ` +
  `ignored pagination said as a pill one tap from its sentence, three silences with three tags and ` +
  `three sentences, a breadth view that draws its own silence rather than vanishing with the ` +
  `ranking beside it, a floor printed from the payload and never from a literal, an account share ` +
  `that says "not published" rather than "none stated", a newest filing placed AFTER the session ` +
  `it is after, a number the vendor quoted formatted rather than dashed while an empty string ` +
  `stays a dash, all eight notes carried verbatim, and nothing overflowing at 320px`);
