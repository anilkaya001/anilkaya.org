/* =============================================================
   flows-ask-render.mjs — what /flows/ask/ SAYS when it was handed
   nothing, and who it blames for the nothing.

   tests/flows-ask.mjs pins the retrieval core: the index, the
   selection, the guard. Every assertion there is about a value
   returned from a pure function. Nothing in it can catch the defect
   this file exists for, because that defect is a SENTENCE — the
   renderer holds a payload that says one thing and prints another,
   and a payload-shaped test never reads the prose.

   THE THREE DEFECTS BELOW ARE ALL ONE DEFECT. Each is a place where
   an absence was rendered as a finding:

     - a consistency report where not one check could run, printed
       as "No inconsistency was found across the published surfaces"
       — a clean bill nobody measured, drawn ABOVE the three regions
       precisely because it changes how they are read, so a morning
       with nothing published read as a morning that was checked and
       found quiet;

     - an answer stating no figure at all, whose audit trail read
       "the guard scanned 0 figures and found every one of them
       already written in the facts it was given" — the strongest
       verification this page can offer, awarded for the answer the
       guard did the least work on;

     - a route that answered 500 BECAUSE the published briefing would
       not parse, reported to the reader as this page failing to
       reach its route and explicitly excused as "not a statement
       about what has been published", which is the one thing it was.

   EVERY SCENARIO CARRIES ITS CONTROL. A test that only asserts the
   withholding passes just as well against a renderer that deleted
   the claim outright, and a page that never states a clean bill is
   not the fix — it is the same defect wearing the other sign. So
   each absent case is asserted beside the measured case it must
   still say out loud.

   THE MODEL IS STUBBED AND THAT IS NOT A CONVENIENCE. Workers AI
   bills the account's 10,000-neuron daily allowance whether the
   caller is production or a local Wrangler, and the allowance is
   account-wide. A suite that reached the real model would spend a
   shared production budget on every CI run and would make its own
   result depend on a quota. The guard verdicts below are fulfilled
   at the network boundary in the exact shapes shared/flows-ask.js
   returns and worker.js sends.
   ============================================================= */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { signSession } from "../shared/session.js";
import { startWorker, SESSION_SECRET, FLOWS_TEST_USER } from "./worker-server.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };

const TOKEN = "ask-render-token-aaaa";
const server = await startWorker({ extraVars: [`FLOWS_INGEST_TOKEN:${TOKEN}`] });
const url = (p) => server.baseURL + p;
const token = await signSession(
  { sub: FLOWS_TEST_USER, aud: "flows", epoch: "1", exp: Date.now() + 600000 }, SESSION_SECRET);
const put = (key, body) => fetch(url("/api/flows/ingest?key=" + encodeURIComponent(key)), {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
  body: JSON.stringify(body),
});

const STAMP = "2026-09-04T08:10:00.000Z";

/* THE FACT SHAPE IS shared/flows-ask.js's maker(), not an approximation of
   it: `n` is an OBJECT keyed by what each number is, and `source` and `at`
   travel with the sentence. A fixture that flattened `n` to an array would
   certify a renderer against a payload the publisher does not send. */
const fact = (id, say, n) => ({ id, topic: ["short", "board", "leads"], say,
  n: n || {}, source: "board:short", at: STAMP });

const LEAD = fact("board:short/lead",
  "The short board's leading name is SYN35 at 58.", { score: 58 });

/* The briefing the warnings box sits on top of. It is deliberately COMPLETE
   — one drawn reading in each region that has one — so that nothing else on
   the page is empty while the consistency report is. A fixture whose regions
   were also silent could not tell "the clean bill was withheld" from "the
   whole page had nothing to draw". */
const briefWith = (warnings, checkedField) => ({
  generatedAt: STAMP, sessionDate: "2026-09-04",
  today: { session: "2026-09-04", facts: [fact("brief:today/tilt",
    "The session tilts long: 44 of 118 names cleared the band.", { longCleared: 44 })],
    silences: [] },
  yesterday: { prior: "2026-09-03", facts: [fact("brief:yesterday/entrants",
    "3 names entered the long board against the prior session.", { entrants: 3 })],
    silences: [] },
  next: { origin: "2026-09-04", gateDays: 7, isForecast: false,
    facts: [fact("brief:next/earnings", "1 name on the board reports inside the gate.",
      { dated: 1 })], silences: [] },
  facts: [LEAD], silences: { pending: [], unreadable: [], quiet: [] },
  warnings, ...checkedField,
});

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
/* ONLY THROWN ERRORS COUNT, AND THAT IS NOT THE USUAL LAXITY. The other
   render suites here also collect console errors, because on those routes a
   console error is always a defect. Two of the branches below REQUIRE a
   failed request — a 500 and a refused connection — and the browser logs
   each of those to the console whatever the page does with it. Counting them
   would make the suite fail for successfully reaching the state it exists to
   test, so the net is thrown errors: a renderer that threw while wording one
   of these failures would still be caught, which is the thing worth catching. */
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.context().addCookies([
  { name: "flows_session", value: token, url: server.baseURL }]);

