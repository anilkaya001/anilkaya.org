/* =============================================================
   flows-political-contract.mjs — disclosed political filings.

   WHAT IS WORTH ASSERTING. This surface ranks people by money, from
   data that states neither an amount nor a current date. The
   expensive defects are all quiet overclaims:

     - an open-ended band ("Over $50,000,000") given an invented
       midpoint and then summed into a ranking;
     - a "Receive" — a gift or transfer — counted as a purchase;
     - a seller topping a list captioned about buying;
     - a missing owner read as "self", which is the exact error the
       card's congress panel already names;
     - a lag left in a footnote, so an 80-day-old ranking reads as
       today's.

   The fixture below is built so each of those, if reintroduced,
   changes an assertion rather than passing silently.
   ============================================================= */

import assert from "node:assert/strict";
import {
  parseBand, valueBand, sideOf, filingRow, rankBuyers, rankAssets, shapeRecent,
  shapeHolders, buildPolitical, unwrapRows,
  POLITICAL_CAPS, POLITICAL_NOTES, POLITICAL_FEEDS, SIZE_BASIS, HOLDER_QTY_UNIT,
} from "../shared/flows-political.js";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const deep = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

/* ---------- §1 the band, including the one with no top ----------- */
{
  const b = parseBand("$1,000 - $15,000");
  eq(b.lo, 1000, "the low bound parses through the comma");
  eq(b.hi, 15000, "and the high bound");
  eq(b.mid, 8000, "the midpoint is the stated convention");

  const open = parseBand("Over $50,000,000");
  eq(open.lo, 50000000, "an open band keeps its floor");
  eq(open.hi, null, "states no ceiling");
  eq(open.mid, null,
    "AND HAS NO MIDPOINT. Inventing one would put a fabricated number into a " +
    "sum that is then ranked — the largest disclosures are exactly the rows " +
    "where a guess would move the ranking most");
  eq(open.open, true, "and it is flagged so a total built on one can say so");

  eq(parseBand("$5,000").mid, 5000, "a single stated figure is its own midpoint");
  eq(parseBand(null).mid, null, "and junk yields no number at all");
  eq(parseBand("unknown").lo, null, "including unparseable prose");
}

/* ---------- §2 the vendor's vocabulary, including the gift ------- */
{
  eq(sideOf("Purchase"), "buy", "Purchase is a buy");
  eq(sideOf("Buy"), "buy", "and so is Buy");
  eq(sideOf("Sale (Partial)"), "sell", "a partial sale is a sale");
  eq(sideOf("Sale (Full)"), "sell", "and a full one");
  eq(sideOf("Receive"), null,
    "RECEIVE IS NEITHER. A transfer or gift is not a purchase, and counting it " +
    "as one would put an acquisition nobody paid for into a ranking of " +
    "disclosed purchase size");
  eq(sideOf(undefined), null, "and an absent type classifies as nothing");
}

