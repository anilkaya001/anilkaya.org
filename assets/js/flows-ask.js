/* THE QUESTION BOX, AND THE BRIEFING IT OPENS WITH.
 *
 * Renders /flows/ask/: a standing three-session briefing — the prior session,
 * this one, and what is already on the calendar for the next — followed by a
 * box that answers a typed question from the same published payloads.
 *
 * IT IS ALSO WHAT THE DOCKED RAIL MOUNTS, on every gated route but this one,
 * with `data-mode="dock"` and no briefing. Two mounts, one renderer: a second
 * implementation of the guard notice, the four fallback sentences and the
 * four silences is how two surfaces come to disagree about what the model was
 * allowed to do. Where a sentence differs it is because the MOUNT differs —
 * the rail draws no briefing, so it may not point at one — and every such
 * sentence names DOCKED at the point of use.
 *
 * THE BRIEFING IS DRAWN BEFORE ANYTHING IS ASKED, THE PAGE'S ONE STRUCTURAL
 * DECISION. Most readers arrive with the same question, and answering it only
 * after they have typed it charges a round trip and a model call for a
 * reading published hours ago. The box is for the second question.
 *
 * THE MODEL IS NEVER THE SOURCE OF A NUMBER, AND THIS FILE SAYS SO IN THE
 * OPEN. shared/flows-ask.js refuses a generated answer carrying a figure in
 * none of the facts it was handed; the route reports that verdict on
 * `guard`, and this page prints it rather than quietly serving the
 * replacement. A reader who cannot tell the model's prose from the site's
 * own has no way to weigh either.
 *
 * THE VOCABULARY RULE GOVERNING EVERY STRING HERE. Nothing here is a call, a
 * target or an outlook: the regions state what was MEASURED, what is
 * SCHEDULED (the calendar's own dated rows) and what is POSITIONED (a
 * published distance to a threshold). flows-brief.mjs scans the module's
 * next-session sentences for a verb that claims the future; prose written
 * HERE would wear the same authority beside them and pass no scan at all.
 *
 * THE SHELL THIS FILE NEEDS IS ONE ELEMENT. `#askApp` is the container and
 * the rest is built here, because markup carrying elements only one file
 * writes is a second copy of what that file already states. `#askStatus` and
 * `#askFoot` are used if the page provides them and mounted here if not, so
 * the page can never come up with no channel to report its own failure on.
 * It depends on no other bundle: the route's script list is not this file's
 * to write, and a renderer that blanks itself over a missing script tag
 * fails for a reason no reader can see.
 */
