/* THE QUESTION BOX, AND THE BRIEFING IT OPENS WITH.
 *
 * Renders /flows/ask/: a standing three-session briefing — the prior session,
 * this one, and what is already on the calendar for the next — followed by a
 * box that answers a typed question from the same published payloads.
 *
 * THE BRIEFING IS DRAWN BEFORE ANYTHING IS ASKED, AND THAT IS THE PAGE'S ONE
 * STRUCTURAL DECISION. Most readers arrive with the same question, and a
 * route that answers it only after they have typed it charges them a round
 * trip and a model call for a reading the pipeline published hours ago. So
 * the three regions come first and the box comes second: a reader who never
 * types anything has already been answered, and the box exists for the second
 * question rather than the first.
 *
 * THE MODEL IS NEVER THE SOURCE OF A NUMBER, AND THIS FILE STATES SO IN THE
 * OPEN. shared/flows-ask.js scans every generated answer and refuses one
 * carrying a figure that appears in none of the facts it was handed; the
 * route reports that verdict on `guard`, and this page prints it rather than
 * quietly serving the replacement. Two fallbacks that announce themselves are
 * worth more than one that does not: a reader who cannot tell the model's
 * prose from the site's own has no way to weigh either.
 *
 * THE VOCABULARY RULE GOVERNING EVERY STRING HERE. Nothing on this page is a
 * call, a target or an outlook. The regions state what was MEASURED (the two
 * boards, the alert feed, the sector premium lean), what is SCHEDULED (the
 * events calendar's own dated rows) and what is POSITIONED (a published
 * distance to a threshold). The next-session region in particular carries no
 * verb that claims the future: tests/flows-brief.mjs:207-227 scans the
 * module's sentences for exactly that, and prose written here would sit
 * beside them wearing the same authority while passing no scan at all.
 *
 * THE SHELL THIS FILE NEEDS, WHICH IS ONE ELEMENT. `#askApp` is the container
 * and everything else is built here — the same argument flows-market.js:1902
 * makes for its own panel: this renderer owns the route end to end, and a
 * markup file carrying elements only one file writes is a second copy of a
 * fact that file already states. `#askStatus` and `#askFoot` are read if the
 * page provides them and mounted here if it does not, so the page can never
 * come up with no channel to report its own failure on.
 *
 * SELF-CONTAINED ON PURPOSE. flows-overview.js:63 treats window.FlowsUI as a
 * hard dependency and says so on screen when it is missing; this file cannot,
 * because the route's script list is not this file's to write and a renderer
 * that blanks itself over a script tag somebody else has to add is a page
 * that fails for a reason its reader cannot see. The three primitives it
 * needs are the same bodies flows-market.js:39 and flows-political.js:78
 * carry, for the same measured reason those two carry them.
 */