/* ---------- §3 one filing, shaped -------------------------------- */
{
  const r = filingRow({
    name: "A Member", politician_id: "pid-1", ticker: "AAA", asset: "Aaa Inc",
    txn_type: "Purchase", amounts: "$15,001 - $50,000",
    transaction_date: "2026-07-01", filed_at_date: "2026-08-20",
  });
  eq(r.side, "buy", "the side is classified");
  eq(r.mid, 32500.5, "the midpoint comes off the band");
  eq(r.lagDays, 50,
    "AND THE LAG IS ON THE ROW, not in a footnote — 50 days between the " +
    "transaction and its disclosure is the difference between this being news " +
    "and being history");
  eq(filingRow({}), null, "a filing with neither a filer nor a ticker is dropped");
  eq(filingRow({ ticker: "BBB" }).who, null, "a ticker-only row survives with no filer");

  /* THE SECOND WIRE SPELLING. The unusual-trades family sends the same fact
     as `transaction_type` plus a numeric triple, with the issuer under
     `asset`. Reading only the congress spelling would not throw on this row
     — it would classify the side as null and the band as unparseable, and
     the ranking would come back confidently empty. */
  const alt = filingRow({
    name: "B Member", ticker: "BBB", asset: "Bbb Corporation - Common Stock",
    transaction_type: "Buy", low_value: "1000001", high_value: "5000000",
    mid_value: "3000000", transaction_date: "2026-06-20", filed_at_date: "2026-07-15",
  });
  eq(alt.side, "buy", "the alternate spelling of the side is classified, not dropped");
  eq(alt.mid, 3000000.5,
    "AND THE MIDPOINT IS COMPUTED FROM THE BOUNDS, not lifted from the vendor's " +
    "own mid_value (3,000,000) — one basis produces every summed number on the " +
    "page, and SIZE_BASIS states that basis");
  eq(alt.asset, "Bbb Corporation - Common Stock",
     "the SECURITY is read from `asset`, which is the field that names the security");

  /* ---- `issuer` IS NOT THE COMPANY, and this suite used to say it was ----

     The line above asserted `alt.issuer === "Bbb Corporation - Common Stock"`,
     encoding the same misreading the shaper had: that `issuer` and `asset`
     were two spellings of one field. The vendor's spec says otherwise —

       Insider Trades Issuer: "The person who executed the transaction."
                              example: spouse      (docs/uw-openapi.yaml:6042)
       Politician Trades:     asset: NVIDIA Corporation - Common Stock
                              ticker: NVDA         (docs/uw-openapi.yaml:9573)

     — and `issuer` does not appear on the /congress/recent-trades schema at
     all. On every live row that carried it, the page printed "joint" or
     "not-disclosed" where a company name belongs.

     THE CORRECT READING WAS ALREADY IN THIS REPOSITORY. shared/flows-card.js
     has read it right since the congress panel shipped, and says why: "A large
     share of filings are a spouse's or a dependent's. Attributing those to a
     member's judgement is the classic error." Two files, one field, two
     readings, and the newer one was wrong. */
  const spousal = filingRow({
    name: "C Member", ticker: "CCC", asset: "Ccc Holdings - Common Stock",
    issuer: "spouse", txn_type: "Purchase", amounts: "$1,001 - $15,000",
    transaction_date: "2026-06-20", filed_at_date: "2026-07-15",
  });
  eq(spousal.asset, "Ccc Holdings - Common Stock",
     "the company comes from `asset` even when `issuer` is present — which is the row " +
     "shape that used to print 'spouse' as the company");
  eq(spousal.executedBy, "spouse",
     "and `issuer` is kept for what it is: WHOSE ACCOUNT executed the trade. A spouse's " +
     "trade is a different fact from the member's own and is worth keeping — as a qualifier " +
     "on the filing, never as its name");
  ok(spousal.asset !== spousal.executedBy,
     "the two are never the same string, which is the whole defect stated as an assertion");

  /* ABSENT IS NOT "not-disclosed". /recent-trades omits the field entirely;
     a member declining to say is a different fact from a schema that never
     carried it, and only one of those is a disclosure choice. */
  eq(alt.executedBy, null,
     "a row with no `issuer` publishes null, not a guess and not 'not-disclosed'");
  eq(filingRow({ name: "D", ticker: "DDD", issuer: "not-disclosed",
    txn_type: "Purchase", amounts: "$1,001 - $15,000" }).executedBy, "not-disclosed",
     "while a member who declined to say has that recorded verbatim");
  eq(alt.lagDays, 25, "and the lag still computes across the spellings");

  const oneBound = valueBand({ low_value: "1000001", mid_value: "9999999" });
  eq(oneBound.mid, null,
    "a floor with no ceiling stays open-ended even when the vendor volunteers a " +
    "midpoint — a stated mid is not evidence of the missing bound");
  eq(oneBound.open, true, "and it is flagged as such");
  eq(valueBand({ mid_value: "42" }).mid, 42,
    "while a stated midpoint with no bounds at all is the only number there is");
}