const warnsText = async (warnings, checkedField) => {
  await put("brief", briefWith(warnings, checkedField));
  await page.goto(url("/flows/ask/"), { waitUntil: "networkidle" });
  await page.waitForSelector(".ak-warns");
  return (await page.evaluate(() => document.querySelector(".ak-warns").textContent)).trim();
};

/* ---------- 1. a clean bill nobody measured ---------------------- */

/* shared/flows-warnings.js:860 returns `checked` for exactly this test and
   states the rule in its own words: a check whose inputs are absent "reports
   nothing and does not count itself as having run", so a caller printing "no
   warnings" beside a `checked` of 0 "can see that it has printed nothing at
   all". The renderer held the field and did not look at it. */
const zero = await warnsText([], { warningsChecked: 0 });

ok(!/No inconsistency was found/.test(zero),
   "a briefing where NOT ONE consistency check could run states no clean bill: `warnings: []` " +
   "beside `warningsChecked: 0` is what a store with nothing published in it produces, and " +
   "'No inconsistency was found across the published surfaces' is a comparison nobody " +
   "performed — the confident zero, in the one panel drawn first because it changes how " +
   "every region below it is read");
ok(/no two surfaces were compared|nothing is claimed/i.test(zero),
   "and it says which of the two it is: nothing was compared, so nothing is claimed. A " +
   "reader who is told the surfaces agree reads three regions of silences as a session that " +
   "was checked and found quiet rather than as a pipeline that has not run — the " +
   "pending/quiet merge arriving through the one panel that is not itself a silence");
ok(/gap in what has been published|rather than a clean bill/i.test(zero),
   "and it names the absence as a gap in the payload rather than as a fact about the " +
   "market, which is the sentence every other silence on this page already gets");

/* THE CONTROL. A renderer that simply deleted the claim would pass both
   assertions above and would be a different defect of the same size: a page
   that can never tell a reader its surfaces were checked and agree. */
const four = await warnsText([], { warningsChecked: 4 });
ok(/No inconsistency was found across the published surfaces, from 4 checks that could run/
   .test(four),
   "while a report where four checks DID have their inputs keeps the clean bill and the " +
   "count that earns it — the finding is withheld for want of a measurement, never because " +
   "the sentence was removed");

/* AND THE FIELD ABSENT IS A THIRD STATE, not the zero and not the four. A
   briefing published before `warningsChecked` existed carries an empty list
   and no count, and an empty list alone cannot tell an unasked question from
   an answered one. */
const nocount = await warnsText([], {});
ok(!/No inconsistency was found/.test(nocount),
   "a briefing carrying an empty warnings list and NO count of the checks that ran states " +
   "no clean bill either: without the denominator an empty list is exactly as consistent " +
   "with thirteen questions answered as with none asked, and the page cannot tell which");
ok(/cannot tell an empty list from an unasked question/i.test(nocount),
   "and says so in those terms, rather than falling back on the strongest of the readings " +
   "the evidence still permits");

/* ---------- 2. the guard that had nothing to check --------------- */

const ask = async (payload) => {
  await page.route("**/api/flows/ask", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify(payload) }));
  await page.fill("#askQ", "who leads the short board");
  await page.click(".ak-ask-go");
  await page.waitForSelector("#askAnswer .ft-how");
  const said = await page.evaluate(() =>
    document.getElementById("askAnswer").textContent);
  await page.unroute("**/api/flows/ask");
  return said;
};

/* THE SHAPE IS guardAnswer()'s OWN. shared/flows-ask.js:1128 returns
   {ok:true, rejected:[], numerals, invented:false, forecast:false} for a
   clean answer, and `numerals` is empty whenever the answer stated no
   figure — which is every answer that names a board and no number. */
const noFigures = await ask({
  answer: "The short board leads with a name that also led it in the prior session.",
  llm: true, model: "@cf/zai-org/glm-4.7-flash", note: null, capped: false,
  why: "Picked 1 of the 1 facts that matched: matched on topic words, no ticker in the " +
    "question matched one.",
  facts: [LEAD], silences: null,
  guard: { ok: true, rejected: [], numerals: [], invented: false, forecast: false,
    reason: null },
});