(function () {
  "use strict";

  /* THE PROVENANCE MARK, AND IT IS A GLYPH IN A FIXED POSITION. Who wrote the
     sentences a reader is looking at is the single most load-bearing fact on
     this page, so it cannot be a tint: the mark sits at the front of the
     provenance line — the same place every time, on every answer — and the
     sentence beside it says the same thing in words. Both glyphs are in the
     JetBrains Mono subsets this site self-hosts, so neither falls back to a
     system face mid-line. */
  var MARK_MODEL = "◆";   // the wording came back from the model and passed the guard
  var MARK_PLAIN = "▪";   // the wording was assembled here from the published facts

  /* A NUMBER, OR THE VENDOR'S QUOTED NUMBER, AND NOTHING ELSE. Byte-for-byte
     the body in assets/js/flows-market.js:39 and assets/js/flows-ui.js:65.

     IT RETURNS THE READING, so `!isNum(x)` and `isNum(x) ?` are bugs rather
     than idioms — a measured 0 is falsy and a measured 0 is a real reading.
     Ask `=== null`; format what comes back. */
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
     flows-market.js:106 and flows-political.js:126 already use, and the four
     marks flows.css:880 draws for them. The tags are what make the
     distinction machine-checkable; the sentences are what make it useful to a
     reader. Only "quiet" is a claim about the market. */
  function emptyLine(kind, said) {
    var p = el("p", "flows-empty", said);
    p.setAttribute("data-empty", kind);
    return p;
  }

  /* A NOTE THAT COULD CHANGE WHAT THE READING MEANS stays in the open;
     flows.css:938 reserves `.is-qualifier` for exactly that and gives it full
     ink and a rule down the left. Everything this page has to say about a
     spent allowance, a refused answer or a truncated list is one of these,
     which is why none of them is inside a disclosure. */
  function qualifier(said) {
    return el("p", "fc-note is-qualifier", said);
  }

  /* THE METHOD, BELOW THE FINDING AND NEVER INSTEAD OF IT. `.ft-how` and
     `.ft-how-s` are already in flows.css (:3434-3442, :3763) and are not
     route-scoped, so this reuses the disclosure vocabulary rather than
     inventing one — the same reuse flows-overview.js:1311 argues for. What
     goes in here is derivation only: nothing a reader needs in order to
     weigh the sentence above it is ever folded away. <summary> is natively
     focusable, so the method is reachable by keyboard and by touch. */
  function howBox(summary, lines) {
    var box = el("details", "ft-how");
    box.append(el("summary", "ft-how-s", summary));
    for (var i = 0; i < lines.length; i++) {
      if (typeof lines[i] === "string" && lines[i] !== "") box.append(el("p", "fc-note", lines[i]));
    }
    return box;
  }

  /* THE HEADING IS THE QUESTION, SO THE QUESTION IS NOT PRINTED TWICE.
     Each region used to carry a heading and, under it in italics, a
     restatement: "Since the prior session" followed by "What is different
     from the last session this pipeline measured?". The second line taught
     a reader nothing the first had not, and three of them cost three lines
     of a page whose owner had to say out loud that it held too much text.
     `asks` survives as the fold's summary, where it is doing work: it tells
     a reader what opening the disclosure will explain. */
  function panel(id, extraClass, heading) {
    var section = el("section", "fc-panel ak-panel " + extraClass);
    section.id = id;
    section.append(el("h2", "fc-panel-h", heading));
    return section;
  }

  /* A STAMP IS PRINTED AS PUBLISHED WHEN IT CANNOT BE PARSED, because
     "Invalid Date" is this page's word for the string that was actually
     stored, and only the stored string is something a reader can take to the
     job log. The absent case is not this function's to word: it returns null
     and the caller says which absence it is. */
  function stampSaid(at) {
    if (typeof at !== "string" || at.trim() === "") return null;
    var ms = Date.parse(at);
    if (!isFinite(ms)) return at;
    return new Date(ms).toLocaleString();
  }

  /* ---------- a fact, with the key it came from and the run that made it --

     EVERY FACT CARRIES ITS SOURCE AND ITS STAMP, and neither is decoration.
     A briefing sentence and a market sentence read alike and are answerable
     to different keys; a sentence from a key that stopped publishing three
     days ago reads exactly like one from this morning. The two lines below
     are what let a reader take any sentence on this page back to the payload
     it was built from.

     THE STAMP IS THE KEY'S, NOT THE FACT'S, AND THAT IS STATED. The briefing
     publishes one `generatedAt` per run rather than one per sentence, so the
     fallback is the payload's own stamp and the wording says "built" — the
     moment the run wrote the key, which is the only moment either side of
     this wire actually measured. */
  function factItem(fact, fallbackSource, fallbackAt, lead) {
    var li = el("li", "ak-fact" + (lead ? " is-lead" : ""));
    var say = fact && typeof fact.say === "string" ? fact.say : "";
    /* A FACT THAT ARRIVED WITHOUT ITS SENTENCE IS NAMED, NOT DRAWN BLANK —
       the treatment silenceLine() already gives a silence that lost its
       wording, for the reason it gives there. An empty paragraph still
       counted toward the "N readings were published for this region, and all
       of them are drawn" line above it, so the region stated a count and
       showed the reader white space: a gap in the payload wearing the
       appearance of a rendering fault, and named as neither. */
    if (say.trim() === "") {
      li.append(emptyLine("unreadable",
        "A reading was published for this region without the sentence that states it, so " +
        "this page has nothing to show for it. That is a gap in the payload rather than a " +
        "fact about the session."));
    } else {
      li.append(el("p", "ak-fact-say fc-reading" + (lead ? " is-lead" : ""), say));
    }

    var key = fact && typeof fact.source === "string" && fact.source ? fact.source : fallbackSource;
    var at = fact && typeof fact.at === "string" && fact.at ? fact.at : fallbackAt;

    /* PROVENANCE ONLY WHERE IT DIFFERS FROM THE REGION'S. The briefing
       publishes one key and one stamp per run, so drawing them under every
       sentence printed the identical line twelve times down one screen. That
       is not provenance, it is wallpaper: a reader who sees the same twelve
       words under every fact stops reading them, and the one morning a
       sentence really does come from a different key with an older stamp is
       the morning the difference is invisible. The region header states the
       key and the stamp once; a fact draws its own ONLY when it disagrees
       with that, which is exactly when a reader needs to look. */
    var sameKey = key === fallbackSource;
    var sameAt = at === fallbackAt;
    if (!sameKey || !sameAt) {
      var line = el("p", "ak-fact-src");
      line.append(el("span", "ak-src-key",
        typeof key === "string" && key ? key : "no source key on this fact"));
      line.append(text(" · "));
      var said = stampSaid(at);
      line.append(el("span", "ak-src-at",
        said === null ? "no build stamp published on this key" : "built " + said));
      li.append(line);
    }
    return li;
  }

  /* THE FIRST FACT IS THE FINDING AND IS SIZED AS ONE. flows.css:5934 records
     the survey behind `.fc-reading.is-lead`: across fourteen renderers the
     method paragraph was emitted 87 times against 4 emissions of the finding,
     so the product led with its methodology and buried the number. The
     briefing's sections emit their headline sentence first by construction —
     flows-brief.js pushes the tilt before the top name, the entrant count
     before the movers — so promoting index 0 promotes the finding rather than
     whatever happened to sort first. */
  function factList(facts, source, at) {
    var ul = el("ul", "ak-facts");
    for (var i = 0; i < facts.length; i++) ul.append(factItem(facts[i], source, at, i === 0));
    return ul;
  }

  /* ---------- the three silences, kept three ------------------------------

     TWO SHAPES ARRIVE AND BOTH MEAN THE SAME THING. shared/flows-brief.js
     hands each section an ARRAY of {kind, what, say}; shared/flows-ask.js
     keeps its index's silences in THREE NAMED LISTS so that a caller cannot
     sum them by accident. This normalises both into one array without
     collapsing the kinds, because the kind is the whole point: a job that has
     not run and a market that was quiet are two facts and one sentence would
     serve them as one. */
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
        /* THE LIST A SILENCE WAS FILED UNDER IS THE KIND, and the entry's own
           field is not consulted. `q.kind || SILENCE_ORDER[i]` said the
           opposite of this comment: it trusted the field and fell back to the
           list, so a reading filed under `quiet` carrying kind:"pending" was
           drawn with the mark for a job that has not run. That is the three
           silences swapping identities — a measured, empty market reported as
           a pipeline that never ran — which is the one confusion this page
           exists to prevent. The publisher's filing is the publisher's
           answer. */
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
       the row would turn a payload defect into a region that quietly shrank,
       which is how the briefing lost its whole sector section once. */
    var p = emptyLine(kind, said === null
      ? "A silence was published for " + (q.what || "this surface") +
        " without the sentence that explains it, so this page cannot say which " +
        "of the three it is. That is a gap in the payload rather than a fact " +
        "about the session."
      : said);
    if (typeof q.reason === "string" && q.reason) p.append(text(" (" + q.reason + ")"));
    if (typeof q.source === "string" && q.source) {
      /* THE KEY THAT WAS SILENT, NAMED. A silence is answerable to a publish
         key the same way a reading is, and a reader who cannot see which key
         went quiet cannot check whether it came back. It is written as a
         clause rather than appended as a bare token, because a monospace word
         hanging off the end of a sentence reads as a fragment. */
      p.append(text(" Source key: "));
      p.append(el("span", "ak-src-key", q.source));
      p.append(text("."));
    }
    return p;
  }

  /* THE ORDER IS FIXED AND THE KINDS DO NOT MIX. Drawing them in publication
     order would put a pending line between two quiet ones on one run and not
     on the next, and a reader who is learning to tell the four marks apart
     does not also need to learn them in a new order every morning. Anything
     carrying a kind this page does not know is drawn last rather than
     dropped — the rule flows-events.js:1065 states for notes, applied to
     silences. */
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

     THE THREE REGIONS ARE DRAWN IN CHRONOLOGICAL ORDER, prior session first.
     flows-overview.js:5 already established what a reader wants at 09:15 —
     "the question at 09:15 is WHAT IS DIFFERENT" — and the same argument
     holds harder here, where three sessions sit on one page and any order but
     time's own is an order the reader has to be taught.

     EACH REGION LEADS WITH ITS FINDING. The sentences come first at reading
     size, the qualifications that could change what they mean come next in
     the open, the silences after that, and only the derivation goes behind a
     disclosure. Nothing that would alter how a sentence is read is ever
     inside the <details>. */
  var REGIONS = [
    {
      slot: "yesterday",
      id: "askYesterday",
      heading: "Since the prior session",
      asks: "What is different from the last session this pipeline measured?",
      /* The comparand, and the briefing's own suite asserts the section names
         it: a count of names that entered the board means nothing until the
         board it entered against is dated. */
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
      /* NOTHING IN THIS REGION CLAIMS THE FUTURE, and the wording is chosen so
         that the claim survives a scan. tests/flows-brief.mjs:207-227 runs a
         verb scan over the module's own next-session sentences; prose written
         here sits beside those wearing the same authority, so it is held to
         the same rule. An earnings date is a calendar entry somebody
         published, and a distance to a threshold is a subtraction over two
         numbers measured today. Neither is a claim about a price. */
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
        /* THE PAYLOAD'S OWN DECLARATION, READ RATHER THAN ASSUMED. The module
           returns a literal false on this field. A payload that does not
           carry it came from something else, and claiming otherwise would be
           this page asserting a guarantee it never received. */
        /* THE REASSURANCE FOLDS; THE WITHHOLDING NEVER DOES, and the
           asymmetry is the whole rule. "This section is declared measured
           rather than projected" tells a reader that what they are looking
           at is what they already assume it is — useful, and safe to put
           one click away. "This payload does not declare it, so this page
           withholds that claim" changes how every line above should be
           read, and a caveat folded is a caveat unread.

           Marked with a trailing `fold` flag rather than by matching the
           text, because a sentence is edited far more often than a flag
           is, and a fold that keyed on wording would silently start
           hiding the wrong arm the first time someone rephrased it. */
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
      /* PUBLISHED, AND THIS REGION IS NOT ON IT. Distinct from a key that has
         not been published at all, which the caller has already handled: this
         is a briefing payload that answered and carried no section under this
         name, which happens to a page reading a payload written before the
         section existed. */
      section.append(emptyLine("unavailable",
        "The briefing was published and carried no section for this region, so there is " +
        "nothing here to read. A gap in the payload rather than a fact about the session."));
      return section;
    }

    var facts = Array.isArray(payload.facts) ? payload.facts : [];
    var silences = silenceList(payload.silences);

    if (facts.length) {
      /* THE COUNT IS THE POPULATION, and on this region it genuinely is. Every
         other list on this site states a published denominator because its
         rows were capped on the wire; the briefing publishes a section whole
         and this page draws all of it, so the sentences in hand ARE the
         section. Nothing here is truncated, and nothing here claims to be a
         selection. */
      /* THE KEY AND THE STAMP, ONCE. factItem() now draws a sentence's own
         provenance only where it DIFFERS from this, so this line has to
         carry the default or the page would show none at all — and a
         briefing whose readings had no stated origin would be the one thing
         this product will not ship. Said once and read; said twelve times
         and skipped. */
      /* THE COUNT AND THE STAMP MOVE INTO THE FOLD, and this is the one
         reduction on this page that needed an argument rather than a
         measurement. What it says is true and worth having: how many
         readings were published, that all of them are drawn, which key
         they came from and when it was built. But every word of it is
         about the PAGE, not about the market — and three regions of it,
         at three lines each, stood between a reader and the first number
         on every visit.

         IT IS FOLDED AND NOT DELETED, and the test is the one this file
         uses everywhere: does it change what a visible number MEANS? It
         does not. It qualifies the SET — and the set is complete, which
         is exactly why it is safe to fold. A truncated set could not go
         in here; a complete one has nothing to warn about. Any sentence
         whose own origin differs still draws its provenance in the open,
         under itself, because that one does change a reading. */
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

    /* A SECTION WITH NEITHER A READING NOR A SILENCE IS A FAULT HERE, and it
       is named as one. The module emits a silence for every surface it could
       not read, so an empty section that also named nothing means the shape
       on the wire and the shape this page reads have parted company. Saying
       so is what turns the next field rename into a visible sentence rather
       than a region that quietly stops appearing. */
    if (!facts.length && !drawn) {
      section.append(emptyLine("unreadable",
        "This section published no reading and named no silence, so this page cannot say " +
        "whether anything was measured. That is a fault on this page's side of the wire " +
        "rather than a fact about the session."));
    }

    /* THE FOLD'S SUMMARY IS THE QUESTION THE REGION ANSWERS, which is
       where `asks` went when it stopped being printed twice: as a summary
       it tells a reader what opening this will explain, which is more use
       than restating the heading above it. The region's own count and
       stamp lead the folded lines, before the derivation. */
    section.append(howBox(cfg.asks || "How this region was derived",
      (regionMeta ? [regionMeta] : []).concat(folded).concat(cfg.how)));
    return section;
  }

  /* ---------- the answer ---------------------------------------------------

     WHY THE ROUTE'S OWN SENTENCE IS PREFERRED TO THIS FILE'S. flows-market.js
     :2011 and flows-political.js:1064 both print the payload's published
     prose verbatim, for the reason those files state: a renderer that rewords
     a caveat has turned it into a claim. The map below exists only for a
     route that sends a reason CODE and no sentence, and the last arm is the
     honest one — a model that did not answer for a reason nobody can read is
     a third fact, and it is not the same fact as an allowance being spent. */
  var LLM_REASONS = {
    allowance: "The free daily allowance for the model is spent, and it resets at 00:00 UTC.",
    "3036": "The free daily allowance for the model is spent, and it resets at 00:00 UTC.",
    capacity: "The model had no capacity for this question just now, and nothing of today's " +
      "allowance went on it.",
    "3040": "The model had no capacity for this question just now, and nothing of today's " +
      "allowance went on it.",
    plan: "The model this site asks for is not available on the plan it runs on, which is a " +
      "configuration fault here rather than a limit anyone hit.",
    "5035": "The model this site asks for is not available on the plan it runs on, which is a " +
      "configuration fault here rather than a limit anyone hit.",
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
       worker.js words all four no-model outcomes there — the spent allowance
       and its 00:00 UTC reset, the capacity miss that spent nothing, the plan
       fault, the model that could not be reached — and this block read
       `llmReason`, which nothing on this wire has ever sent. Every one of
       those four arrived as an absent field and left as "the route did not
       state why", which is the brief's THIRD honest answer: a reader was told
       the cause was unknown in the one case where it had been named. */
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

  function llmLine(block, fired) {
    var line = el("p", "ak-prov");
    /* A REFUSED ANSWER IS NOT THE MODEL'S WORDING, WHATEVER `llm` SAYS. The
       flag reports that a model was ASKED, and the guard reports whether what
       it wrote survived; a page that read only the first would print "the
       model wrote this" directly above "the generated wording was discarded"
       and leave the reader to decide which of its own sentences to believe.
       The guard is read first because it is the later fact. */
    if (fired) {
      line.append(el("span", "ak-prov-mark", MARK_PLAIN));
      /* A FIRED GUARD IS ITSELF THE PROOF THAT A MODEL WROTE SOMETHING, so
         the flag is not consulted on this branch. `llm` reports whose wording
         is being SERVED, and on a refusal the served wording is always the
         pipeline's — the route returns the refusal with llm false. Read as
         "was a model asked", that false printed "No model wrote any part of
         it" directly above the qualifier explaining that the model's wording
         had been discarded, and left the reader two of this page's own
         sentences to choose between. */
      line.append(text(" The wording above was assembled here from the published facts, in a " +
        "fixed order. A model was asked this question and what it wrote was refused before " +
        "it reached this page. Every figure in it is quoted from a payload."));
      return line;
    }
    if (block.used === true) {
      line.append(el("span", "ak-prov-mark", MARK_MODEL));
      line.append(text(" The wording above came back from a language model, which was given " +
        "the measured facts and asked to restate them. Every figure it wrote was checked " +
        "against those same facts before this page drew it."));
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

  /* THE GUARD'S VERDICT, READ FOR WHAT IT IS RATHER THAN FOR WHETHER IT IS
     TRUTHY. shared/flows-ask.js returns `rejected` as an ARRAY of the tokens
     that earned a refusal, and an empty array is truthy — so `if
     (guard.rejected)` would report every single answer as refused, including
     every clean one. A route that summarises the verdict into a boolean is
     read as a boolean, an array is read by its length, and `ok` is read as
     its own inverse. The house rule about isNum is the same rule: a helper
     that RETURNS something is compared, never asked for its truthiness. */
  function guardFired(guard) {
    if (!guard || typeof guard !== "object") return false;
    /* `ok` IS THE VERDICT AND IT IS ASKED FIRST. shared/flows-ask.js refuses
       an empty generation with {ok:false, rejected:[]} — a real refusal
       carrying no tokens, because there was no text to find one in. Counting
       `rejected` before consulting `ok` reads that empty array as a pass and
       prints "every figure it wrote was checked" over an answer the guard
       threw away. The length of `rejected` is a measurement of how many
       tokens were refused and a measured 0 is a real reading; it is not the
       verdict, and that is the same rule this file states for isNum. */
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
     answer is a lead sentence, a dash-prefixed fact per line and a closing
     sentence; put into one paragraph its newlines collapse and the fallback
     reads as a run-on, which would make it worse than the prose it replaced —
     the exact inversion the fallback exists to avoid. Blocks of dashed lines
     become a list and everything else becomes a paragraph, and the first
     paragraph is the finding. */
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

  /* TWO MOUNTS, ONE RENDERER. The route draws the briefing and the question
     box; the docked rail on every other page draws the question box alone.
     They are the same code because they are the same product — a second
     implementation of the guard notice, the four fallback sentences and the
     three silences is exactly how two surfaces come to disagree about what
     the model was allowed to do.

     THE DOCK DOES NOT REPEAT THE BRIEFING. A rail is 380px wide and the
     briefing is three regions of findings; drawn there it would be a worse
     copy of a page one click away, and it would fetch a key the route has
     already fetched. So the dock skips the regions and asks. */
  var DOCKED = app.getAttribute("data-mode") === "dock";

  /* THE STATUS LINE IS MOUNTED IF THE SHELL DID NOT CARRY ONE, because it is
     the channel this page reports its own failures on and a page with no such
     channel fails invisibly — which reads exactly like a quiet session.
     flows-overview.js:63 makes the same argument for the one dependency it
     cannot do without. */
  var status = document.getElementById("askStatus");
  if (!status) {
    status = el("p", "flows-status");
    status.id = "askStatus";
    app.append(status);
  }

  var briefHost = el("div", "ak-brief");
  briefHost.id = "askBrief";
  app.append(briefHost);

  var box = panel("askBox", "ak-askbox", "Ask about what has been published",
    "Anything the regions above did not answer.");
  box.append(el("p", "fc-note",
    "This box answers from the payloads this site has already published. It reads nothing " +
    "live, it places no vendor call, and it performs no arithmetic: every figure in an " +
    "answer is quoted from a payload. An answer that states a figure no payload published " +
    "is refused before it reaches this page, and the measured reading is served instead."));

  var form = el("form", "ak-ask");
  form.id = "askForm";
  var label = el("label", "ak-ask-l", "Your question");
  label.htmlFor = "askQ";
  var row = el("div", "ak-ask-row");
  var input = el("textarea", "ak-ask-in");
  input.id = "askQ";
  input.rows = 2;
  input.placeholder = "What changed on the short board?";
  input.autocomplete = "off";
  input.spellcheck = false;
  var send = el("button", "ak-ask-go", "Ask");
  send.type = "submit";
  row.append(input);
  row.append(send);
  form.append(label);
  form.append(row);
  box.append(form);

  var answerHost = el("div", "ak-answer");
  answerHost.id = "askAnswer";
  /* THE ANSWER REGION IS ANNOUNCED. It is replaced wholesale several times in
     a session and a reader who is not looking at it — or not looking at all —
     otherwise has no way to know a new one arrived. Polite rather than
     assertive: an answer is worth hearing at the end of the current sentence,
     not in the middle of it. */
  answerHost.setAttribute("aria-live", "polite");
  box.append(answerHost);
  app.append(box);

  var foot = document.getElementById("askFoot");

  /* ---------- reading the briefing --------------------------------------

     A REQUEST THAT NEVER CAME BACK IS NOT A KEY THAT WAS NEVER PUBLISHED.
     The sentinel is flows-market.js:126's, for the reason that file gives: a
     500, a dropped connection or a JSON parse failure reduces to the same
     null the {status:"pending"} envelope does, so a failed request would
     print a confident claim about the pipeline. Its fields are prefixed so a
     payload-shape scan cannot mistake them for publisher fields. */
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

  /* SEVERITY IS A WORD AND A POSITION, NEVER A HUE ALONE — the same rule
     flows.css:880 states for the silence marks. The mark is drawn in a
     fixed column so "blocking" and "note" are told apart by shape before
     any colour is read, and the word itself is printed, because a glyph
     alone is a legend a reader has to have been taught. */
  var WARN_MARK = { blocking: "!!", caution: "!", note: "\u00b7" };

  function paintWarnings(brief) {
    var box = el("section", "ak-warns fc-panel ak-panel");
    var list = brief && Array.isArray(brief.warnings) ? brief.warnings : null;
    var checked = brief && typeof brief.warningsChecked === "number" ? brief.warningsChecked : null;

    if (list === null) {
      /* THE KEY PREDATES THE CHECKS, or the field did not survive the
         wire. Either way this page has not been told anything about the
         data's consistency, and saying "no warnings" here would be a
         claim nobody measured. */
      box.append(el("p", "ak-warns-none fc-note",
        "This briefing carries no consistency report, so nothing is stated about whether " +
        "its surfaces agree. That is a gap on this page rather than a clean bill."));
      return box;
    }

    if (!list.length) {
      box.append(el("p", "ak-warns-none fc-note", checked === null
        ? "No inconsistency was found across the published surfaces."
        : "No inconsistency was found across the published surfaces, from " + checked + " " +
          (checked === 1 ? "check that could run" : "checks that could run") + "."));
      return box;
    }

    box.append(el("h2", "fc-panel-h", list.length === 1
      ? "1 thing to know before reading the rest"
      : list.length + " things to know before reading the rest"));
    box.append(el("p", "ak-sub fc-note", checked === null
      ? "Each was found by comparing two published surfaces against each other."
      : "Found by comparing published surfaces against each other; " + checked + " of these " +
        (checked === 1 ? "check" : "checks") + " had the inputs to run at all."));

    var ul = el("ul", "ak-warns-list");
    for (var i = 0; i < list.length; i++) {
      var w = list[i] && typeof list[i] === "object" ? list[i] : {};
      /* AN UNRECOGNISED SEVERITY KEEPS THE WORD ITS PUBLISHER CHOSE. The
         lookup was a truth test over WARN_MARK, so a severity this page has
         no mark for — a level flows-warnings.js grows later, or a typo on the
         wire — became "note", and the least severe of the three was then
         printed as though the publisher had asked for it. silenceLine() above
         maps an unknown kind to a FOURTH value rather than into one of its
         three, for exactly this reason. Membership is asked with
         hasOwnProperty because a severity of "constructor" or "toString"
         otherwise answers the truth test with a function off the prototype
         and prints it as the mark. */
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

  function post(question) {
    return fetch("/api/flows/ask", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ question: question }),
    }).then(function (r) {
      /* A 401 SAYS THE SESSION IS GONE AND THE PAGE IS ALREADY NAVIGATING, so
         nothing below may paint over it. It is a FLAG as well as a null
         return — flows-overview.js:1922's fix — because this handler has a
         re-enable step after it, and re-enabling a form on a page that is
         leaving invites a second request nobody can answer. */
      if (r.status === 401) { gated = true; location.replace("/flows/"); return null; }
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  function paintAnswer(payload, question) {
    answerHost.textContent = "";

    /* THE QUESTION IS ECHOED, AND THAT IS NOT THE RULE shared/flows-ask.js
       BREAKS. That module refuses to quote the question back INSIDE the
       answer, because a reader who wrote "what happened to the 40 names"
       would otherwise put a 40 into prose the guard then scans and refuses.
       Here it is a labelled line of the reader's own words, outside the
       answer and outside the guard's subject, and it is what makes a second
       question distinguishable from the first on a page that keeps only the
       latest answer. */
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
       The briefing route and this one answer the same store, so the state
       before the session's first pipeline run arrives here as well — the
       route returns {status:"pending", answer:null, facts:[]} with its own
       sentence on `note`. Read without this branch that envelope tripped the
       "carried no text" line AND the "neither an answer, a fact nor a
       silence" line, so the ordinary morning before the run was reported
       twice as a fault on this page's side of the wire, and the provenance
       line between them claimed a reading had been assembled from published
       facts that do not yet exist. paintBrief() has always told the three
       apart; this half of the page did not. */
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

    answerHost.append(llmLine(block, fired));

    /* THE REFUSAL IS NEVER HIDDEN. A reader holding a deterministic answer
       that was silently swapped in for a refused one has been told less than
       nothing: the prose they are reading is not the prose the system first
       produced, and they cannot weigh it without knowing that. The reason is
       printed as the module wrote it — it carries no figures of its own, by
       design, so that this sentence cannot put an unquoted number back on the
       page in the course of explaining why one was refused. */
    if (fired) {
      /* THE ROUTE'S SENTENCE, NOT THE GUARD'S. `guard.reason` ends by naming
         the `rejected` field — the right thing to hand a developer reading
         the JSON and the wrong thing to print on a page, which is why the
         route words its own `note` for this branch and tells an invented
         figure from a claim about the future while it is there. The guard's
         string is kept only as the fallback for a route that sends no
         sentence of its own. */
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
       bound, and the method line below states it. The vendor-capped case does
       not arise here: nothing between the index and this page is anyone
       else's ceiling. */
    if (payload.capped === true) {
      answerHost.append(qualifier("The facts below were cut at this page's own cap, so they " +
        "are a selection rather than everything published. How many were selected out of how " +
        "many exist is stated in the method note at the foot of this answer."));
    }

    if (facts.length) {
      /* THE VERB AGREES WITH THE COUNT, and it is written as two whole
         sentences rather than as one with a bolted-on "s". A line reading
         "1 fact were handed" is a small thing that tells a reader the prose
         on this page is assembled rather than written, which is exactly the
         impression a page carrying a model's output cannot afford. */
      answerHost.append(el("p", "ak-sub fc-note", facts.length === 1
        ? "1 fact was handed to the answer above, with the key it came from and the run that " +
          "built it."
        : facts.length + " facts were handed to the answer above, each with the key it came " +
          "from and the run that built it."));
      answerHost.append(factList(facts, null, null));
    }

    var silences = silenceList(payload.silences);
    paintSilences(answerHost, silences);

    if (!facts.length && !silences.length && said === "") {
      answerHost.append(emptyLine("unreadable",
        "The route returned neither an answer, a fact nor a silence, so this page cannot say " +
        "what was asked of the payloads. A fault on this page's side of the wire."));
    }

    answerHost.append(howBox("How this answer was assembled", answerHow(payload, block, guard)));
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
      /* THE REFUSED TOKENS ARE DATA, NOT A READING, and they are the one thing
         on this page that is deliberately behind a disclosure. They are what
         a maintainer needs to see in order to know what the model tried; they
         are not a measurement of anything, and a reader who met them in the
         open would meet a number no payload published. */
      lines.push("The tokens the guard refused, listed as data rather than as readings: " +
        tokens.join(", ") + ". None of them appears in any fact the answer was given.");
    } else if (!fired && guard && Array.isArray(guard.numerals)) {
      /* AND ONLY WHERE THE GUARD PASSED. An empty `rejected` is reached both
         by an answer that was clean and by a refusal that found no token to
         name, so without the verdict this sentence reported "found every one
         of them already written in the facts it was given" inside the audit
         trail of an answer the guard had just thrown away. */
      lines.push("The guard scanned " + guard.numerals.length + " figure" +
        (guard.numerals.length === 1 ? "" : "s") + " in the answer above and found every one " +
        "of them already written in the facts it was given.");
    }
    lines.push("The scan is character-for-character against the sentences the answer was " +
      "handed, not against the field values behind them. That is stricter than it sounds: an " +
      "answer that rewrites a published figure into millions has performed arithmetic on a " +
      "measurement, and it is refused for it.");

    if (block.model !== null) lines.push("The model asked for this route is " + block.model + ".");
    if (block.calls !== null) {
      /* A COUNT OF THIS SITE'S OWN CALLS, AND IT IS NOT A BALANCE. The daily
         allowance is account-wide and this site is not the only thing that
         could spend it, so a number derived here can say what this route did
         and nothing whatever about what remains. Reporting it as a remaining
         balance would be a confident figure that is not a measurement, which
         is the one defect this product is organised against. */
      lines.push("This site has asked the model " + block.calls + " time" +
        (block.calls === 1 ? "" : "s") + " today. That is a count of this route's own calls " +
        "and not a reading of what the account has left: the allowance is account-wide, and " +
        "nothing here can measure what else has spent it.");
    }

    var pins = factPins(payload.facts);
    if (pins) lines.push(pins);
    return lines;
  }

  /* THE ANTI-TAMPER RECORD, FLATTENED INTO ONE SENTENCE PER FACT. Every fact
     carries its numbers under names in `n`, and every numeral in its sentence
     is one of those values — that is what makes the sentence checkable rather
     than merely plausible. It is printed for the ANSWER's facts and not for
     the briefing's, because the answer is the one place a model touched the
     prose and so the one place a reader's need to verify is highest.

     THE VALUES ARE NOT REFORMATTED. No thousands separator, no rounding, no
     currency mark: reformatting a measurement on the way to the page is the
     same arithmetic the guard refuses an answer for, and it would be
     indefensible to do it in the paragraph that exists to prove none was
     done. */
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
      parts.join("; ") + ". Every figure in the prose above is one of these values.";
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
      answerHost.append(qualifier("No question was typed, so nothing was sent and no model " +
        "call was spent. The briefing above stands whether or not anything is asked."));
      input.focus();
      return;
    }

    setAsking(true);
    answerHost.textContent = "";
    answerHost.append(el("p", "ak-busy",
      "Reading the published payloads for this question…"));

    post(question).then(function (payload) {
      if (gated) return;
      paintAnswer(payload, question);
    }).catch(function (error) {
      if (gated) return;
      answerHost.textContent = "";
      /* THE REQUEST FAILED, AND THAT IS A FACT ABOUT THIS PAGE. It says
         nothing at all about what the payloads hold, and a reader who took it
         as an empty session would have been told the opposite of the truth by
         a page that could not reach its own route. */
      answerHost.append(emptyLine("unreadable",
        "The question could not be sent: " + (error && error.message ? error.message : error) +
        ". That is this page failing to reach its route, not a statement about what has been " +
        "published — the briefing above was read separately and still stands."));
    }).then(function () {
      if (gated) return;
      setAsking(false);
    });
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
   CLASSES THIS FILE EMITS, for the stylesheet pass.

   NEW — no rule exists for any of these in assets/css/flows.css:

     .ak-panel          a panel on this route. `.fc-panel` carries the shell;
                        this exists so the header below can be scoped the way
                        flows.css:5939 scopes `.sg-panel .fc-panel-h`, which
                        is the documented precedent for a route whose heading
                        slot is an h2 rather than an h3 and therefore inherits
                        nothing.
     .ak-brief          the wrapper holding the three briefing regions.
     .ak-region         a briefing region (also carries .fc-panel .ak-panel).
     .ak-askbox         the question panel (also carries .fc-panel .ak-panel).
     .ak-sub            the count line under a region heading — how many
                        readings were published and drawn.
     .ak-facts          the <ul> of facts.
     .ak-fact           one fact. `.is-lead` marks the first, whose sentence
                        is the region's finding.
     .ak-fact-say       the sentence. Also carries .fc-reading (+ .is-lead).
     .ak-fact-src       the provenance line under a sentence.
     .ak-src-key        the publish key a sentence came from. Monospace: it is
                        a key, not prose, and it is also emitted on a silence
                        line to name the surface that was silent.
     .ak-src-at         the run stamp, or the sentence saying there is none.
     .ak-ask            the question form.
     .ak-ask-l          its <label>, bound to the textarea by `for`.
     .ak-ask-row        the row holding the textarea and the button.
     .ak-ask-in         the textarea. The 16px iOS focus-zoom floor and the
                        tap target are the stylesheet's half of the contract,
                        the same way flows-ui.js:300 states it for searchBox.
     .ak-ask-go         the submit button. Its disabled state is set here
                        while a question is in flight and needs a visible
                        treatment, because a button that looks identical
                        whether or not it is accepting clicks is a button
                        readers press twice.
     .ak-answer         the answer region. aria-live="polite" is set here.
     .ak-answer-list    the <ul> a dash-prefixed answer block becomes.
     .ak-answer-item    one line of it.
     .ak-asked          the echoed question, above the answer.
     .ak-asked-l        its "You asked" label.
     .ak-prov           the provenance line: who wrote the wording.
     .ak-prov-mark      its leading glyph, ◆ or ▪, in a fixed position. THIS
                        IS THE SIGN AND IT MUST NOT BECOME A HUE — the mark
                        has to survive greyscale and a monochrome printout,
                        which is the same rule flows.css:880 states for the
                        four silence marks and flows-political.js:31 for its
                        freshness glyph.
     .ak-busy           the in-flight line while a question is out.

   REUSED — rules already exist and this file adds no CSS need for them:

     .fc-panel          flows.css:839
     .fc-panel-h        no rule of its own; see .ak-panel above and
                        flows.css:5934, which records why.
     .fc-q              flows.css:885 — the question a panel answers.
     .fc-reading        flows.css — the FINDING; `.is-lead` promotes it.
     .fc-note           flows.css:892 — the method paragraph.
     .fc-note.is-qualifier
                        flows.css:938 — a note that could change what the
                        reading means, and therefore never inside a
                        disclosure.
     .flows-empty       flows.css:5555, with the four marks at :5565-5612.
     .flows-status      flows.css:5624.
     .flows-foot-p      flows.css:5462.
     .ft-how/.ft-how-s  flows.css:3763 and :3434-3442 — the disclosure the
                        method is folded into.

   data-empty VALUES THIS FILE SETS, all four of which already have a mark:
     "pending"      … the key has not been published for this session
     "unreadable"   ×  the request or the shape failed HERE
     "quiet"        |  measured, and it held nothing — the one that is a
                       reading about the market
     "unavailable"  †  published, and the field this region needs is not on it
   ============================================================= */
