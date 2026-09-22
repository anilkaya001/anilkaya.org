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

const fact = (id, say, n) => ({ id, topic: ["short", "board", "leads"], say,
  n: n || {}, source: "board:short", at: STAMP });

const LEAD = fact("board:short/lead",
  "The short board's leading name is SYN35 at 58.", { score: 58 });

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

const four = await warnsText([], { warningsChecked: 4 });
ok(/No inconsistency was found across the published surfaces, from 4 checks that could run/
   .test(four),
   "while a report where four checks DID have their inputs keeps the clean bill and the " +
   "count that earns it — the finding is withheld for want of a measurement, never because " +
   "the sentence was removed");

ok(/not the share of the sweep|does not publish/i.test(four),
   "a clean bill counted from a `warningsChecked` the briefing publishes WITHOUT its " +
   "denominator says the denominator is missing: `assess()` carries thirteen questions and " +
   "four is the count that ran, so a bare 'from 4 checks that could run' lets a reader take " +
   "four for every question there was and read a third of a sweep as all of it");

const four13 = await warnsText([], { warningsChecked: 4, warningsQuestions: 13 });
ok(/This briefing carries 13/.test(four13) && /9 of them could not be asked/.test(four13),
   "and where the briefing DOES publish how many checks it carries, the clean bill states " +
   "the total and names the nine questions that could not be asked at all — four of " +
   "thirteen is a different fact from four of four, and only one of them is a swept surface");
ok(/unanswered rather than clear/i.test(four13),
   "and says what the nine are: unanswered, not clear. A check that could not run has found " +
   "nothing and cleared nothing, and folding it into a clean bill is the confident zero " +
   "wearing the one sign this page draws above everything else");

const all13 = await warnsText([], { warningsChecked: 13, warningsQuestions: 13 });
ok(/every check this briefing carries, so the sweep was complete/.test(all13),
   "while a briefing where all thirteen questions could be asked says the sweep was " +
   "complete — the qualification is withheld when it is not earned, exactly as the clean " +
   "bill is");

const nocount = await warnsText([], {});
ok(!/No inconsistency was found/.test(nocount),
   "a briefing carrying an empty warnings list and NO count of the checks that ran states " +
   "no clean bill either: without the denominator an empty list is exactly as consistent " +
   "with thirteen questions answered as with none asked, and the page cannot tell which");
ok(/cannot tell an empty list from an unasked question/i.test(nocount),
   "and says so in those terms, rather than falling back on the strongest of the readings " +
   "the evidence still permits");

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

const norate = await meterOf(SPEND({ neurons: null, remaining: null }));
ok(!/10,000/.test(norate.open),
   "with no rate configured the spend is UNKNOWN, and an unknown spend is not printed as a " +
   "full allowance: Number(null) === 0 reaching the subtraction would render 10,000 of " +
   "10,000 left on a day this route may have emptied it, which is the confident zero this " +
   "codebase is organised against — arriving through arithmetic rather than through a field");
ok(/7 times today/.test(norate.open),
   "the call count is still printed, because it was still measured — withholding the derived " +
   "figure is not a reason to withhold the measurement it was derived from");
ok(/rate for a model this site asked is not set/i.test(norate.open),
   "and the reason is named, so a reader can tell a missing rate from a spent allowance — " +
   "worded for the two configured models, since the fallback is billed at its own rate");

const fresh = await meterOf(SPEND({ calls: 0, tokensIn: 0, tokensOut: 0,
  neurons: 0, remaining: 10000 }));
ok(/10,000 of 10,000/.test(fresh.open),
   "and the control that keeps the assertion above from passing against a renderer that " +
   "simply never prints an allowance: a morning before the first question really is 10,000 " +
   "of 10,000, a measured zero spend rather than an unmeasured one, and it says so");
ok(fresh.width === 100,
   "with a full track, drawn rather than withheld");

const drained = await meterOf(SPEND({ neurons: 10000, remaining: 0 }));
ok(drained.hasBar && drained.width === 0,
   "a spent budget still draws its track: a gauge that renders as nothing at zero is " +
   "indistinguishable from a gauge that failed to draw, and those are the two states this " +
   "box most needs to keep apart");
