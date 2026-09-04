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

/* ---------- 1b. the numerator that read as the whole set --------- */

/* shared/flows-warnings.js:865 returns `questions` beside `checked` and says
   why in as many words: "a numerator printed alone reads as the whole set.
   Nothing in a bare `checked: 7` says whether seven is every question this
   module carries or seven of thirteen". assess({}) reports questions: 13, so
   a clean bill drawn from four is a clean bill over under a third of the
   sweep — and the page printed the four alone, which is the truncation that
   does not say it truncated in the panel whose whole job is to say so. */
ok(/not the share of the sweep|does not publish/i.test(four),
   "a clean bill counted from a `warningsChecked` the briefing publishes WITHOUT its " +
   "denominator says the denominator is missing: `assess()` carries thirteen questions and " +
   "four is the count that ran, so a bare 'from 4 checks that could run' lets a reader take " +
   "four for every question there was and read a third of a sweep as all of it");

/* THE DENOMINATOR PUBLISHED. The pipeline now sends `questions` beside
   `checked`, and where it is on the wire the page states the share and names
   what could not be asked, rather than leaving a reader to assume a total. */
const four13 = await warnsText([], { warningsChecked: 4, warningsQuestions: 13 });
ok(/This briefing carries 13/.test(four13) && /9 of them could not be asked/.test(four13),
   "and where the briefing DOES publish how many checks it carries, the clean bill states " +
   "the total and names the nine questions that could not be asked at all — four of " +
   "thirteen is a different fact from four of four, and only one of them is a swept surface");
ok(/unanswered rather than clear/i.test(four13),
   "and says what the nine are: unanswered, not clear. A check that could not run has found " +
   "nothing and cleared nothing, and folding it into a clean bill is the confident zero " +
   "wearing the one sign this page draws above everything else");

/* THE CONTROL ON THE CONTROL. A sweep where every question could be asked
   must still be able to say so plainly, or the fix has traded a false clean
   bill for a page that can never report a complete one. */
const all13 = await warnsText([], { warningsChecked: 13, warningsQuestions: 13 });
ok(/every check this briefing carries, so the sweep was complete/.test(all13),
   "while a briefing where all thirteen questions could be asked says the sweep was " +
   "complete — the qualification is withheld when it is not earned, exactly as the clean " +
   "bill is");

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

/* ---------- 2b. the same empty scan, in the line readers meet ---- */

/* THE FOLD WAS FIXED AND THE PROVENANCE LINE WAS NOT. `.ak-prov` sits in the
   open directly under the answer and is the sentence a reader meets without
   opening anything; it claimed "every figure it wrote was checked against
   those same facts" over the identical payload whose audit trail correctly
   refuses to call that a verification. Two of this page's own sentences
   disagreeing, with the false one in front. It is also the answer where the
   claim matters most: prose carrying no numeral is prose the guard cannot
   touch at all, so the reader is being reassured about exactly the answer
   nothing was checked in. */
ok(!/Every figure it wrote was checked/.test(noFigures),
   "an answer stating no figure gets no claim in its PROVENANCE line that its figures were " +
   "checked either: 'every figure it wrote was checked against those same facts' is " +
   "vacuously true over an empty set, and it sits in the open above the fold that has just " +
   "refused to call the same empty scan a verification");
ok(/none for the guard to check/i.test(noFigures),
   "and the open line says what the fold says — there was no figure to check — so a reader " +
   "who never opens the disclosure is told the same thing as one who does");
ok(/Every figure it wrote was checked against those same facts/.test(withFigure),
   "while the answer that DID state a figure keeps the sentence in the open, because for " +
   "that answer the check was performed and the reader is entitled to hear so without " +
   "opening anything");

/* ---------- 2c. `n` is not the set of figures in the prose ------- */

/* CORRECTION 2 IN THE BRIEF: the guard's allowed set is numeralsIn(fact.say),
   not the values of `n`, because `n` is an OBJECT of named measured fields
   and a sentence carries numerals that are not measurements. LEAD is the
   proof and it is this suite's own fixture: say "The short board's leading
   name is SYN35 at 58." yields the numerals 35 and 58 — the 35 belongs to
   the ticker — while n is {score: 58}. The audit paragraph closed by
   asserting every figure in the prose was one of these values, which is
   false for that fact and for every fact naming a ticker or a date. */
