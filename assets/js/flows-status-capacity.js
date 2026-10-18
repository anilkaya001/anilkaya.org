(() => {
  "use strict";

  const UI = window.FlowsUI;
  const kit = UI && UI.statusKit;
  if (!kit) return;
  const {
    h, DASH, num, whole, trt, clockSec, span, usd, table, facts, why, fill, unread, okBody, whyOf, state, vendorReading, capOf, sameDay, mini, rest, line, paintAi,
  } = kit;
  const $ = (id) => document.getElementById(id);
  const BAND = { low: 0.8, high: 0.85 };
  const FREE_NEURONS_USD_PER_1000 = 0.011;

  const pct = (used, cap) => (num(used) === null || !(num(cap) > 0) ? null : used / cap);
  const pctText = (p) => (p === null ? DASH : (p * 100 < 10 ? (p * 100).toFixed(1) : Math.round(p * 100)) + "%");

  function gauge(used, cap, marks) {
    const p = pct(used, cap);
    const track = h("div", { class: "lt-gauge", role: "img", "aria-label": p === null ? "No cap, no gauge" : pctText(p) + " of the cap" });
    if (p === null) return track;
    track.append(h("span", { class: "lt-band", style: { "--a": BAND.low * 100 + "%", "--b": (BAND.high - BAND.low) * 100 + "%" } }));
    track.append(h("span", { class: "lt-fill" + (p >= 1 ? " is-full" : p >= BAND.high ? " is-high" : ""), style: { "--w": Math.min(1, p) * 100 + "%" } }));
    for (const m of marks || []) track.append(h("span", { class: "lt-mark", title: m.label, style: { "--x": Math.min(1, m.at / cap) * 100 + "%" } }));
    return track;
  }

  function meter(name, used, cap, o) {
    const p = pct(used, cap);
    const lines = [];
    if (o.note) lines.push(o.note);
    return h("article", { class: "lt-meter" },
      h("div", { class: "lt-meter-h" }, h("h3", null, name), h("span", { class: "lt-meter-v" }, h("b", null, num(used) === null ? DASH : o.format(used)),
        cap === null || cap === undefined ? " of " + DASH + " no cap listed" : " of " + o.format(cap), " ", h("span", { class: "lt-unit" }, o.unit), " · ", h("b", null, pctText(p)))),
      num(used) === null ? h("p", { class: "lt-none" }, DASH + " " + (o.unread || "not read")) : gauge(used, cap, o.marks),
      ...(p !== null ? [h("p", { class: "lt-band-note" }, "Marks: your target band " + BAND.low * 100 + " to " + BAND.high * 100 + "%, not enforced." +
        ((o.marks || []).length ? " " + o.marks.map((m) => m.label).join("; ") + "." : ""))] : []),
      ...lines.map((t) => h("p", { class: "lt-src" }, t)),
      h("p", { class: "lt-src" }, o.source));
  }

  const lineText = (l) => (!l ? DASH + " the plan table has no line" : (l.cap === null ? "no cap listed" : whole(l.cap)) + " per " + l.per + " (" + l.plan + " plan, " + (l.capFrom || "plan") + "; " + l.via + ", " + l.source + ")");

  function paintMeters(now) {
    const host = $("stMeters");
    const S = state();
    const ops = okBody("ops");
    if (!ops) { unread(host, "The ops view", S.D.ops ? S.D.ops.reason : "no read yet"); return; }
    const lines = ops.lines || {};
    const cards = [];
    const reading = vendorReading(now);
    const uw = lines["uw.day"];
    cards.push(meter("Vendor calls today, whole key", reading && reading.today ? reading.daily : null, uw ? uw.cap : null, {
      format: whole, unit: "calls",
      unread: reading ? "the last counter was read " + trt(reading.at, now) + ", before today" : "no Tier 1 or focus tick has recorded the vendor's counter header yet",
      source: "The vendor's own count of every call on the key, MCP sessions and probes included" + (reading ? ", read " + trt(reading.at, now, true) : "") + ". Cap: " + lineText(uw) +
        ". The vendor's day boundary is assumed to turn at 03:00 TRT, not learned.",
    }));
    const rail = okBody("rail");
    const calls = rail && rail.calls ? rail.calls : null;
    cards.push(meter("Vendor calls, rail, last minute", calls ? calls.minuteTotal : null, calls ? calls.perMinute : null, {
      format: whole, unit: "calls a minute", unread: "the rail was not read: " + whyOf("rail"),
      source: "The rail's own enforced ceiling; past it a topic is degraded with reason budget. Key-wide per minute: " + DASH + " not measured, the vendor's per-minute header never decrements. Vendor ceiling: " + lineText(lines["uw.min"]) + ".",
    }));
    const cap = capOf();
    const aiBody = okBody("ai");
    const spend = aiBody && aiBody.spend ? aiBody.spend : ops.ai ? ops.ai.spend : null;
    const neurons = spend && num(spend.neurons) !== null ? spend.neurons : null;
    cards.push(meter("Workers AI neurons", neurons, cap ? cap.neurons : null, {
      format: whole, unit: "neurons today",
      unread: !spend ? "the model day was not read" : "a model on the day has no configured rate, so the total is not worked",
      marks: cap ? [{ at: cap.allowanceNeurons, label: "free allowance " + whole(cap.allowanceNeurons) }, { at: cap.readsStopAt, label: "readings stop at " + whole(cap.readsStopAt) }] : [],
      source: "The site's cap, the one every model call is refused at; the free allowance only starts billing. Plan line: " + lineText(lines["ai.neurons"]) + ".",
    }));
    cards.push(meter("Workers AI calls", spend ? spend.calls : null, cap ? cap.calls : null, {
      format: whole, unit: "calls today", unread: "the model day was not read",
      source: "Refused at the cap before the model is reached. Plan line: " + lineText(lines["ai.calls"]) + ".",
    }));
    const over = neurons === null ? null : Math.max(0, neurons - (cap ? cap.allowanceNeurons : 10000));
    const dollars = over === null ? null : (over / 1000) * FREE_NEURONS_USD_PER_1000;
    const usdLine = lines["ai.usd"];
    cards.push(meter("Workers AI beyond the allowance", dollars, usdLine ? usdLine.cap : null, {
      format: usd, unit: "dollars today", unread: "the neurons were not worked",
      source: "Neurons past the free allowance at $0.011 per 1,000. Plan line: " + lineText(usdLine) + ".",
    }));
    for (const [id, name, what] of [["d1.read", "D1 rows read", "D1 counts rows per account"], ["d1.write", "D1 rows written", "D1 counts rows per account"]]) {
      cards.push(meter(name, null, lines[id] ? lines[id].cap : null, {
        format: whole, unit: "rows", unread: "Not measured on the site: " + what + ", and the read-back needs Cloudflare's analytics token (P2-04, A-14)",
        source: "Plan line: " + lineText(lines[id]) + ".",
      }));
    }
    for (const [id, name, unit] of [["do.req", "Durable Object requests", "requests"], ["do.gbs", "Durable Object duration", "GB-s"]]) {
      cards.push(meter(name, null, lines[id] ? lines[id].cap : null, {
        format: whole, unit, unread: "Not measured on the site: the rail keeps no per-window record that survives it (the window recorder is not built)",
        source: "Plan line: " + lineText(lines[id]) + ".",
      }));
    }
    cards.push(meter("Workers requests", null, lines["cf.req"] ? lines["cf.req"].cap : null, {
      format: whole, unit: "requests", unread: "Not measured on the site: needs the analytics read-back (P2-04, token A-14)",
      source: "Plan line: " + lineText(lines["cf.req"]) + ".",
    }));
    const renewal = ops.plan && ops.plan.renewal ? ops.plan.renewal : null;
    fill(host, h("div", { class: "lt-meters" }, ...cards),
      renewal ? h("p", { class: "st-foot" }, "Workers " + renewal.workers + " plan, paid through " + renewal.through + ", renews " + renewal.renews +
        (renewal.daysLeft === null ? "" : " (" + whole(renewal.daysLeft) + " days left)") + (renewal.recorded ? "" : "; the date is the repository's, not one the owner recorded") + ".") : null);
  }

  function paintConsumers(now) {
    const host = $("stConsumers");
    const S = state();
    const ops = okBody("ops");
    if (!ops) { unread(host, "The ops view", S.D.ops ? S.D.ops.reason : "no read yet"); return; }
    const own = ops.vendor ? ops.vendor.own : null;
    const reading = vendorReading(now);
    const meta = okBody("meta");
    const nightlyToday = meta && meta.generatedAt ? sameDay(new Date(Date.parse(meta.generatedAt)), new Date(now)) : false;
    const rail = okBody("rail");
    const railHour = rail && rail.topics ? Object.values(rail.topics).reduce((a, t) => a + (num(t && t.calls && t.calls.hour) ?? 0), 0) : null;
    const rows = [
      ["Nightly run", meta && meta.generatedAt ? (nightlyToday ? num(meta.apiCalls) : null) : null, meta && meta.generatedAt ? (nightlyToday ? "attempts including retries, session " + (meta.sessionDate || DASH) : "the last run landed " + trt(meta.generatedAt, now) + ", not today") : "the nightly record was not read"],
      ["Tier 1 (Worker)", own ? own.tier1 : null, own ? (own.tier1 === null ? "the ledger column is not written yet" : "two reads a tick, counted at the tick") : "no ledger day"],
      ["Focus (Worker)", own ? own.focus : null, own ? (own.focus === null ? "the ledger column is not written yet" : "one read a tick") : "no ledger day"],
      ["Tier 2 (Actions)", own ? own.tier2 : null, own ? "logical reads; retries inside the pipeline's client are not counted" : "no ledger day"],
    ];
    const known = rows.filter((r) => num(r[1]) !== null).reduce((a, r) => a + r[1], 0);
    const complete = rows.slice(1).every((r) => num(r[1]) !== null);
    const total = reading && reading.today ? reading.daily : null;
    const residual = total !== null && complete ? total - known : null;
    rows.push(["Everything else on the key", residual, residual === null
      ? (total === null ? "the vendor's count was not read today" : "an engine's count is missing, so the remainder is not worked")
      : "on-demand reads, pre-market news, MCP sessions and probes; valid only inside one vendor day" + (residual < 0 ? "; negative means a count above is wrong or the day boundary moved" : "")]);
    const max = Math.max(1, ...rows.map((r) => num(r[1]) ?? 0));
    const list = h("ul", { class: "lt-bars" }, ...rows.map((r) => h("li", null,
      h("span", { class: "lt-bars-n" }, r[0]),
      h("span", { class: "lt-bars-t", "aria-hidden": "true" }, num(r[1]) === null ? null : h("span", { class: "lt-bars-f", style: { "--w": Math.max(0, r[1]) / max * 100 + "%" } })),
      h("b", null, num(r[1]) === null ? DASH : whole(r[1])))));
    fill(host, list,
      table("Vendor calls by consumer", ["Consumer", "Calls today", "Basis"], rows.map((r) => [r[0], num(r[1]) === null ? DASH : whole(r[1]), r[2]]), true),
      h("p", { class: "st-foot" }, "The rail made " + (railHour === null ? DASH : whole(railHour)) + " calls in the last hour; it keeps no day total, so it is not in the sum. " +
        (total === null ? "The vendor's own count was not read, so there is no remainder." : "The vendor's count was " + whole(total) + ", read " + trt(reading.at, now, true) + ".")));
  }

  function paintLimits() {
    const host = $("stLimits");
    const ops = okBody("ops");
    if (!ops || !Array.isArray(ops.limits)) { unread(host, "The enforced limits", ops ? "the answer carried none" : (state().D.ops ? state().D.ops.reason : "no read yet")); return; }
    const per = (s) => (s === null ? DASH : s === 60 ? "minute" : s === 86400 ? "day" : s + " s");
    fill(host,
      table("Limits enforced today", ["Limit", "Scope", "Value", "Per", "What happens past it"], ops.limits.map((l) => [l.name, l.scope, l.limit === null ? DASH + " set by the platform" : whole(l.limit), per(l.periodS), l.effect]), true),
      h("p", { class: "st-foot" }, "Not enforced yet: a daily vendor line (P1-30, F-26) and a daily D1 line (F-25, F-73). Nothing here sheds work at 80 or 85%; those marks on the meters are the owner's band, not a governor."));
  }

  function paintOutcomes() {
    const host = $("stOutcomes");
    const S = state();
    const r = S.D.opsAi;
    if (!r) { fill(host, h("p", { class: "st-miss" }, "Reading…")); return; }
    if (!r.ok) { unread(host, "The outcome block", r.reason); return; }
    const block = r.body && r.body.ai ? r.body.ai.block : null;
    if (!block) { unread(host, "The outcome block", "the store could not be read"); return; }
    const sum = (o, names) => names.reduce((a, k) => a + (o[k] || 0), 0);
    const rows = Object.entries(block.surfaces || {}).map(([k, v]) => [k, whole(v.calls), whole(v.reached), whole(v.outcomes.clean || 0), whole(v.outcomes.trimmed || 0),
      whole(sum(v.outcomes, ["refused", "unparsable", "overlong", "empty", "length"])), whole(sum(v.outcomes, ["allowance", "capacity", "plan", "unreachable"])),
      whole(sum(v.outcomes, ["budget", "class", "user"])), v.refusalRate === null ? DASH : Math.round(v.refusalRate * 1000) / 10 + "%", span(v.msAvg), span(v.msMax)]);
    const models = Object.entries(block.models || {}).map(([k, v]) => [k, whole(v.calls), whole(v.reached), v.refusalRate === null ? DASH : Math.round(v.refusalRate * 1000) / 10 + "%", span(v.msAvg), span(v.msMax)]);
    const recent = (block.recent || []).slice(0, 50).map((x) => [trt(x.at, Date.now(), true), x.surface, x.model, x.reason, x.culprit || DASH]);
    const heads = ["Surface", "Calls", "Reached", "Clean", "Trimmed", "Wording failures", "Transport", "Not asked", "Refusal rate", "Mean time", "Longest"];
    fill(host,
      rows.length ? table("Model outcomes by surface", heads, rows) : h("p", { class: "st-miss" }, "No model call has been recorded on " + (block.today || "today") + "."),
      models.length ? table("Model outcomes by model", ["Model", "Calls", "Reached", "Refusal rate", "Mean time", "Longest"], models) : null,
      recent.length ? table("The latest refusals", ["Time", "Surface", "Model", "Reason", "Culprit"], recent, true) : null,
      h("p", { class: "st-foot" }, "Reached is a call that got as far as the model. A wording failure is a reply the checks refused; transport is a refusal by the platform; not asked is a call the site's own cap or class turned away. The culprit is the offending token as text."));
  }

  function paintPlan() {
    const host = $("stPlan");
    const ops = okBody("ops");
    if (!ops || !ops.lines) { unread(host, "The plan lines", ops ? "the answer carried none" : (state().D.ops ? state().D.ops.reason : "no read yet")); return; }
    const rows = Object.entries(ops.lines).map(([id, l]) => [id, l.unit, l.cap === null ? DASH : whole(l.cap), l.per, l.plan, l.via, l.source, l.capFrom || "plan"]);
    const plan = ops.plan || {};
    fill(host,
      facts([["Workers plan", (plan.workers || DASH) + (plan.workersExplicit ? "" : " (default; no plan is recorded)")], ["Vendor plan", (plan.uw || DASH) + (plan.uwExplicit ? "" : " (not recorded; the working line is advisory)")]]),
      h("details", { class: "lt-details" }, h("summary", null, "Every line, with the page it was read from"),
        table("Plan lines", ["Line", "Unit", "Cap", "Per", "Plan", "How it is known", "Source", "Cap from"], rows, true)));
  }

  function bar(name, used, cap, o) {
    const p = pct(used, cap);
    const known = num(used) !== null;
    return h("div", { class: "st-gr" },
      h("div", { class: "st-gr-h" }, h("span", { class: "st-gr-n" }, name),
        h("span", { class: "st-gr-v" }, known ? h("b", null, o.format(used)) : DASH, cap === null || cap === undefined ? " of " + DASH : " of " + o.format(cap), " ", o.unit, known ? " · " + pctText(p) : "")),
      known ? gauge(used, cap, o.marks) : h("p", { class: "lt-none st-why1" }, DASH + " " + o.unread));
  }

  function mixOf(meta) {
    const v = meta && meta.vendor;
    return v && Array.isArray(v.mix) && v.mix.length ? v.mix.filter((m) => m && typeof m.op === "string" && num(m.n) !== null) : null;
  }

  function mixLine(meta) {
    if (!meta || !meta.generatedAt) return "Nightly call mix: " + DASH + " the nightly record was not read";
    const mix = mixOf(meta);
    if (!mix) return "Nightly call mix: " + DASH + " the last run recorded none (" + (meta.vendor ? "its record predates the mix" : "it made no vendor call") + ")";
    return "Nightly call mix: " + mix.slice(0, 3).map((m) => m.op + " " + whole(m.n)).join(" · ") + " of " + whole(meta.vendor.n) + " attempts";
  }

  function paintMix(now) {
    const host = $("stMix");
    const meta = okBody("meta");
    if (!meta) { unread(host, "The nightly record", whyOf("meta")); return; }
    const mix = mixOf(meta);
    if (!mix) { unread(host, "The call mix", meta.generatedAt ? "the last run recorded none: " + (meta.vendor ? "its record predates the mix" : "it made no vendor call") : "no run has been published yet"); return; }
    const total = num(meta.vendor.n);
    fill(host,
      table("Nightly calls by operation", ["Operation", "Attempts", "Share", "Not 2xx"], mix.map((m) => [m.op, whole(m.n), total ? pctText(m.n / total) : DASH, whole(m.bad)]), true),
      h("p", { class: "st-foot" }, "The eight most-called registered operations of the run that landed " + trt(meta.generatedAt, now) + ", counted per attempt including retries; the rest are not listed."));
  }

  function sumVendor(now) {
    const host = $("cVendor");
    const ops = okBody("ops");
    if (!ops) { unread(host, "The ops view", state().D.ops ? state().D.ops.reason : "no read yet"); return; }
    const lines = ops.lines || {};
    const reading = vendorReading(now);
    const uw = lines["uw.day"];
    const rail = okBody("rail");
    const calls = rail && rail.calls ? rail.calls : null;
    const own = ops.vendor ? ops.vendor.own : null;
    const rows = own ? [["Tier 1", own.tier1], ["Focus", own.focus], ["Tier 2", own.tier2]].map(([k, v]) => [k, num(v) === null ? DASH : whole(v)]) : [];
    fill(host,
      bar("Whole key today", reading && reading.today ? reading.daily : null, uw ? uw.cap : null, {
        format: whole, unit: "calls",
        unread: reading ? "last counter read " + trt(reading.at, now) + ", before today" : "no Tier 1 or focus tick has recorded the vendor's counter yet",
      }),
      bar("Rail, this minute", calls ? calls.minuteTotal : null, calls ? calls.perMinute : null, { format: whole, unit: "calls", unread: "the rail was not read: " + whyOf("rail") }),
      rows.length ? mini("Own engines today", ["Engine", "Calls counted"], rows, "engine counts") : line(DASH + " no ledger day, so the engines' own counts are not read"),
      line(mixLine(okBody("meta"))),
      line("Cap: " + lineText(uw)));
  }

  function sumAi() {
    const host = $("cAi");
    const cap = capOf();
    const aiBody = okBody("ai");
    const ops = okBody("ops");
    const spend = aiBody && aiBody.spend ? aiBody.spend : ops && ops.ai ? ops.ai.spend : null;
    if (!spend) { unread(host, "The model day", state().D.ai && !state().D.ai.ok ? state().D.ai.reason : "no read yet"); return; }
    const neurons = num(spend.neurons) !== null ? spend.neurons : null;
    const over = neurons === null ? null : Math.max(0, neurons - (cap ? cap.allowanceNeurons : 10000));
    const block = okBody("opsAi") && okBody("opsAi").ai ? okBody("opsAi").ai.block : null;
    const surf = block && block.surfaces ? Object.values(block.surfaces) : [];
    const calls = surf.reduce((a, v) => a + (num(v.calls) || 0), 0);
    const bad = surf.reduce((a, v) => a + (num(v.calls) || 0) * (num(v.refusalRate) || 0), 0);
    fill(host,
      bar("Neurons today", neurons, cap ? cap.neurons : null, {
        format: whole, unit: "neurons", unread: "a model on the day has no configured rate, so the total is not worked",
        marks: cap ? [{ at: cap.allowanceNeurons, label: "free allowance " + whole(cap.allowanceNeurons) }, { at: cap.readsStopAt, label: "readings stop at " + whole(cap.readsStopAt) }] : [],
      }),
      bar("Calls today", spend.calls, cap ? cap.calls : null, { format: whole, unit: "calls", unread: "the model day was not read" }),
      line("Beyond the free allowance: " + (over === null ? DASH : whole(over) + " neurons, about " + usd((over / 1000) * FREE_NEURONS_USD_PER_1000)) +
        (cap ? " · readings stop at " + whole(cap.readsStopAt) : "") + " · model day " + String(spend.day || DASH)),
      line(block ? "Wording refusals today: " + (calls ? whole(Math.round(bad)) + " of " + whole(calls) + " calls" : "no call recorded") : "Refusals: " + DASH + " the outcome block was not read"));
  }

  function sumPlatform(now) {
    const host = $("cPlat");
    const ops = okBody("ops");
    if (!ops) { unread(host, "The ops view", state().D.ops ? state().D.ops.reason : "no read yet"); return; }
    const lines = ops.lines || {};
    const cell = (id) => (lines[id] && lines[id].cap !== null ? whole(lines[id].cap) + " per " + lines[id].per : DASH + " no cap listed");
    const names = [["d1.read", "D1 rows read"], ["d1.write", "D1 rows written"], ["do.req", "Durable Object requests"], ["cf.req", "Workers requests"]];
    const day = ops.ledger && Array.isArray(ops.ledger.days) && ops.ledger.days.length ? ops.ledger.days[0] : null;
    const rows = names.map(([id, n]) => [n, cell(id), DASH]);
    fill(host,
      mini("Platform meters", ["Meter", "Allowance", "Used"], rows, "meters"),
      line(DASH + " Used: Cloudflare reports none to the Worker (read-back is P2-04); the fuse is the 503 store_quota answer."),
      day ? line(day.day + ": Tier 1 " + whole(day.tier1.ok) + " ok, " + whole(day.tier1.fail) + " failed · focus " + whole(day.focus.ok) + " · Tier 2 " + whole(day.tier2.passes) + " passes")
        : line("Cron ticks: " + DASH + " no ledger day yet"));
  }

  function sumLimits() {
    const host = $("cLimits");
    const ops = okBody("ops");
    if (!ops || !Array.isArray(ops.limits)) { unread(host, "The enforced limits", ops ? "the answer carried none" : (state().D.ops ? state().D.ops.reason : "no read yet")); return; }
    const per = (x) => (x === null ? "" : x === 60 ? " / min" : x === 86400 ? " / day" : " / " + x + " s");
    fill(host,
      mini("Limits enforced", ["Limit", "Value", "Scope"], ops.limits.map((l) => [l.name, l.limit === null ? DASH + " platform" : whole(l.limit) + per(l.periodS), l.scope]), "limits"),
      line("No daily vendor line or D1 line sheds work yet (P1-30, F-25); the 80 to 85% band on the meters is a target."));
  }

  function capacity(now) {
    paintAi(state().D.ai, now);
    sumVendor(now);
    sumAi();
    sumPlatform(now);
    sumLimits();
    paintMeters(now);
    paintConsumers(now);
    paintMix(now);
    paintLimits();
    paintOutcomes();
    paintPlan();
    for (const [id, key] of [["cVendor", "ops"], ["cAi", "ai"], ["cPlat", "ops"], ["cLimits", "ops"], ["stMeters", "ops"], ["stConsumers", "ops"], ["stMix", "meta"], ["stLimits", "ops"], ["stOutcomes", "opsAi"], ["stPlan", "ops"], ["stAi", "ai"]]) {
      const el = $(id + "Asof");
      const r = state().D[key];
      if (el) el.textContent = r && r.finished ? "read " + clockSec(r.finished) : "";
    }
  }

  kit.attach({ capacity });
})();
