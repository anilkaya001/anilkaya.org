(() => {
  "use strict";

  const UI = window.FlowsUI;
  const kit = UI && UI.statusKit;
  if (!kit) return;
  const {
    h, DASH, num, whole, trt, clockSec, span, ago, share, bytes, median, chip, stateChip, table, facts, why, fill, unread, lagOf, lagReason,
    engineCards, engineData, mini, rest, line, okBody, whyOf, BASIS, TOPIC_NAME, state,
  } = kit;
  const $ = (id) => document.getElementById(id);
  const SVG = "http://www.w3.org/2000/svg";
  const s = (tag, attrs, ...kids) => {
    const el = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined) el.setAttribute(k, String(v));
    for (const kid of kids) if (kid) el.append(kid);
    return el;
  };
  const FEEDS = ["px", "fl", "gx", "mk", "nw"];
  const VENDOR_SOCKET_NOTE = "Flagged alerts on the vendor's own socket ran 5.9 s p50 and 7.1 s p95 on 2026-10-05.";

  function rangeBar(lag, win, name) {
    const W = 220;
    const live = win ? num(win.liveMs) : null;
    const stale = win ? num(win.staleMs) : null;
    const top = Math.max(num(lag.p95) ?? 0, (live ?? 0) * 1.2, 1);
    const x = (v) => 6 + (Math.min(Math.max(v, 0), top) / top) * (W - 12);
    const label = name + ": p50 " + span(lag.p50) + ", p95 " + span(lag.p95) + (live === null ? "" : ", live window " + span(live)) +
      (stale !== null && stale <= top ? ", stale line " + span(stale) : "");
    const svg = s("svg", { class: "lt-bar", viewBox: "0 0 " + W + " 40", role: "img", "aria-label": label },
      s("rect", { class: "lt-track", x: 6, y: 14, width: W - 12, height: 8, rx: 4 }),
      s("rect", { class: "lt-range", x: x(lag.p50), y: 14, width: Math.max(2, x(lag.p95) - x(lag.p50)), height: 8, rx: 4 }),
      live !== null ? s("line", { class: "lt-live", x1: x(live), x2: x(live), y1: 6, y2: 30 }) : null,
      stale !== null && stale <= top ? s("line", { class: "lt-stale", x1: x(stale), x2: x(stale), y1: 6, y2: 30 }) : null,
      s("circle", { class: "lt-p50", cx: x(lag.p50), cy: 18, r: 4.5 }),
      s("circle", { class: "lt-p95", cx: x(lag.p95), cy: 18, r: 4.5 }),
      s("text", { class: "lt-ax", x: 6, y: 39 }, document.createTextNode("0")),
      s("text", { class: "lt-ax", x: W - 6, y: 39, "text-anchor": "end" }, document.createTextNode(span(top))));
    return svg;
  }

  function feedCard(k, rail, now) {
    const body = rail.body || {};
    const t = body.topics && body.topics[k] ? body.topics[k] : {};
    const lag = lagOf(k, t);
    const has = lag && num(lag.p50) !== null;
    const up = body.upstream && body.upstream.topics && body.upstream.topics[k] ? body.upstream.topics[k] : null;
    const via = up && up.via ? up.via : null;
    const win = t.window && typeof t.window === "object" ? t.window : null;
    const time = t.time && typeof t.time === "object" ? t.time : null;
    const watched = time && num(time.demandedMs) > 0 ? num(time.demandedMs) : null;
    const rows = [
      ["Measured as", BASIS[k]],
      ["Via", via ? String(via) : DASH + " the upstream did not say"],
    ];
    if (k === "px") rows.push(["Quote age p95", t.rowLagMs && num(t.rowLagMs.p95) !== null ? span(t.rowLagMs.p95) + ", " + whole(t.rowLagMs.n) + " rows" : DASH + " no row age yet"]);
    const rtt = t.rttMs && typeof t.rttMs === "object" ? t.rttMs : null;
    rows.push(["Poll round trip", via === "socket" ? "socket: no poll" : rtt && num(rtt.p50) !== null ? "p50 " + span(rtt.p50) + ", p95 " + span(rtt.p95) : DASH + " no poll in this epoch"]);
    rows.push(["Live share of watched time", watched === null ? DASH + " not watched in this epoch"
      : share(time.liveMs, watched) + " of " + span(watched) + " (vendor lag " + share(time.vendorLagMs, watched) + ", ours " + share(time.oursMs, watched) + ")"]);
    rows.push(["Line", win ? "live window " + span(win.liveMs) + ", stale at " + span(win.staleMs) : DASH + " the rail sent no window"]);
    return h("article", { class: "lt-card", "data-topic": k },
      h("div", { class: "lt-card-h" }, h("h3", null, TOPIC_NAME[k]), h("code", null, k), stateChip(t.fresh && t.fresh.state)),
      has ? h("p", { class: "lt-fig" }, "p50 ", h("b", null, span(lag.p50)), " · p95 ", h("b", null, span(lag.p95)), " · ", whole(lag.n), " samples")
        : h("p", { class: "lt-fig lt-none" }, DASH + " " + lagReason(rail, k)),
      has ? rangeBar(lag, win, TOPIC_NAME[k]) : null,
      facts(rows));
  }

  function paintFeeds(now) {
    const host = $("stFeeds");
    const rail = state().D.rail;
    if (!rail || !rail.ok) {
      unread(host, "The real-time rail", rail ? rail.reason : "no read yet");
      return;
    }
    const idle = !(rail.body && rail.body.running);
    fill(host,
      idle ? h("p", { class: "lt-idle", role: "status" }, "Rail idle: no one is watching, so nothing is polled. Its latency figures live in memory and are reset when the last viewer leaves, so an idle rail shows none.") : null,
      h("div", { class: "lt-feeds" }, ...FEEDS.map((k) => feedCard(k, rail, now)),
        h("article", { class: "lt-card", "data-topic": "prints" },
          h("div", { class: "lt-card-h" }, h("h3", null, "Option prints"), h("code", null, "prints"), chip("withheld", "no feed")),
          h("p", { class: "lt-fig lt-none" }, DASH + " No option-prints feed on the rail (F-94, F-116)."))),
      h("p", { class: "st-foot" }, "Behind the vendor's own stamp. The vendor's pipeline before it stamps a row is upstream of these figures. " + VENDOR_SOCKET_NOTE));
    const el = $("stFeedsAsof");
    if (el) el.textContent = rail.finished ? "read " + clockSec(rail.finished) : "";
  }

  let drawn = null;
  let chart = null;
  function paintSession(now) {
    const host = $("stSession");
    const series = state().D.series;
    const parts = [];
    if (!series || !series.ok) {
      fill(host, ...parts, h("p", { class: "st-miss" }, DASH + " The Tier 2 quote-age series was not read: " + (series ? series.reason : "no read yet") + ". Nothing is claimed about it."));
      drawn = null; chart = null;
      fill($("stSessionTbl"), h("p", { class: "st-miss" }, DASH + " no series was read"));
      return;
    }
    const b = series.body || {};
    const t = Array.isArray(b.t) ? b.t : [];
    const lag = b.lag && typeof b.lag === "object" ? b.lag : null;
    if (b.status === "pending" || !t.length || !lag) {
      fill(host, ...parts, h("p", { class: "st-miss" }, DASH + " The Tier 2 series holds no pass yet: " + (b.status === "pending" ? "it has not been published" : "its quote-age columns are empty") + "."));
      drawn = null; chart = null;
      fill($("stSessionTbl"), h("p", { class: "st-miss" }, DASH + " the series holds no pass"));
      return;
    }
    const ops = okBody("ops");
    const entry = ops && Array.isArray(ops.live) ? ops.live.find((l) => l.key === "live:strips") : null;
    const line = entry && num(entry.liveS) !== null ? entry.liveS : null;
    const labels = t.map((iso) => { const ms = Date.parse(iso); return Number.isFinite(ms) ? clockSec(ms).slice(0, 5) : DASH; });
    const p50 = (lag.p50 || []).map((v) => num(v));
    const p90 = (lag.p90 || []).map((v) => num(v));
    const mx = (lag.max || []).map((v) => num(v));
    const ahead = (lag.ahead || []).map((v) => num(v));
    const over = line === null ? null : p90.filter((v) => v !== null && v > line).length;
    const key = [t.length, t[t.length - 1], p90[p90.length - 1], line].join("|");
    if (key === drawn && $("stSessionChart")) return;
    const wrap = h("div", { class: "lt-chart", id: "stSessionChart" });
    const text = h("p", { class: "st-foot" },
      "Tier 2 quote age per pass (p50, p90, largest); the rail's own per-window latency is " + DASH + " not recorded, it lives in memory. " +
      (line === null ? "Live window not read, so no line." : "Dashed: the live window, " + whole(line) + " s.") +
      (over === null ? "" : " " + whole(over) + " of " + whole(p90.filter((v) => v !== null).length) + " passes had p90 past it."));
    fill(host, ...parts, wrap, text);
    fill($("stSessionTbl"), table("Tier 2 quote age by pass", ["Pass", "p50", "p90", "Largest"], t.map((_, i) => [labels[i], p50[i] === null ? DASH : span(p50[i] * 1000), p90[i] === null ? DASH : span(p90[i] * 1000), mx[i] === null ? DASH : span(mx[i] * 1000)])));
    const C = window.FlowsUI.chart;
    if (!C || typeof C.plot !== "function") {
      fill(wrap, h("p", { class: "st-miss" }, DASH + " The chart library did not load; the passes are in Details."));
      return;
    }
    try {
      chart = C.plot(wrap, {
        kind: "line", label: "Tier 2 quote age per pass", x: labels, xType: "category", table: false, smooth: false, yFormat: (v) => span(v * 1000),
        series: [
          { label: "p50", values: p50, color: "--accent", format: (v) => span(v * 1000) },
          { label: "p90", values: p90, color: "--s-orange", format: (v) => span(v * 1000) },
          { label: "Largest", values: mx, color: "--s-gray", dash: true, format: (v) => span(v * 1000) },
        ],
        refs: line === null ? [] : [{ y: line, dash: true, color: "--warn" }],
        height: [88, 100, 124],
      });
      drawn = key;
    } catch {
      fill(wrap, h("p", { class: "st-miss" }, DASH + " The chart could not be drawn; the numbers are in the heartbeat's series."));
    }
  }

  function sumFeeds(now) {
    const host = $("lFeeds");
    const rail = state().D.rail;
    if (!rail || !rail.ok) { unread(host, "The real-time rail", rail ? rail.reason : "no read yet"); return; }
    const body = rail.body || {};
    const rows = FEEDS.map((k) => {
      const t = body.topics && body.topics[k] ? body.topics[k] : {};
      const lag = lagOf(k, t);
      const has = lag && num(lag.p50) !== null;
      const win = t.window && typeof t.window === "object" ? t.window : null;
      return [TOPIC_NAME[k], has ? span(lag.p50) : DASH, has ? span(lag.p95) : DASH, win ? span(win.liveMs) : DASH, stateChip(t.fresh && t.fresh.state)];
    });
    rows.push(["Option prints", DASH, DASH, DASH, chip("withheld", "no feed")]);
    fill(host,
      mini("Feed latency", ["Feed", "p50", "p95", "Live line", "State"], rows, "feeds"),
      line(body.running ? "Behind the vendor's stamp; alerts and news behind the item's own time." : DASH + " rail idle: nothing is polled, so no latency is held. Figures return when a viewer connects."));
  }

  function sumStored(now) {
    const host = $("lStored");
    const ops = state().D.ops;
    if (!ops || !ops.ok) { unread(host, "The stored feeds", ops ? ops.reason : "no read yet"); return; }
    const live = ops.body.live;
    if (!Array.isArray(live)) { unread(host, "The stored feeds", ops.body.why ? "the store could not be read" : "the answer carried none"); return; }
    const rank = (l) => (l.present === false ? 3 : l.state === "stale" ? 2 : l.state === "fresh" ? 1 : 0);
    const ordered = live.slice().sort((a, b) => rank(b) - rank(a) || (b.ageS ?? 0) - (a.ageS ?? 0));
    const late = live.filter((l) => l.present === false || l.state === "stale").length;
    fill(host,
      line(late ? late + " of " + live.length + " keys are stale or missing; worst first." : "All " + live.length + " keys are inside their lines."),
      mini("Stored feeds, worst first", ["Key", "Age", "Behind vendor", "State"], ordered.map((l) => (l.present === false
        ? [l.key, DASH, DASH, chip("pending", "no row")]
        : [l.key, span((l.ageS ?? NaN) * 1000), l.behindS === null ? "unstamped" : span(l.behindS * 1000), stateChip(l.state)])), "keys"));
  }

  function sumTiming(now) {
    const host = $("lTime");
    const S = state();
    const rail = S.D.rail;
    const sock = rail && rail.ok && rail.body && rail.body.upstream ? rail.body.upstream.socket : null;
    const t2 = engineData(true, now).find((c) => c.name === "Tier 2");
    const trips = S.trips;
    const off = S.offsets.length ? median(S.offsets) : null;
    fill(host,
      mini("Timing", ["Source", "Reading"], [
        ["Tier 2 pass", t2 ? t2.lines[1] || t2.lines[0] : DASH],
        ["Vendor socket", !rail || !rail.ok ? DASH + " rail not read" : sock ? (sock.connected ? "connected" : sock.connecting ? "connecting" : "not connected") + ", " + whole(sock.messages) + " messages" : "REST polling, no socket"],
        ["This page's reads", trips.length ? "median " + span(median(trips.map((x) => x.ms))) + " over " + trips.length : DASH + " none finished"],
        ["Worker clock vs browser", off === null ? DASH + " not carried" : (off >= 0 ? "+" : "−") + span(Math.abs(off))],
      ]));
  }

  function paintStored(now) {
    const host = $("stStored");
    const ops = state().D.ops;
    if (!ops || !ops.ok) { unread(host, "The stored feeds", ops ? ops.reason : "no read yet"); return; }
    const live = ops.body.live;
    if (!Array.isArray(live)) { unread(host, "The stored feeds", ops.body.why ? "the store could not be read" : "the answer carried none"); return; }
    const rows = live.map((l) => (l.present === false
      ? [l.key, DASH, DASH, DASH, DASH, DASH, DASH, "no row"]
      : [l.key, (l.writer || DASH) + (l.source ? " (" + l.source + ")" : ""), trt(l.readAt, now, true), span((l.ageS ?? NaN) * 1000),
        l.behindS === null ? "unstamped" : span(l.behindS * 1000), span(l.liveS * 1000), span(l.staleS * 1000), l.state + (l.reason ? ", " + l.reason : "")]));
    fill(host, table("Stored feeds", ["Key", "Writer", "Read at", "Age now", "Behind the vendor at read", "Live line", "Stale line", "State"], rows, true),
      h("p", { class: "st-foot" }, "Behind the vendor at read is the read instant minus the vendor's own stamp inside the row; a row the vendor did not stamp is unstamped."));
  }

  function paintTiming(now) {
    const host = $("stTiming");
    fill(host, h("div", { class: "st-engs" }, ...engineCards(true, now)));
  }

  const memo = { finished: null, messages: null, at: null, rate: null };
  function paintSocket(now) {
    const host = $("stSocket");
    const rail = state().D.rail;
    if (!rail || !rail.ok) { unread(host, "The real-time rail", rail ? rail.reason : "no read yet"); return; }
    const up = (rail.body && rail.body.upstream) || {};
    const sock = up.socket && typeof up.socket === "object" ? up.socket : null;
    if (!sock) {
      fill(host, h("p", { class: "st-miss" }, DASH + " The rail polls the vendor over REST" + (up.kind ? " (upstream " + up.kind + ")" : "") + "; no vendor socket is configured, so there is nothing to report."));
      return;
    }
    if (memo.finished !== rail.finished) {
      if (memo.messages !== null && num(sock.messages) !== null && rail.finished > memo.at) {
        memo.rate = { perS: (sock.messages - memo.messages) / ((rail.finished - memo.at) / 1000), over: (rail.finished - memo.at) / 1000 };
      }
      memo.finished = rail.finished; memo.messages = num(sock.messages); memo.at = rail.finished;
    }
    const refused = sock.refused && typeof sock.refused === "object" ? Object.entries(sock.refused) : [];
    const err = sock.lastError && typeof sock.lastError === "object" ? sock.lastError : null;
    fill(host, facts([
      ["Connection", sock.connected ? "connected" : sock.connecting ? "connecting" : "not connected"],
      ["Since", sock.since ? trt(sock.since, now, true) : DASH],
      ["Host", sock.host ? String(sock.host) : DASH],
      ["Hours window", sock.hours ? String(sock.hours) : DASH],
      ["Channels", whole(sock.channels) + " wanted, " + whole(sock.joined) + " joined, " + whole(sock.acked) + " acknowledged, " + refused.length + " refused"],
      ["Refused", refused.length ? refused.map(([k, v]) => k + " (" + v + ")").join(", ") : "none"],
      ["Messages", whole(sock.messages) + ", " + bytes(sock.bytes)],
      ["Messages a second", memo.rate ? memo.rate.perS.toFixed(1) + " between the last two reads, " + memo.rate.over.toFixed(0) + " s apart" : DASH + " needs two reads of the rail"],
      ["Reconnects", whole(sock.reconnects) + ", " + whole(sock.failures) + " failures"],
      ["Last error", err ? [err.code, err.message, err.at ? trt(err.at, now) : null].filter(Boolean).join(", ") || "recorded" : "none"],
      ["Last message", sock.lastMsgAt ? ago(sock.lastMsgAt, now) : DASH + " none in this epoch"],
    ]), h("p", { class: "st-foot" }, "Messages a second is the change between this read and the one before it, not a rate the Worker measured."));
  }

  function paintBrowser(now) {
    const host = $("stBrowser");
    const S = state();
    if (!S.trips.length) { fill(host, h("p", { class: "st-miss" }, DASH + " No read of this page has finished yet.")); return; }
    const by = new Map();
    for (const t of S.trips) { if (!by.has(t.path)) by.set(t.path, []); by.get(t.path).push(t.ms); }
    const rows = [...by.entries()].map(([path, list]) => [path, span(list[list.length - 1]), span(median(list)), whole(list.length)]);
    const off = S.offsets.length ? median(S.offsets) : null;
    fill(host,
      facts([
        ["Round trip, all reads", "last " + span(S.trips[S.trips.length - 1].ms) + ", median " + span(median(S.trips.map((t) => t.ms))) + " over " + S.trips.length + " reads"],
        ["Worker clock against this browser", off === null ? DASH + " no read carried the Worker's clock" : (off >= 0 ? "+" : "−") + span(Math.abs(off)) + ", an estimate from " + S.offsets.length + " reads"],
      ]),
      table("This page's own reads", ["Route", "Last", "Median", "Reads"], rows, true),
      h("p", { class: "st-foot" }, "Measured by this page from the request to the end of the body. The clock offset is the Worker's clock minus the midpoint of the round trip, so it carries half a round trip of doubt."));
  }

  function latency(now) {
    sumFeeds(now);
    sumStored(now);
    sumTiming(now);
    paintFeeds(now);
    paintSession(now);
    paintStored(now);
    paintTiming(now);
    paintSocket(now);
    paintBrowser(now);
    for (const [id, key] of [["lFeeds", "rail"], ["lStored", "ops"], ["lTime", "rail"], ["stFeeds", "rail"], ["stSession", "series"], ["stStored", "ops"], ["stTiming", "ops"], ["stSocket", "rail"], ["stBrowser", "rail"]]) {
      const el = $(id + "Asof");
      const r = state().D[key];
      if (el) el.textContent = r && r.finished ? "read " + clockSec(r.finished) : "";
    }
  }

  kit.attach({ latency });
})();