/* ---------- §4 the ranking is of PURCHASES ----------------------- */
{
  const rows = [
    { who: "Big Seller", id: "s1", t: "AAA", side: "sell", mid: 5000000, lo: 1, hi: 2, lagDays: 10 },
    { who: "Big Seller", id: "s1", t: "AAA", side: "buy", mid: 1000, lo: 500, hi: 1500, lagDays: 10 },
    { who: "Real Buyer", id: "b1", t: "BBB", side: "buy", mid: 90000, lo: 80000, hi: 100000, lagDays: 90 },
    { who: "Real Buyer", id: "b1", t: "CCC", side: "buy", mid: 10000, lo: 9000, hi: 11000, lagDays: 20 },
    { who: "Gifted", id: "g1", t: "DDD", side: null, mid: 999999, lagDays: 5 },
  ];
  const built = rankBuyers(rows);
  deep(built.rows.map((r) => r.who), ["Real Buyer", "Big Seller"],
    "A SELLER DOES NOT TOP A BUYING LIST. Big Seller disclosed 5,000x more in " +
    "sales than Real Buyer bought, and still ranks below — the caption says " +
    "purchases and so does the ordering");
  eq(built.rows[0].bought, 100000, "purchase midpoints sum");
  eq(built.rows[0].boughtLo, 89000, "with the low bounds carried");
  eq(built.rows[0].boughtHi, 111000,
    "and the high bounds, so the width of the estimate stays visible beside it");
  eq(built.rows[0].names, 2, "distinct names are counted");
  eq(built.rows[0].medianLagDays, 55, "and the median lag of the filings behind the total");
  ok(!built.rows.some((r) => r.who === "Gifted"),
    "a filer with no classifiable purchase is not ranked as a buyer");
  eq(built.rows[1].unclassified, 0, "classified rows are not counted as unclassified");
  ok(built.basis === SIZE_BASIS && /midpoint/.test(built.basis),
    "and the ranking convention rides on the payload rather than living in a caption");

  /* THE TRIPLE DESCRIBES ONE POPULATION. A synthetic run produced a filer
     whose summed LOW ($55,067,012) exceeded both their midpoint total
     ($13,623,506) and their summed HIGH ($22,180,000) — an impossible row
     that every other check passed. The cause: an open-ended band contributes
     a floor and no ceiling, so summing its floor into the low while it
     supplies neither of the other two breaks lo <= mid <= hi. Such a
     purchase now sits out the triple entirely and reports its floor
     separately, and the invariant is asserted rather than assumed. */
  const withOpen = rankBuyers([
    { who: "Open", id: "o1", t: "AAA", side: "buy", mid: 8000, lo: 1000, hi: 15000, lagDays: 3 },
    { who: "Open", id: "o1", t: "BBB", side: "buy", mid: null, lo: 50000000, hi: null,
      openBand: true, lagDays: 3 },
  ]);
  const o = withOpen.rows[0];
  eq(o.bought, 8000, "the open band contributes no midpoint, because it states none");
  eq(o.boughtLo, 1000,
    "AND NO LOW EITHER — its $50,000,000 floor stays out of a total the same row " +
    "cannot supply a ceiling for");
  eq(o.boughtHi, 15000, "the high total covers exactly the filings the other two do");
  eq(o.openFloor, 50000000,
    "and the floor held back is PUBLISHED rather than dropped, so the largest " +
    "disclosure on the row is visible beside the total that excludes it");
  eq(o.openBands, 1, "with the count of such filings beside it");
  ok(o.boughtLo <= o.bought && o.bought <= o.boughtHi,
    "lo <= mid <= hi, the invariant the triple exists to carry");
  for (const r of built.rows) {
    ok(r.boughtLo <= r.bought && r.bought <= r.boughtHi,
      `${r.who}: lo <= mid <= hi holds across the ranking, not just on the crafted row`);
  }

  const openAsset = rankAssets([
    { who: "X", id: "x", t: "AAA", side: "buy", mid: null, lo: 9e6, hi: null, openBand: true },
    { who: "Y", id: "y", t: "AAA", side: "buy", mid: 100, lo: 50, hi: 150 },
  ]).rows[0];
  eq(openAsset.boughtLo, 50, "the by-asset ranking keeps the same rule");
  eq(openAsset.openFloor, 9e6, "and publishes the same held-back floor");
}

/* ---------- §5 the same discipline by asset ---------------------- */
{
  const built = rankAssets([
    { who: "X", id: "x", t: "AAA", side: "buy", mid: 100, lo: 50, hi: 150 },
    { who: "Y", id: "y", t: "AAA", side: "buy", mid: 200, lo: 100, hi: 300 },
    { who: "X", id: "x", t: "AAA", side: "sell", mid: 9999 },
    { who: "Z", id: "z", t: "BBB", side: "sell", mid: 5000 },
  ]);
  deep(built.rows.map((r) => r.t), ["AAA"],
    "a name with sales but no disclosed purchase does not enter a purchase ranking");
  eq(built.rows[0].bought, 300, "purchase midpoints sum across filers");
  eq(built.rows[0].filers, 2, "distinct filers are counted, not filings");
  eq(built.rows[0].sells, 1, "and the sales are carried beside, not folded in");
}