(function () {
  "use strict";

  /* THE PROVENANCE MARK, AND IT IS A GLYPH IN A FIXED POSITION. Who wrote
     the sentences a reader is looking at is the most load-bearing fact on
     this page, so it cannot be a tint: the mark sits at the front of the
     provenance line, the same place on every answer, and the sentence beside
     it says the same thing in words. Both glyphs are in the mono subsets
     this site self-hosts, so neither falls back mid-line. */
  var MARK_MODEL = "◆";   // the wording came back from the model and passed the guard
  var MARK_PLAIN = "▪";   // the wording was assembled here from the published facts

  /* A NUMBER, OR THE VENDOR'S QUOTED NUMBER, AND NOTHING ELSE. Byte-for-byte
     the body in flows-market.js and flows-ui.js. IT RETURNS THE READING, so
     `!isNum(x)` and `isNum(x) ?` are bugs rather than idioms: a measured 0
     is falsy and a measured 0 is a real reading. Ask `=== null`. */
  function isNum(v) {
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v !== "string") return null;
    if (v.trim() === "") return null;
    var n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  function text(s) {
    return document.createTextNode(s);
  }

  /* ---------- the silences, told apart in the DOM as well as in prose ----

     THREE SILENCES, THREE SENTENCES, THREE data-empty TAGS — the shape
     flows-market.js and flows-political.js already use, and the four marks
     flows.css draws for them. The tags make the distinction
     machine-checkable; the sentences make it useful to a reader. Only
     "quiet" is a claim about the market. */
  function emptyLine(kind, said) {
    var p = el("p", "flows-empty", said);
    p.setAttribute("data-empty", kind);
    return p;
  }

  /* A NOTE THAT COULD CHANGE WHAT THE READING MEANS stays in the open;
     flows.css reserves `.is-qualifier` for exactly that, with full ink and a
     rule down the left. Everything this page says about a spent allowance, a
     refused answer or a truncated list is one of these, which is why none is
     inside a disclosure. */
  function qualifier(said) {
    return el("p", "fc-note is-qualifier", said);
  }

  /* THE METHOD, BELOW THE FINDING AND NEVER INSTEAD OF IT. `.ft-how` and
     `.ft-how-s` are in flows.css already and are not route-scoped, so this
     reuses the disclosure vocabulary rather than inventing one. What goes in
     is derivation only: nothing a reader needs in order to weigh the
     sentence above it is ever folded away. <summary> is natively focusable,
     so the method is reachable by keyboard and by touch. */
  function howBox(summary, lines) {
    var box = el("details", "ft-how");
    box.append(el("summary", "ft-how-s", summary));
    for (var i = 0; i < lines.length; i++) {
      if (typeof lines[i] === "string" && lines[i] !== "") box.append(el("p", "fc-note", lines[i]));
    }
    return box;
  }

  /* ---------- the model budget --------------------------------------------

     DRAWN BEFORE IT IS SPENT: a budget visible only after you spend from it
     is a receipt. Fetched on load, redrawn from every answer.

     THE CONDITION DOES NOT FOLD, which is the fold rule applied rather than
     an exception to it: "8,412 left" means one thing if this site is the
     only thing drawing on the account and another if it is not, so
     "counting only this site's own calls" is the number's units and not
     reassurance about it. The derivation folds; the condition does not.

     THE BAR IS NOT THE READING — the same two numbers as the text,
     aria-hidden, because a reading whose only output is a length does not
     survive greyscale or a screen reader. */

  function meterFigure(n) {
    /* GROUPED FOR THE EYE, and the one place here where reformatting a
       number is right. `factPins` prints payload values raw so they can be
       audited against the payload; this figure comes from no payload — it is
       this site's accounting of its own calls, so there is no stored string
       a separator could disagree with. */
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function spendMeter(spend, reason) {
    var box = el("div", "ak-meter");

    /* THE METER'S OWN SILENCE, NOT THE MARKET'S. "unreadable" and not
       "quiet": a quiet meter reads as a day on which nothing was spent,
       which is a reading this branch has not earned. */
    if (!spend || typeof spend !== "object") {
      box.append(emptyLine("unreadable", "This page could not read what has been spent on " +
        "the model today" + (reason ? " (" + reason + ")" : "") + ". Nothing follows from " +
        "that about the allowance or about the readings below, and a question can still be " +
        "asked: Cloudflare reports a spent allowance itself, and it is the authority here."));
      return box;
    }

    var allowance = isNum(spend.allowanceNeurons);
    var left = isNum(spend.remaining);
    var spent = isNum(spend.neurons);
    var calls = isNum(spend.calls);
    var tokIn = isNum(spend.tokensIn);
    var tokOut = isNum(spend.tokensOut);

    var how = [];
    if (typeof spend.day === "string" && spend.day !== "") {
      how.push("The day is " + spend.day + ", counted in UTC because that is the calendar " +
        "the allowance resets on — at 00:00 UTC, not at midnight where you are.");
    }
    if (calls !== null) {
      how.push("This site has asked the model " + meterFigure(calls) + " time" +
        (calls === 1 ? "" : "s") + " today" + (tokIn !== null && tokOut !== null
          ? ", for " + meterFigure(tokIn) + " tokens in and " + meterFigure(tokOut) +
            " tokens out. Tokens are what the model itself reported; the credit figure is " +
            "arithmetic over them at the published rate for the configured model, done when " +
            "this page was drawn rather than stored, so a corrected rate repairs the whole " +
            "history rather than leaving it stamped at yesterday's."
          : "."));
    }
    how.push("Cloudflare is the authority on the allowance and this meter is not. It can " +
      "only see calls this site made; anything else on the same account draws from the same " +
      "pool and is invisible here. If a question comes back saying the allowance is spent " +
      "while this still shows credits left, that difference is the answer — something else " +
      "spent them — and the answer will say so.");

    /* NO RATE, NO CREDIT FIGURE — AND THE CALLS ARE STILL REPORTED. The
       rate is configuration and can be absent; the token counts are
       measurements either way, and credits derived from a guessed rate would
       read plausibly and be wrong. `=== null`, not truthiness: a measured 0
       spent is the reading every morning before the first question. */
    if (left === null || allowance === null) {
      var said = calls === null
        ? "What has been spent on the model today could not be counted."
        : "This site has asked the model " + meterFigure(calls) + " time" +
          (calls === 1 ? "" : "s") + " today.";
      box.append(el("p", "ak-meter-say", said + " The credits that cost is not shown: the " +
        "per-token rate for the configured model is not set here, and deriving one would " +
        "put a plausible wrong number where a measurement belongs."));
      box.append(howBox("How this is counted", how));
      return box;
    }

    var pct = allowance > 0 ? Math.max(0, Math.min(1, left / allowance)) : 0;
    var bar = el("div", "ak-meter-bar");
    bar.setAttribute("aria-hidden", "true");
    var fill = el("span", "ak-meter-fill");
    fill.style.width = (pct * 100).toFixed(1) + "%";
    bar.append(fill);
    box.append(bar);

    var say = el("p", "ak-meter-say");
    say.append(el("strong", "ak-meter-n",
      meterFigure(left) + " of " + meterFigure(allowance)));
    /* "model credits" rather than "neurons": the reader is told what they
       have left, not what the billing unit is called. The fold names the
       unit for anyone checking. */
    say.append(text(" model credits left today · counting only this site's own calls"));
    box.append(say);

    /* THE EMPTY METER IS A DIFFERENT SENTENCE. "0 of 10,000" reads as a
       closed door and is not one: nothing here refuses a question, and the
       readings an answer is built from cost no model call. */
    if (left === 0) {
      box.append(qualifier("By this count today's model credits are gone. Asking is still " +
        "allowed and nothing here refuses it — and if the model does decline, the answer is " +
        "still served: every figure in it was measured by the pipeline, and only the phrasing " +
        "would have come from a model."));
    }

    if (spent !== null) {
      how.unshift("Spent so far today: " + meterFigure(spent) + " of " +
        meterFigure(allowance) + " credits, rounded up. A meter that rounded a spend down " +
        "would report less spent than was spent, so this errs toward showing less left.");
    }
    box.append(howBox("How this is counted", how));
    return box;
  }

  /* THE HEADING IS THE QUESTION, SO THE QUESTION IS NOT PRINTED TWICE.
     Each region carried a heading and under it a restatement — "Since the
     prior session", then "What is different from the last session this
     pipeline measured?" — which taught a reader nothing, three times, on a
     page its owner had called too wordy. `asks` survives as the fold's
     summary, where it says what opening the disclosure will explain. */
  /* A NULL HEADING DRAWS NO HEADING, which is how the docked mount stops
     printing the rail's title twice. `.ak-dock-panel` carries "Ask about
     what has been published" in its head and this panel repeated it three
     elements below; the stylesheet hid the second with `display: none`,
     which conceals a duplicate rather than not making one — and a heading
     in the DOM is still in the accessibility tree and still read out. */
  function panel(id, extraClass, heading) {
    var section = el("section", "fc-panel ak-panel " + extraClass);
    section.id = id;
    if (heading) section.append(el("h2", "fc-panel-h", heading));
    return section;
  }

  /* A STAMP IS PRINTED AS PUBLISHED WHEN IT CANNOT BE PARSED: "Invalid
     Date" is this page's word for what was actually stored, and only the
     stored string can be taken to the job log. The absent case is not this
     function's to word — it returns null and the caller says which absence
     it is. */
  function stampSaid(at) {
    if (typeof at !== "string" || at.trim() === "") return null;
    var ms = Date.parse(at);
    if (!isFinite(ms)) return at;
    return new Date(ms).toLocaleString();
  }

  /* ---------- a fact, with the key it came from and the run that made it --

     EVERY FACT CARRIES ITS SOURCE AND ITS STAMP, and neither is
     decoration: two sentences from two keys read alike, and one from a key
     that stopped publishing three days ago reads like one from this
     morning. THE STAMP IS THE KEY'S, NOT THE FACT'S, and the wording is
     "built" — the moment the run wrote the key, the only moment either side
     of this wire measured. */
  /* THE HEADLINE FIGURE, READ FROM `n` AND NEVER FROM THE SENTENCE. The
     module that built the sentence attaches `lead` — a label and the KEYS
     that lead — because it is the only one that knows which numeral is the
     reading. A regex over `say` would lift "53" out of "SYN053 fell 15
     places" as willingly as out of "53 lean bearish", and a headline taken
     from a ticker is a confident wrong number in the page's largest type.
     AN ABSENT VALUE IS AN EM DASH, NOT A ZERO; isNum RETURNS the reading,
     so it is compared `=== null` — a measured 0 is a real headline, and
     often the interesting one. */
  function leadFigure(fact) {
    var spec = fact && fact.lead;
    if (!spec || !Array.isArray(spec.keys) || !spec.keys.length) return null;
    var n = fact.n && typeof fact.n === "object" ? fact.n : {};
    var box = el("div", "ak-fig");
    if (spec.label) box.append(el("p", "ak-fig-l", spec.label));
    var row = el("p", "ak-fig-v");
    for (var i = 0; i < spec.keys.length; i++) {
      if (i) row.append(el("span", "ak-fig-sep", "/"));
      var v = isNum(n[spec.keys[i]]);
      row.append(el("span", "ak-fig-n" + (v === null ? " is-absent" : ""),
        v === null ? "\u2014" : String(v)));
    }
    if (spec.unit) row.append(el("span", "ak-fig-u", spec.unit));
    box.append(row);
    /* THE DENOMINATOR TRAVELS WITH THE PAIR. "44 / 53 NAMES" set large,
       with "out of 100 scored" only in the sentence below, is a pair a
       reader takes for the whole population. Absent, it says so rather than
       dropping the line: a pair printed with no denominator at all is the
       state this exists to prevent. */
    if (spec.den && spec.den.key) {
      var d = isNum(n[spec.den.key]);
      box.append(el("p", "ak-fig-d", d === null
        ? "of an unpublished total"
        : "of " + d + (spec.den.word ? " " + spec.den.word : "")));
    }
    return box;
  }

  /* THE PROVENANCE LINE, OR NULL WHERE IT WOULD ONLY RESTATE THE REGION'S.
     Split out of factItem so the list that must NOT reprint the sentences
     can still draw this, and so the "only where it differs" rule below
     lives in one place rather than in two callers that would drift. */
  function provLine(fact, fallbackSource, fallbackAt) {
    var key = fact && typeof fact.source === "string" && fact.source ? fact.source : fallbackSource;
    var at = fact && typeof fact.at === "string" && fact.at ? fact.at : fallbackAt;
    if (key === fallbackSource && at === fallbackAt) return null;
    var line = el("p", "ak-fact-src");
    line.append(el("span", "ak-src-key",
      typeof key === "string" && key ? key : "no source key on this fact"));
    line.append(text(" · "));
    var said = stampSaid(at);
    line.append(el("span", "ak-src-at",
      said === null ? "no build stamp published on this key" : "built " + said));
    return line;
  }

  function factItem(fact, fallbackSource, fallbackAt, lead) {
    var li = el("li", "ak-fact" + (lead ? " is-lead" : ""));
    var say = fact && typeof fact.say === "string" ? fact.say : "";
    /* THE FIGURE IS DRAWN ABOVE THE SENTENCE AND NEVER INSTEAD OF IT. On
       its own it has lost its units, its denominator and every
       qualification the sentence carries. */
    var fig = leadFigure(fact);
    if (fig) li.append(fig);
    /* A FACT THAT ARRIVED WITHOUT ITS SENTENCE IS NAMED, NOT DRAWN BLANK,
       the treatment silenceLine() gives a silence that lost its wording. An
       empty paragraph still counted toward the "N readings were published
       for this region" line above, so the region stated a count and showed
       white space: a gap in the payload wearing the look of a rendering
       fault, and named as neither. */
    if (say.trim() === "") {
      li.append(emptyLine("unreadable",
        "A reading was published for this region without the sentence that states it, so " +
        "this page has nothing to show for it. That is a gap in the payload rather than a " +
        "fact about the session."));
    } else {
      li.append(el("p", "ak-fact-say fc-reading" + (lead ? " is-lead" : ""), say));
    }

    /* PROVENANCE ONLY WHERE IT DIFFERS FROM THE REGION'S. One key and one
       stamp per run drawn under every sentence is the identical line twelve
       times down one screen — not provenance but wallpaper, and a reader who
       stops reading it cannot see the morning a sentence really does come
       from a different key with an older stamp. The header states it once; a
       fact draws its own ONLY when it disagrees. */
    var line = provLine(fact, fallbackSource, fallbackAt);
    if (line) li.append(line);
    return li;
  }

  /* THE FIRST FACT IS THE FINDING AND IS SIZED AS ONE. flows.css records
     the survey behind `.fc-reading.is-lead`: across fourteen renderers the
     method paragraph was emitted 87 times against 4 emissions of the
     finding. The briefing emits its headline sentence first by construction
     — the tilt before the top name — so promoting index 0 promotes the
     finding rather than whatever sorted first. */
  function factList(facts, source, at) {
    var ul = el("ul", "ak-facts");
    for (var i = 0; i < facts.length; i++) ul.append(factItem(facts[i], source, at, i === 0));
    return ul;
  }

  /* THE SAME LIST WITH THE SENTENCES LEFT OUT. On every fallback branch —
     fired guard, spent allowance, no model — the served ANSWER is
     renderFactsPlain, one dashed line per fact, so the full list under it
     printed every sentence twice. What is left is what the count line
     promises: the key and the run. No figure either, since this file's rule
     is that a figure is drawn ABOVE its sentence and the sentence is
     elsewhere. NULL where every fact shares the origin already stated,
     rather than a list of empty rows. */
  function provList(facts, source, at) {
    var ul = el("ul", "ak-facts is-prov");
    var drawn = 0;
    for (var i = 0; i < facts.length; i++) {
      var line = provLine(facts[i], source, at);
      if (line === null) continue;
      var li = el("li", "ak-fact");
      li.append(line);
      ul.append(li);
      drawn++;
    }
    return drawn ? ul : null;
  }

  /* THE KEY AND THE STAMP MOST OF THESE FACTS SHARE, MEASURED. paintAnswer
     called factList(facts, null, null), which turns the "only where it
     differs" rule off, since nothing equals null. paintRegion knows its own
     key; an answer selects across seventeen surfaces and has none, so the
     default is the (key, stamp) PAIR most of the facts carry — the pair and
     not the halves, because a fact agreeing on the key and disagreeing on
     the stamp is the case the line exists for. `n` is the majority's size,
     so the caller prints it with a denominator. */
  function commonOrigin(facts) {
    var best = null, i, j;
    for (i = 0; i < facts.length; i++) {
      var f = facts[i];
      var key = f && typeof f.source === "string" && f.source ? f.source : null;
      var at = f && typeof f.at === "string" && f.at ? f.at : null;
      var n = 0;
      for (j = 0; j < facts.length; j++) {
        var g = facts[j];
        if ((g && typeof g.source === "string" && g.source ? g.source : null) === key &&
            (g && typeof g.at === "string" && g.at ? g.at : null) === at) n++;
      }
      if (best === null || n > best.n) best = { source: key, at: at, n: n };
    }
    return best;
  }

  /* IS THE ANSWER ABOVE THIS LIST THE LIST ITSELF? Measured against the
     served text, not inferred from `llm` — which reports whether a model
     was ASKED and not whose wording is served, and this file has been wrong
     once already for reading it the other way. Every fact's sentence must
     appear as one of the answer's dash-prefixed lines; one that does not
     means the prose is not the list and nothing below is a repeat. */
  function answerEchoes(said, facts) {
    if (typeof said !== "string" || said === "" || !facts.length) return false;
    var lines = said.split("\n");
    var bullets = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (/^-\s+/.test(line)) bullets.push(line.replace(/^-\s*/, ""));
    }
    for (var j = 0; j < facts.length; j++) {
      var say = facts[j] && typeof facts[j].say === "string" ? facts[j].say.trim() : "";
      if (say === "" || bullets.indexOf(say) === -1) return false;
    }
    return true;
  }

  /* ---------- the three silences, kept three ------------------------------

     TWO SHAPES ARRIVE AND BOTH MEAN THE SAME THING. flows-brief hands each
     section an ARRAY of {kind, what, say}; flows-ask keeps its index's
     silences in NAMED LISTS so a caller cannot sum them by accident. This
     normalises both into one array without collapsing the kinds, because
     the kind is the whole point: a job that has not run and a market that
     was quiet are two facts, and one sentence would serve them as one. */
  var SILENCE_ORDER = ["pending", "unreadable", "quiet"];

  function silenceList(value) {
    var out = [];
    var i, j;
    if (Array.isArray(value)) {
      for (i = 0; i < value.length; i++) {
        if (value[i] && typeof value[i] === "object") out.push(value[i]);
      }
      return out;
    }
    if (!value || typeof value !== "object") return out;
    for (i = 0; i < SILENCE_ORDER.length; i++) {
      var bucket = value[SILENCE_ORDER[i]];
      if (!Array.isArray(bucket)) continue;
      for (j = 0; j < bucket.length; j++) {
        var q = bucket[j];
        if (!q || typeof q !== "object") continue;
        /* THE LIST A SILENCE WAS FILED UNDER IS THE KIND, and the entry's
           own field is not consulted. `q.kind || SILENCE_ORDER[i]` trusted
           the field and fell back to the list, so a reading filed under
           `quiet` carrying kind:"pending" wore the mark for a job that has
           not run — a measured, empty market reported as a pipeline that
           never ran, the one confusion this page exists to prevent. */
        out.push({ kind: SILENCE_ORDER[i], what: q.what, say: q.say,
          source: q.source, reason: q.reason });
      }
    }
    return out;
  }

  function silenceLine(q) {
    var said = typeof q.say === "string" && q.say.trim() !== "" ? q.say : null;
    var kind = SILENCE_ORDER.indexOf(q.kind) === -1 ? "unavailable" : q.kind;
    /* A SILENCE THAT ARRIVED WITHOUT ITS SENTENCE IS STILL DRAWN. The
       publisher words these and this page prints them verbatim, so a missing
       one is a gap in the payload rather than in the session — and dropping
       the row turns a payload defect into a region that quietly shrank,
       which is how the briefing lost its sector section once. */
    var p = emptyLine(kind, said === null
      ? "A silence was published for " + (q.what || "this surface") +
        " without the sentence that explains it, so this page cannot say which " +
        "of the three it is. That is a gap in the payload rather than a fact " +
        "about the session."
      : said);
    if (typeof q.reason === "string" && q.reason) p.append(text(" (" + q.reason + ")"));
    if (typeof q.source === "string" && q.source) {
      /* THE KEY THAT WAS SILENT, NAMED. A silence answers to a publish key
         the way a reading does, and a reader who cannot see which key went
         quiet cannot check whether it came back. Written as a clause rather
         than a bare token: a monospace word hanging off the end of a
         sentence reads as a fragment. */
      p.append(text(" Source key: "));
      p.append(el("span", "ak-src-key", q.source));
      p.append(text("."));
    }
    return p;
  }

  /* THE ORDER IS FIXED AND THE KINDS DO NOT MIX. Publication order puts a
     pending line between two quiet ones on one run and not the next, and a
     reader learning the four marks does not also need a new order every
     morning. An unknown kind is drawn last rather than dropped. */
  function paintSilences(host, list) {
    var drawn = 0, i, j;
    for (i = 0; i < SILENCE_ORDER.length; i++) {
      for (j = 0; j < list.length; j++) {
        if (list[j].kind !== SILENCE_ORDER[i]) continue;
        host.append(silenceLine(list[j]));
        drawn++;
      }
    }
    for (j = 0; j < list.length; j++) {
      if (SILENCE_ORDER.indexOf(list[j].kind) !== -1) continue;
      host.append(silenceLine(list[j]));
      drawn++;
    }
    return drawn;
  }

  /* ---------- the standing briefing --------------------------------------

     THE THREE REGIONS ARE DRAWN IN CHRONOLOGICAL ORDER, prior session
     first: where three sessions sit on one page, any order but time's own
     has to be taught. EACH REGION LEADS WITH ITS FINDING — sentences first
     at reading size, then the qualifications that could change what they
     mean, then the silences, and only the derivation behind a disclosure. */
  var REGIONS = [
    {
      slot: "yesterday",
      id: "askYesterday",
      heading: "Since the prior session",
      asks: "What is different from the last session this pipeline measured?",
      /* The comparand, which the briefing's own suite asserts the section
         names: a count of names that entered the board means nothing until
         the board it entered against is dated. */
      qualify: function (section) {
        var said = [];
        var prior = typeof section.prior === "string" && section.prior ? section.prior : null;
        said.push(prior === null
          ? "This region names no comparand, so the movement above is not anchored to a " +
            "dated session and cannot be read as an overnight change."
          : "Every count above is measured against the " + prior + " session, which is the " +
            "board this run compared itself with.");
        return said;
      },
      how: [
        "The movement is read off fields the run stamps on each board row — where a name " +
          "stood in the prior session, how many places it moved, whether it is new or held " +
          "over — rather than from this page subtracting two payloads.",
        "That distinction is the whole reason the region is trustworthy. A subtraction done " +
          "here has no way to tell a name that was not scored in the prior session from one " +
          "that scored identically, so it reports a name last seen three weeks ago as an " +
          "overnight mover.",
      ],
    },
    {
      slot: "today",
      id: "askToday",
      heading: "Where the session stands",
      asks: "What did this run measure across the two boards?",
      qualify: function (section) {
        var said = [];
        var session = typeof section.session === "string" && section.session
          ? section.session : null;
        said.push(session === null
          ? "No session date was published beside these readings, so nothing here can be " +
            "tied to a trading day. That is a gap in the payload rather than a quiet market."
          : "These readings are from the " + session + " session.");
        return said;
      },
      how: [
        "The tilt counts the whole side rather than the page. A board publishes how many " +
          "names cleared the dead band and, separately, how many rows fitted on it, and the " +
          "count above is the first of those — a page count would understate the session.",
        "The leading name on each side is the row the run itself ranked first. This page does " +
          "no sorting: a renderer that re-ranked could disagree with the board it links to, " +
          "for the same session, on the same numbers.",
      ],
    },
    {
      slot: "next",
      id: "askNext",
      heading: "Next session: scheduled, and positioned",
      asks: "What is already on the calendar, and what sits on a threshold?",
      /* NOTHING IN THIS REGION CLAIMS THE FUTURE, and the wording is chosen
         to survive the verb scan tests/flows-brief.mjs runs over the
         module's next-session sentences, beside which this prose sits
         wearing the same authority. An earnings date is a published calendar
         entry; a distance to a threshold is a subtraction over two numbers
         measured today. Neither is a claim about a price. */
      qualify: function (section) {
        var said = [];
        var origin = typeof section.origin === "string" && section.origin ? section.origin : null;
        var gate = isNum(section.gateDays);
        said.push(origin === null
          ? "No origin date was published for this region, so the day counts above are not " +
            "anchored and cannot be read as distances from any particular session."
          : "Every day count above is measured from the " + origin + " session, not from the " +
            "clock on this device — a briefing opened on a Saturday about the next session " +
            "is a briefing about Monday.");
        if (gate !== null) {
          said.push("The gate carries a name for " + gate + " calendar day" +
            (gate === 1 ? "" : "s") + " from that origin, and the calendar entries above are " +
            "the ones inside it.");
        }
        /* THE PAYLOAD'S OWN DECLARATION, READ RATHER THAN ASSUMED. The
           module returns a literal false here. A payload not carrying it came
           from something else, and claiming otherwise would assert a
           guarantee this page never received. */
        /* THE REASSURANCE FOLDS; THE WITHHOLDING NEVER DOES, and the
           asymmetry is the whole rule. "Declared measured rather than
           projected" tells a reader what they already assume. "This payload
           does not declare it, so this page withholds that claim" changes
           how every line above reads, and a caveat folded is a caveat
           unread. Marked with a `fold` flag rather than by matching text: a
           fold keyed on wording hides the wrong arm after a rephrasing. */
        said.push(section.isForecast === false
          ? { say: "This section is declared measured rather than projected: every line in " +
              "it is either an entry already on a published calendar or a distance between " +
              "two numbers measured today. Nothing here is a claim about a future price.",
              fold: true }
          : "This payload does not declare the section measured rather than projected, so " +
            "this page withholds that claim. Read the lines above as what they say and " +
            "nothing further.");
        return said;
      },
      how: [
        "The threshold distance is quoted from the watch list's published residual and never " +
          "from its integer score, which is zero for every row inside the band — reading the " +
          "score would report the whole band as one undifferentiated tie.",
        "A negative days-to-earnings is withheld rather than read as due today. It means the " +
          "vendor's date is stale, and a stale date presented as an imminent one is the more " +
          "expensive of the two mistakes.",
      ],
    },
  ];

  function paintRegion(cfg, brief) {
    var section = panel(cfg.id, "ak-region", cfg.heading);
    var regionMeta = null;
    var payload = brief && typeof brief === "object" ? brief[cfg.slot] : null;

    if (!payload || typeof payload !== "object") {
      /* PUBLISHED, AND THIS REGION IS NOT ON IT — distinct from a key never
         published at all, which the caller has handled. This is a briefing
         that answered and carried no section under this name, which happens
         to a page reading a payload written before the section existed. */
      section.append(emptyLine("unavailable",
        "The briefing was published and carried no section for this region, so there is " +
        "nothing here to read. A gap in the payload rather than a fact about the session."));
      return section;
    }

    var facts = Array.isArray(payload.facts) ? payload.facts : [];
    var silences = silenceList(payload.silences);

    if (facts.length) {
      /* THE COUNT IS THE POPULATION, and on this region it genuinely is.
         Every other list here states a published denominator because its
         rows were capped on the wire; the briefing publishes a section whole
         and this page draws all of it, so the sentences in hand ARE the
         section. THE KEY AND THE STAMP ARE STATED ONCE, because factItem()
         draws a sentence's own provenance only where it DIFFERS from this,
         so this line has to carry the default or the page would show none.

         BOTH MOVE INTO THE FOLD. Every word is true and about the PAGE
         rather than the market, and three regions of it stood between a
         reader and the first number on every visit. FOLDED, NOT DELETED, on
         this file's usual test: does it change what a visible number MEANS?
         No — it qualifies the SET, and the set is complete, which is why
         folding it is safe; a truncated one could not go here. A sentence
         whose origin differs still draws provenance in the open. */
      var regionAt = brief && typeof brief.generatedAt === "string" ? brief.generatedAt : null;
      var regionSaid = stampSaid(regionAt);
      regionMeta = (facts.length === 1
        ? "1 reading was published for this region, and it is drawn."
        : facts.length + " readings were published for this region, and all of them are drawn.") +
        (regionSaid === null
          ? " They come from the brief key, which published no build stamp."
          : " All of them come from the brief key, built " + regionSaid + "; any sentence " +
            "below that came from somewhere else says so under itself.");
      section.append(factList(facts, "brief", regionAt));
    }

    var said = typeof cfg.qualify === "function" ? cfg.qualify(payload) : [];
    var folded = [];
    for (var i = 0; i < said.length; i++) {
      var q = said[i];
      if (q && typeof q === "object" && q.fold) { folded.push(q.say); continue; }
      section.append(qualifier(typeof q === "string" ? q : (q && q.say) || ""));
    }

    var drawn = paintSilences(section, silences);

    /* A SECTION WITH NEITHER A READING NOR A SILENCE IS A FAULT HERE, and
       it is named as one. The module emits a silence for every surface it
       could not read, so an empty section naming nothing means the shape on
       the wire and the shape this page reads have parted company — and
       saying so turns the next field rename into a visible sentence rather
       than a region that quietly stops appearing. */
    if (!facts.length && !drawn) {
      section.append(emptyLine("unreadable",
        "This section published no reading and named no silence, so this page cannot say " +
        "whether anything was measured. That is a fault on this page's side of the wire " +
        "rather than a fact about the session."));
    }

    /* THE FOLD'S SUMMARY IS THE QUESTION THE REGION ANSWERS, which is
       where `asks` went when it stopped being printed twice: as a summary
       it says what opening this will explain, which is more use than
       restating the heading. The region's count and stamp lead the folded
       lines, before the derivation. */
    section.append(howBox(cfg.asks || "How this region was derived",
      (regionMeta ? [regionMeta] : []).concat(folded).concat(cfg.how)));
    return section;
  }

  /* ---------- the answer ---------------------------------------------------

     WHY THE ROUTE'S OWN SENTENCE IS PREFERRED TO THIS FILE'S: a renderer
     that rewords a caveat has turned it into a claim. The map below is only
     for a route that sends a reason CODE and no sentence, and the last arm
     is the honest one — a model that did not answer for a reason nobody can
     read is a third fact, not the same fact as a spent allowance. */
  /* THE WORD AND THE CODE SHARE ONE SENTENCE OBJECT rather than one copy
     each. worker.js sends the cause as a word on `llmFailure` and Cloudflare
     numbers the same three outcomes, so each was written out twice here —
     two strings a later edit could improve one of. */
  var R_SPENT = "The free daily allowance for the model is spent, and it resets at 00:00 UTC.";
  var R_BUSY = "The model had no capacity for this question just now, and nothing of today's " +
    "allowance went on it.";
  var R_PLAN = "The model this site asks for is not available on the plan it runs on, which " +
    "is a configuration fault here rather than a limit anyone hit.";
  var LLM_REASONS = {
    allowance: R_SPENT, "3036": R_SPENT,
    capacity: R_BUSY, "3040": R_BUSY,
    plan: R_PLAN, "5035": R_PLAN,
    unreachable: "The model was unreachable for this question.",
    off: "The model is switched off for this route, so every answer here is assembled from " +
      "the published facts.",
  };

  function llmBlock(payload) {
    var v = payload.llm;
    var obj = v && typeof v === "object" ? v : null;
    /* A BOOLEAN IS READ AS A BOOLEAN AND NOTHING ELSE IS COERCED INTO ONE.
       `payload.llm` may arrive as the flag itself or as a block carrying the
       flag beside its reason, and anything else means the route did not state
       it — which this page reports rather than guessing at. */
    var used = null;
    if (v === true || v === false) used = v;
    else if (obj && typeof obj.used === "boolean") used = obj.used;
    else if (obj && typeof obj.llm === "boolean") used = obj.llm;

    /* THE ROUTE'S OWN SENTENCE IS LOOKED FOR, AND IT IS CALLED `note`.
       worker.js words all four no-model outcomes there, and this block read
       `llmReason`, which nothing on this wire has ever sent — so all four
       arrived absent and left as "the route did not state why": the reader
       was told the cause was unknown in the case where it had been named. */
    var published = null;
    if (obj && typeof obj.reason === "string" && obj.reason.trim() !== "") published = obj.reason;
    else if (typeof payload.llmReason === "string" && payload.llmReason.trim() !== "") {
      published = payload.llmReason;
    } else if (typeof payload.note === "string" && payload.note.trim() !== "") {
      published = payload.note;
    }
    /* `llmFailure` CARRIES THE CAUSE AS A WORD, and the four words the route
       uses for it are four of the keys in LLM_REASONS above. It is read after
       the numeric codes so a route that later sends one loses nothing. */
    var code = obj && obj.code !== undefined && obj.code !== null ? String(obj.code)
      : (payload.llmCode !== undefined && payload.llmCode !== null ? String(payload.llmCode)
        : (typeof payload.llmFailure === "string" && payload.llmFailure.trim() !== ""
          ? payload.llmFailure.trim() : null));

    /* THE COUNT IS LOOKED FOR IN BOTH PLACES RATHER THAN IN WHICHEVER ONE
       HAPPENED TO EXIST. A block that carries the flag and not the count is a
       shape the route is free to send, and reading only the block would drop
       a count published beside it — silently, which is the one way a missing
       number is worse than an absent one. */
    var calls = isNum(obj ? obj.calls : null);
    if (calls === null) calls = isNum(payload.llmCalls);
    var model = obj && typeof obj.model === "string" && obj.model ? obj.model
      : (typeof payload.model === "string" && payload.model ? payload.model : null);

    return { used: used, published: published, code: code, calls: calls, model: model };
  }

  function llmLine(block, fired, guard) {
    var line = el("p", "ak-prov");
    /* A REFUSED ANSWER IS NOT THE MODEL'S WORDING, WHATEVER `llm` SAYS. The
       flag reports that a model was ASKED; the guard reports whether what it
       wrote survived. Reading only the first prints "the model wrote this"
       above "the generated wording was discarded" and leaves the reader to
       pick. The guard is read first because it is the later fact. */
    if (fired) {
      line.append(el("span", "ak-prov-mark", MARK_PLAIN));
      /* A FIRED GUARD IS ITSELF THE PROOF THAT A MODEL WROTE SOMETHING, so
         the flag is not consulted here. `llm` reports whose wording is
         SERVED, and on a refusal that is the pipeline's. Read as "was a
         model asked", that false printed "No model wrote any part of it"
         above the qualifier explaining that the model's wording had been
         discarded — two of this page's sentences to choose between. */
      line.append(text(" The wording above was assembled here from the published facts, in a " +
        "fixed order. A model was asked this question and what it wrote was refused before " +
        "it reached this page. Every figure in it is quoted from a payload."));
      return line;
    }
    if (block.used === true) {
      line.append(el("span", "ak-prov-mark", MARK_MODEL));
      /* A SCAN THAT FOUND NOTHING TO SCAN IS NOT A SCAN THAT PASSED, and
         this line matters most: answerHow() refuses to call an empty scan a
         verification, but inside the disclosure, while this sentence is the
         one a reader meets. It read "every figure it wrote was checked" over
         an answer stating no figure. `=== null` is asked before 0: a
         measured 0 is the finding here. */
      var scanned = guard && Array.isArray(guard.numerals) ? guard.numerals.length : null;
      line.append(text(" The wording above came back from a language model, which was given " +
        "the measured facts and asked to restate them. " + (scanned === null
          ? "This page was not told whether the figures in it were checked against those " +
            "facts, so it makes no claim that they were."
          : scanned === 0
            ? "It states no figure, so there was none for the guard to check: what you are " +
              "reading is the model's prose over the facts listed below it."
            : "Every figure it wrote was checked against those same facts before this page " +
              "drew it.")));
      return line;
    }
    line.append(el("span", "ak-prov-mark", MARK_PLAIN));
    if (block.used === null) {
      line.append(text(" The route did not state whether a model wrote this wording, so this " +
        "page makes no claim either way. The facts below are the ones the answer was built " +
        "from, whoever phrased it."));
      return line;
    }
    /* A FALLBACK THAT DOES NOT ANNOUNCE ITSELF IS A LIE, and the reason is
       part of the announcement. One sentence, in the open, above the answer
       it explains — not a footnote, and never a spinner that resolves into
       silence. */
    var why = block.published !== null ? block.published
      : (block.code !== null && LLM_REASONS[block.code] ? LLM_REASONS[block.code] : null);
    line.append(text(" No model wrote this wording. " + (why === null
      ? "The route did not state why, which is a third answer and not the same as the " +
        "allowance being spent. "
      : why + " ") +
      "The reading above was assembled here from the published facts, in a fixed order, and " +
      "every figure in it is quoted from a payload."));
    return line;
  }

  /* THE GUARD'S VERDICT, READ FOR WHAT IT IS RATHER THAN FOR WHETHER IT
     IS TRUTHY. `rejected` is an ARRAY and an empty array is truthy, so `if
     (guard.rejected)` reports every answer as refused, the clean ones
     included. A boolean is read as a boolean, an array by its length, `ok`
     as its own inverse — this file's isNum rule: a helper that RETURNS
     something is compared, never asked for its truthiness. */
  function guardFired(guard) {
    if (!guard || typeof guard !== "object") return false;
    /* `ok` IS THE VERDICT AND IT IS ASKED FIRST. The module refuses an
       empty generation with {ok:false, rejected:[]} — a real refusal naming
       no token, there being no text to find one in — so counting `rejected`
       first reads that empty array as a pass and prints "every figure it
       wrote was checked" over an answer the guard threw away. `rejected`
       counts refused tokens; a measured 0 is a reading, not a verdict. */
    if (typeof guard.ok === "boolean") return !guard.ok;
    if (typeof guard.rejected === "boolean") return guard.rejected;
    if (Array.isArray(guard.rejected)) return guard.rejected.length > 0;
    return false;
  }

  function guardTokens(guard) {
    if (!guard || typeof guard !== "object") return [];
    if (!Array.isArray(guard.rejected)) return [];
    var out = [];
    for (var i = 0; i < guard.rejected.length; i++) {
      var t = guard.rejected[i];
      if (typeof t === "string" && t !== "") out.push(t);
    }
    return out;
  }

  /* THE ANSWER ARRIVES AS LINES AND IS DRAWN AS LINES. The deterministic
     answer is a lead sentence, a dashed fact per line and a closing
     sentence; in one paragraph its newlines collapse and the fallback reads
     as a run-on — worse than the prose it replaced, the inversion it exists
     to avoid. Dashed blocks become a list, everything else a paragraph, and
     the first paragraph is the finding. */
  function paintAnswerText(host, said) {
    var lines = String(said).split("\n");
    var list = null;
    var first = true;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line === "") { list = null; continue; }
      /* A DASH FOLLOWED BY SPACE IS A BULLET; A DASH FOLLOWED BY A DIGIT IS A
         READING. `charAt(0) === "-"` alone would turn a sentence opening on a
         negative number into a list item and eat its minus sign on the way —
         a signed measurement silently unsigned, which is the one edit a
         renderer may never make to a number. */
      if (/^-\s+/.test(line)) {
        if (!list) { list = el("ul", "ak-answer-list"); host.append(list); }
        list.append(el("li", "ak-answer-item", line.replace(/^-\s*/, "")));
        continue;
      }
      list = null;
      host.append(el("p", "fc-reading" + (first ? " is-lead" : ""), line));
      first = false;
    }
  }

  /* ---------- the page ---------------------------------------------- */

  var app = document.getElementById("askApp");
  if (!app) return;

  /* THE DOCK DOES NOT REPEAT THE BRIEFING. A rail is 380px wide and the
     briefing is three regions of findings; drawn there it would be a worse
     copy of a page one click away, and it would fetch a 16KB key to do it.
     So the dock skips the regions and asks — and every sentence that refers
     to the briefing has to know which mount it is on, because on this one
     there is nothing above the box. */
  var DOCKED = app.getAttribute("data-mode") === "dock";

  /* THE STATUS LINE IS MOUNTED IF THE SHELL DID NOT CARRY ONE. It is the
     channel this page reports its own failures on, and a page with no such
     channel fails invisibly — which reads exactly like a quiet session. */
  var status = document.getElementById("askStatus");
  if (!status) {
    status = el("p", "flows-status");
    status.id = "askStatus";
    app.append(status);
  }

  var briefHost = el("div", "ak-brief");
  briefHost.id = "askBrief";
  app.append(briefHost);

  /* THE FOURTH ARGUMENT WAS DROPPED, AND IT HAD NEVER RENDERED: panel()
     takes three, so "Anything the regions above did not answer." reached no
     DOM on either mount. Deleted rather than restored — the dock has no
     regions above it. */
  var box = panel("askBox", "ak-askbox",
    DOCKED ? null : "Ask about what has been published");

  /* WHAT THE RAIL OPENS ONTO IS THE CONTROL, NOT THE PROSE. Opened, the
     dock presented 335 characters of guarantee and then the credit meter —
     469 characters of chrome — above an empty field. Every word survives:
     the guarantee is reassurance about what the box will NOT do, and
     reassurance may fold, so it sits one click below the field. The meter
     does not fold; its numbers are a withholding about capacity. The
     examples lead because they answer, in three lines a reader can press,
     what the paragraph was answering: what can I ask this? */
  var exampleHost = el("div", "ak-examples");
  exampleHost.id = "askExamples";
  box.append(exampleHost);

  /* ABOVE THE FIELD, NOT UNDER THE ANSWER: the reader deciding whether to
     ask is the one who needs it. One line and a bar. */
  var meterHost = el("div", "ak-meter-host");
  meterHost.id = "askMeter";
  box.append(meterHost);

  /* THE NAME THE PAGE UNDER THIS RAIL IS ABOUT, drawn directly above the
     field it applies to. */
  var onPageHost = el("div", "ak-onpage-host");
  onPageHost.id = "askOnPage";
  box.append(onPageHost);

  function paintSpend(spend, reason) {
    meterHost.textContent = "";
    meterHost.append(spendMeter(spend, reason));
  }

  var form = el("form", "ak-ask");
  form.id = "askForm";
  var label = el("label", "ak-ask-l", "Your question");
  label.htmlFor = "askQ";
  /* A SHORTCUT NOBODY IS TOLD ABOUT IS NOT AN AFFORDANCE. Inside the
     <label>, so a screen reader announces it as part of the field's name.
     It survives the density pass because it does not describe data — it
     describes how to operate the control it is bound to. */
  label.append(el("span", "ak-ask-hint", "Enter sends \u00b7 Shift-Enter for a new line"));
  var row = el("div", "ak-ask-row");
  var input = el("textarea", "ak-ask-in");
  input.id = "askQ";
  input.rows = 2;
  input.placeholder = "What changed on the short board?";
  input.autocomplete = "off";
  input.spellcheck = false;

  var send = el("button", "ak-ask-go", "Ask");
  send.type = "submit";
  /* ENTER SENDS; SHIFT-ENTER AND THE MODIFIERS MAKE A NEW LINE.

     IT STAYS A TEXTAREA: an <input> sends on Enter for free and cannot hold
     a line break, and questions here run to a sentence and a half.

     `isComposing` IS CHECKED FIRST AND IT IS NOT A NICETY. An input method
     editor — Japanese, Chinese, Korean, the Mac accent composers — uses
     Enter to COMMIT what is being composed; sending on it submits a
     half-typed word and eats the key that was finishing it, which makes the
     box unusable in those languages. All three modifiers, not just Shift:
     Ctrl-Enter and Cmd-Enter are what a reader reaches for elsewhere. */
  input.addEventListener("keydown", function (event) {
    if (event.key !== "Enter") return;
    if (event.isComposing || event.keyCode === 229) return;
    if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    /* requestSubmit(), not submit(): submit() bypasses the submit event,
       which is where every rule of this box lives — the empty-question
       sentence, the in-flight guard, the gated check. A form submitted
       around its own handler would navigate the page away. */
    if (typeof form.requestSubmit === "function") form.requestSubmit();
    else send.click();
  });

  row.append(input);
  row.append(send);
  form.append(label);
  form.append(row);
  box.append(form);

  /* THE GUARANTEE, FOLDED — REASSURANCE IS THE ONLY KIND OF SENTENCE THIS
     PAGE FOLDS. It states what the box will NOT do, and nothing in it
     changes what a visible number means, which is the test this file
     applies everywhere else and the reason the meter's condition above it
     stays in the open while this does not. */
  box.append(howBox("What this box answers from", [
    "This box answers from the payloads this site has already published. It reads nothing " +
    "live, it places no vendor call, and it performs no arithmetic: every figure in an " +
    "answer is quoted from a payload. An answer that states a figure no payload published " +
    "is refused before it reaches this page, and the measured reading is served instead."]));

  var answerHost = el("div", "ak-answer");
  answerHost.id = "askAnswer";
  /* THE ANSWER REGION IS ANNOUNCED. It is replaced wholesale several times
     a session, and a reader not looking at it has no other way to know a new
     one arrived. Polite rather than assertive: an answer is worth hearing at
     the end of the current sentence, not in the middle of it. */
  answerHost.setAttribute("aria-live", "polite");
  box.append(answerHost);
  app.append(box);

  var foot = document.getElementById("askFoot");

  /* ---------- the examples, and the name of the page they are on --------

     THREE QUESTIONS THIS INDEX CAN ANSWER, AND NOT ONE NAMES A TICKER
     WRITTEN INTO THIS FILE. They name topics the index carries every
     session — the two boards, the session's standing, the calendar gate —
     so they answer on the morning they are pressed. As soon as a payload
     names covered names the first is replaced by one about the first of
     THEM: a `card:` source is a per-name reading, so a name there is one
     the index demonstrably holds readings for. A symbol list written here
     would go stale the first session the roster changed, and silently —
     still looking like an offer. */
  var EXAMPLE_TOPICS = [
    "What changed on the short board?",
    "Where does the session stand?",
    "What is already on the calendar before the next session?",
  ];

  function coveredNames(facts) {
    var out = [];
    if (!Array.isArray(facts)) return out;
    for (var i = 0; i < facts.length; i++) {
      var src = facts[i] && typeof facts[i].source === "string" ? facts[i].source : "";
      if (src.indexOf("card:") !== 0) continue;
      var name = src.slice(5);
      if (name && out.indexOf(name) === -1) out.push(name);
    }
    return out;
  }

  function paintExamples(names) {
    exampleHost.textContent = "";
    var said = EXAMPLE_TOPICS.slice(0);
    if (names.length) said[0] = "What is new for " + names[0] + "?";
    exampleHost.append(el("p", "ak-examples-l", "Try one of these"));
    var row = el("div", "ak-examples-row");
    for (var i = 0; i < said.length; i++) row.append(exampleButton(said[i]));
    exampleHost.append(row);
  }

  function exampleButton(said) {
    var b = el("button", "ak-example", said);
    b.type = "button";
    /* IT FILLS THE FIELD AND DOES NOT SEND. A button that submitted on one
       click would spend a model call the reader had not decided to spend,
       out of the allowance the meter above it exists to show them first. */
    b.addEventListener("click", function () {
      input.value = said;
      try { input.focus(); } catch (e) { /* a detached node; harmless */ }
    });
    return b;
  }

  /* THE NAME ON THE PAGE THIS RAIL IS DOCKED TO, READ OFF THAT PAGE'S URL.
     The dock is mounted on /flows/ticker/?t=SYN046 and every other gated
     route and knew neither: a reader who opened it over one name and typed
     "what changed" was answered about the market. BOUNDED BEFORE IT IS
     TRUSTED, since the value comes off a query string anybody can type
     into — and bounded to THE ROUTE'S OWN SHAPE, character for character:
     readTicker() in assets/js/flows-ticker.js reads the very `?t=` this
     re-reads and accepts /^[A-Z][A-Z0-9.\-]{0,9}$/, as does
     subjectTickers() at the far end. Three copies of ONE rule. A narrower
     copy here does not fail safe, it fails SILENT — it drops the name and
     the rail answers about the market with nothing saying it ignored the
     page. Five characters and no `.` or `-` was the first attempt, and it
     rejected every card this site publishes (all 93 in the emitted corpus
     are SYN0##, six characters) as well as BRK.B and RDS-A. Uppercased
     first, as readTicker is, so ?t=nvda is a name. A URL this browser will
     not parse yields null rather than throwing. */
  function pageTicker() {
    var raw = null;
    try { raw = new URL(location.href).searchParams.get("t"); } catch (e) { raw = null; }
    if (typeof raw !== "string") return null;
    var t = raw.trim().toUpperCase();
    return /^[A-Z][A-Z0-9.\-]{0,9}$/.test(t) ? t : null;
  }

  var ON_PAGE = pageTicker();

  paintExamples([]);

  if (ON_PAGE !== null) {
    /* IT PREFILLS NOTHING. A field that opens holding a symbol has put
       words in the reader's question that the reader did not write, and
       deleting them is the first thing they would do. The sentence says
       what will happen instead; the button is for a reader who wants the
       name inside a question of their own. */
    var onPage = el("p", "ak-onpage");
    /* AND THE UNDOCKED MOUNT DOES NOT SAY "THIS PAGE". Both mounts read
       one `?t=` and both apply it, so neither may stay silent — the
       subject IS used at the far end, and a mount that said nothing
       would answer about a name the reader never typed. But "the name
       on this page" is a fact a reader on the ticker route can see and
       a claim about nothing at /flows/ask/?t=X, where the symbol came
       in the link and no card is drawn. */
    onPage.append(text("Asking about " + ON_PAGE + (DOCKED
      ? " — the name on this page. "
      : " — the name this link carried. ") +
      "A question that names no ticker is answered about it. "));
    var insert = el("button", "ak-onpage-go", "Insert " + ON_PAGE);
    insert.type = "button";
    insert.addEventListener("click", function () {
      var held = String(input.value || "");
      input.value = held === "" ? ON_PAGE : held.replace(/\s+$/, "") + " " + ON_PAGE;
      try { input.focus(); } catch (e) { /* a detached node; harmless */ }
    });
    onPage.append(insert);
    onPageHost.append(onPage);
  }

  /* ---------- reading the briefing --------------------------------------

     A REQUEST THAT NEVER CAME BACK IS NOT A KEY THAT WAS NEVER PUBLISHED.
     A 500, a dropped connection or a parse failure reduces to the same null
     the {status:"pending"} envelope does, so a failed request would print a
     confident claim about the pipeline. The sentinel's fields are prefixed
     so a payload-shape scan cannot take them for publisher fields. */
  var gated = false;

  function get(path) {
    return fetch(path, { credentials: "same-origin", headers: { Accept: "application/json" } })
      .then(function (r) {
        if (r.status === 401) { gated = true; location.replace("/flows/"); return null; }
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      });
  }

  function optional(path) {
    return get(path).catch(function (error) {
      return {
        __unreadable: true,
        __path: path,
        __reason: (error && error.message) ? error.message : String(error),
      };
    });
  }

  /* SEVERITY IS A WORD AND A POSITION, NEVER A HUE ALONE — the rule
     flows.css states for the silence marks. The mark sits in a fixed column
     so "blocking" and "note" are told apart by shape before any colour is
     read, and the word is printed too: a glyph alone is a legend a reader
     has to have been taught. */
  var WARN_MARK = { blocking: "!!", caution: "!", note: "\u00b7" };

  function paintWarnings(brief) {
    var box = el("section", "ak-warns fc-panel ak-panel");
    var list = brief && Array.isArray(brief.warnings) ? brief.warnings : null;
    var checked = brief && typeof brief.warningsChecked === "number" ? brief.warningsChecked : null;
    /* THE DENOMINATOR, BECAUSE A NUMERATOR PRINTED ALONE READS AS THE
       WHOLE SET. Nothing in a bare `checked: 4` tells four of four from four
       of thirteen, so a store holding two keys rendered the same clean bill
       as a complete one — the truncation that does not say it truncated, in
       the panel drawn first because it changes how every region below it
       reads. Where the total is absent the sentence says so. */
    var questions = brief && typeof brief.warningsQuestions === "number"
      ? brief.warningsQuestions : null;

    if (list === null) {
      /* THE KEY PREDATES THE CHECKS, or the field did not survive the wire.
         Either way nothing has been said about the data's consistency, and
         "no warnings" here would be a claim nobody measured. */
      box.append(el("p", "ak-warns-none fc-note",
        "This briefing carries no consistency report, so nothing is stated about whether " +
        "its surfaces agree. That is a gap on this page rather than a clean bill."));
      return box;
    }

    if (!list.length) {
      /* AN EMPTY LIST IS A CLEAN BILL ONLY WHERE A QUESTION WAS PUT, and
         `checked` is on the wire for that test: a check whose inputs are
         absent "reports nothing and does not count itself as having run".
         This caller printed the clean bill anyway, so a store with nothing
         published yet opened with "No inconsistency was found across the
         published surfaces" — a measurement nobody took, where the page's
         strongest claim goes. It matters most here because this box is
         drawn FIRST, above the regions, because it changes how they read: a
         reader told the surfaces agree reads three regions of silences as a
         session checked and found quiet rather than as a pipeline that has
         not run. */
      if (checked === null) {
        box.append(el("p", "ak-warns-none fc-note",
          "No inconsistency is listed, and this briefing does not say how many of its " +
          "checks could run — so this page cannot tell an empty list from an unasked " +
          "question, and states nothing either way about whether these surfaces agree."));
        return box;
      }
      if (checked === 0) {
        box.append(el("p", "ak-warns-none fc-note",
          "Not one consistency check had the inputs to run, so no two surfaces were " +
          "compared and nothing is claimed about whether they agree. An empty list here " +
          "is what a store with nothing in it produces, and it is a gap in what has been " +
          "published rather than a clean bill."));
        return box;
      }
      box.append(el("p", "ak-warns-none fc-note",
        "No inconsistency was found across the published surfaces, from " + checked + " " +
        (checked === 1 ? "check that could run" : "checks that could run") + "." +
        (questions === null
          ? " How many checks this briefing carries is not published, so that number is the " +
            "count that ran and not the share of the sweep it covers."
          : questions - checked === 0
            ? " That is every check this briefing carries, so the sweep was complete."
            : " This briefing carries " + questions + ", so " + (questions - checked) + " of " +
              "them could not be asked at all — they are unanswered rather than clear, and " +
              "nothing is claimed about what they would have found.")));
      return box;
    }

    box.append(el("h2", "fc-panel-h", list.length === 1
      ? "1 thing to know before reading the rest"
      : list.length + " things to know before reading the rest"));
    /* "N OF THESE CHECKS" NAMED A FRACTION AND SUPPLIED NO DENOMINATOR. The
       only enumerated set above this line is the warnings, so "4 of these
       checks had the inputs to run" sat under a heading counting one warning
       and invited a reader to divide two numbers sharing no population. The
       count is stated as the count it is; the total is named only where the
       briefing published one. */
    box.append(el("p", "ak-sub fc-note", checked === null
      ? "Each was found by comparing two published surfaces against each other."
      : "Found by comparing published surfaces against each other. " + (questions === null
        ? checked + " " + (checked === 1 ? "check" : "checks") + " had the inputs to run at " +
          "all, out of a total this briefing does not publish."
        : checked + " of the " + questions + " checks this briefing carries had the inputs " +
          "to run at all.")));

    var ul = el("ul", "ak-warns-list");
    for (var i = 0; i < list.length; i++) {
      var w = list[i] && typeof list[i] === "object" ? list[i] : {};
      /* AN UNRECOGNISED SEVERITY KEEPS THE WORD ITS PUBLISHER CHOSE. The
         lookup was a truth test over WARN_MARK, so a severity with no mark
         here — a level flows-warnings.js grows later, or a typo on the wire —
         became "note", and the least severe of the three was printed as
         though the publisher had asked for it. silenceLine() maps an unknown
         kind to a FOURTH value for the same reason. Membership is asked with
         hasOwnProperty, because "constructor" or "toString" otherwise
         answers the truth test with a function off the prototype. */
      var severity = typeof w.severity === "string" && w.severity.trim() !== ""
        ? w.severity.trim() : null;
      var known = severity !== null &&
        Object.prototype.hasOwnProperty.call(WARN_MARK, severity);
      var sev = known ? severity : "unknown";
      var li = el("li", "ak-warn is-" + sev);
      li.append(el("span", "ak-warn-mark", known ? WARN_MARK[severity] : "?"));
      var body = el("div", "ak-warn-body");
      /* A WARNING IS COUNTED IN THE HEADING ABOVE WHETHER OR NOT IT CARRIES
         ITS SENTENCE, so drawing a sentence-less one as an empty paragraph
         told a reader there was something to know before reading the rest and
         then showed them nothing. */
      var wsaid = typeof w.say === "string" && w.say.trim() !== "" ? w.say : null;
      if (wsaid === null) {
        body.append(emptyLine("unreadable",
          "A warning was published without the sentence that states it, so this page cannot " +
          "say what it found. That is a gap in the payload rather than a clean surface."));
      } else {
        body.append(el("p", "ak-warn-say", wsaid));
      }
      var src = Array.isArray(w.sources) ? w.sources.filter(function (x) { return typeof x === "string" && x; }) : [];
      var line = el("p", "ak-warn-src");
      line.append(el("span", "ak-warn-sev",
        severity === null ? "no severity published" : severity));
      if (src.length) {
        line.append(text(" \u00b7 "));
        line.append(el("span", "ak-src-key", src.join(", ")));
      }
      body.append(line);
      li.append(body);
      ul.append(li);
    }
    box.append(ul);
    return box;
  }

  function paintBrief(brief) {
    briefHost.textContent = "";

    if (brief && brief.__unreadable === true) {
      briefHost.append(emptyLine("unreadable",
        "The request for the briefing did not come back" +
        (brief.__reason ? " (" + brief.__reason + ")" : "") +
        ". That is this page failing to READ the key, not a statement about what the key " +
        "holds — reload before drawing any conclusion from its absence. The question box " +
        "below is unaffected and still answers."));
      if (status) {
        status.textContent = "The briefing could not be read on this load. The question box " +
          "below reads a different route and is unaffected.";
        status.setAttribute("data-empty", "unreadable");
      }
      return;
    }

    if (!brief || typeof brief !== "object") {
      briefHost.append(emptyLine("unreadable",
        "The briefing arrived in a shape this page cannot read, so none of the three regions " +
        "is drawn. That is a fault on this page rather than a fact about the session."));
      return;
    }

    if (brief.status === "pending") {
      /* THE ORDINARY STATE BEFORE THE FIRST RUN, stated as a fact about the
         store rather than as an error. It is also the state after a gap, and
         neither is a claim that the market was quiet. */
      briefHost.append(emptyLine("pending",
        "The briefing has not been published for this session yet, so there is nothing to " +
        "summarise. It appears with the first pipeline run of the session; nothing here is " +
        "a reading about the market."));
      if (status) {
        status.textContent = "No briefing has been published for this session yet.";
        status.setAttribute("data-empty", "pending");
      }
      return;
    }

    /* WARNINGS FIRST, BECAUSE THEY CHANGE HOW THE REST IS READ. A caution
       saying a count is a floor rather than a total has to arrive BEFORE
       the count, or the reader has already formed the comparison it
       exists to prevent. This is not an overlay and it is not a banner:
       each line has read two payloads at once, names the surfaces that
       disagree, and quotes the numbers that make it a fact rather than a
       worry. `checked` is drawn beside them because a reader must be able
       to tell "nothing is wrong" from "almost nothing could be asked". */
    briefHost.append(paintWarnings(brief));

    for (var i = 0; i < REGIONS.length; i++) briefHost.append(paintRegion(REGIONS[i], brief));

    /* AND THE OFFER ABOVE THE FIELD IS REBUILT FROM THE BRIEFING ITSELF.
       On this mount the index is in hand, so an example can name a name it
       demonstrably holds readings for rather than a topic. */
    var covered = coveredNames(brief.facts);
    if (covered.length) paintExamples(covered);

    if (status) {
      status.removeAttribute("data-empty");
      var session = typeof brief.sessionDate === "string" && brief.sessionDate
        ? brief.sessionDate : null;
      var built = stampSaid(brief.generatedAt);
      status.textContent = [
        session === null ? "Briefing published without a session date" : "Session " + session,
        built === null ? "no build stamp on this key" : "built " + built,
      ].join(" · ");
    }

    /* THE PROSE TRAVELS WITH THE NUMBERS — published in the payload beside the
       arithmetic that produced them, printed verbatim, so a renderer cannot
       reword a caveat into a claim. Every key the payload adds later still
       reaches the reader rather than being lost to a hardcoded list here. */
    if (foot && brief.notes && typeof brief.notes === "object") {
      var keys = Object.keys(brief.notes);
      for (var k = 0; k < keys.length; k++) {
        var note = brief.notes[keys[k]];
        if (typeof note === "string" && note.trim() !== "") {
          foot.append(el("p", "flows-foot-p", note));
        }
      }
    }
  }

  /* ---------- asking ------------------------------------------------- */

  var asking = false;

  /* THE PAGE'S NAME TRAVELS AS ITS OWN FIELD, NOT GLUED ONTO THE QUESTION.
     Whether to use it at all depends on whether the reader named a ticker
     themselves, and shared/flows-ask.js is the module that decides that —
     it reads `subject` only when the question names none. Gluing the symbol
     on here would put that rule in a second file, in a browser. */
  function post(question, subject) {
    return fetch("/api/flows/ask", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ question: question, subject: subject }),
    }).then(function (r) {
      /* A 401 SAYS THE SESSION IS GONE AND THE PAGE IS ALREADY NAVIGATING, so
         nothing below may paint over it. It is a FLAG as well as a null
         return — flows-overview.js:1922's fix — because this handler has a
         re-enable step after it, and re-enabling a form on a page that is
         leaving invites a second request nobody can answer. */
      if (r.status === 401) { gated = true; location.replace("/flows/"); return null; }
      if (r.ok) return r.json();
      /* THE ROUTE'S OWN SENTENCE SURVIVES ITS STATUS CODE — the rule this file
         states for the answer and did not keep for the failure. A published
         `brief` key that will not parse answers 500 WITH the words for it;
         this handler reduced that to "HTTP 500", which the caller below
         explained as the page failing to REACH its route. Two different
         unreadables, and the reader got the wrong one — told nothing was
         implied about what had been published, on the one occasion when what
         was published is exactly what is broken. A body carrying no sentence
         leaves the status, which is honest for a failure nobody worded. */
      return r.json().catch(function () { return null; }).then(function (body) {
        var said = body && body.error && typeof body.error.message === "string" &&
          body.error.message.trim() !== "" ? body.error.message.trim() : null;
        var failure = new Error(said === null ? "HTTP " + r.status : said);
        failure.said = said;
        throw failure;
      });
    });
  }

  function paintAnswer(payload, question) {
    answerHost.textContent = "";

    /* THE METER MOVES WHEN THE BUDGET DOES: the route sends the reading as
       it stands after the call it just made. ASKED AS "did the route send
       one", not "is it truthy": an absent `spend` says nothing about the
       budget and the meter drawn on load still stands, while a null one
       means the route looked and could not read it. Repainting on both
       blanks a good meter every time a 400 comes back. */
    if (Object.prototype.hasOwnProperty.call(payload, "spend")) {
      paintSpend(payload.spend, null);
    }

    /* THE QUESTION IS ECHOED, AND THAT IS NOT THE RULE THE MODULE BREAKS.
       It refuses to quote the question INSIDE the answer: "what happened to
       the 40 names" would put a 40 into prose the guard then refuses. Here
       it is a labelled line of the reader's own words, outside the answer
       and outside the guard's subject, and it is what tells a second
       question from the first on a page that keeps only the latest. */
    var asked = el("p", "ak-asked");
    asked.append(el("span", "ak-asked-l", "You asked"));
    asked.append(text(" " + question));
    answerHost.append(asked);

    if (!payload || typeof payload !== "object") {
      answerHost.append(emptyLine("unreadable",
        "The route answered in a shape this page cannot read, so there is nothing to show " +
        "for this question. That is a fault on this page's side of the wire rather than a " +
        "fact about the session."));
      return;
    }

    /* PENDING REACHES THIS ROUTE TOO, AND IT IS NOT A FAULT ON THIS PAGE.
       Both routes answer the same store, so the state before the session's
       first run arrives as {status:"pending", answer:null, facts:[]} with
       its own sentence on `note`. Without this branch that envelope tripped
       the "carried no text" line AND the "neither an answer, a fact nor a
       silence" line, so the ordinary morning before the run was reported
       twice as a fault here, with a provenance line between them claiming a
       reading had been assembled from facts that do not yet exist. */
    if (payload.status === "pending") {
      answerHost.append(emptyLine("pending",
        typeof payload.note === "string" && payload.note.trim() !== ""
          ? payload.note.trim()
          : "The briefing has not been published for this session yet, so there is nothing " +
            "measured to answer from. Nothing is claimed about the market by that."));
      return;
    }

    var block = llmBlock(payload);
    var guard = payload.guard && typeof payload.guard === "object" ? payload.guard : null;
    var fired = guardFired(guard);
    var facts = Array.isArray(payload.facts) ? payload.facts : [];

    /* READING FIRST. The answer is the finding and it goes at the top at
       reading size; everything that qualifies it follows in the open, and
       only the method goes behind the disclosure at the bottom. */
    var said = typeof payload.answer === "string" ? payload.answer.trim() : "";
    if (said === "") {
      answerHost.append(emptyLine("unreadable",
        "The route answered and carried no text for this question, so there is nothing to " +
        "read. The facts it selected are listed below and are unaffected."));
    } else {
      paintAnswerText(answerHost, said);
    }

    answerHost.append(llmLine(block, fired, guard));

    /* THE PAGE'S OWN NAME WAS ADDED, AND THAT IS SAID IN THE OPEN. A
       reader who typed no symbol and is handed readings about SYN046 has
       been answered about a name they did not name; where it came from is
       provenance about the SELECTION, and it belongs beside the provenance
       about the wording. */
    if (payload.subjectApplied === true &&
        typeof payload.subject === "string" && payload.subject !== "") {
      answerHost.append(qualifier("Nothing in the question named a ticker, so " +
        payload.subject + " — the name on the page this was asked from — was " +
        "added to it before the readings were selected. Typing a name of your own is what " +
        "overrides that; this page's name is not added to a question that already has one."));
    }

    /* A WITHHOLDING NEVER FOLDS, AND THIS ONE USED TO. `why` carries two
       kinds of sentence: an accounting of what was served out of what
       matched, and — when there is one — a withholding, that nothing
       indexed is about the name asked about, or that nothing matched at all
       and these are the session's headline readings instead. The whole
       string goes in the method disclosure, which is right for the
       accounting. On the branch where a model wrote the prose, that left
       the withholding one click away, under a summary reading "How this
       answer was assembled".

       IT IS LIFTED AND NOT MOVED: the fold still holds `why` entire,
       because a record with a hole cut in it is worse than a sentence read
       twice. What is lifted is the caveat alone, published by the route as
       its own field so this page is not matching on wording to find it.

       ONLY WHERE THE MODEL'S WORDING IS SERVED. Every other branch serves
       renderFactsPlain, whose lead is a coverage claim in the open already
       — "None of the readings below is about NVDA" — and printing both
       would state one withholding twice in eight lines. The guard is asked
       before `used`, the order llmLine() reads them in and for its reason. */
    var withheld = typeof payload.withheld === "string" && payload.withheld.trim() !== ""
      ? payload.withheld.trim() : null;
    if (withheld !== null && block.used === true && !fired) {
      answerHost.append(qualifier(withheld));
    }

    /* THE REFUSAL IS NEVER HIDDEN. A reader holding a deterministic answer
       silently swapped in for a refused one has been told less than nothing:
       the prose is not what the system first produced, and they cannot weigh
       it without knowing that. The reason is printed as the module wrote it,
       carrying no figures of its own, so that explaining why a number was
       refused cannot put an unquoted one back on the page. */
    if (fired) {
      /* THE ROUTE'S SENTENCE, NOT THE GUARD'S. `guard.reason` ends by
         naming the `rejected` field — right for a developer reading the JSON
         and wrong on a page — so the route words its own `note` here. The
         guard's string is the fallback for a route that sends none. */
      var why = typeof payload.note === "string" && payload.note.trim() !== ""
        ? payload.note.trim()
        : (guard && typeof guard.reason === "string" && guard.reason.trim() !== ""
          ? guard.reason : null);
      answerHost.append(qualifier("The generated wording was discarded before it reached this " +
        "page and what you are reading is the measured facts in a fixed order. " +
        (why === null
          ? "The route did not state which rule it failed."
          : why)));
    }

    /* A LIST THAT TRUNCATES WITHOUT SAYING SO READS AS A POPULATION, and this
       cap is OURS — so the total is exactly reportable rather than a lower
       bound, and the method line states it. No vendor ceiling sits between
       the index and this page. */
    if (payload.capped === true) {
      answerHost.append(qualifier("The facts below were cut at this page's own cap, so they " +
        "are a selection rather than everything published. How many were selected out of how " +
        "many exist is stated in the method note at the foot of this answer."));
    }

    if (facts.length) {
      /* THE KEY AND THE STAMP, ONCE, WITH THEIR DENOMINATOR. Two defects met
         here: the provenance dedupe was off (both defaults passed as null),
         so one run's stamp was drawn under all fourteen of its sentences;
         and on every fallback branch the sentences were drawn twice, as the
         answer's dashed lines and again here. THE VERB AGREES WITH THE COUNT
         ON BOTH HALVES OF THE SPLIT SENTENCE — "1 fact were handed" tells a
         reader this prose is assembled rather than written, which a page
         carrying a model's output cannot afford. The split branch fires at a
         mixed 1-and-1 (one market-wide reading, one card reading), so it
         needs both singulars. */
      var origin = commonOrigin(facts);
      var originAt = stampSaid(origin.at);
      var keySaid = origin.source === null
        ? "no source key at all" : "the " + origin.source + " key";
      var builtSaid = originAt === null ? "which published no build stamp" : "built " + originAt;
      var echoed = answerEchoes(said, facts);
      var counted = facts.length === 1
        ? "1 fact was handed to the answer above."
        : facts.length + " facts were handed to the answer above.";
      var rest = facts.length - origin.n;
      var whence = origin.n === facts.length
        ? " " + (facts.length === 1 ? "It comes" : "All of them come") + " from " + keySaid +
          ", " + builtSaid + "."
        : " " + origin.n + (origin.n === 1 ? " of them comes" : " of them come") + " from " +
          keySaid + ", " + builtSaid + "; the other " + rest + (rest === 1
            ? " names its own key and stamp under itself."
            : " name their own key and stamp under themselves.");
      answerHost.append(el("p", "ak-sub fc-note", counted + whence + (echoed
        ? " Their sentences are the lines in the answer above, and are not repeated here."
        : "")));
      var drawn = echoed
        ? provList(facts, origin.source, origin.at)
        : factList(facts, origin.source, origin.at);
      if (drawn) answerHost.append(drawn);
    }

    var silences = silenceList(payload.silences);
    paintSilences(answerHost, silences);

    if (!facts.length && !silences.length && said === "") {
      answerHost.append(emptyLine("unreadable",
        "The route returned neither an answer, a fact nor a silence, so this page cannot say " +
        "what was asked of the payloads. A fault on this page's side of the wire."));
    }

    answerHost.append(howBox("How this answer was assembled", answerHow(payload, block, guard)));

    /* THE EXAMPLES ARE REBUILT FROM WHAT THIS ANSWER PROVED THE INDEX
       HOLDS. The dock never fetches the briefing, so covered names are
       unknown until a payload carrying `card:` sources arrives. An answer
       carrying none leaves the examples as they stand: "this question
       selected no per-name reading" is not evidence the index holds none. */
    var names = coveredNames(facts);
    if (names.length) paintExamples(names);
  }

  /* THE METHOD, AND ONLY THE METHOD. Everything a reader needs in order to
     weigh the answer is above, in the open; what is folded away here is the
     audit trail — which facts were selected and why, what the guard scanned,
     which model was asked and how many times this site has asked it today. */
  function answerHow(payload, block, guard) {
    var lines = [];
    var fired = guardFired(guard);

    if (typeof payload.why === "string" && payload.why.trim() !== "") lines.push(payload.why);
    lines.push("Selection is deterministic and carries no model: the same question over the " +
      "same published payloads picks the same facts on every machine. A ticker named in the " +
      "question outweighs a topic word, and recency only ever breaks a tie.");

    var tokens = guardTokens(guard);
    if (tokens.length) {
      /* THE REFUSED TOKENS ARE DATA, NOT A READING, and they are the one
         thing here deliberately behind a disclosure: a maintainer needs to
         see what the model tried, and a reader who met them in the open
         would meet a number no payload published. */
      lines.push("The tokens the guard refused, listed as data rather than as readings: " +
        tokens.join(", ") + ". None of them appears in any fact the answer was given.");
    } else if (!fired && guard && Array.isArray(guard.numerals)) {
      /* AND ONLY WHERE THE GUARD PASSED. An empty `rejected` is reached both
         by an answer that was clean and by a refusal that found no token to
         name, so without the verdict this sentence reported "found every one
         of them already written in the facts it was given" inside the audit
         trail of an answer the guard had just thrown away. */
      /* AND A SCAN THAT FOUND NOTHING TO SCAN IS NOT A SCAN THAT PASSED. An
         answer stating no figure arrives with an empty `numerals`, over
         which "found every one of them already written in the facts it was
         given" is vacuously true — the strongest verification this page has,
         awarded to the answer the guard did least work on. A measured 0 is a
         reading here as everywhere: the model wrote prose and no number. */
      lines.push(guard.numerals.length === 0
        ? "The answer above states no figure, so there was nothing in it for the guard to " +
          "check. That is not a verification it passed: it is an answer that carried no " +
          "number for one to be performed on."
        : "The guard scanned " + guard.numerals.length + " figure" +
          (guard.numerals.length === 1 ? "" : "s") + " in the answer above and found every " +
          "one of them already written in the facts it was given.");
    }
    lines.push("The scan is character-for-character against the sentences the answer was " +
      "handed, not against the field values behind them. That is stricter than it sounds: an " +
      "answer that rewrites a published figure into millions has performed arithmetic on a " +
      "measurement, and it is refused for it.");

    if (block.model !== null) lines.push("The model asked for this route is " + block.model + ".");
    if (block.calls !== null) {
      /* A COUNT OF THIS SITE'S OWN CALLS, AND IT IS NOT A BALANCE. The
         allowance is account-wide and this site is not the only thing that
         can spend it, so a number derived here says what this route did and
         nothing about what remains. Reporting it as a balance would be a
         confident figure that is not a measurement. */
      lines.push("This site has asked the model " + block.calls + " time" +
        (block.calls === 1 ? "" : "s") + " today. That is a count of this route's own calls " +
        "and not a reading of what the account has left: the allowance is account-wide, and " +
        "nothing here can measure what else has spent it.");
    }

    var pins = factPins(payload.facts);
    if (pins) lines.push(pins);
    return lines;
  }

  /* THE ANTI-TAMPER RECORD, ONE SENTENCE PER FACT. `n` holds the measured
     fields each sentence was built from; printing them lets a reader confirm
     it was assembled rather than composed. For the ANSWER's facts only, that
     being where a model touched the prose.

     `n` IS NOT THE GUARD'S ALLOWED SET AND MAY NOT BE OFFERED AS ONE. The
     guard scans `say`, which holds more numerals than `n` holds values —
     "the short board's leading name is SYN35 at 58" has n {score:58} beside
     the numerals 35 and 58 — so a reader auditing against `n` finds one
     missing and concludes the guard let it through.

     THE VALUES ARE NOT REFORMATTED: no separator, no rounding, no currency
     mark. That is the arithmetic the guard refuses an answer for. */
  function factPins(facts) {
    if (!Array.isArray(facts) || !facts.length) return null;
    var parts = [];
    for (var i = 0; i < facts.length; i++) {
      var f = facts[i];
      if (!f || typeof f !== "object" || !f.n || typeof f.n !== "object") continue;
      var keys = Object.keys(f.n);
      if (!keys.length) continue;
      var pairs = [];
      for (var k = 0; k < keys.length; k++) {
        var v = f.n[keys[k]];
        pairs.push(keys[k] + "=" + (Array.isArray(v) ? v.join("/") : String(v)));
      }
      parts.push((typeof f.id === "string" ? f.id : "fact") + " [" + pairs.join(", ") + "]");
    }
    if (!parts.length) return null;
    return "The fields each sentence was built from, named and quoted as published: " +
      parts.join("; ") + ". These are the measured fields behind the sentences, not the whole " +
      "set of figures written in them — a ticker or a date carries digits of its own — and " +
      "the guard checks the answer against those sentences rather than against these values.";
  }

  function setAsking(on) {
    asking = on;
    send.disabled = on;
    form.setAttribute("aria-busy", on ? "true" : "false");
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (asking || gated) return;
    var question = String(input.value || "").trim();
    if (question === "") {
      answerHost.textContent = "";
      /* AN UNTYPED QUESTION IS NOT ONE OF THE THREE SILENCES. Nothing was
         measured, nothing failed and nothing was published empty — the reader
         simply did not ask, and dressing that as a payload state would put a
         fourth meaning on marks that already carry three. */
      /* WORDED FOR THE MOUNT IT IS ON. This sentence and the one in the
         failure branch below pointed at "the briefing above", which
         paintBrief draws and paintBrief is skipped when DOCKED — so on
         twelve of the thirteen routes this box appears on, the page sent a
         reader to a region that is not on the page and never was. */
      answerHost.append(qualifier("No question was typed, so nothing was sent and no model " +
        "call was spent. " + (DOCKED
          ? "Nothing on this page changes; the session's briefing is a page of its own, at " +
            "/flows/ask/."
          : "The briefing above stands whether or not anything is asked.")));
      input.focus();
      return;
    }

    setAsking(true);
    answerHost.textContent = "";
    answerHost.append(el("p", "ak-busy",
      "Reading the published payloads for this question…"));

    post(question, ON_PAGE).then(function (payload) {
      if (gated) return;
      paintAnswer(payload, question);
    }).catch(function (error) {
      if (gated) return;
      answerHost.textContent = "";
      /* THE REQUEST FAILED, AND THAT IS A FACT ABOUT THIS PAGE — but only
         where the route never answered. A route that DID answer and said why
         is quoted verbatim instead, because the sentence below reassures a
         reader that nothing is implied about what has been published, and
         that reassurance is false for every failure the route worded: those
         are failures about the published key itself. */
      answerHost.append(emptyLine("unreadable", error && error.said
        ? error.said
        : "The question could not be sent: " + (error && error.message ? error.message : error) +
          ". That is this page failing to reach its route, not a statement about what has " +
          "been published — " + (DOCKED
            ? "this rail draws no briefing, and the one at /flows/ask/ is read from a " +
              "different route."
            : "the briefing above was read separately and still stands.")));
    }).then(function () {
      if (gated) return;
      setAsking(false);
    });
  });

  /* FETCHED ON BOTH MOUNTS, ABOVE THE DOCK'S EARLY RETURN ON PURPOSE. The
     briefing belongs to the page; the budget belongs to the QUESTION, and
     the dock is where most questions will be asked. A rail that let a reader
     spend an allowance it would not show them is the receipt problem again.
     One indexed read of a one-row-per-day table, and the only request this
     file makes when docked. */
  optional("/api/flows/ai-usage").then(function (res) {
    if (gated) return;
    if (res && res.__unreadable) { paintSpend(null, res.__reason); return; }
    paintSpend(res && typeof res === "object" ? res.spend : null, null);
  });

  if (DOCKED) return;

  optional("/api/flows/brief").then(function (brief) {
    if (gated) return;
    paintBrief(brief);
  }).catch(function (error) {
    if (gated) return;
    if (status) {
      status.textContent = "The briefing could not be drawn: " + error.message;
      status.setAttribute("data-empty", "unreadable");
    }
  });
})();