ok(!/Every figure in the prose above is one of these values/.test(withFigure),
   "the fact-pin paragraph does not claim `n` holds every figure in the prose: SYN35 puts " +
   "the numeral 35 in a sentence whose n is {score:58}, so a reader auditing the answer " +
   "against the pinned values finds a figure missing from them and concludes the guard let " +
   "one through — the audit trail accusing the check it exists to evidence");
ok(/not the whole set of figures written in them/i.test(withFigure),
   "and says which set it is: the measured fields behind the sentences, with the digits in " +
   "a ticker or a date named as the reason the two differ");
ok(/checks the answer against those sentences rather than against these values/i
   .test(withFigure),
   "and states the rule the guard actually applies — the scan is against `say`, which the " +
   "method note one paragraph above already said, and the two now agree instead of " +
   "describing two different guards");
ok(/score=58/.test(withFigure),
   "while the pinned fields themselves are still printed, unreformatted and named — the " +
   "anti-tamper record is corrected in what it claims, not withdrawn");

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

/* ---------- 5. the model budget, and the condition on it ---------

   THE METER SUBTRACTS, SO EVERY WAY THE SUBTRACTION CAN LIE IS A
   SCENARIO HERE. `remaining` is allowance minus spend, and spend is
   derived from token counts at a configured rate — so an absent rate
   makes the spend UNKNOWN, and Number(null) === 0 reaching that
   subtraction would render an unknown spend as a full tank on a day
   this route may have emptied. The measured-zero case is asserted
   beside it: a morning before the first question really is 10,000 of
   10,000, and a page that withheld both would be the same defect
   wearing the other sign.

   AND THE CONDITION IS ASSERTED TO BE IN THE OPEN. "8,412 left" means
   one thing if this site is the only thing drawing on the Cloudflare
   account and something else if it is not, so the words naming that
   assumption are the number's units rather than reassurance about it —
   and this page's fold rule lets reassurance fold and never a
   withholding. The assertion is structural: the text is read from a
   copy of the host with the <details> REMOVED, so a later edit that
   tidies the condition into the disclosure fails here. */

const meterOf = async (body) => {
  await page.route("**/api/flows/ai-usage", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify(body) }));
  await page.goto(url("/flows/ask/"), { waitUntil: "networkidle" });
  await page.waitForSelector("#askMeter *");
  const out = await page.evaluate(() => {
    const live = document.getElementById("askMeter");
    const copy = live.cloneNode(true);
    const fold = copy.querySelector("details");
    const foldText = fold ? fold.textContent : "";
    if (fold) fold.remove();
    const fill = live.querySelector(".ak-meter-fill");
    const bar = live.querySelector(".ak-meter-bar");
    const empty = live.querySelector("[data-empty]");
    return {
      open: copy.textContent, fold: foldText,
      /* READ AS A NUMBER, NOT AS THE STRING THAT WAS SET. The CSSOM
         normalises the width it is given — "100.0%" comes back "100%" and
         "0.0%" comes back "0%" — so asserting the string tests the
         browser's serialiser and fails on exactly the two endpoints this
         gauge most needs to draw correctly. */
      width: fill && /%$/.test(fill.style.width) ? parseFloat(fill.style.width) : null,
      hasBar: !!bar, barHidden: bar ? bar.getAttribute("aria-hidden") : null,
      emptyKind: empty ? empty.getAttribute("data-empty") : null,
    };
  });
  await page.unroute("**/api/flows/ai-usage");
  return out;
};

const SPEND = (over) => ({ spend: Object.assign({
  day: "2026-09-04", calls: 7, tokensIn: 41000, tokensOut: 3100,
  allowanceNeurons: 10000, neurons: 1588, remaining: 8412,
  assumesSoleSpender: true }, over || {}) });

const spent = await meterOf(SPEND());
ok(/8,412/.test(spent.open) && /10,000/.test(spent.open),
   "the budget is drawn as a figure over its allowance, in the open: a reader deciding " +
   "whether to ask is the one who needs it, and a reader who has already asked has spent it");