/* ---------- §6 holders: the vendor's own numbers ----------------- */
{
  const h = shapeHolders({ data: [
    { full_name: "Alpha", id: "a", owner: "self", min_amount: 1, mid_amount: 76, max_amount: 143 },
    { full_name: "Beta", id: "b", owner: "spouse", min_amount: 5, mid_amount: 500, max_amount: 900 },
  ] }, "AAA");
  deep(h.rows.map((r) => r.who), ["Beta", "Alpha"], "ranked by the vendor's own midpoint");
  eq(h.rows[0].midQty, 500,
    "AND THE NUMBER IS NAMED FOR ITS UNIT. The spec calls all three fields a " +
    "\"share quantity\"; every other number in this module is dollars, so a " +
    "field called `mid` here would be printed with a currency mark by the first " +
    "renderer that touched it");
  eq(h.rows[0].mid, undefined,
    "the dollar-shaped name is not also published — one name, so the two units " +
    "cannot be confused by autocomplete");
  ok(/share quantity/.test(h.qtyUnit) && /not dollars/.test(h.qtyUnit),
    "and the unit rides on the block rather than living in a caption");
  ok(/never summed with/.test(HOLDER_QTY_UNIT),
    "stating the refusal the unit implies: a share count cannot be added to a " +
    "dollar band");
  eq(h.rows[0].owner, "spouse",
    "AND THE OWNER IS CARRIED. A spouse's account attributed to a member's " +
    "judgement is the classic error this repository already names");
  eq(h.selfFiled, 1, "the self-filed share is counted where owners are known");

  const noOwner = shapeHolders([{ full_name: "Gamma", mid_amount: 10 }], "BBB");
  eq(noOwner.rows[0].owner, null, "an absent owner stays null");
  eq(noOwner.selfFiled, null,
    "and the self-filed share is UNKNOWN rather than 100% — no owner sent is " +
    "not the same fact as every owner being the filer");
  eq(noOwner.ownerKnown, 0, "with the count of known owners published beside it");
}

/* ---------- §7 recency is by FILING date ------------------------- */
{
  const built = shapeRecent([
    { who: "A", t: "AAA", filedDate: "2026-08-01", txnDate: "2026-07-30", mid: 1 },
    { who: "B", t: "BBB", filedDate: "2026-08-20", txnDate: "2026-05-01", mid: 2 },
  ]);
  eq(built.rows[0].who, "B",
    "newest DISCLOSURE first, not newest transaction — the filing is what " +
    "changed today, and B's much older trade is the newer news");
}

/* ---------- §8 caps, shed, determinism, isolation ---------------- */
{
  const many = Array.from({ length: POLITICAL_CAPS.buyers + 5 }, (_, i) => ({
    who: "P" + String(i).padStart(3, "0"), id: "p" + i, t: "T" + i,
    side: "buy", mid: 1000 - i, lo: 1, hi: 2, lagDays: 1,
  }));
  const b = rankBuyers(many);
  eq(b.rows.length, POLITICAL_CAPS.buyers, "the cap holds");
  eq(b.shed, 5, "and what it removed is counted beside what it kept");
  eq(JSON.stringify(rankBuyers(many)), JSON.stringify(b), "two builds are byte-identical");

  const pol = buildPolitical({ filings: { __failed: "HTTP 500" }, holders: [] });
  eq(pol.buyers.status, "unavailable", "a failed filings fetch marks its dependants unavailable");
  ok(/HTTP 500/.test(pol.assets.reason), "with the reason it carried");
  eq(pol.holders.status, "quiet", "while the holders feed answers for itself");
  eq(pol.notes, POLITICAL_NOTES, "and the notes ride whatever the feeds did");
  for (const f of POLITICAL_FEEDS) ok(pol[f], `every declared feed (${f}) is present`);
  deep(unwrapRows(null), [], "a non-response is an empty read, not a throw");
}

/* ---------- §9 the refusals hold in the payload's own prose ------
   Ranking people by money invites exactly the claims this data cannot
   support. The scan runs with NO allow-list: the prose was written to
   need no exception. */
{
  const BAN = /\b(return|returns|outperform|beat the market|track record|skill|profit|profits|gains|alpha|insider|tipped|front-?run)\b/gi;
  for (const [k, text] of Object.entries(POLITICAL_NOTES)) {
    BAN.lastIndex = 0;
    const hit = BAN.exec(text);
    ok(!hit, `notes.${k} says "${hit && hit[1]}" — a claim a disclosure cannot support`);
  }
  ok(/opening with no paired closing/.test(POLITICAL_NOTES.refusals),
    "the reason performance is refused is stated, not merely the refusal");
  ok(/45 days/.test(POLITICAL_NOTES.lag) && /never the same question/.test(POLITICAL_NOTES.lag),
    "and the lag note says plainly that disclosed is not current");
  ok(/spouse|dependent/.test(POLITICAL_NOTES.attribution),
    "and the attribution note names the account it will not assume");
}

console.log(`✓ flows-political: ${checks} assertions — an open-ended band with no invented ` +
  `midpoint, a gift that is not a purchase, a seller kept off a buying ranking, band bounds ` +
  `carried beside every midpoint total, disclosure lag on the row and the median under the ` +
  `total, an owner that stays unknown rather than becoming "self", recency by filing date, ` +
  `caps with counted shed, byte-identical rebuilds, both wire spellings of a filing read ` +
  `onto one row, a holder count named for the unit the vendor gives it, and prose that ` +
  `needs no allow-list`);