ok(!/scanned 0 figures/.test(noFigures),
   "an answer stating no figure at all reports no count of figures checked: 'the guard " +
   "scanned 0 figures in the answer above and found every one of them already written in " +
   "the facts it was given' is vacuously true over an empty set, and it awarded the " +
   "strongest verification this page can offer to the answer the guard did the least work on");
ok(/nothing in it for the guard to check/i.test(noFigures),
   "and states the measured 0 as what it is — an answer that carried no number — which is " +
   "a reading about the answer rather than a claim about a check that was performed");
ok(/not a verification it passed/i.test(noFigures),
   "and refuses the reading a reader would otherwise take from it, in the audit trail that " +
   "is the only place on this page a reader can go to weigh a model's prose");

/* THE CONTROL. An answer that DID state a figure must keep the sentence that
   says the figure was checked, or the guard's one report to the reader has
   been traded for a disclaimer. */
const withFigure = await ask({
  answer: "The short board's leading name is SYN35 at 58.",
  llm: true, model: "@cf/zai-org/glm-4.7-flash", note: null, capped: false,
  why: "Picked 1 of the 1 facts that matched.", facts: [LEAD], silences: null,
  guard: { ok: true, rejected: [], numerals: ["58"], invented: false, forecast: false,
    reason: null },
});
ok(/scanned 1 figure in the answer above and found every one of them already written/
   .test(withFigure),
   "while an answer carrying one figure keeps the sentence saying that figure was found " +
   "already written in the facts — the count is a measurement and it is reported whenever " +
   "there was something to count");

/* ---------- 3. whose failure a 500 was --------------------------- */

/* worker.js:3448 answers a `brief` key that WAS published and would not parse
   with this exact envelope. It is the third silence's sharpest case: the key
   exists, the job ran, and the payload is broken — which is a fault on the
   site and emphatically not a fact about the session. */
const BRIEF_UNREADABLE = "The briefing was published and could not be read, so no answer " +
  "is offered. That is a fault on this site rather than a fact about the session.";

await page.route("**/api/flows/ask", (route) => route.fulfill({
  status: 500, contentType: "application/json",
  body: JSON.stringify({ error: { code: "brief_unreadable", message: BRIEF_UNREADABLE } }) }));
await page.fill("#askQ", "who leads the short board");
await page.click(".ak-ask-go");
await page.waitForSelector('#askAnswer [data-empty="unreadable"]');
const failed = await page.evaluate(() => document.getElementById("askAnswer").textContent);
await page.unroute("**/api/flows/ask");

ok(failed.includes(BRIEF_UNREADABLE),
   "a route that answered and said why is quoted verbatim, which is the rule this file " +
   "already keeps for the answer itself: the sentence naming the published key as the " +
   "broken thing is the whole content of the failure, and 'HTTP 500' is what is left after " +
   "throwing it away");
ok(!/failing to reach its route/.test(failed),
   "and the page does not report a route that ANSWERED as one it could not reach — two " +
   "different unreadables, and the reader was being handed the one that points at the " +
   "network instead of at the payload");
ok(!/not a statement about what has been published/.test(failed),
   "nor does it repeat the reassurance that goes with that sentence, which is false for " +
   "exactly this failure: what has been published is the thing that is broken, and a reader " +
   "told otherwise goes on trusting a briefing built from the key that would not parse");

/* THE CONTROL. A route that genuinely never answered still gets the sentence
   about transport, because for that failure it is the true one. */
await page.route("**/api/flows/ask", (route) => route.abort("connectionrefused"));
await page.fill("#askQ", "who leads the short board");
await page.click(".ak-ask-go");
await page.waitForSelector('#askAnswer [data-empty="unreadable"]');
const dropped = await page.evaluate(() => document.getElementById("askAnswer").textContent);
await page.unroute("**/api/flows/ask");

ok(/failing to reach its route/.test(dropped),
   "a request that never came back keeps the transport sentence, and keeps the clause " +
   "saying nothing is implied about what was published — which is true when the route was " +
   "never reached and was the defect only when it had been");

ok(errors.length === 0,
   "and the renderer threw nothing across every branch above — including the two that hand " +
   "it a failed request, which is where a page that words its own failures is most likely " +
   "to fail wording one: " + errors.join(" | "));

await browser.close();
await server.stop();

console.log(`✓ flows-ask-render: ${checks} assertions — a consistency report that states no ` +
  `clean bill it did not measure, a guard that reports an empty scan as an empty scan ` +
  `rather than as a verification passed, and a failed route quoted in its own words so a ` +
  `broken payload is never reported as a broken connection`);
