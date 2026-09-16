(function () {
  "use strict";

  var MARK_MODEL = "∗";
  var MARK_PLAIN = "•";

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

  function emptyLine(kind, said) {
    var p = el("p", "flows-empty", said);
    p.setAttribute("data-empty", kind);
    return p;
  }

  function qualifier(said) {
    return el("p", "fc-note is-qualifier", said);
  }

  function howBox(summary, lines) {
    var box = el("details", "ft-how");
    box.append(el("summary", "ft-how-s", summary));
    for (var i = 0; i < lines.length; i++) {
      if (typeof lines[i] === "string" && lines[i] !== "") box.append(el("p", "fc-note", lines[i]));
    }
    return box;
  }

  function meterFigure(n) {

    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function spendMeter(spend, reason) {
    var box = el("div", "ak-meter");

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

    say.append(text(" model credits left today · counting only this site's own calls"));
    box.append(say);

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

  function panel(id, extraClass, heading) {
    var section = el("section", "fc-panel ak-panel " + extraClass);
    section.id = id;
    if (heading) section.append(el("h2", "fc-panel-h", heading));
    return section;
  }

  function stampSaid(at) {
    if (typeof at !== "string" || at.trim() === "") return null;
    var ms = Date.parse(at);
    if (!isFinite(ms)) return at;
    return new Date(ms).toLocaleString();
  }

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

    if (spec.den && spec.den.key) {
      var d = isNum(n[spec.den.key]);
      box.append(el("p", "ak-fig-d", d === null
        ? "of an unpublished total"
        : "of " + d + (spec.den.word ? " " + spec.den.word : "")));
    }
    return box;
  }

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

    var fig = leadFigure(fact);
    if (fig) li.append(fig);

    if (say.trim() === "") {
      li.append(emptyLine("unreadable",
        "A reading was published for this region without the sentence that states it, so " +
        "this page has nothing to show for it. That is a gap in the payload rather than a " +
        "fact about the session."));
    } else {
      li.append(el("p", "ak-fact-say fc-reading" + (lead ? " is-lead" : ""), say));
    }

    var line = provLine(fact, fallbackSource, fallbackAt);
    if (line) li.append(line);
    return li;
  }

  function factList(facts, source, at) {
    var ul = el("ul", "ak-facts");
    for (var i = 0; i < facts.length; i++) ul.append(factItem(facts[i], source, at, i === 0));
    return ul;
  }

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

        out.push({ kind: SILENCE_ORDER[i], what: q.what, say: q.say,
          source: q.source, reason: q.reason });
      }
    }
    return out;
  }

  function silenceLine(q) {
    var said = typeof q.say === "string" && q.say.trim() !== "" ? q.say : null;
    var kind = SILENCE_ORDER.indexOf(q.kind) === -1 ? "unavailable" : q.kind;

    var p = emptyLine(kind, said === null
      ? "A silence was published for " + (q.what || "this surface") +
        " without the sentence that explains it, so this page cannot say which " +
        "of the three it is. That is a gap in the payload rather than a fact " +
        "about the session."
      : said);
    if (typeof q.reason === "string" && q.reason) p.append(text(" (" + q.reason + ")"));
    if (typeof q.source === "string" && q.source) {

      p.append(text(" Source key: "));
      p.append(el("span", "ak-src-key", q.source));
      p.append(text("."));
    }
    return p;
  }

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

  var REGIONS = [
    {
      slot: "yesterday",
      id: "askYesterday",
      heading: "Since the prior session",
      asks: "What is different from the last session this pipeline measured?",

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

      section.append(emptyLine("unavailable",
        "The briefing was published and carried no section for this region, so there is " +
        "nothing here to read. A gap in the payload rather than a fact about the session."));
      return section;
    }

    var facts = Array.isArray(payload.facts) ? payload.facts : [];
    var silences = silenceList(payload.silences);

    if (facts.length) {

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

    if (!facts.length && !drawn) {
      section.append(emptyLine("unreadable",
        "This section published no reading and named no silence, so this page cannot say " +
        "whether anything was measured. That is a fault on this page's side of the wire " +
        "rather than a fact about the session."));
    }

    section.append(howBox(cfg.asks || "How this region was derived",
      (regionMeta ? [regionMeta] : []).concat(folded).concat(cfg.how)));
    return section;
  }

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

    var used = null;
    if (v === true || v === false) used = v;
    else if (obj && typeof obj.used === "boolean") used = obj.used;
    else if (obj && typeof obj.llm === "boolean") used = obj.llm;

    var published = null;
    if (obj && typeof obj.reason === "string" && obj.reason.trim() !== "") published = obj.reason;
    else if (typeof payload.llmReason === "string" && payload.llmReason.trim() !== "") {
      published = payload.llmReason;
    } else if (typeof payload.note === "string" && payload.note.trim() !== "") {
      published = payload.note;
    }

    var code = obj && obj.code !== undefined && obj.code !== null ? String(obj.code)
      : (payload.llmCode !== undefined && payload.llmCode !== null ? String(payload.llmCode)
        : (typeof payload.llmFailure === "string" && payload.llmFailure.trim() !== ""
          ? payload.llmFailure.trim() : null));

    var calls = isNum(obj ? obj.calls : null);
    if (calls === null) calls = isNum(payload.llmCalls);
    var model = obj && typeof obj.model === "string" && obj.model ? obj.model
      : (typeof payload.model === "string" && payload.model ? payload.model : null);

    return { used: used, published: published, code: code, calls: calls, model: model };
  }

  function llmLine(block, fired, guard) {
    var line = el("p", "ak-prov");

    if (fired) {
      line.append(el("span", "ak-prov-mark", MARK_PLAIN));

      line.append(text(" The wording above was assembled here from the published facts, in a " +
        "fixed order. A model was asked this question and what it wrote was refused before " +
        "it reached this page. Every figure in it is quoted from a payload."));
      return line;
    }
    if (block.used === true) {
      line.append(el("span", "ak-prov-mark", MARK_MODEL));

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

  function guardFired(guard) {
    if (!guard || typeof guard !== "object") return false;

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

  function paintAnswerText(host, said) {
    var lines = String(said).split("\n");
    var list = null;
    var first = true;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line === "") { list = null; continue; }

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

  var app = document.getElementById("askApp");
  if (!app) return;

  var DOCKED = app.getAttribute("data-mode") === "dock";

  var status = document.getElementById("askStatus");
  if (!status) {
    status = el("p", "flows-status");
    status.id = "askStatus";
    app.append(status);
  }

  var briefHost = el("div", "ak-brief");
  briefHost.id = "askBrief";
  app.append(briefHost);

  var box = panel("askBox", "ak-askbox",
    DOCKED ? null : "Ask about what has been published");

  var exampleHost = el("div", "ak-examples");
  exampleHost.id = "askExamples";
  box.append(exampleHost);

  var meterHost = el("div", "ak-meter-host");
  meterHost.id = "askMeter";
  box.append(meterHost);

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

  input.addEventListener("keydown", function (event) {
    if (event.key !== "Enter") return;
    if (event.isComposing || event.keyCode === 229) return;
    if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();

    if (typeof form.requestSubmit === "function") form.requestSubmit();
    else send.click();
  });

  row.append(input);
  row.append(send);
  form.append(label);
  form.append(row);
  box.append(form);

  box.append(howBox("What this box answers from", [
    "This box answers from the payloads this site has already published. It reads nothing " +
    "live, it places no vendor call, and it performs no arithmetic: every figure in an " +
    "answer is quoted from a payload. An answer that states a figure no payload published " +
    "is refused before it reaches this page, and the measured reading is served instead."]));

  var answerHost = el("div", "ak-answer");
  answerHost.id = "askAnswer";

  answerHost.setAttribute("aria-live", "polite");
  box.append(answerHost);
  app.append(box);

  var foot = document.getElementById("askFoot");

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

    b.addEventListener("click", function () {
      input.value = said;
      try { input.focus(); } catch (e) {   }
    });
    return b;
  }

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

    var onPage = el("p", "ak-onpage");

    onPage.append(text("Asking about " + ON_PAGE + (DOCKED
      ? " — the name on this page. "
      : " — the name this link carried. ") +
      "A question that names no ticker is answered about it. "));
    var insert = el("button", "ak-onpage-go", "Insert " + ON_PAGE);
    insert.type = "button";
    insert.addEventListener("click", function () {
      var held = String(input.value || "");
      input.value = held === "" ? ON_PAGE : held.replace(/\s+$/, "") + " " + ON_PAGE;
      try { input.focus(); } catch (e) {   }
    });
    onPage.append(insert);
    onPageHost.append(onPage);
  }

  var gated = false;

  function get(path) {
    return fetch(path, { credentials: "same-origin", signal: AbortSignal.timeout(15000), headers: { Accept: "application/json" } })
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

  var WARN_MARK = { blocking: "!!", caution: "!", note: "\u00b7" };

  function paintWarnings(brief) {
    var box = el("section", "ak-warns fc-panel ak-panel");
    var list = brief && Array.isArray(brief.warnings) ? brief.warnings : null;
    var checked = brief && typeof brief.warningsChecked === "number" ? brief.warningsChecked : null;

    var questions = brief && typeof brief.warningsQuestions === "number"
      ? brief.warningsQuestions : null;

    if (list === null) {

      box.append(el("p", "ak-warns-none fc-note",
        "This briefing carries no consistency report, so nothing is stated about whether " +
        "its surfaces agree. That is a gap on this page rather than a clean bill."));
      return box;
    }

    if (!list.length) {

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

      var severity = typeof w.severity === "string" && w.severity.trim() !== ""
        ? w.severity.trim() : null;
      var known = severity !== null &&
        Object.prototype.hasOwnProperty.call(WARN_MARK, severity);
      var sev = known ? severity : "unknown";
      var li = el("li", "ak-warn is-" + sev);
      li.append(el("span", "ak-warn-mark", known ? WARN_MARK[severity] : "?"));
      var body = el("div", "ak-warn-body");

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

    briefHost.append(paintWarnings(brief));

    for (var i = 0; i < REGIONS.length; i++) briefHost.append(paintRegion(REGIONS[i], brief));

    var covered = coveredNames(brief.facts);
    if (covered.length) paintExamples(covered);

    if (status) {
      status.removeAttribute("data-empty");
      var session = typeof brief.sessionDate === "string" && brief.sessionDate
        ? brief.sessionDate : null;
      var built = stampSaid(brief.generatedAt);

      var reread = stampSaid(brief.refreshedAt);
      status.textContent = [
        session === null ? "Briefing published without a session date" : "Session " + session,
        built === null ? "no build stamp on this key" : "built " + built,
      ].concat(reread === null ? [] : ["alerts and pulse re-read " + reread]).join(" \u00b7 ");
    }

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

  var asking = false;

  function post(question, subject) {
    return fetch("/api/flows/ask", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ question: question, subject: subject }),
    }).then(function (r) {

      if (r.status === 401) { gated = true; location.replace("/flows/"); return null; }
      if (r.ok) return r.json();

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

    if (Object.prototype.hasOwnProperty.call(payload, "spend")) {
      paintSpend(payload.spend, null);
    }

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

    if (payload.status === "pending") {
      answerHost.append(emptyLine("pending",
        typeof payload.note === "string" && payload.note.trim() !== ""
          ? payload.note.trim()
          : "The briefing has not been published for this session yet, so there is nothing " +
            "measured to answer from. Nothing is claimed about the market by that."));
      return;
    }

    if (payload.status === "unreadable") {
      answerHost.append(emptyLine("unreadable",
        typeof payload.note === "string" && payload.note.trim() !== ""
          ? payload.note.trim()
          : "The briefing could not be read from the store, so no answer is offered. That " +
            "is a fault on this site rather than a fact about the session."));
      return;
    }

    var block = llmBlock(payload);
    var guard = payload.guard && typeof payload.guard === "object" ? payload.guard : null;
    var fired = guardFired(guard);
    var facts = Array.isArray(payload.facts) ? payload.facts : [];

    var age = payload.session && typeof payload.session === "object" ? payload.session : null;
    if (age && age.stale === true && typeof age.say === "string" && age.say.trim() !== "") {
      answerHost.append(qualifier(age.say.trim()));
    }

    var said = typeof payload.answer === "string" ? payload.answer.trim() : "";
    if (said === "") {
      answerHost.append(emptyLine("unreadable",
        "The route answered and carried no text for this question, so there is nothing to " +
        "read. The facts it selected are listed below and are unaffected."));
    } else {
      paintAnswerText(answerHost, said);
    }

    answerHost.append(llmLine(block, fired, guard));

    if (payload.subjectApplied === true &&
        typeof payload.subject === "string" && payload.subject !== "") {
      answerHost.append(qualifier("Nothing in the question named a ticker, so " +
        payload.subject + " — the name on the page this was asked from — was " +
        "added to it before the readings were selected. Typing a name of your own is what " +
        "overrides that; this page's name is not added to a question that already has one."));
    }

    var withheld = typeof payload.withheld === "string" && payload.withheld.trim() !== ""
      ? payload.withheld.trim() : null;
    if (withheld !== null && block.used === true && !fired) {
      answerHost.append(qualifier(withheld));
    }

    if (fired) {

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

    if (payload.capped === true) {
      answerHost.append(qualifier("The facts below were cut at this page's own cap, so they " +
        "are a selection rather than everything published. How many were selected out of how " +
        "many exist is stated in the method note at the foot of this answer."));
    }

    if (facts.length) {

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

    var names = coveredNames(facts);
    if (names.length) paintExamples(names);
  }

  function answerHow(payload, block, guard) {
    var lines = [];
    var fired = guardFired(guard);

    if (typeof payload.why === "string" && payload.why.trim() !== "") lines.push(payload.why);
    lines.push("Selection is deterministic and carries no model: the same question over the " +
      "same published payloads picks the same facts on every machine. A ticker named in the " +
      "question outweighs a topic word, and recency only ever breaks a tie.");

    var tokens = guardTokens(guard);
    if (tokens.length) {

      lines.push("The tokens the guard refused, listed as data rather than as readings: " +
        tokens.join(", ") + ". None of them appears in any fact the answer was given.");
    } else if (!fired && guard && Array.isArray(guard.numerals)) {

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

      lines.push("This site has asked the model " + block.calls + " time" +
        (block.calls === 1 ? "" : "s") + " today. That is a count of this route's own calls " +
        "and not a reading of what the account has left: the allowance is account-wide, and " +
        "nothing here can measure what else has spent it.");
    }

    var pins = factPins(payload.facts);
    if (pins) lines.push(pins);
    return lines;
  }

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