ok(/counting only this site.s own calls/i.test(spent.open),
   "and the condition the subtraction rests on is in the open WITH it, outside the " +
   "disclosure — the text here is read from a copy of the host with the <details> removed, " +
   "so folding the condition away later fails this assertion. It is not reassurance about " +
   "the number, it is the number's units: 8,412 left means one thing if this site is the " +
   "only thing drawing on the account and another if it is not");
ok(/Cloudflare is the authority/i.test(spent.fold),
   "while what folds is the derivation — who the authority actually is, the day, the token " +
   "totals — none of which changes what the visible figure means");
ok(spent.width === 84.1,
   "the bar is drawn from the same two numbers the sentence states, not from a third: " +
   "8,412 of 10,000 is 84.1% of the track and the fill measures " + spent.width + "%");
ok(spent.barHidden === "true",
   "and it is aria-hidden, because a gauge whose only output is a length is a reading that " +
   "does not survive greyscale, a printout or a screen reader — the same rule this page's " +
   "mark glyphs follow");

/* THE CONFIDENT ZERO, IN THE ONE PLACE A SUBTRACTION CREATES IT. */
const norate = await meterOf(SPEND({ neurons: null, remaining: null }));
ok(!/10,000/.test(norate.open),
   "with no rate configured the spend is UNKNOWN, and an unknown spend is not printed as a " +
   "full allowance: Number(null) === 0 reaching the subtraction would render 10,000 of " +
   "10,000 left on a day this route may have emptied it, which is the confident zero this " +
   "codebase is organised against — arriving through arithmetic rather than through a field");
ok(/7 times today/.test(norate.open),
   "the call count is still printed, because it was still measured — withholding the derived " +
   "figure is not a reason to withhold the measurement it was derived from");
ok(/rate for the configured model is not set/i.test(norate.open),
   "and the reason is named, so a reader can tell a missing rate from a spent allowance");

/* THE CONTROL: a measured zero spend IS printed, and in full. */
const fresh = await meterOf(SPEND({ calls: 0, tokensIn: 0, tokensOut: 0,
  neurons: 0, remaining: 10000 }));
ok(/10,000 of 10,000/.test(fresh.open),
   "and the control that keeps the assertion above from passing against a renderer that " +
   "simply never prints an allowance: a morning before the first question really is 10,000 " +
   "of 10,000, a measured zero spend rather than an unmeasured one, and it says so");
ok(fresh.width === 100,
   "with a full track, drawn rather than withheld");

/* AN EMPTY GAUGE IS NOT A MISSING GAUGE, and it is not a closed door. */
const drained = await meterOf(SPEND({ neurons: 10000, remaining: 0 }));
ok(drained.hasBar && drained.width === 0,
   "a spent budget still draws its track: a gauge that renders as nothing at zero is " +
   "indistinguishable from a gauge that failed to draw, and those are the two states this " +
   "box most needs to keep apart");
ok(/Asking is still allowed/i.test(drained.open),
   "and it says asking is still allowed, because this meter is a gauge and not a gate — the " +
   "figures in an answer were measured by the pipeline and cost no model call, so a reader " +
   "at zero loses the phrasing and nothing else");

/* THE METER'S OWN SILENCE IS NOT THE MARKET'S. */
const unread = await meterOf({ spend: null });
ok(unread.emptyKind === "unreadable",
   "a route that looked and could not read the meter gets the unreadable mark, not the " +
   "quiet one: a quiet meter would read as a day on which nothing was spent, which is " +
   "exactly the reading the fresh-morning case above is entitled to and this one is not");
ok(/Nothing follows from that about the allowance/i.test(unread.open),
   "and it says what does not follow, rather than leaving a reader to decide whether a " +
   "blank meter means the budget is gone");

/* ---------- 6. the key that sends ---------------------------------

   ENTER SENDS AND SHIFT-ENTER DOES NOT, asserted from the keyboard
   rather than from the handler. The field is a <textarea>, whose
   native behaviour on Enter is a newline, so every one of these is a
   behaviour the page had to add and could lose to a stray
   preventDefault or a listener attached to the wrong node.

   THE COMPOSITION CASE IS THE ONE WORTH THE TROUBLE. An input method
   editor — Japanese, Chinese, Korean, and the accent composers — uses
   Enter to COMMIT the characters being composed, and a box that sends
   on that Enter submits a half-typed word and swallows the keystroke
   that was finishing it. That makes the field unusable in those
   languages rather than merely awkward, and no amount of clicking Ask
   would surface it. Playwright's keyboard cannot raise the flag, so
   the event is dispatched with isComposing set, which is exactly the
   shape the browser delivers mid-composition. */