ok(/Asking is still allowed/i.test(drained.open),
   "and it says asking is still allowed, because this meter is a gauge and not a gate — the " +
   "figures in an answer were measured by the pipeline and cost no model call, so a reader " +
   "at zero loses the phrasing and nothing else");

const unread = await meterOf({ spend: null });
ok(unread.emptyKind === "unreadable",
   "a route that looked and could not read the meter gets the unreadable mark, not the " +
   "quiet one: a quiet meter would read as a day on which nothing was spent, which is " +
   "exactly the reading the fresh-morning case above is entitled to and this one is not");
ok(/Nothing follows from that about the allowance/i.test(unread.open),
   "and it says what does not follow, rather than leaving a reader to decide whether a " +
   "blank meter means the budget is gone");

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

  q.dispatchEvent(new KeyboardEvent("keydown", {
    key: "Enter", keyCode: 229, isComposing: true, bubbles: true, cancelable: true }));
  return { before, after: document.getElementById("askAnswer").textContent };
});
ok(composed.after === composed.before,
   "an Enter that belongs to an input method editor's composition does not send: it is the " +
   "keystroke COMMITTING a Japanese, Chinese or Korean word, and sending on it would submit " +
   "a half-typed question and eat the key that was finishing it");

await page.unroute("**/api/flows/ask");