/* =============================================================
   CLASSES THIS FILE EMITS, so that one emitted with no rule at all is
   visible here rather than only on screen. A LIST and not a commentary:
   annotations here are a second copy of what flows.css argues beside the
   rules, and these bytes are served to every reader of this route.

     .ak-panel .ak-brief .ak-region .ak-askbox .ak-sub
     .ak-facts .ak-fact .ak-fact-say .ak-fact-src .ak-src-key .ak-src-at
     .ak-facts.is-prov   — the list with the sentences left out, drawn
                           where the answer above already printed them
     .ak-examples .ak-examples-l .ak-examples-row .ak-example
     .ak-onpage-host .ak-onpage .ak-onpage-go
     .ak-ask .ak-ask-l .ak-ask-hint .ak-ask-row .ak-ask-in .ak-ask-go
     .ak-answer .ak-answer-list .ak-answer-item .ak-asked .ak-asked-l
     .ak-prov .ak-prov-mark .ak-busy
     .ak-meter .ak-meter-host .ak-meter-bar .ak-meter-fill .ak-meter-say
     .ak-meter-n
     .ak-fig .ak-fig-l .ak-fig-v .ak-fig-n .ak-fig-sep .ak-fig-u .ak-fig-d
     .ak-warns .ak-warns-none .ak-warns-list .ak-warn .ak-warn-mark
     .ak-warn-body .ak-warn-say .ak-warn-src .ak-warn-sev

   TWO OF THEM CARRY A DECISION RATHER THAN A STYLE, both argued in
   flows.css beside the rule: `.ak-prov-mark` may not become a hue, and
   `.ak-meter-bar` is aria-hidden.

   data-empty VALUES THIS FILE SETS, all four of which already have a mark:
     "pending"      … the key has not been published for this session
     "unreadable"   ×  the request or the shape failed HERE
     "quiet"        |  measured, and it held nothing — the one that is a
                       reading about the market
     "unavailable"  †  published, and the field this region needs is not on it
   ============================================================= */