await page.route("**/api/flows/ask", (route) => route.fulfill({
  status: 200, contentType: "application/json",
  body: JSON.stringify({ answer: "A short board reading.", llm: false, model: null,
    note: "No model is configured for this route.", capped: false, why: "Picked 1 of 1.",
    facts: [LEAD], silences: null, guard: null }) }));
await page.goto(url("/flows/ask/"), { waitUntil: "networkidle" });

const answerText = () => page.evaluate(() =>
  document.getElementById("askAnswer").textContent);

await page.fill("#askQ", "what leads the short board");
await page.focus("#askQ");
await page.keyboard.press("Enter");
await page.waitForSelector("#askAnswer .ak-asked", { timeout: 5000 });
ok(/what leads the short board/.test(await answerText()),
   "Enter in the question field sends it: the field is a textarea, whose native Enter is a " +
   "newline, so this is behaviour the page adds and can lose");
ok((await page.inputValue("#askQ")).indexOf("\n") === -1,
   "and the newline Enter would otherwise have inserted is suppressed, rather than being " +
   "sent AND left behind in the field for the next question to inherit");

await page.evaluate(() => { document.getElementById("askAnswer").textContent = ""; });
await page.fill("#askQ", "first line");
await page.focus("#askQ");
await page.keyboard.down("Shift");
await page.keyboard.press("Enter");
await page.keyboard.up("Shift");
await page.type("#askQ", "second line");
ok((await page.inputValue("#askQ")) === "first line\nsecond line",
   "Shift-Enter makes a new line instead of sending, so a question can still be written " +
   "across two lines — which is why this field stays a textarea rather than becoming an " +
   "<input> that would send on Enter for free");
ok((await answerText()) === "",
   "and nothing was sent by it: a Shift-Enter that both broke the line and submitted would " +
   "look correct in the field and be wrong in the answer");

const composed = await page.evaluate(() => {
  const q = document.getElementById("askQ");
  const before = document.getElementById("askAnswer").textContent;
  q.value = "composing";
  q.focus();
  /* THE SHAPE A BROWSER DELIVERS MID-COMPOSITION. Chrome sets
     isComposing on the keydown and reports keyCode 229; either is
     enough on its own and both are sent here because the handler
     accepts either as proof. */
  q.dispatchEvent(new KeyboardEvent("keydown", {
    key: "Enter", keyCode: 229, isComposing: true, bubbles: true, cancelable: true }));
  return { before, after: document.getElementById("askAnswer").textContent };
});
ok(composed.after === composed.before,
   "an Enter that belongs to an input method editor's composition does not send: it is the " +
   "keystroke COMMITTING a Japanese, Chinese or Korean word, and sending on it would submit " +
   "a half-typed question and eat the key that was finishing it");

await page.unroute("**/api/flows/ask");

ok(errors.length === 0,
   "and the renderer threw nothing across every branch above — including the two that hand " +
   "it a failed request, which is where a page that words its own failures is most likely " +
   "to fail wording one: " + errors.join(" | "));

await browser.close();
await server.stop();

console.log(`✓ flows-ask-render: ${checks} assertions — a consistency report that states no ` +
  `clean bill it did not measure and never prints its numerator as the whole sweep, a ` +
  `guard that reports an empty scan as an empty scan in the open as well as in the fold, ` +
  `an anti-tamper record that does not claim to hold every figure in the prose, a ` +
  `failed route quoted in its own words so a broken payload is never reported as a broken ` +
  `connection, and a model budget whose condition never folds, whose bar is never the ` +
  `reading, and which tells a measured zero spend from a spend it could not measure in ` +
  `both directions, and a question field where Enter sends, Shift-Enter breaks the line, ` +
  `and an input method editor's composing Enter does neither`);
