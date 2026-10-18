(() => {
  "use strict";

  const UI = window.FlowsUI;
  const root = document.getElementById("stMain");
  if (!UI || !root) return;
  const { h } = UI;
  const DASH = UI.DASH;
  const $ = (id) => document.getElementById(id);
  const host = {
    meta: $("stMeta"), ready: $("stReady"), note: $("stNote"), again: $("stAgain"), tabs: $("stTabs"), sub: $("stSub"),
    rail: $("stRail"), night: $("stNight"), ai: $("stAi"), eng: $("stEng"), sw: $("stSw"),
  };
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const TRT_MS = 3 * 36e5;
  const pad = (k) => (k < 10 ? "0" : "") + k;
  const VIEWS = ["health", "capacity", "latency", "coverage"];
  const VIEW_LABELS = { health: "Health", capacity: "Capacity", latency: "Latency", coverage: "Coverage" };
  const MAX_BACKOFF_MS = 300e3;

  const num = (v) => {
    if (v === null || v === undefined || (typeof v === "string" && !v.trim())) return null;
    const x = typeof v === "number" ? v : Number(v);
    return Number.isFinite(x) ? x : null;
  };
  const whole = (v) => (num(v) === null ? DASH : Math.round(num(v)).toLocaleString("en-US"));
  const clock = (ms) => {
    const t = new Date(ms + TRT_MS);
    return pad(t.getUTCHours()) + ":" + pad(t.getUTCMinutes()) + " TRT";
  };
  const clockSec = (ms) => {
    const t = new Date(ms + TRT_MS);
    return pad(t.getUTCHours()) + ":" + pad(t.getUTCMinutes()) + ":" + pad(t.getUTCSeconds()) + " TRT";
  };
  const sameDay = (a, b) => a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();
  const trt = (value, now, withSeconds) => {
    const ms = typeof value === "number" ? value : Date.parse(value);
    if (!Number.isFinite(ms)) return DASH;
    const t = new Date(ms + TRT_MS), n = new Date(now + TRT_MS);
    return (sameDay(t, n) ? "" : t.getUTCDate() + " " + MONTHS[t.getUTCMonth()] + ", ") + (withSeconds ? clockSec(ms) : clock(ms));
  };
  const span = (ms) => {
    const x = num(ms);
    if (x === null) return DASH;
    if (x < 1000) return Math.round(x) + " ms";
    if (x < 6e4) return (x / 1000).toFixed(1) + " s";
    if (x < 36e5) return Math.round(x / 6e4) + " min";
    return (x / 36e5).toFixed(1) + " h";
  };
  const ago = (ms, now) => (Number.isFinite(ms) ? span(Math.max(0, now - ms)) + " ago" : DASH);
  const share = (a, b) => (num(a) === null || !(num(b) > 0) ? DASH : Math.round((100 * num(a)) / num(b)) + "%");
  const bytes = (n) => {
    const x = num(n);
    if (x === null) return DASH;
    if (x < 1024) return Math.round(x) + " B";
    if (x < 1048576) return (x / 1024).toFixed(1) + " KiB";
    return (x / 1048576).toFixed(1) + " MiB";
  };
  const usd = (v) => (num(v) === null ? DASH : "$" + (num(v) < 1 ? num(v).toFixed(3) : num(v).toFixed(2)));
  const median = (list) => {
    const xs = list.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
    if (!xs.length) return null;
    const m = xs.length >> 1;
    return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
  };

  const chip = (state, word) => h("span", { class: "ds-st", "data-s": state }, h("i", { "aria-hidden": "true" }), word || state);
  const stateChip = (state) => {
    const s = typeof state === "string" ? state : "";
    if (s === "live" || s === "fresh" || s === "stale" || s === "closed" || s === "pending") return chip(s);
    return chip("pending", "not read");
  };

  const table = (label, heads, rows, left) => {
    const body = h("tbody");
    for (const r of rows) {
      body.appendChild(h("tr", null, ...r.map((c, i) => (i === 0 ? h("th", { scope: "row" }, c) : h("td", null, c)))));
    }
    return h("div", { class: "ui-tbl-w st-tbl" + (left ? " st-left" : ""), tabindex: "0", role: "region", "aria-label": label },
      h("table", { class: "ui-tbl-t" }, h("thead", null, h("tr", null, ...heads.map((t, i) => h("th", { scope: "col", class: i ? "" : "st-l" }, t)))), body));
  };
  const facts = (pairs) => h("dl", { class: "st-kv" }, ...pairs.flatMap(([k, v]) => [h("dt", null, k), h("dd", null, v)]));
  const why = (items) => (items.length ? h("ul", { class: "st-why" }, ...items.map((t) => h("li", null, t))) : null);
  const fill = (el, ...kids) => { if (el) el.replaceChildren(...kids.filter(Boolean)); };
  const unread = (el, what, reason) => {
    fill(el, h("p", { class: "st-miss" }, DASH + " " + what + " was not read: " + reason + ". Nothing is claimed about it."));
    return false;
  };

  const READS = {
    rail: { path: "/api/rt/status", every: { health: 30e3, capacity: 30e3, latency: 10e3, coverage: 30e3 } },
    ops: { path: "/api/flows/ops", every: { health: 60e3, capacity: 60e3, latency: 60e3, coverage: 60e3 } },
    opsAi: { path: "/api/flows/ops?part=ai", once: true, every: { capacity: 1, latency: 1 } },
    cover: { path: "/api/flows/ops?part=coverage", every: { coverage: 300e3 } },
    hb: { path: "/api/flows/lk?k=heartbeat", every: { health: 60e3, latency: 60e3 } },
    series: { path: "/api/flows/lk?k=strips:series", every: { latency: 300e3 } },
    meta: { path: "/api/flows/meta", every: { health: 300e3, capacity: 300e3, latency: 300e3, coverage: 300e3 } },
    ready: { path: "/api/flows/ready", every: { health: 300e3, capacity: 300e3, latency: 300e3, coverage: 300e3 } },
    ai: { path: "/api/flows/ai-usage", every: { health: 300e3, capacity: 300e3 } },
  };
  const readsFor = (view) => Object.keys(READS).filter((k) => READS[k].every[view] !== undefined);

  const S = { tab: "health", card: {}, D: {}, nextAt: {}, fails: {}, busy: {}, lastRound: null, trips: [], offsets: [], timer: null, loaded: false };

  const read = async (path) => {
    const t0 = performance.now();
    try {
      const res = await fetch(path, { credentials: "same-origin", headers: { Accept: "application/json" } });
      let body = null;
      try { body = await res.json(); } catch { body = null; }
      const took = performance.now() - t0;
      const serverNow = num(res.headers.get("X-Server-Now"));
      const finished = Date.now();
      if (res.ok) return { ok: true, body, took, serverNow, finished };
      const code = body && body.error && body.error.code ? body.error.code : "http_" + res.status;
      return { ok: false, reason: "HTTP " + res.status + " " + code, took, serverNow, finished };
    } catch {
      return { ok: false, reason: "the request did not complete", took: null, serverNow: null, finished: Date.now() };
    }
  };

  const EVENT = { fl: true, nw: true };
  const lagOf = (k, t) => {
    const series = EVENT[k] ? t && t.itemLagMs : t && t.lagMs;
    return series && typeof series === "object" ? series : null;
  };
  const BASIS = {
    px: "frame against the vendor's stamp", gx: "frame against the vendor's stamp", mk: "frame against the vendor's stamp",
    fl: "behind the item's own time", nw: "behind the item's own time",
  };
  const TOPIC_NAME = { px: "Prices", fl: "Flagged alerts", gx: "Dealer gamma", mk: "Market tide", nw: "News" };

  function lagReason(rail, k) {
    if (!rail || !rail.ok) return "the rail was not read: " + (rail ? rail.reason : "no read yet");
    const s = rail.body || {};
    const t = s.topics && s.topics[k];
    if (!s.running) return "rail idle: no one is watching, so nothing is polled";
    if (!t) return "the rail does not report " + k;
    if (!t.demanded) return k + " is not demanded, so it is not polled";
    return "no sample yet in this epoch";
  }

  function paintRail(r, now) {
    if (!r || !r.ok) return unread(host.rail, "The real-time rail", r ? r.reason : "no read yet");
    const s = r.body || {};
    const sockets = s.sockets || {};
    const calls = s.calls || {};
    const sw = s.killSwitches || {};
    const gaps = [];
    const deg = s.degraded;
    const up = s.upstream || {};
    const vendor = up.vendor && typeof up.vendor === "object" ? up.vendor : null;
    const sock = up.socket && typeof up.socket === "object" ? up.socket : null;
    const topics = s.topics && typeof s.topics === "object" ? s.topics : {};
    const rows = Object.keys(topics).map((k) => {
      const t = topics[k] || {};
      const lag = lagOf(k, t) || {};
      const c = t.calls || {};
      const age = num(t.lastFrameAgeMs);
      if (age === null) gaps.push(k + ": no frame yet in this epoch");
      if (!t.demanded) gaps.push(k + ": not demanded, so not polled");
      const via = (up.topics && up.topics[k] && up.topics[k].via) || (sock ? null : up.kind) || null;
      return [k, via ? String(via) : DASH, t.demanded ? "yes" : "no", age === null ? DASH : span(age) + " ago", span(lag.p50), span(lag.p95),
        whole(lag.n), BASIS[k] || DASH, whole(c.minute), whole(c.hour), whole(t.fails), t.fresh && t.fresh.state ? String(t.fresh.state) : DASH];
    });
    fill(host.rail,
      facts([
        ["Rail", s.running ? "running" : "idle, no viewer"],
        ["Mode", sw.FLOWS_RT_MODE ? String(sw.FLOWS_RT_MODE) : DASH],
        ["Audience", sw.FLOWS_RT_AUDIENCE ? String(sw.FLOWS_RT_AUDIENCE) : DASH],
        ["Upstream", up.kind ? String(up.kind) + (sock ? (sock.connected ? ", socket connected" : sock.connecting ? ", socket connecting" : ", socket not connected") : "") : DASH],
        ["Vendor key counter", vendor && num(vendor.daily) !== null ? whole(vendor.daily) + " calls today, read " + trt(vendor.at, now, true) : DASH + " the rail has made no vendor call with a counter header in this isolate"],
        ["Phase", s.phase ? s.phase.phase + (s.phase.trading ? ", trading day" : ", not a trading day") : DASH],
        ["Started", s.startedAt ? trt(s.startedAt, now) : DASH],
        ["Sockets", whole(sockets.n) + " of " + whole(sockets.max) + " (" + whole(sockets.userCap) + " a member)"],
        ["Vendor calls, this minute", whole(calls.minuteTotal) + " of " + whole(calls.perMinute) + " a minute"],
        ["Degraded", deg ? "since " + trt(deg.since, now) + ", " + String(deg.reason) + ", " + (deg.k || []).join(" ") : "no"],
      ]),
      table("Rail topics", ["Topic", "Via", "Demanded", "Last frame", "Lag p50", "Lag p95", "Samples", "Measured as", "Calls, minute", "Calls, hour", "Failures", "Freshness"], rows),
      why(gaps));
    return true;
  }

  function paintNight(r, now) {
    if (!r || !r.ok) return unread(host.night, "The nightly record", r ? r.reason : "no read yet");
    const m = r.body || {};
    if (!m.generatedAt) return unread(host.night, "The nightly record", "no run has been published yet");
    const hl = m.health || null;
    const stages = Array.isArray(m.stages) ? m.stages : [];
    const gaps = [];
    if (!hl) gaps.push("health: this run's record carries no health line");
    if (!stages.length) gaps.push("stages: this run's record carries no stage ledger");
    const rows = stages.map((st) => [String(st.id), String(st.status), span(st.ms), whole(st.calls), whole(st.keys), st.why ? String(st.why) : DASH]);
    fill(host.night,
      facts([
        ["Written", trt(m.generatedAt, now) + " (" + ago(Date.parse(m.generatedAt), now) + ")"],
        ["Session", m.sessionDate ? String(m.sessionDate) : DASH],
        ["Universe", whole(m.universe) + " names"],
        ["Cards", whole(m.cardsBuilt) + " built, " + whole(m.cardsFailed) + " failed, " + whole(m.cardsSkipped) + " skipped"],
        ["Vendor calls", whole(m.apiCalls)],
        ["Health", hl ? whole(hl.failures) + " failures, " + whole(hl.warnings) + " warnings" : DASH],
      ]),
      hl && Array.isArray(hl.first) && hl.first.length ? h("ul", { class: "st-lines" }, ...hl.first.map((t) => h("li", null, String(t)))) : null,
      stages.length ? table("Nightly stages", ["Stage", "Status", "Time", "Calls", "Keys", "Why"], rows) : null,
      why(gaps));
    return true;
  }

  const capOf = () => {
    const a = S.D.ai;
    if (a && a.ok && a.body && a.body.cap) return a.body.cap;
    const o = S.D.ops;
    if (o && o.ok && o.body && o.body.ai && o.body.ai.cap) return o.body.ai.cap;
    return null;
  };

  function paintAi(r, now) {
    if (!r || !r.ok) return unread(host.ai, "The model spend", r ? r.reason : "no read yet");
    const s = r.body && r.body.spend;
    if (!s) return unread(host.ai, "The model spend", "the store could not be read");
    const cap = r.body.cap || capOf();
    const gaps = [];
    if (num(s.neurons) === null) gaps.push("neurons: a model on the day has no configured rate, so the total is not worked");
    if (!cap) gaps.push("cap: this read carried no site cap, so spend is not measured against one");
    for (const m of Array.isArray(s.byModel) ? s.byModel : []) {
      if (num(m.neurons) === null) gaps.push(String(m.model) + ": no configured rate, so its neurons are not worked");
    }
    const rows = (Array.isArray(s.byModel) ? s.byModel : []).map((m) => [String(m.model), whole(m.calls), whole(m.tokensIn), whole(m.tokensOut),
      num(m.neurons) === null ? DASH : whole(m.neurons)]);
    const over = num(s.neurons) === null ? null : Math.max(0, num(s.neurons) - (num(s.allowanceNeurons) ?? 10000));
    fill(host.ai,
      facts([
        ["Model day", String(s.day || DASH) + ", turns over at 03:00 TRT"],
        ["Calls", cap ? whole(s.calls) + " of " + whole(cap.calls) + " (site cap)" : whole(s.calls)],
        ["Tokens in and out", whole(s.tokensIn) + " in, " + whole(s.tokensOut) + " out"],
        ["Neurons", num(s.neurons) === null ? DASH : cap ? whole(s.neurons) + " of " + whole(cap.neurons) + " (site cap)" : whole(s.neurons)],
        ["Until the cap", num(s.neurons) === null || !cap ? DASH : whole(Math.max(0, cap.neurons - s.neurons)) + " neurons"],
        ["Readings stop at", cap ? whole(cap.readsStopAt) + " neurons (" + Math.round(cap.readShare * 100) + "% of the cap)" : DASH],
        ["Free allowance", whole(s.allowanceNeurons) + " neurons a day; beyond it Workers AI bills"],
        ["Beyond the allowance", over === null ? DASH : whole(over) + " neurons, about " + usd((over / 1000) * 0.011) + " at $0.011 per 1,000"],
      ]),
      rows.length ? table("Spend by model", ["Model", "Calls", "Tokens in", "Tokens out", "Neurons"], rows) : null,
      why(gaps));
    return true;
  }

  function paintReady(r) {
    if (!host.ready) return true;
    const why = $("stWhy");
    if (!r || !r.ok || !r.body || typeof r.body !== "object") {
      host.ready.textContent = "Readiness: " + DASH + " (" + (r && r.reason ? r.reason : "not read") + ").";
      if (why) why.hidden = true;
      return false;
    }
    const b = r.body;
    const opens = b.opens && Number.isFinite(b.opens.ms) ? b.opens.ms : null;
    const list = Array.isArray(b.blockers) ? b.blockers : [];
    const head = b.ok ? "Ready" : list.length + (list.length === 1 ? " blocker" : " blockers");
    const tail = opens === null ? "" : b.phase === "rth" ? ". US session open" : ". US open " + trt(opens, Date.now()) +
      (num(b.minutesToOpen) === null ? "" : ", in " + whole(b.minutesToOpen) + " min");
    host.ready.replaceChildren(h("strong", null, "Readiness: "), document.createTextNode(head + tail + "."));
    if (why) why.hidden = !list.length;
    const body = $("stReadyBody");
    if (body) body.replaceChildren(h("ul", { class: "st-why" }, ...list.map((x) => h("li", null, String(x && x.sentence || x && x.code || DASH)))));
    return true;
  }

  const okBody = (key) => (S.D[key] && S.D[key].ok ? S.D[key].body : null);
  const whyOf = (key) => (S.D[key] ? S.D[key].reason || "not read" : "no read yet");

  function tileSet(id, state, figure, sub) {
    const el = $(id);
    if (!el) return;
    const label = el.querySelector(".st-tile-l");
    el.replaceChildren(label, h("span", { class: "st-tile-v" }, chip(state[0], state[1]), h("b", null, figure)), h("span", { class: "st-tile-s", title: sub }, sub));
  }

  function lagTile(id, k, now) {
    const rail = S.D.rail;
    const body = rail && rail.ok ? rail.body : null;
    const t = body && body.topics ? body.topics[k] : null;
    const lag = t ? lagOf(k, t) : null;
    if (!lag || num(lag.p50) === null) {
      tileSet(id, ["pending", "not read"], DASH, lagReason(rail, k));
      return;
    }
    const via = body.upstream && body.upstream.topics && body.upstream.topics[k] ? body.upstream.topics[k].via : null;
    tileSet(id, [t.fresh && t.fresh.state ? t.fresh.state : "pending", t.fresh && t.fresh.state ? null : "not read"],
      span(lag.p50), "p50 " + (EVENT[k] ? "behind the item's own time" : "behind the vendor's stamp") + (via ? ", via " + via : "") + ", " + whole(lag.n) + " samples");
  }

  const sumKnown = (list) => (list.every((x) => num(x) !== null) ? list.reduce((a, b) => a + num(b), 0) : null);
  const vendorReading = (now) => {
    const o = okBody("ops");
    const r = o && o.vendor && o.vendor.reading ? o.vendor.reading : null;
    if (r && num(r.daily) !== null && num(r.at) !== null) return { ...r, today: sameDay(new Date(r.at), new Date(now)) };
    return null;
  };

  function paintTiles(now) {
    lagTile("stTilePx", "px", now);
    lagTile("stTileFl", "fl", now);
    const reading = vendorReading(now);
    const ops = okBody("ops");
    const own = ops && ops.vendor ? ops.vendor.own : null;
    if (reading && reading.today) {
      tileSet("stTileUw", ["fresh", "counted"], whole(reading.daily),
        "calls on the vendor key today, every caller included, read " + trt(reading.at, now, true) + "; the vendor's day is assumed to turn at 03:00 TRT");
    } else {
      const ownSum = own ? sumKnown([own.tier1, own.focus, own.tier2]) : null;
      const reason = !S.D.ops ? "no read yet" : !S.D.ops.ok ? "the ops view was not read: " + S.D.ops.reason
        : reading ? "the last vendor counter was read " + trt(reading.at, now) + ", before today"
          : "no Tier 1 or focus tick has recorded the vendor's counter header yet";
      tileSet("stTileUw", ["pending", "not read"], ownSum === null ? DASH : "own " + whole(ownSum),
        "vendor count not read: " + reason + (ownSum === null ? "" : "; own count is Tier 1, focus and Tier 2 only"));
    }
    const cap = capOf();
    const a = S.D.ai && S.D.ai.ok && S.D.ai.body ? S.D.ai.body.spend : null;
    const spend = a || (ops && ops.ai ? ops.ai.spend : null);
    if (!spend || num(spend.neurons) === null || !cap) {
      tileSet("stTileAi", ["pending", "not read"], DASH, !spend ? "the model day was not read: " + (S.D.ai && !S.D.ai.ok ? S.D.ai.reason : "no read yet")
        : num(spend.neurons) === null ? "a model on the day has no configured rate, so the total is not worked" : "no site cap was sent");
    } else {
      const state = spend.neurons >= cap.neurons ? ["unavailable", "capped"] : spend.neurons >= cap.readsStopAt ? ["stale", "readings stopped"] : ["live", "within the cap"];
      tileSet("stTileAi", state, whole(spend.neurons) + " of " + whole(cap.neurons),
        "neurons, the site cap; calls " + whole(spend.calls) + " of " + whole(cap.calls) + "; free allowance " + whole(spend.allowanceNeurons));
    }
  }

  const DISPATCH = (why, now) => {
    if (typeof why !== "string" || !why) return [chip("pending", "none recorded"), "no dispatch to GitHub has been recorded"];
    if (why === "sent") return [chip("live", "accepted"), "GitHub accepted the last dispatch"];
    if (why.startsWith("refused")) return [chip("unavailable", "refused"), "GitHub refused the Worker's dispatch (" + why + "), an owner action"];
    if (why === "no-token") return [chip("unavailable", "no token"), "no dispatch token is set, an owner action"];
    return [chip("stale", why), "the last dispatch outcome was " + why];
  };

  function engineData(full, now) {
    const cards = [];
    const card = (name, state, lines) => ({ name, state, lines });
    const meta = okBody("meta");
    const nightlyLines = [];
    let nightlyState = chip("pending", "not read");
    if (!meta) nightlyLines.push(DASH + " the nightly record was not read: " + whyOf("meta"));
    else if (!meta.generatedAt) nightlyLines.push(DASH + " no run has been published yet");
    else {
      const stages = Array.isArray(meta.stages) ? meta.stages : [];
      const ms = sumKnown(stages.map((x) => x.ms));
      const cpu = stages.length && stages.every((x) => num(x.cpu) !== null) ? stages.reduce((a, x) => a + x.cpu, 0) : null;
      nightlyState = meta.health && num(meta.health.failures) > 0 ? chip("stale", "failures") : chip("live", "landed");
      nightlyLines.push("Landed " + trt(meta.generatedAt, now) + ", " + ago(Date.parse(meta.generatedAt), now));
      nightlyLines.push("Run time " + (stages.length ? span(ms) : DASH + " (no stage ledger)") + (stages.length ? ", CPU " + (cpu === null ? DASH + " (not recorded)" : span(cpu)) : ""));
      nightlyLines.push("Vendor calls " + whole(meta.apiCalls));
      if (full && meta.callStats && typeof meta.callStats === "object") {
        const cs = meta.callStats;
        nightlyLines.push("Retries " + whole(cs.retries) + ", rate limited " + whole(cs.rateLimited) + ", failed " + whole(cs.failures) + ", timed out " + whole(cs.timedOut));
      } else if (full) nightlyLines.push("Call statistics: " + DASH + " this run's record carries none");
    }
    cards.push(card("Nightly", nightlyState, nightlyLines));

    const ops = okBody("ops");
    const day = ops && ops.ledger && Array.isArray(ops.ledger.days) && ops.ledger.days.length ? ops.ledger.days[0] : null;
    const noOps = DASH + " the ops view was not read: " + whyOf("ops");
    if (!ops) {
      cards.push(card("Tier 1", chip("pending", "not read"), [noOps]), card("Focus", chip("pending", "not read"), [noOps]));
    } else {
      const t1 = ops.clock && ops.clock.tier1 ? ops.clock.tier1 : null;
      const why = t1 && t1.why ? String(t1.why) : null;
      const st = !t1 ? chip("pending", "no clock row") : why === "written" ? chip("live", "writing") : why && why.startsWith("error") ? chip("unavailable", "failed")
        : why === "holiday" || why === "off" ? chip("closed", why) : chip("stale", why || "not due");
      const lines = [];
      lines.push(t1 && t1.at ? "Last tick " + trt(t1.at, now) + ", " + ago(Date.parse(t1.at), now) : "Last tick: " + DASH + " none recorded");
      lines.push(t1 && t1.okAt ? "Last write " + trt(t1.okAt, now) : "Last write: " + DASH + " none recorded");
      lines.push("Last verdict " + (why || DASH));
      if (day) {
        lines.push(day.day + ": " + whole(day.tier1.ok) + " writes, " + whole(day.tier1.fail) + " failed, longest gap between writes " + span(day.tier1.okGapMs));
        if (full) lines.push("Vendor calls counted " + (day.tier1.calls === null ? DASH + " (column not yet written)" : whole(day.tier1.calls)));
      } else lines.push("Ledger: " + DASH + " no day recorded yet");
      cards.push(card("Tier 1", st, lines));
      const fo = day ? day.focus : null;
      const fl = [];
      if (fo) {
        fl.push(day.day + ": " + whole(fo.ok) + " written, " + whole(fo.partial) + " partial, " + whole(fo.fail) + " failed");
        fl.push(fo.okAt ? "Last write " + trt(fo.okAt, now) : "Last write: " + DASH + " none today");
        fl.push("Longest gap " + span(fo.gapMs));
        if (full) fl.push("Vendor calls counted " + (fo.calls === null ? DASH + " (column not yet written)" : whole(fo.calls)));
      } else fl.push("Ledger: " + DASH + " no day recorded yet");
      cards.push(card("Focus", !fo ? chip("pending", "no day") : fo.fail > 0 && fo.ok === 0 ? chip("unavailable", "failed") : fo.ok > 0 ? chip("live", "writing") : chip("pending", "none yet"), fl));
    }
    const hb = okBody("hb");
    const run = hb && hb.run ? hb.run : null;
    const t2 = [];
    let t2State = chip("pending", "not read");
    if (!hb) t2.push(DASH + " the Tier 2 heartbeat was not read: " + whyOf("hb"));
    else if (!run) t2.push(DASH + " the heartbeat carries no pass yet");
    else {
      const lag = run.quoteLag && typeof run.quoteLag === "object" ? run.quoteLag : null;
      t2State = num(run.failedCalls) > 0 && num(run.calls) === num(run.failedCalls) ? chip("unavailable", "failed") : chip("live", "passing");
      t2.push("Last pass finished " + trt(run.finishedAt, now) + ", " + ago(Date.parse(run.finishedAt), now));
      t2.push("Took " + span(run.durationMs) + ", " + whole(run.calls) + " calls, " + whole(run.failedCalls) + " failed");
      t2.push(lag ? "Quote age p50 " + span(lag.p50 * 1000) + ", p90 " + span(lag.p90 * 1000) + ", largest " + span(lag.max * 1000) : "Quote age: " + DASH + " the pass measured none");
    }
    if (day && day.tier2) {
      t2.push(day.day + ": " + whole(day.tier2.passes) + " passes, longest gap " + span(day.tier2.gapMs) + (full ? ", " + whole(day.tier2.calls) + " calls counted" : ""));
    }
    cards.push(card("Tier 2", t2State, t2));
    if (ops) {
      const stale = day ? day.stale : null;
      cards.push(card("Worst stale key today", stale && stale.key ? chip("stale", "late") : chip("live", "none"),
        stale && stale.key ? [stale.key + " ran " + span(stale.overS * 1000) + " past its stale line", whole(stale.ticks) + " ticks saw a lapse"] : ["No stored feed ran past its stale line on a Tier 1 tick today"]));
      const [dc, dl] = DISPATCH(ops.clock ? ops.clock.dispatchWhy : null, now);
      cards.push(card("GitHub dispatch", dc, [dl]));
    }
    if (full) {
      const block = okBody("opsAi") && okBody("opsAi").ai ? okBody("opsAi").ai.block : null;
      if (!block) cards.push(card("Model calls", chip("pending", "not read"), [DASH + " the outcome block was not read: " + (S.D.opsAi ? S.D.opsAi.reason || "no block in the answer" : "no read yet")]));
      else {
        const lines = Object.entries(block.surfaces || {}).map(([k, v]) => k + ": mean " + span(v.msAvg) + ", longest " + span(v.msMax) + ", " + whole(v.calls) + " calls");
        cards.push(card("Model calls", lines.length ? chip("live", "recorded") : chip("quiet", "no calls"), lines.length ? lines : ["No model call has been recorded today"]));
      }
    }
    return cards;
  }

  const engineCards = (full, now) => engineData(full, now).map((c) => h("div", { class: "st-eng" }, h("div", { class: "st-eng-h" }, h("span", { class: "st-eng-n" }, c.name), c.state),
    h("ul", { class: "st-eng-l" }, ...c.lines.map((t) => h("li", null, t)))));

  const SWITCH_EFFECT = {
    FLOWS_RT_MODE: "on runs the real-time rail; anything else is off and its routes answer 404",
    FLOWS_RT_AUDIENCE: "members lets every signed-in member open the rail; anything else is owner only",
    FLOWS_RT_UPSTREAM: "socket joins the vendor's socket for prices and alerts; anything else polls REST",
    FLOWS_RT_SOCKET_HOURS: "session keeps the socket open from pre-market to after-hours; anything else holds it to regular hours",
    FLOWS_READ_MODE: "off makes every per-name reading the deterministic one, with no model call",
    FLOWS_LIVE_MODE: "off stops the Tier 1 and focus ticks; any other value runs them",
    FLOWS_PREMARKET_NEWS: "on runs the pre-market news pass, one vendor call every half hour before the open",
    FLOWS_READY: "on serves the readiness route; anything else is a 404",
    FLOWS_HEALTH: "on serves the public health route; anything else is a 404",
    FLOWS_SCENES: "on shows the skyline and relations scenes to members; owner shows them to owners only",
    FLOWS_MOVES: "on opens the Moves page to members; owner opens it to owners only; off closes it",
    FLOWS_HOME_NET: "on shows the flow network on Home to members; owner shows it to owners only",
    FLOWS_FRONT_DOOR: "off turns the About and Glossary pages into the unknown-page 404",
    FLOWS_OPS: "on serves this view's own route; anything else is a 404 and this page shows nothing from the Worker",
  };

  function paintSwitches() {
    const ops = okBody("ops");
    if (!ops || !ops.switches) return unread(host.sw, "The switch values", ops === null ? whyOf("ops") : "the answer carried none");
    const rows = Object.keys(ops.switches).map((k) => [k, ops.switches[k] === null ? "unset" : String(ops.switches[k]), SWITCH_EFFECT[k] || DASH]);
    fill(host.sw, table("Switches", ["Switch", "Value", "What it does"], rows, true),
      h("p", { class: "st-foot" }, "Read-only. These are set in wrangler.toml; a deploy overwrites values changed in the dashboard. Fail closed: a value that is not the one named is off."));
    return true;
  }

  function paintEngines() {
    const cards = engineCards(false, Date.now());
    fill(host.eng, h("div", { class: "st-engs" }, ...cards));
    return true;
  }

  const mini = (label, heads, rows, what) => {
    const body = h("tbody");
    for (const r of rows) body.appendChild(h("tr", null, ...r.map((c, i) => (i === 0 ? h("th", { scope: "row" }, c) : h("td", null, c)))));
    return h("table", { class: "st-mt", "aria-label": label, "data-what": what || null }, h("thead", null, h("tr", null, ...heads.map((t) => h("th", { scope: "col" }, t)))), body);
  };
  const rest = () => null;
  function fit(el) {
    if (!el) return;
    const t = el.querySelector("table.st-mt[data-what]");
    if (!t || !t.tBodies[0]) return;
    const rows = [...t.tBodies[0].rows];
    const what = t.getAttribute("data-what");
    const note = h("p", { class: "st-rest" });
    el.append(note);
    let n = rows.length;
    const place = () => {
      rows.forEach((r, i) => { r.hidden = i >= n; });
      t.hidden = n === 0;
      const hid = rows.length - n;
      note.textContent = hid ? "+" + hid + " more " + what + " in Details" : "";
      note.hidden = !hid;
    };
    place();
    while (el.scrollHeight > el.clientHeight + 1 && n > 0) { n--; place(); }
  }
  const fitAll = () => {
    for (const id of ["hEng", "hRail", "hNight", "hSw", "cVendor", "cAi", "cPlat", "cLimits", "lFeeds", "lStored", "lTime", "kStore", "kDeep"]) {
      const el = $(id);
      if (el && el.offsetParent !== null) fit(el);
    }
  };
  const line = (text) => h("p", { class: "st-line" }, text);

  function sumEngines(now) {
    const host = $("hEng");
    if (!okBody("meta") && !okBody("ops") && !okBody("hb")) {
      unread(host, "The engines", "the nightly record, the ops view and the heartbeat were all unavailable (" + whyOf("ops") + ")");
      return;
    }
    const data = engineData(false, now);
    fill(host, mini("Engines", ["Engine", "State", "Latest"], data.map((c) => [c.name, c.state, h("span", { class: "st-t" }, c.lines[0])]), "engines"));
  }

  function sumRail(now) {
    const host = $("hRail");
    const r = S.D.rail;
    if (!r || !r.ok) { unread(host, "The real-time rail", r ? r.reason : "no read yet"); return; }
    const s = r.body || {};
    const sockets = s.sockets || {};
    const calls = s.calls || {};
    const up = s.upstream || {};
    const topics = s.topics && typeof s.topics === "object" ? s.topics : {};
    const rows = Object.keys(topics).map((k) => {
      const lag = lagOf(k, topics[k] || {}) || {};
      return [(TOPIC_NAME[k] || k), topics[k] && topics[k].demanded ? span(lag.p50) : DASH, topics[k] && topics[k].demanded ? span(lag.p95) : DASH,
        stateChip(topics[k] && topics[k].fresh && topics[k].fresh.state)];
    });
    fill(host,
      line((s.running ? "Running" : "Idle, no viewer") + " · upstream " + (up.kind ? String(up.kind) : DASH) + " · sockets " + whole(sockets.n) + " of " + whole(sockets.max) +
        " · vendor calls " + whole(calls.minuteTotal) + " of " + whole(calls.perMinute) + " this minute"),
      s.degraded ? line("Degraded since " + trt(s.degraded.since, now) + ": " + String(s.degraded.reason)) : null,
      rows.length ? mini("Rail topics", ["Topic", "p50", "p95", "State"], rows, "topics") : line(DASH + " the rail reported no topics"),
      s.running ? null : line("An idle rail polls nothing and keeps no latency; figures return when a viewer connects."));
  }

  function sumNight(now) {
    const host = $("hNight");
    const r = S.D.meta;
    if (!r || !r.ok) { unread(host, "The nightly record", r ? r.reason : "no read yet"); return; }
    const m = r.body || {};
    if (!m.generatedAt) { unread(host, "The nightly record", "no run has been published yet"); return; }
    const hl = m.health || null;
    const stages = Array.isArray(m.stages) ? m.stages : [];
    const slow = stages.filter((x) => num(x.ms) !== null).sort((a, b) => b.ms - a.ms);
    fill(host,
      line("Written " + trt(m.generatedAt, now) + " (" + ago(Date.parse(m.generatedAt), now) + ") · session " + (m.sessionDate ? String(m.sessionDate) : DASH)),
      line(whole(m.universe) + " names · cards " + whole(m.cardsBuilt) + " built, " + whole(m.cardsFailed) + " failed, " + whole(m.cardsSkipped) + " skipped · " +
        (hl ? whole(hl.failures) + " health failures, " + whole(hl.warnings) + " warnings" : "health " + DASH + " not in this record")),
      slow.length ? mini("Slowest nightly stages", ["Slowest stages", "Time", "Status"], slow.map((x) => [String(x.id), span(x.ms), String(x.status)]), "stages") : line(DASH + " this run's record carries no stage ledger"));
  }

  function sumSwitches() {
    const host = $("hSw");
    const ops = okBody("ops");
    if (!ops || !ops.switches) { unread(host, "The switch values", ops === null ? whyOf("ops") : "the answer carried none"); return; }
    const all = Object.keys(ops.switches);
    const off = all.filter((k) => ops.switches[k] !== "on");
    fill(host,
      line(all.length - off.length + " of " + all.length + " switches are on. Read-only; set in wrangler.toml, and a value that is not the one named is off."),
      off.length ? mini("Switches not on", ["Not on", "Value"], off.map((k) => [k, ops.switches[k] === null ? "unset" : String(ops.switches[k])]), "switches") : null);
  }

  const kit = {
    h, DASH, num, whole, clock, clockSec, trt, span, ago, share, bytes, usd, median, chip, stateChip, table, facts, why, fill, unread,
    lagOf, lagReason, engineCards, engineData, paintAi, mini, rest, line, capOf, vendorReading, sameDay, okBody, whyOf, EVENT, BASIS, TOPIC_NAME, SWITCH_EFFECT, DISPATCH,
    state: () => S, panels: {},
    attach(panels) {
      Object.assign(kit.panels, panels);
      paint();
    },
  };
  window.FlowsUI = Object.freeze(Object.assign({}, window.FlowsUI, { statusKit: Object.freeze(kit) }));

  const modAsof = (id, key) => {
    const el = $(id + "Asof");
    const r = S.D[key];
    if (el) el.textContent = r && r.finished ? "read " + clockSec(r.finished) : "";
  };

  function paintHeader(now) {
    const asked = readsFor(S.tab);
    const failed = asked.filter((k) => S.D[k] && !S.D[k].ok).length;
    const next = asked.map((k) => (READS[k].once ? Infinity : S.nextAt[k])).filter((x) => Number.isFinite(x));
    const wait = next.length ? Math.max(0, Math.ceil((Math.min(...next) - now) / 1000)) : null;
    const total = asked.length;
    host.meta.textContent = (S.lastRound ? "Read at " + clockSec(S.lastRound) : "Not read yet") + (wait === null ? "" : " · next read in " + wait + " s") +
      " · the page reads " + total + " existing routes and calls no vendor and no model";
    host.note.textContent = failed ? failed + " of " + total + " sources could not be read." : "All " + total + " sources read.";
  }

  function paint() {
    const now = Date.now();
    paintReady(S.D.ready);
    paintTiles(now);
    if (S.tab === "health") {
      sumEngines(now); modAsof("hEng", "ops");
      sumRail(now); modAsof("hRail", "rail");
      sumNight(now); modAsof("hNight", "meta");
      sumSwitches(); modAsof("hSw", "ops");
      paintRail(S.D.rail, now); modAsof("stRail", "rail");
      paintNight(S.D.meta, now); modAsof("stNight", "meta");
      paintEngines(); modAsof("stEng", "ops");
      paintSwitches(); modAsof("stSw", "ops");
    } else if (kit.panels[S.tab]) {
      kit.panels[S.tab](now);
    }
    paintHeader(now);
    fitAll();
  }

  function nextDelay(key) {
    const every = READS[key].every[S.tab];
    return Math.min(MAX_BACKOFF_MS, Math.max(every, every * 2 ** Math.min(S.fails[key] || 0, 5)));
  }

  async function runReads(keys, manual) {
    if (!keys.length) {
      if (manual) host.again.disabled = false;
      return;
    }
    if (manual) host.again.disabled = true;
    await Promise.all(keys.map(async (key) => {
      if (S.busy[key]) return;
      S.busy[key] = true;
      const r = await read(READS[key].path);
      S.busy[key] = false;
      S.D[key] = r;
      S.fails[key] = r.ok ? 0 : (S.fails[key] || 0) + 1;
      const at = Date.now();
      S.nextAt[key] = at + (READS[key].every[S.tab] === undefined ? MAX_BACKOFF_MS : nextDelay(key));
      if (r.took !== null && r.took !== undefined) S.trips.push({ key, path: READS[key].path, ms: r.took, at });
      if (S.trips.length > 60) S.trips.shift();
      if (r.ok && r.serverNow !== null && Number.isFinite(r.finished) && r.took !== null) {
        S.offsets.push(r.serverNow - (r.finished - r.took / 2));
        if (S.offsets.length > 30) S.offsets.shift();
      }
      S.lastRound = at;
    }));
    paint();
    if (manual) host.again.disabled = false;
  }

  const dueKeys = (force) => {
    const now = Date.now();
    return readsFor(S.tab).filter((k) => {
      if (S.busy[k]) return false;
      if (force) return true;
      if (READS[k].once) return !S.D[k];
      return (S.nextAt[k] || 0) <= now;
    });
  };

  const tick = () => {
    const keys = dueKeys(false);
    if (keys.length) runReads(keys, false);
    else paintHeader(Date.now());
  };
  const start = () => { if (S.timer === null) S.timer = setInterval(tick, 1000); };
  const stop = () => { if (S.timer !== null) { clearInterval(S.timer); S.timer = null; } };

  const viewFromHash = () => {
    const m = /(?:^#|[&;])view=(health|capacity|usage|latency|coverage)(?:$|[&;])/.exec(window.location.hash || "");
    if (!m) return "health";
    return m[1] === "usage" ? "capacity" : m[1];
  };

  let seg = null;
  function setCard(view, idx) {
    const cards = [...document.querySelectorAll("#stPanel-" + view + " .st-card")];
    S.card[view] = idx;
    cards.forEach((c, j) => c.classList.toggle("is-on", j === idx));
    window.dispatchEvent(new Event("resize"));
  }
  function mountSub(view) {
    const cards = [...document.querySelectorAll("#stPanel-" + view + " .st-card")];
    if (!host.sub || !cards.length) return;
    const idx = Math.min(S.card[view] || 0, cards.length - 1);
    cards.forEach((c, j) => c.classList.toggle("is-on", j === idx));
    const sg = UI.segmented("Card in " + VIEW_LABELS[view], cards.map((c) => ({ label: c.dataset.short })), (i) => setCard(view, i), idx);
    [...sg.querySelectorAll('[role="tab"]')].forEach((b, i) => b.setAttribute("aria-controls", cards[i].id));
    host.sub.replaceChildren(sg);
  }
  document.addEventListener("click", (e) => {
    const open = e.target.closest ? e.target.closest("[data-dlg]") : null;
    if (open) {
      const d = $(open.getAttribute("data-dlg"));
      if (d && typeof d.showModal === "function" && !d.open) d.showModal();
      return;
    }
    const close = e.target.closest ? e.target.closest("[data-close]") : null;
    if (close) {
      const d = close.closest("dialog");
      if (d) d.close();
      return;
    }
    if (e.target && e.target.tagName === "DIALOG" && e.target.open) e.target.close();
  });
  function syncRail() {
    const rail = document.querySelector("#railOps");
    if (!rail) return;
    const links = rail.nextElementSibling ? rail.nextElementSibling.querySelectorAll("a") : [];
    for (const a of links) {
      const latency = /view=latency/.test(a.getAttribute("href") || "");
      const on = latency ? S.tab === "latency" : S.tab !== "latency";
      a.classList.toggle("is-on", on);
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    }
  }

  function show(view, user, manual) {
    S.tab = view;
    for (const v of VIEWS) {
      const p = $("stPanel-" + v);
      if (p) p.hidden = v !== view;
    }
    if (seg) seg.pick(VIEWS.indexOf(view));
    if (user) {
      try { window.history.replaceState(null, "", window.location.pathname + window.location.search + "#view=" + view); } catch { S.hashBlocked = true; }
    }
    syncRail();
    mountSub(view);
    if (view !== "health" && UI.defer && !S.loaded) {
      S.loaded = true;
      UI.defer("status-panels", { when: "idle", label: "the capacity, latency and coverage panels" });
    }
    runReads(dueKeys(false), manual === true);
    paint();
  }

  function mountTabs() {
    seg = UI.segmented("Status view", VIEWS.map((v) => ({ label: VIEW_LABELS[v] })), (i) => show(VIEWS[i], true), VIEWS.indexOf(S.tab));
    const buttons = [...seg.querySelectorAll('[role="tab"]')];
    buttons.forEach((b, i) => {
      b.id = "stTab-" + VIEWS[i];
      b.setAttribute("aria-controls", "stPanel-" + VIEWS[i]);
    });
    seg.addEventListener("keydown", (e) => {
      if (e.key !== "Home" && e.key !== "End") return;
      e.preventDefault();
      const target = buttons[e.key === "Home" ? 0 : buttons.length - 1];
      target.focus();
      target.click();
    });
    host.tabs.append(seg);
  }

  host.again.addEventListener("click", () => runReads(dueKeys(true), true));
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else { runReads(dueKeys(true), false); start(); }
  });
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    if (resizeTimer !== null) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { resizeTimer = null; paint(); }, 120);
  });
  window.addEventListener("hashchange", () => {
    const v = viewFromHash();
    if (v !== S.tab) show(v, false);
  });

  S.tab = viewFromHash();
  mountTabs();
  show(S.tab, false, true);
  start();
})();