{
  const DOCK_FACTS = [
    { id: "board:short/lead", topic: ["short", "board"], source: "board:short", at: STAMP,
      say: "The short board's leading name is SYN35 at 58.", n: { score: 58 } },
    { id: "board:long/tilt", topic: ["long", "board"], source: "board:long", at: STAMP,
      say: "The long board cleared 44 of 118 names.", n: { cleared: 44, scored: 118 } },
  ];
  const dockAnswer = (over) => ({
    answer: "These are the published readings that bear on what you asked.\n\n" +
      DOCK_FACTS.map((f) => "- " + f.say).join("\n") + "\n\n" +
      "Every figure above is quoted from a payload this pipeline published; none of it " +
      "was computed for this answer.",
    llm: false, model: null, capped: false, guard: null, silences: null,
    why: "Picked 2 of the 2 facts that matched the words board.",
    note: "No model is configured for this route.", facts: DOCK_FACTS, ...(over || {}),
  });

  let posted = null;
  await page.route("**/api/flows/ask", (route) => {
    posted = route.request().postData();
    route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify(dockAnswer(JSON.parse(posted).subject
        ? { subject: JSON.parse(posted).subject, subjectApplied: true } : null)) });
  });

  await page.goto(url("/flows/history/"), { waitUntil: "networkidle" });
  await page.evaluate(() => document.body.focus());
  await page.keyboard.press("?");

  const opened = await page.waitForSelector("#askQ", { timeout: 5000 })
    .then(() => true, () => false);
  ok(opened,
     "one press of \"?\" opens the rail. flows-dock.js said the box was \"one key away\" from " +
     "the day it shipped and registered no shortcut of any kind — the sentence describing " +
     "the affordance was the whole of the affordance");
  const caret = await page.waitForFunction(
    () => document.activeElement && document.activeElement.id === "askQ", null,
    { timeout: 5000 }).then(() => true, () => false);
  ok(caret,
     "and the caret is in the field on the FIRST open, when the renderer was still in " +
     "flight at the moment the panel appeared: setOpen focuses whatever exists then, which " +
     "is the panel, and a reader who reached for a key to ask a question was left with the " +
     "caret nowhere and a mouse to pick back up");
  ok(await page.evaluate(() => document.getElementById("askDock").classList.contains("is-open")),
     "and the panel is marked open, which is what the tab's aria-expanded is read from");
  ok(await page.evaluate(() =>
       document.getElementById("askDockTab").getAttribute("aria-keyshortcuts") === "?" &&
       /\?/.test(document.querySelector(".ak-dock-tab-k").textContent)),
     "and the key is printed on the tab and announced on it, because a shortcut nobody is " +
     "told about is not an affordance — the same rule the question field's own label " +
     "applies to Enter");

  const opensOnto = await page.evaluate(() => {
    const app = document.getElementById("askApp");
    const walk = document.createTreeWalker(app, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walk.nextNode())) {
      if (!node.textContent.trim()) continue;
      if (node.parentElement.closest("details")) continue;
      return { said: node.textContent.trim().slice(0, 48),
               inExamples: !!node.parentElement.closest("#askExamples") };
    }
    return null;
  });
  ok(opensOnto && opensOnto.inExamples,
     "the first thing a reader meets in the opened rail is the examples: it used to be 335 " +
     "characters of guarantee and then the credit meter, 469 characters of chrome above an " +
     "empty box — first said was " + (opensOnto ? JSON.stringify(opensOnto.said) : "nothing"));
  ok(await page.evaluate(() => {
       const d = [...document.querySelectorAll("#askApp details")]
         .find((x) => /It reads nothing live/.test(x.textContent));
       return !!d && !d.open;
     }),
     "the guarantee is kept, whole, inside a closed disclosure: it is reassurance about " +
     "what the box will NOT do, and the fold rule allows reassurance to fold");

  ok(await page.waitForFunction(() => {
       const meter = document.querySelector("#askMeter");
       return !!meter && !meter.closest("details") && meter.textContent.trim().length > 0;
     }, null, { timeout: 5000 }).then(() => true, () => false),
     "while the meter stays open, because its numbers are a withholding about capacity: a " +
     "budget you can only see after spending from it is a receipt");

  await page.fill("#askQ", "what leads the short board");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".ak-dock .ak-facts", { timeout: 5000 });
  const fit = await page.evaluate(() => {
    const ul = document.querySelector(".ak-dock .ak-facts");
    const panel = document.querySelector(".ak-dock-panel");
    const cs = getComputedStyle(panel);
    const content = panel.clientWidth -
      parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const tracks = getComputedStyle(ul).gridTemplateColumns
      .split(" ").map(parseFloat).filter((n) => !Number.isNaN(n));
    return { content, track: Math.max(...tracks), rows: tracks.length,
             overflow: ul.scrollWidth - ul.clientWidth,
             pageOverflow: document.documentElement.scrollWidth -
               document.documentElement.clientWidth };
  });
  ok(fit.track <= fit.content + 0.5,
     "the widest grid track is " + fit.track.toFixed(1) + "px inside a " +
     fit.content.toFixed(1) + "px content box, so the evidence list fits the rail it is " +
     "drawn in. A bare minmax(30rem, 1fr) is a floor the track may not go under, and in a " +
     "27.2rem host it stayed 30rem and overflowed — on every desktop, on every answer");
  ok(fit.overflow <= 0.5,
     "and the list scrolls nothing horizontally inside itself (" +
     fit.overflow.toFixed(1) + "px)");
  ok(fit.pageOverflow <= 0.5,
     "nor does it push the document sideways (" + fit.pageOverflow.toFixed(1) + "px), which " +
     "is what an overflowing fixed rail does to the page it is pinned to");

  const dockSaid = await page.evaluate(() =>
    document.querySelector(".ak-dock #askAnswer").textContent);
  ok(dockSaid.split("The long board cleared 44 of 118 names.").length - 1 === 1,
     "each selected sentence appears exactly once in the answer region: on this branch the " +
     "answer IS the fact list, and the block below it used to print every sentence again");
  ok(/All of them come from the board:short key, built /.test(dockSaid) === false,
     "with two facts from two different keys the count line names no single origin for all " +
     "of them");
  ok(/1 of them comes from the board:/.test(dockSaid) &&
     /the other 1 names its own key and stamp under itself\./.test(dockSaid),
     "it states the majority origin with its denominator instead, and BOTH HALVES AGREE " +
     "WITH THEIR OWN COUNT at the 1-and-1 split this branch actually draws: \"1 of them " +
     "come ... the other 1 name their own key\" is prose a reader can see was assembled, " +
     "on a page whose whole claim is that a machine's wording can be told from the site's " +
     "own — " + dockSaid.slice(dockSaid.indexOf("2 facts were handed"),
       dockSaid.indexOf("2 facts were handed") + 200));

  await page.goto(url("/flows/history/?t=syn035"), { waitUntil: "networkidle" });
  await page.click("#askDockTab");
  await page.waitForSelector("#askQ", { timeout: 5000 });
  ok(await page.evaluate(() => {

       const p = document.querySelector(".ak-onpage");
       return p !== null && /Asking about SYN035 — the name on this page/.test(p.textContent);
     }),
     "the rail reads the name the page is showing off that page's own URL and says which " +
     "it is, for a SIX-character name: docked on every gated route, it knew neither the " +
     "route nor the name, so a reader who opened it over one name and typed \"what " +
     "changed\" was answered about the market — and a five-character bound would fail this " +
     "the same silent way, by rendering nothing");
  ok((await page.inputValue("#askQ")) === "",
     "and prefills nothing, because a field that opens holding a symbol has put words in a " +
     "reader's question that the reader did not write");
  await page.click(".ak-onpage-go");
  ok((await page.inputValue("#askQ")) === "SYN035",
     "the button inserts the symbol, for a reader who wants it inside a question of their own");

  await page.fill("#askQ", "what changed");
  await page.keyboard.press("Enter");
  await page.waitForSelector("#askAnswer .ak-asked", { timeout: 5000 });
  ok(posted !== null && JSON.parse(posted).subject === "SYN035",
     "the page's name travels to the route as its own field beside the question — not glued " +
     "onto the question here, because whether to use it depends on whether the reader named " +
     "a ticker themselves and shared/flows-ask.js is the module that decides that");
  ok(await page.evaluate(() => {
       const host = document.getElementById("askAnswer");
       const said = [...host.children]
         .filter((n) => !n.matches("details")).map((n) => n.textContent).join(" ");
       return /the name on the page this was asked from/.test(said);
     }),
     "and the answer says in the open that the page's name was added, because a reader who " +
     "typed no symbol and is handed readings selected by one is owed where it came from");

  await page.goto(url("/flows/history/?t=brk.b"), { waitUntil: "networkidle" });
  await page.click("#askDockTab");
  await page.waitForSelector("#askQ", { timeout: 5000 });
  ok(await page.evaluate(() => {
       const p = document.querySelector(".ak-onpage");
       return p !== null && /Asking about BRK\.B — the name on this page/.test(p.textContent);
     }),
     "a share-class symbol carrying a dot is a name here too: /flows/ticker serves ?t=BRK.B " +
     "and the rail is docked to that page, so a rail that refuses the string the route " +
     "accepted answers about the market and says nothing about having ignored the name");

  await page.goto(url("/flows/ask/?t=syn035"), { waitUntil: "networkidle" });
  await page.waitForSelector("#askQ", { timeout: 5000 });
  ok(await page.evaluate(() => document.getElementById("askDockTab") === null),
     "the ask route draws no dock tab, so this is the undocked mount and not a second one");
  ok(await page.evaluate(() => {
       const p = document.querySelector(".ak-onpage");
       return p !== null && /Asking about SYN035 — the name this link carried\./.test(p.textContent)
         && !/the name on this page/.test(p.textContent);
     }),
     "and it discloses the subject in wording that is true where it is drawn: undocked the " +
     "symbol came from the URL, not from a page showing SYN035, and the docked sentence " +
     "would point the reader at a card that is not on the screen");

  await page.unroute("**/api/flows/ask");
}

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
  `and an input method editor's composing Enter does neither; plus the docked rail ` +
  `measured in a browser: "?" opens it and the caret lands in the field on the first ` +
  `open, it opens onto three examples rather than onto 469 characters of chrome, the ` +
  `guarantee is folded whole and the credit meter is not, the evidence list fits inside ` +
  `the 27.2rem panel instead of hanging 2.8rem past its edge, each selected sentence is ` +
  `printed once, and the name the page is showing reaches the route as its own field and ` +
  `is declared in the open when the selection used it`);
