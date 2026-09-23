(() => {
  "use strict";

  const UI = window.FlowsUI;
  if (!UI) return;
  const Q = window.FlowsQuant || null;
  const { h, s, F, glyph, DASH, MINUS } = UI;
  const C = UI.chart;

  const $ = (id) => document.getElementById(id);
  const T = (k) => { const n = document.querySelector('#sgCopy [data-k="' + k + '"]'); return n ? n.textContent.replace(/\s+/g, " ").trim() : ""; };
  const entry = $("sgEntry"), input = $("sgTicker"), statusEl = $("sgStatus"), pickHost = $("sgPick"), grid = $("sgGrid");
  const titleEl = $("sgTitle"), subEl = $("sgSub"), pxEl = $("sgPx"), hero = $("sgHero");
  if (!entry || !input || !grid || !pickHost) return;

  const LOT = 100;
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  const sg = (v) => (v < 0 ? MINUS : v > 0 ? "+" : "");
  const usd = (v, signed) => {
    if (num(v) === null) return DASH;
    const a = Math.abs(v), dp = a < 1000 ? 2 : 0;
    const r = +(a + 1e-9).toFixed(dp);
    return (v < 0 && r ? MINUS : signed && v > 0 && r ? "+" : "") + "$" + r.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  };
  const gusd = (v) => (num(v) === null ? DASH : Math.abs(v) < 10 ? usd(v, true) : sg(Math.round(v)) + "$" + Math.abs(Math.round(v)).toLocaleString("en-US"));
  const kf = (K) => (num(K) === null ? DASH : String(+(+K).toFixed(2)));
  const pct = (v, dp = 1) => (num(v) === null ? DASH : (Math.round(v * Math.pow(10, dp + 2)) / Math.pow(10, dp)).toFixed(dp) + "%");
  const days = (a, b) => {
    const x = Date.parse(String(a).slice(0, 10) + "T00:00:00Z"), y = Date.parse(String(b).slice(0, 10) + "T00:00:00Z");
    return Number.isFinite(x) && Number.isFinite(y) ? Math.round((y - x) / 864e5) : null;
  };

  const NAMES = {
    "long-call": "Long call", "long-put": "Long put", "short-put": "Short put", "covered-call": "Covered call",
    "call-debit-spread": "Call debit spread", "put-debit-spread": "Put debit spread", "put-credit-spread": "Put credit spread",
    "call-credit-spread": "Call credit spread", "long-straddle": "Long straddle", "long-strangle": "Long strangle",
    "short-strangle": "Short strangle", "iron-condor": "Iron condor", "iron-fly": "Iron fly", "long-butterfly": "Butterfly",
    "broken-wing-butterfly": "Broken wing", "long-calendar": "Calendar", diagonal: "Diagonal", "risk-reversal": "Risk reversal",
    collar: "Collar", "put-ratio": "Put ratio", "call-ratio": "Call ratio", "jade-lizard": "Jade lizard", custom: "Custom",
  };
  const P_ = (t, K, side, qty = 1) => ({ type: t, K, side, qty });
  const CANON = {
    "long-call": [P_("C", 0.5, 1)], "long-put": [P_("P", 0.5, 1)], "short-put": [P_("P", 0.5, -1)],
    "covered-call": [P_("S", 0, 1), P_("C", 0.6, -1)], "call-debit-spread": [P_("C", 0.42, 1), P_("C", 0.58, -1)],
    "put-debit-spread": [P_("P", 0.58, 1), P_("P", 0.42, -1)], "put-credit-spread": [P_("P", 0.5, -1), P_("P", 0.38, 1)],
    "call-credit-spread": [P_("C", 0.5, -1), P_("C", 0.62, 1)], "long-straddle": [P_("C", 0.5, 1), P_("P", 0.5, 1)],
    "long-strangle": [P_("C", 0.6, 1), P_("P", 0.4, 1)], "short-strangle": [P_("C", 0.62, -1), P_("P", 0.38, -1)],
    "iron-condor": [P_("P", 0.28, 1), P_("P", 0.4, -1), P_("C", 0.6, -1), P_("C", 0.72, 1)],
    "iron-fly": [P_("P", 0.35, 1), P_("P", 0.5, -1), P_("C", 0.5, -1), P_("C", 0.65, 1)],
    "long-butterfly": [P_("C", 0.38, 1), P_("C", 0.5, -1, 2), P_("C", 0.62, 1)],
    "broken-wing-butterfly": [P_("P", 0.62, 1), P_("P", 0.5, -1, 2), P_("P", 0.3, 1)],
    "risk-reversal": [P_("C", 0.6, 1), P_("P", 0.4, -1)], collar: [P_("S", 0, 1), P_("P", 0.42, 1), P_("C", 0.58, -1)],
    "put-ratio": [P_("P", 0.56, 1), P_("P", 0.44, -1, 2)], "call-ratio": [P_("C", 0.44, 1), P_("C", 0.56, -1, 2)],
    "jade-lizard": [P_("P", 0.42, -1), P_("C", 0.58, -1), P_("C", 0.68, 1)],
  };
  const TENT = (c, a, b) => { const o = []; for (let i = 0; i <= 24; i++) { const x = i / 24; o.push([x, a + (b - a) * Math.exp(-(((x - c) / 0.16) ** 2))]); } return o; };
  const MULTI = new Set(["long-calendar", "diagonal"]);

  function sketch(id) {
    if (id === "long-calendar") return TENT(0.5, -0.5, 0.85);
    if (id === "diagonal") return TENT(0.56, -0.45, 0.8);
    const legs = CANON[id];
    if (!legs || !Q) return null;
    const val = (x) => legs.reduce((a, l) => a + l.side * l.qty * (l.type === "S" ? x : l.type === "C" ? Math.max(0, x - l.K) : Math.max(0, l.K - x)), 0);
    let cost = 0;
    for (let i = 0; i <= 60; i++) cost += val(0.2 + 0.6 * i / 60) / 61;
    const xs = [0, 1, ...legs.filter((l) => l.type !== "S").map((l) => l.K)].sort((a, b) => a - b);
    const pts = xs.map((x) => [x, val(x) - cost]);
    const m = Math.max(...pts.map((p) => Math.abs(p[1]))) || 1;
    return pts.map(([x, v]) => [x, v / m * 0.9]);
  }

  const FAMS = Q ? Q.STRUCTURES.filter((f) => f.id !== "no-position" && NAMES[f.id]) : [];
  const FAM = Object.fromEntries(FAMS.map((f) => [f.id, f]));

  const st = {
    t: "", ctx: null, ctxAt: 0, ctxAge: null, ctxErr: null, loading: 0,
    books: new Map(), bookErr: new Map(), pending: new Set(),
    family: null, custom: false, userFamily: false, expiry: "", back: "", legs: [], urlLegs: null,
    basis: "fill", vol: 1, dir: 0, setup: null, setupKey: "", res: null, mf: null, why: null, domain: null, drag: null, seq: 0,
  };
  const BASES = ["mid", "fill", "natural"];

  const symOf = (l) => (l.type === "S" ? st.t : st.t + l.expiry.slice(2).replace(/-/g, "") + l.type + String(Math.round(l.K * 1000)).padStart(8, "0"));
  const SYM_RE = /^([A-Z0-9]+)(\d{2})(\d{2})(\d{2})([PC])(\d{8})$/;
  function parseLeg(raw) {
    const at = raw.lastIndexOf("@");
    if (at <= 0) return null;
    const sym = raw.slice(0, at).toUpperCase();
    const q = Math.round(Number(raw.slice(at + 1)));
    if (!Number.isFinite(q) || q === 0) return null;
    const qty = Math.min(999, Math.abs(q)), side = q > 0 ? 1 : -1;
    if (sym === st.t) return { type: "S", K: null, side, qty, expiry: null };
    const m = SYM_RE.exec(sym);
    if (!m || m[1] !== st.t) return null;
    const K = Number(m[6]) / 1000;
    if (!(K > 0)) return null;
    return { type: m[5], K, side, qty, expiry: "20" + m[2] + "-" + m[3] + "-" + m[4] };
  }

  function readURL() {
    const q = new URLSearchParams(location.search);
    const t = String(q.get("t") || "").trim().toUpperCase();
    if (/^[A-Z][A-Z0-9.-]{0,9}$/.test(t)) st.t = t;
    const fam = q.get("s");
    if (fam === "custom") { st.custom = true; st.userFamily = true; }
    else if (fam && FAM[fam]) { st.family = fam; st.userFamily = true; }
    const e = q.get("expiry");
    if (e && /^\d{4}-\d{2}-\d{2}$/.test(e)) st.expiry = e;
    const b = q.get("basis");
    if (BASES.includes(b)) st.basis = b;
    const legs = String(q.get("legs") || "").split(",").filter(Boolean).map(parseLeg).filter(Boolean);
    if (legs.length) {
      st.urlLegs = legs;
      if (!st.family) st.custom = true;
      const first = legs.find((l) => l.expiry);
      if (first && !st.expiry) st.expiry = first.expiry;
    }
  }

  function writeURL() {
    const q = new URLSearchParams();
    if (st.t) q.set("t", st.t);
    if (st.custom) q.set("s", "custom");
    else if (st.family && (st.userFamily || st.moved)) q.set("s", st.family);
    if (st.expiry) q.set("expiry", st.expiry);
    if (st.basis !== "fill") q.set("basis", st.basis);
    if (st.legs.length && (st.custom || st.moved)) q.set("legs", st.legs.map((l) => symOf(l) + "@" + (l.side < 0 ? "-" : "") + l.qty).join(","));
    const next = location.pathname + (q.toString() ? "?" + q.toString() : "");
    if (next !== location.pathname + location.search) history.replaceState(null, "", next);
  }

  function messageFor(status, code) {
    if (code === "chain_unconfigured") return "live lookup is not configured on this deployment";
    if (code === "invalid_ticker") return "that is not a symbol this route accepts";
    if (code === "invalid_expiry") return "that is not a date this route accepts";
    if (code === "chain_rate_limited" || status === 429) return "the data provider is rate limiting";
    if (code === "chain_no_spot") return "the provider returned no usable price for that symbol";
    if (code === "chain_empty") return "the provider lists no options for that symbol";
    if (status >= 500) return "the data provider did not answer";
    return "the request failed (" + status + ")";
  }

  async function read(params) {
    let res;
    try {
      res = await fetch("/api/flows/strategy?" + params.toString(), { credentials: "same-origin", headers: { Accept: "application/json" } });
    } catch { return { error: "the request did not reach the server" }; }
    if (res.status === 401) { location.replace("/flows/"); return { gone: true }; }
    const age = num(res.headers.get("X-Chain-Age"));
    const body = await res.json().catch(() => null);
    if (!res.ok) return { error: messageFor(res.status, body && body.error && body.error.code) };
    if (!body || typeof body !== "object") return { error: "the response could not be read" };
    return { body, age, at: Date.now() };
  }

  async function loadContext(refresh) {
    if (!st.t) return;
    const seq = ++st.seq;
    st.loading++;
    st.ctxErr = null;
    paint();
    const p = new URLSearchParams({ t: st.t });
    if (refresh) p.set("refresh", "1");
    const out = await read(p);
    st.loading--;
    if (out.gone || seq !== st.seq) return;
    if (out.error) { st.ctxErr = out.error; st.ctx = null; }
    else {
      st.ctx = out.body;
      st.ctxAge = out.age;
      st.ctxAt = out.at;
      st.books.clear(); st.bookErr.clear(); st.pending.clear();
      const live = out.body.spotSource === "stock-state";
      UI.freshness({ sessionDate: out.body.asOf, generatedAt: out.body.generatedAt, source: "strategy" });
      if (live && out.age !== null) UI.freshness({ readAt: new Date(Date.now() - out.age * 1000).toISOString(), live: true });
      const list = expiries();
      if (!list.some((e) => e.expiry === st.expiry)) st.expiry = pickExpiry(st.family);
      if (st.family && MULTI.has(st.family)) st.back = backFor(st.family, st.expiry);
    }
    paint();
    ensureBooks();
  }

  function expiries() {
    const c = st.ctx;
    if (!c || !Array.isArray(c.expiries)) return [];
    return c.expiries.filter((e) => e && typeof e.expiry === "string").map((e) => ({ ...e, dte: days(c.asOf, e.expiry) })).filter((e) => e.dte === null || e.dte >= 0);
  }

  function pickExpiry(family) {
    const list = expiries();
    if (!list.length) return "";
    const w = family && FAM[family] && FAM[family].window ? FAM[family].window : { min: 21, max: 45, target: 35 };
    const inWin = list.filter((e) => e.dte !== null && e.dte >= w.min && e.dte <= w.max && (!FAM[family] || !FAM[family].minDte || e.dte >= FAM[family].minDte));
    const pool = inWin.length ? inWin : list;
    return pool.slice().sort((a, b) => Math.abs((a.dte ?? 999) - w.target) - Math.abs((b.dte ?? 999) - w.target) || (a.expiry < b.expiry ? -1 : 1))[0].expiry;
  }

  function backFor(family, front) {
    const fam = FAM[family];
    const list = expiries();
    const f = list.find((e) => e.expiry === front);
    if (!fam || !f || f.dte === null) return "";
    const ok = list.filter((e) => e.expiry > front && e.dte !== null && (fam.back ? e.dte - f.dte >= fam.back.min && e.dte - f.dte <= fam.back.max : e.dte >= fam.backAbs.min && e.dte <= fam.backAbs.max));
    return ok.length ? ok[0].expiry : "";
  }

  function needed() {
    const set = new Set();
    if (st.expiry) set.add(st.expiry);
    if (!st.custom && st.family && MULTI.has(st.family) && st.back) set.add(st.back);
    for (const l of st.custom ? (st.urlLegs || st.legs) : st.legs) if (l.expiry) set.add(l.expiry);
    return [...set].sort();
  }

  function ensureBooks(refresh) {
    for (const e of needed()) loadBook(e, refresh);
    rebuild();
  }

  async function loadBook(expiry, refresh) {
    if (!st.t || !expiry) return;
    if ((st.books.has(expiry) && !refresh) || st.pending.has(expiry)) return;
    const t = st.t;
    st.pending.add(expiry);
    st.bookErr.delete(expiry);
    st.loading++;
    paint();
    const p = new URLSearchParams({ t, expiry, engine: "1" });
    if (refresh) p.set("refresh", "1");
    const out = await read(p);
    st.loading--;
    st.pending.delete(expiry);
    if (out.gone || t !== st.t) return;
    if (out.error) st.bookErr.set(expiry, out.error);
    else st.books.set(expiry, out.body);
    rebuild();
  }

  function engineOf(book) {
    const e = book && book.engine;
    return e && e.status === "ok" && Array.isArray(e.fits) && e.fits.length ? e : null;
  }

  function rebuild() {
    const need = needed();
    const ready = need.length && need.every((e) => st.books.has(e));
    const key = need.join("|") + "|" + need.map((e) => (st.books.get(e) || {}).generatedAt || "").join("|");
    if (ready && key !== st.setupKey && Q) {
      st.setupKey = key;
      const front = st.books.get(need[0]);
      const eng = engineOf(front);
      if (eng) {
        const books = need.map((e) => {
          const b = st.books.get(e), en = engineOf(b);
          return en ? { fit: en.fits[0], rows: Q.bookRows(b.calls, b.puts, st.t) } : null;
        }).filter(Boolean);
        try {
          st.setup = Q.labSetup({ asOfMs: eng.asOfMs, spot: eng.spot, facts: eng.facts, state: eng.state, pLaw: eng.pLaw, levels: eng.levels, event: eng.event, stale: eng.stale, books });
        } catch { st.setup = null; }
      } else st.setup = null;
      st.domain = null;
      if (!st.family && !st.custom) {
        const pick = eng && (eng.ideas && eng.ideas[0] || eng.noTrade && eng.noTrade.closest);
        const s0 = pick && eng.structures.find((x) => x.id === pick);
        st.family = s0 && FAM[s0.family] ? s0.family : "put-credit-spread";
        st.engineFamily = true;
        if (s0 && FAM[s0.family] && !st.urlLegs) {
          st.legs = s0.legs.map((l) => ({ type: l.type, K: l.type === "S" ? null : l.k, side: l.side, qty: l.qty, expiry: l.type === "S" ? null : l.expiry }));
          st.moved = false;
        }
      }
      if (st.custom && st.urlLegs) { st.legs = st.urlLegs.map((l) => ({ ...l })); st.urlLegs = null; }
      else if (st.custom && st.snapLegs && st.setup) {
        st.legs = st.legs.map((l) => (l.type === "S" ? l : { ...l, K: snapTo({ ...l }, l.K) }));
      }
      else if (st.urlLegs && st.family) { st.legs = st.urlLegs.map((l) => ({ ...l })); st.urlLegs = null; st.moved = true; }
      else if (!st.custom && (!st.legs.length || st.rebuildLegs)) buildLegs();
      st.rebuildLegs = false;
      st.snapLegs = false;
      st.domain = null;
      price();
    }
    paint();
  }

  function buildLegs() {
    st.legs = [];
    st.moved = false;
    if (!st.setup || !st.family || !Q) return;
    const variants = Q.DELTA_TARGETS[st.family] || [{}];
    const out = Q.structureLegs(st.setup, st.family, variants[0], st.expiry, MULTI.has(st.family) ? st.back : undefined);
    if (!out || !out.legs) { st.why = { state: "unavailable", keep: true, reason: "No listed strikes on " + F.day(st.expiry) + " reach the deltas a " + NAMES[st.family].toLowerCase() + " is built from." }; return; }
    st.legs = out.legs.map((l) => ({ type: l.type, K: l.type === "S" ? null : l.K, side: l.side, qty: l.qty, expiry: l.type === "S" ? null : l.expiry || st.expiry }));
    st.snapped = out.snapped || [];
  }

  function rowOf(l) {
    if (l.type === "S") return null;
    const b = st.books.get(l.expiry);
    const rows = b ? (l.type === "C" ? b.calls : b.puts) : null;
    return rows ? rows.find((r) => Math.abs(r.k - l.K) < 1e-9) || null : null;
  }

  const spot = () => {
    const e = engineOf(st.books.get(st.expiry));
    return e ? e.spot : st.ctx ? num(st.ctx.spot) : null;
  };

  function riskOf(legs) {
    const q = (t) => legs.filter((l) => l.type === t).reduce((a, l) => a + l.side * l.qty, 0);
    const stock = q("S");
    if (Math.max(0, -(q("C") + stock)) > 0 || Math.max(0, -q("P")) > 0) return "undefined";
    return stock ? "stock" : "defined";
  }

  function legName(l) {
    if (l.type === "S") return (l.side > 0 ? "Long " : "Short ") + l.qty * LOT + " shares";
    return (l.side > 0 ? "Long " : "Short ") + l.qty + " " + F.day(l.expiry) + " " + kf(l.K) + " " + (l.type === "C" ? "call" : "put");
  }

  function modelFree() {
    const S = spot();
    let cost = 0;
    const bad = [];
    for (const l of st.legs) {
      if (l.type === "S") { if (S === null) bad.push({ l, why: "spot" }); else cost += l.side * l.qty * S; continue; }
      const r = rowOf(l);
      if (!r) { bad.push({ l, why: st.bookErr.has(l.expiry) ? "unreadable" : st.books.has(l.expiry) ? "gone" : "pending" }); continue; }
      const bid = num(r.bid), ask = num(r.ask);
      const nat = l.side > 0 ? ask : bid;
      const mid = bid !== null && ask !== null ? (bid + ask) / 2 : null;
      const px = st.basis === "natural" ? nat : st.basis === "mid" ? mid : mid !== null && nat !== null ? mid + 0.25 * (nat - mid) : null;
      if (px === null) { bad.push({ l, why: "quote" }); continue; }
      cost += l.side * l.qty * px;
    }
    if (bad.length || !st.legs.length || !Q) return { bad };
    const multi = new Set(st.legs.filter((l) => l.expiry).map((l) => l.expiry)).size > 1;
    if (multi) return { bad, cost, multi };
    const norm = st.legs.map((l) => ({ type: l.type, K: l.K, side: l.side, qty: l.qty }));
    return { bad, cost, prof: Q.expiryProfile(norm, cost), norm };
  }

  function price() {
    st.res = null;
    st.why = st.why && st.why.keep ? st.why : null;
    st.mf = st.legs.length ? modelFree() : null;
    if (!st.legs.length || !st.setup || !Q) return;
    const front = st.legs.filter((l) => l.expiry).map((l) => l.expiry).sort()[0] || st.expiry;
    const fam = st.custom ? { id: "custom", risk: riskOf(st.legs), dir: "neutral" } : null;
    const cand = {
      family: st.custom ? "custom" : st.family, fam, expiry: front,
      legs: st.legs.map((l) => ({ type: l.type, K: l.K, side: l.side, qty: l.qty, expiry: l.expiry || front })),
      dir: st.custom ? "neutral" : Q.familyDirection(FAM[st.family], st.setup.state),
      basis: st.basis === "fill" ? undefined : st.basis,
    };
    try { st.res = Q.priceStructure(st.setup, cand, { detail: true, curves: true }); } catch { st.res = null; }
    if (!st.res && st.mf && !st.mf.bad.length) {
      st.why = st.family === "jade-lizard" && !st.custom
        ? { state: "withheld", reason: "These strikes no longer make a jade lizard: the credit does not cover the call spread's width, so the position carries upside risk the structure exists to remove." }
        : { state: "withheld", reason: "A leg has no two-sided quote on the book the engine read, so the position has no mid to price from." };
    }
  }

  const el = {};
  function status(text, kind) {
    if (!statusEl) return;
    statusEl.textContent = text;
    if (kind) statusEl.dataset.empty = kind; else delete statusEl.dataset.empty;
  }

  function paint() {
    paintHero();
    paintPick();
    paintGrid();
    writeURL();
  }

  function paintHero() {
    const c = st.ctx;
    const name = st.custom ? NAMES.custom : st.family ? NAMES[st.family] : "";
    if (titleEl) titleEl.textContent = st.t || "Strategy";
    if (subEl) subEl.textContent = st.t && name ? name : "";
    if (input && document.activeElement !== input && st.t) input.value = st.t;
    if (!pxEl) return;
    pxEl.replaceChildren();
    if (!c) {
      if (!el.about) {
        el.about = UI.infoButton("the strategy lab", aboutInfo);
        hero.querySelector(".tl-t").append(el.about);
      }
      return;
    }
    const S = num(c.spot), prev = num(c.prevClose);
    const live = c.spotSource === "stock-state";
    pxEl.append(h("span", { class: "tl-spot ui-num" }, F.px(S)));
    if (S !== null && prev !== null && prev > 0) {
      const d = S - prev;
      pxEl.append(UI.capsule(sg(d) + Math.abs(d).toFixed(2) + "  " + F.pct(d / prev, 2, true), { tone: d > 0 ? "up" : d < 0 ? "down" : "flat" }));
    }
    const src = h("button", {
      type: "button", class: "tl-src", "aria-haspopup": "dialog", "aria-controls": "fxPop",
      "aria-label": live ? "Live print" : "Prior close", "data-info": UI.info(contextInfo),
    }, glyph(live ? "live" : "closed"), h("span", null, live ? ageText() : "Close"));
    pxEl.append(src);
    const eng = engineOf(st.books.get(st.expiry));
    if (eng && eng.state && eng.state.state && eng.state.state !== "undetermined") {
      const dir = eng.state.direction;
      pxEl.append(UI.tag(cap(eng.state.state) + (dir ? " " + UI.MID + " " + dir : ""), { tone: dir === "bullish" ? "up" : dir === "bearish" ? "down" : null }));
    }
    if (!el.about || !el.about.isConnected) {
      el.about = UI.infoButton("the strategy lab", aboutInfo);
      hero.querySelector(".tl-t").append(el.about);
    }
  }
  const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);

  function ageText() {
    if (st.ctxAge === null) return "Live";
    const sec = st.ctxAge + Math.max(0, (Date.now() - st.ctxAt) / 1000);
    return sec < 45 ? "Now" : sec < 5400 ? Math.round(sec / 60) + "m" : Math.round(sec / 3600) + "h";
  }

  function contextInfo() {
    const c = st.ctx || {};
    const S = num(c.spot), beta = num(c.beta), idx = c.index && num(c.index.spot);
    const earn = c.earnings;
    return {
      title: st.t + " spot", asOf: c.asOf ? "Session " + F.day(c.asOf) : null,
      lead: (c.spotSource === "stock-state" ? "The live print" : "The prior daily close") + " every reading on this page is measured from. Re-loading the symbol re-reads it; picking another expiry does not, because a second read per pick would spend a shared vendor quota to re-learn a number the page already holds and can date.",
      facts: [
        ["Spot", F.px(S) + " " + UI.MID + " " + (c.spotSource === "stock-state" ? "live print" : "prior daily close")],
        ["Read", st.ctxAge === null ? "age unknown" : ageText() === "Now" ? "moments ago" : ageText() + " ago"],
        ["Session", c.asOf || DASH],
        ["Beta", beta === null ? DASH : beta.toFixed(2)],
        ["Reference index", idx === null || !c.index ? DASH : c.index.symbol + " " + F.px(idx)],
        ["Next earnings", earn && earn.date ? earn.date + (earn.announceTime ? " " + UI.MID + " " + earn.announceTime : "") : earn && /etf|index/i.test(String(earn.issueType || "")) ? "not applicable " + UI.MID + " " + earn.issueType : DASH],
      ],
      notes: [
        T("ctx-dash"),
        T("ctx-earn"),
      ],
    };
  }

  function aboutInfo() {
    const src = $("sgRefusePanel");
    const node = h("div", { class: "tl-refuse" });
    if (src) {
      const dl = src.querySelector("dl");
      if (dl) node.append(dl.cloneNode(true));
      for (const p of src.querySelectorAll("p")) node.append(p.cloneNode(true));
    }
    return {
      title: "Strategy lab",
      lead: T("about"),
      node,
    };
  }

  function paintPick() {
    pickHost.hidden = !Q;
    if (!Q) return;
    if (!el.pick) {
      const seg = UI.segmented("Direction", [{ label: "All" }, { label: "Bullish" }, { label: "Bearish" }, { label: "Neutral" }], (i) => { st.dir = i; paintTiles(); }, st.dir);
      el.tiles = h("div", { class: "tl-strip", role: "radiogroup", "aria-label": "Structure", tabindex: "-1" });
      el.tileWrap = h("div", { class: "tl-stripw" }, el.tiles);
      el.exp = h("div", { class: "tl-strip tl-exp", role: "radiogroup", "aria-label": "Expiry" });
      el.expWrap = h("div", { class: "tl-stripw" }, el.exp);
      el.pick = h("div", { class: "tl-pick" },
        h("header", { class: "ui-mod-h" }, h("h2", { class: "ui-mod-t" }, "Structure"), h("span", { class: "ui-mod-sp" }), seg,
          UI.infoButton("structures", structInfo)),
        el.tileWrap,
        h("div", { class: "tl-exprow" }, h("div", { class: "tl-exph" }, h("span", { class: "tl-lbl" }, "Expiry"), UI.infoButton("expiries", expiryInfo, { small: true })), el.expWrap));
      pickHost.append(el.pick);
      for (const w of [el.tileWrap, el.expWrap]) {
        const strip = w.firstChild;
        const edge = () => {
          const max = strip.scrollWidth - strip.clientWidth;
          w.classList.toggle("is-l", strip.scrollLeft > 2);
          w.classList.toggle("is-r", strip.scrollLeft < max - 2);
        };
        strip.addEventListener("scroll", edge, { passive: true });
        if (window.ResizeObserver) new ResizeObserver(edge).observe(strip);
        w._edge = edge;
      }
    }
    paintTiles();
    paintExpiries();
  }

  function dirOf(fam) {
    const state = st.setup ? st.setup.state : null;
    const d = Q.familyDirection(fam, state);
    return d === "bull" ? 1 : d === "bear" ? 2 : 3;
  }

  function enginePicks() {
    const e = engineOf(st.books.get(st.expiry));
    if (!e) return new Map();
    const m = new Map();
    (e.ideas || []).forEach((id, i) => { const s0 = e.structures.find((x) => x.id === id); if (s0 && !m.has(s0.family)) m.set(s0.family, i + 1); });
    return m;
  }

  function paintTiles() {
    const picks = enginePicks();
    const list = FAMS.filter((f) => !st.dir || dirOf(f) === st.dir);
    const cur = st.custom ? "custom" : st.family;
    const keep = el.tiles.scrollLeft;
    el.tiles.replaceChildren(...list.map((f) => {
      const on = cur === f.id;
      const w = f.window ? f.window.min + "–" + f.window.max + "d" : "";
      const b = h("button", {
        type: "button", class: "tl-tile" + (on ? " is-on" : ""), role: "radio", "aria-checked": String(on), "data-family": f.id,
        "aria-label": NAMES[f.id] + ", " + f.legs + (f.legs === 1 ? " leg" : " legs") + ", " + w + (picks.has(f.id) ? ", engine pick " + picks.get(f.id) : ""),
        tabindex: on || (!cur && f === list[0]) ? "0" : "-1",
        onclick: () => choose(f.id),
      },
      C.payoff(null, { shape: sketch(f.id) }),
      h("span", { class: "tl-tile-n" }, NAMES[f.id]),
      h("span", { class: "tl-tile-m" }, f.legs + (f.legs === 1 ? " leg" : " legs") + "  " + w),
      picks.has(f.id) ? h("span", { class: "tl-pickdot", "aria-hidden": "true" }, String(picks.get(f.id))) : null,
      f.risk === "undefined" ? h("span", { class: "tl-risk", title: "Undefined risk", "aria-hidden": "true" }, glyph("unavailable")) : null);
      b.addEventListener("keydown", (e) => roving(e, el.tiles));
      return b;
    }));
    if (st.custom) {
      const b = h("button", { type: "button", class: "tl-tile is-on", role: "radio", "aria-checked": "true", "data-family": "custom", tabindex: "0" },
        C.payoff(null, { shape: customShape() }), h("span", { class: "tl-tile-n" }, "Custom"), h("span", { class: "tl-tile-m" }, st.legs.length + (st.legs.length === 1 ? " leg" : " legs")));
      el.tiles.prepend(b);
    }
    el.tiles.scrollLeft = keep;
    const on = el.tiles.querySelector(".is-on");
    if (on && on.dataset.family !== "custom" && st.tileShown !== on.dataset.family) {
      st.tileShown = on.dataset.family;
      requestAnimationFrame(() => { const r = on.offsetLeft - el.tiles.clientWidth / 2 + on.offsetWidth / 2; el.tiles.scrollLeft = Math.max(0, r); });
    }
    if (el.tileWrap._edge) requestAnimationFrame(el.tileWrap._edge);
  }

  function customShape() {
    const mf = st.mf;
    if (!mf || !mf.prof || !mf.norm) return null;
    const ks = mf.norm.filter((l) => l.type !== "S").map((l) => l.K);
    if (!ks.length) return null;
    const lo = Math.min(...ks) * 0.85, hi = Math.max(...ks) * 1.15;
    const xs = [lo, ...ks, hi].sort((a, b) => a - b);
    const v = xs.map((x) => Q.payoffValue(mf.norm, x) - mf.cost);
    const m = Math.max(...v.map(Math.abs)) || 1;
    return xs.map((x, i) => [(x - lo) / (hi - lo), v[i] / m * 0.9]);
  }

  function roving(e, box) {
    const items = [...box.querySelectorAll("[role=radio]")];
    const i = items.indexOf(e.currentTarget);
    let j = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") j = Math.min(items.length - 1, i + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") j = Math.max(0, i - 1);
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = items.length - 1;
    if (j < 0) return;
    e.preventDefault();
    items[j].focus();
    items[j].click();
  }

  function structInfo() {
    const f = st.custom ? null : FAM[st.family];
    const picks = enginePicks();
    return {
      title: "Structures",
      lead: T("struct"),
      facts: f ? [["Selected", NAMES[f.id]], ["Window", f.window ? f.window.min + " to " + f.window.max + " days, aiming at " + f.window.target : DASH],
        ["Risk", f.risk === "undefined" ? "Undefined" : f.risk === "stock" ? "Carries the stock" : "Defined"], ["Premium", cap(f.premium)]] : [],
      sections: [
        { title: "Engine picks", lines: [picks.size ? T("struct-picks") : T("struct-nopick")] },
        { title: "Undefined risk", lines: [T("struct-risk")] },
      ],
    };
  }

  function expiryInfo() {
    const list = expiries();
    const c = st.ctx || {};
    const sel = list.find((e) => e.expiry === st.expiry);
    const book = st.books.get(st.expiry);
    const lines = [];
    if (book) {
      const rows = (book.calls || []).length + (book.puts || []).length;
      const quotable = (book.calls || []).concat(book.puts || []).filter((r) => num(r.bid) > 0 && num(r.ask) >= num(r.bid)).length;
      lines.push(quotable + " of " + rows + " contracts read at " + F.day(st.expiry) + " carry a two-sided quote. Strike handles snap only to those.");
      if (book.callsTruncated || book.putsTruncated) {
        const which = book.callsTruncated && book.putsTruncated ? "Both sides" : book.callsTruncated ? "The call side" : "The put side";
        lines.push(which + " of this expiry is CUT OFF: the provider caps a page at " + book.pageSize + " contracts and this page reads " + book.pagesPerType + " of them per side, so strikes beyond those are not listed here at all.");
      }
      const off = num(book.offExpiry);
      if (off) lines.push(off + " row" + (off === 1 ? "" : "s") + " the provider returned belonged to a different expiry or option type and were dropped, so treat the strike list as incomplete.");
      if (book.ivBasis) lines.push("Implied volatility units, resolved once for the whole expiry: " + book.ivBasis + ".");
    }
    return {
      title: "Expiries", asOf: c.asOf ? "Session " + F.day(c.asOf) : null,
      lead: T("exp"),
      facts: [["Selected", sel ? F.day(sel.expiry) + " " + UI.MID + " " + sel.dte + "d" + (num(sel.chains) !== null ? " " + UI.MID + " " + sel.chains + " listed" : "") : DASH],
        ["Listed", list.length + (list.length === 1 ? " expiry" : " expiries")]],
      sections: [{ title: "This book", lines }],
      notes: [c.expirySource === "exposure" ? T("exp-oi") : null],
    };
  }

  function paintExpiries() {
    const list = expiries();
    el.expWrap.hidden = !list.length;
    if (!list.length) { el.exp.replaceChildren(); return; }
    const fam = !st.custom && st.family ? FAM[st.family] : null;
    const w = fam && fam.window;
    const maxN = Math.max(1, ...list.map((e) => num(e.chains) || 0));
    const keep = el.exp.scrollLeft;
    el.exp.replaceChildren(...list.map((e) => {
      const on = e.expiry === st.expiry, back = e.expiry === st.back && fam && MULTI.has(fam.id);
      const inWin = w && e.dte !== null && e.dte >= w.min && e.dte <= w.max;
      const n = num(e.chains);
      const b = h("button", {
        type: "button", class: "tl-chip" + (on ? " is-on" : "") + (back ? " is-back" : "") + (inWin ? " is-win" : ""),
        role: "radio", "aria-checked": String(on), tabindex: on ? "0" : "-1", "data-expiry": e.expiry,
        "aria-label": F.day(e.expiry) + ", " + (e.dte === null ? "" : e.dte + " days") + (n === null ? "" : ", " + n + " listed") + (back ? ", back month" : ""),
        title: e.expiry + (e.dte === null ? "" : " " + UI.MID + " " + e.dte + "d") + (n === null ? "" : " " + UI.MID + " " + n + " listed"),
        onclick: () => setExpiry(e.expiry),
      },
      h("b", null, F.day(e.expiry)), h("span", null, e.dte === null ? DASH : e.dte + "d"),
      h("i", { class: "tl-chip-n", style: { "--n": n === null ? "0" : String(Math.max(0.06, Math.sqrt(n / maxN))) }, "aria-hidden": "true" }));
      b.addEventListener("keydown", (ev) => roving(ev, el.exp));
      return b;
    }));
    el.exp.scrollLeft = keep;
    if (!st.expShown && st.expiry) {
      st.expShown = true;
      const on = el.exp.querySelector(".is-on");
      if (on) requestAnimationFrame(() => { el.exp.scrollLeft = Math.max(0, on.offsetLeft - el.exp.clientWidth / 2 + on.offsetWidth / 2); });
    }
    if (el.expWrap._edge) requestAnimationFrame(el.expWrap._edge);
  }

  function choose(id) {
    if (!FAM[id]) return;
    st.custom = false;
    st.family = id;
    st.userFamily = true;
    st.engineFamily = false;
    st.why = null;
    const fam = FAM[id];
    const e = expiries().find((x) => x.expiry === st.expiry);
    const fits = e && e.dte !== null && fam.window && e.dte >= fam.window.min && e.dte <= fam.window.max && (!fam.minDte || e.dte >= fam.minDte);
    if (!fits && st.ctx) { st.expiry = pickExpiry(id); st.expShown = false; }
    st.back = MULTI.has(id) ? backFor(id, st.expiry) : "";
    if (MULTI.has(id) && !st.back) st.why = { state: "unavailable", keep: true, reason: "No listed expiry sits in a " + NAMES[id].toLowerCase() + "'s back-month window behind " + F.day(st.expiry) + "." };
    st.legs = [];
    st.rebuildLegs = true;
    st.setupKey = "";
    if (!st.t) { paint(); input.focus(); return; }
    ensureBooks();
  }

  function setExpiry(e) {
    if (e === st.expiry) return;
    st.expiry = e;
    st.why = null;
    if (!st.custom && st.family && MULTI.has(st.family)) {
      st.back = backFor(st.family, e);
      if (!st.back) st.why = { state: "unavailable", keep: true, reason: "No listed expiry sits in a " + NAMES[st.family].toLowerCase() + "'s back-month window behind " + F.day(e) + "." };
    }
    if (st.custom) { st.legs = st.legs.map((l) => (l.expiry ? { ...l, expiry: e } : l)); st.snapLegs = true; }
    else { st.legs = []; st.rebuildLegs = true; }
    st.setupKey = "";
    ensureBooks();
  }

  function paintGrid() {
    const c = st.ctx;
    if (!st.t) { status("Enter a symbol to begin."); showSilence(null); return; }
    if (st.loading > 0 && !c) { status("Reading the book…", "pending"); showSilence({ state: "pending", reason: "Reading " + st.t + "…" }, "Reading"); return; }
    if (st.ctxErr) {
      const t = st.t + ": " + st.ctxErr + ". Nothing below was read — this is the request failing, not the market being quiet.";
      status(t, "unreadable");
      showSilence({ state: "unavailable", reason: t }, st.t);
      return;
    }
    if (!c) { status("Enter a symbol to begin."); showSilence(null); return; }
    if (c.expiryStatus === "unreadable") {
      const t = st.t + ": the expiry list did not come back, so there is nothing to pick from. The price above was read; this one request was not.";
      status(t, "unreadable");
      showSilence({ state: "unavailable", reason: t }, "Expiries");
      return;
    }
    if (!expiries().length) {
      const t = st.t + " was read and lists no option expiries. That is a reading about the name, not a failure of this page.";
      status(t, "quiet");
      showSilence({ state: "quiet", reason: t }, "Expiries");
      return;
    }
    const failed = needed().find((e) => st.bookErr.has(e));
    if (failed) {
      const t = "The book for " + failed + " did not come back: " + st.bookErr.get(failed) + ". Nothing is priced because nothing was read, which is not the same as this expiry being empty.";
      status(t, "unreadable");
      showSilence({ state: "unavailable", reason: t }, "Book");
      return;
    }
    const waiting = needed().some((e) => !st.books.has(e));
    if (waiting || (st.loading > 0 && !st.res && !st.mf)) {
      status("Reading every listed contract at " + F.day(st.expiry) + "…", "pending");
      showModules(true);
      return;
    }
    const n = expiries().length;
    status(st.t + " " + UI.MID + " " + n + " listed " + (n === 1 ? "expiry" : "expiries") + " " + UI.MID + " " + (st.legs.length ? st.legs.length + (st.legs.length === 1 ? " leg" : " legs") : "no legs"));
    showModules(false);
  }

  function showSilence(stt, label) {
    delete st.mods;
    grid.replaceChildren();
    if (!stt) return;
    grid.append(h("section", { class: "ui-card ui-mod tl-silence", "data-state": stt.state }, UI.silent(stt, label || st.t, 260)));
  }

  function showModules(busy) {
    if (!st.mods) buildModules();
    if (busy) grid.setAttribute("data-busy", ""); else grid.removeAttribute("data-busy");
    fillModules(!busy);
  }

  function buildModules() {
    grid.replaceChildren();
    const m = st.mods = {};
    m.cost = slot("Cost"); m.maxP = slot("Max profit"); m.maxL = slot("Max loss"); m.be = slot("Breakeven");
    m.plot = h("div", { class: "tl-plot" });
    m.chart = h("div", { class: "tl-chart", id: "sgPayoff" });
    m.rail = h("div", { class: "tl-rail", role: "group", "aria-label": "Strike handles" });
    m.plot.append(m.chart, m.rail);
    m.legend = h("div", { class: "tl-legend" });
    m.payoffState = h("span", { class: "tl-hstate" });
    const payoff = UI.moduleCard({ id: "sgPayoffM", title: "Payoff", span: 8, index: 0, info: payoffInfo, body: [UI.metrics([m.cost, m.maxP, m.maxL, m.be], { min: 110 }), m.plot, m.legend] });
    payoff.querySelector(".ui-mod-t").append(m.payoffState);
    m.pop = h("div", { class: "tl-pop" });
    m.evP = slot("EV real world"); m.evQ = slot("EV implied"); m.edge = slot("Edge");
    m.grade = h("span", { class: "tl-grade" });
    const odds = UI.moduleCard({ id: "sgOddsM", title: "Odds", index: 1, info: oddsInfo, body: [m.pop, UI.metrics([m.evP, m.evQ, m.edge], { min: 96 })] });
    odds.querySelector(".ui-mod-t").append(m.grade);
    m.dl = slot("Delta"); m.gm = slot("Gamma"); m.vg = slot("Vega"); m.th = slot("Theta"); m.cap = slot("Capital"); m.ror = slot("Return");
    const greeks = UI.moduleCard({ id: "sgGreeksM", title: "Greeks", index: 3, info: greeksInfo, body: [UI.metrics([m.dl, m.gm, m.vg, m.th, m.cap, m.ror], { min: 112 })] });
    m.scn = h("div", { class: "tl-scn" });
    m.volSeg = UI.segmented("Volatility shift", [{ label: "−5 vol" }, { label: "Flat" }, { label: "+5 vol" }], (i) => { st.vol = i; fillScenario(); }, st.vol);
    const scen = UI.moduleCard({ id: "sgScenM", title: "Scenarios", span: 7, index: 2, seg: m.volSeg, info: scenarioInfo, body: [m.scn] });
    m.legs = h("div", { class: "tl-legs", role: "list", "aria-label": "Position legs" });
    m.basisSeg = UI.segmented("Price legs at", [{ label: "Mid" }, { label: "Fill" }, { label: "Natural" }], (i) => { st.basis = BASES[i]; price(); paint(); }, BASES.indexOf(st.basis));
    m.basisSeg.id = "sgBasis";
    m.add = h("button", { type: "button", class: "tl-addrow", id: "sgAdd", onclick: addLeg }, h("span", { "aria-hidden": "true" }, "+"), "Add leg");
    m.px4 = h("div", { class: "tl-px4", role: "group", "aria-label": "Position price" });
    const legs = UI.moduleCard({ id: "sgLegsM", title: "Legs", span: 5, index: 4, seg: m.basisSeg, info: legsInfo, body: [m.px4, m.legs, m.add] });
    grid.append(payoff, h("div", { class: "ui-span-4 tl-col" }, odds, greeks), scen, legs);
    m.chartRec = C.mount(m.chart, (host, w, animate) => drawPlot(host, w, animate));
  }

  function slot(label) {
    const w = h("div", { class: "tl-slot", "data-slot": label });
    w._label = label;
    return w;
  }
  function put(w, value, o = {}) {
    const silentNow = !!(o.state && o.state.state !== "ok");
    const cur = w.firstChild;
    const unit = o.unit || "";
    if (cur && !silentNow && !cur._silent && w._unit === unit && w._info === !!o.info && cur.querySelector(".ui-metric-n")) {
      UI.updateMetric(cur, value, { tone: o.tone || "flat", sub: o.sub || "", animate: o.animate !== false });
      return;
    }
    const m = UI.metric(w._label, value, { ...o, state: silentNow ? o.state : null, tone: o.tone || "flat" });
    m._silent = silentNow;
    w._unit = unit;
    w._info = !!o.info;
    w.replaceChildren(m);
  }

  function engineState() {
    if (!Q) return { state: "unavailable", reason: "The engine bundle did not load, so nothing on the smile can be computed in this page." };
    if (st.why) return st.why;
    const book = st.books.get(st.legs.find((l) => l.expiry) ? st.legs.find((l) => l.expiry).expiry : st.expiry);
    const e = book && book.engine;
    if (!e) return { state: "unavailable", reason: "The route returned the book without an engine block." };
    if (e.status !== "ok") return { state: "unavailable", reason: cap(e.reason || "the engine did not price this expiry") + "." };
    if (!engineOf(book)) return { state: "withheld", reason: "No smile could be fitted to this expiry's quotes, so no leg can be priced on it." };
    if (!st.legs.length) return { state: "quiet", reason: "No legs yet: pick a structure or add a leg." };
    if (st.mf && st.mf.bad.length) return badState(st.mf.bad);
    if (!st.res) return { state: "withheld", reason: "The engine could not price this position." };
    return { state: "ok", reason: null };
  }

  function badState(bad) {
    const which = (k) => bad.filter((b) => b.why === k).map((b) => legName(b.l)).join("; ");
    if (bad.some((b) => b.why === "unreadable")) return { state: "unavailable", reason: "Withheld: the book for " + which("unreadable") + " did not come back. Nothing here is computed from a partial position." };
    if (bad.some((b) => b.why === "gone")) return { state: "withheld", reason: "Withheld: " + which("gone") + " is no longer listed at that expiry. The contract was read for and is not in the book, so remove the leg." };
    if (bad.some((b) => b.why === "quote")) return { state: "withheld", reason: "Withheld: " + which("quote") + " has no " + (st.basis === "mid" || st.basis === "fill" ? "two-sided quote, so it has no mid" : "quote on the side this basis would trade at") + ". A position with one unpriced leg has an unknown cost, not a smaller one." };
    if (bad.some((b) => b.why === "spot")) return { state: "unavailable", reason: "Withheld: the share leg needs a spot price and none was read." };
    return { state: "pending", reason: "Reading the book that prices " + which("pending") + "…" };
  }

  function fillModules(animate) {
    const m = st.mods;
    if (!m) return;
    const es = engineState();
    const r = es.state === "ok" ? st.res : null;
    const mf = st.mf && !st.mf.bad.length ? st.mf : null;
    const moneyState = mf || r ? null : st.mf && st.mf.bad.length ? badState(st.mf.bad) : es;
    const cost = r ? costOf(r) : mf ? mf.cost * LOT : null;
    const credit = cost !== null && cost < 0;
    const maxP = r ? r.maxProfit : mf && mf.prof ? (mf.prof.maxProfit === null ? null : mf.prof.maxProfit * LOT) : null;
    const maxL = r ? r.maxLoss : mf && mf.prof ? (mf.prof.maxLoss === null ? null : mf.prof.maxLoss * LOT) : null;
    const pu = r ? r.profitUnbounded : mf && mf.prof ? mf.prof.profitUnbounded : false;
    const lu = r ? r.lossUnbounded : mf && mf.prof ? mf.prof.lossUnbounded : false;
    const bes = r ? r.breakevens : mf && mf.prof ? mf.prof.breakevens : [];
    m.cost._label = credit ? "Credit" : "Debit";
    if (m.cost.firstChild && m.cost.firstChild.querySelector(".ui-metric-l") && m.cost.firstChild.querySelector(".ui-metric-l").firstChild) m.cost.firstChild.querySelector(".ui-metric-l").firstChild.textContent = m.cost._label;
    put(m.cost, usd(cost === null ? null : Math.abs(cost)), { state: moneyState, sub: "at " + (st.basis === "fill" ? "fill" : st.basis), animate });
    put(m.maxP, pu ? "Unbounded" : usd(maxP, true), { state: moneyState, tone: pu ? "flat" : maxP > 0 ? "up" : maxP < 0 ? "down" : "flat", animate });
    put(m.maxL, lu ? "Unbounded" : usd(maxL, true), { state: moneyState, tone: lu ? "down" : maxL < 0 ? "down" : maxL > 0 ? "up" : "flat", animate });
    m.maxP.classList.toggle("is-word", !!pu);
    m.maxL.classList.toggle("is-word", !!lu);
    put(m.be, !bes || !bes.length ? "None" : bes.map(kf).join("  "), { state: moneyState, animate, sub: bes && bes.length > 1 ? bes.length + " breakevens" : null });
    m.payoffState.replaceChildren(...[es.state !== "ok" && (mf || r) ? UI.stateButton(es, "Today line") : null].filter(Boolean));
    if (m.chartRec) m.chartRec.redraw(false);
    fillLegend();
    fillOdds(r, es, animate);
    fillGreeks(r, es, animate);
    fillScenario();
    fillLegs(r);
    const pr = r ? r.price : null;
    const pv = (k) => (pr && num(pr[k]) !== null ? usd(Math.abs(pr[k]) * LOT) : DASH);
    const cr = pr && num(pr.mid) !== null && pr.mid < 0;
    m.px4.replaceChildren(...[["Mid", "mid"], ["Fill", "fill"], ["Natural", "natural"], ["Model", "model"]].map(([l, k]) =>
      h("div", { "data-on": st.basis === k ? "" : null }, h("span", null, l), h("b", null, pv(k)))));
    m.px4.setAttribute("aria-label", "Position " + (cr ? "credit" : "debit") + " per lot at mid, fill, natural and on the smile");
  }

  const costOf = (r) => {
    const p = r.price;
    const per = st.basis === "mid" ? p.mid : st.basis === "natural" ? p.natural : p.fill;
    return num(per) === null ? null : per * LOT;
  };

  function fillLegend() {
    const m = st.mods;
    const r = st.res;
    const keys = [[ "--label-1", "ln", "Expiry" ]];
    if (r && r.curves) keys.push(["--accent", "ln", "Today"], ["--accent-ink", "", "Implied"]);
    if (r && r.curves && r.curves.densP) keys.push(["--s-orange", "", "Real world"]);
    keys.push(["--up-mark", "dot", "Profit zone"]);
    m.legend.replaceChildren(UI.legend(keys));
  }

  function popRow(label, key, color) {
    const bar = h("i", { style: { "--c": `var(${color})` } });
    const gap = h("u", { class: "tl-pop-gap" });
    const guide = h("s", { class: "tl-pop-g" });
    const val = h("span", { class: "tl-pop-v" });
    const row = h("div", { class: "tl-pop-r", "data-law": key }, h("span", { class: "tl-pop-l" }, label), h("span", { class: "tl-pop-t", "aria-hidden": "true" }, bar, gap, guide), val);
    Object.assign(row, { _bar: bar, _gap: gap, _guide: guide, _val: val, _label: label });
    return row;
  }

  function fillOdds(r, es, animate) {
    const m = st.mods;
    if (!m.popQ) {
      m.popQ = popRow("Implied", "q", "--accent");
      m.popP = popRow("Real world", "p", "--s-orange");
      m.popD = h("div", { class: "tl-pop-d" });
      m.pop.append(m.popQ, m.popP, m.popD);
      m.pop.setAttribute("role", "img");
      requestAnimationFrame(() => requestAnimationFrame(() => m.pop.classList.add("is-in")));
    }
    const popQ = r ? r.prob.popQ : null, popP = r ? r.prob.popP : null;
    const lawState = r && popP === null ? { state: "unavailable", reason: "No real-world law: " + lawWhy() + "." } : null;
    const setRow = (row, v, stt) => {
      row.classList.toggle("is-none", v === null);
      row._bar.style.setProperty("--p", v === null ? "0" : String(v));
      if (v === null) row._val.replaceChildren(UI.dash(stt, row._label));
      else {
        const txt = v >= 0.995 ? ">99%" : v > 0 && v <= 0.005 ? "<1%" : pct(v, 0);
        const cur = row._val.querySelector(".ui-roll");
        if (cur) UI.roll(cur, txt, cur.dataset.value, animate); else row._val.replaceChildren(UI.roll(h("b", { class: "ui-num" }), txt, null, animate));
      }
    };
    setRow(m.popQ, popQ, es);
    setRow(m.popP, popP, lawState || es);
    const both = popQ !== null && popP !== null;
    const d = both ? popP - popQ : 0;
    for (const row of [m.popQ, m.popP]) {
      row._guide.hidden = !both;
      row._guide.style.setProperty("--a", String(both ? popQ : 0));
    }
    m.popP._gap.hidden = !both;
    m.popP._gap.dataset.tone = d >= 0 ? "up" : "down";
    m.popP._gap.style.setProperty("--a", String(both ? Math.min(popQ, popP) : 0));
    m.popP._gap.style.setProperty("--b", String(both ? Math.max(popQ, popP) : 0));
    m.popD.replaceChildren(...(both ? [UI.capsule(sg(d) + Math.abs(d * 100).toFixed(1) + " pts", { tone: Math.abs(d) < 0.0005 ? "flat" : d > 0 ? "up" : "down", label: "Real world against implied, " + sg(d) + Math.abs(d * 100).toFixed(1) + " points" }),
      h("span", { class: "tl-pop-dl" }, "Chance of profit")] : [h("span", { class: "tl-pop-dl" }, "Chance of profit")]));
    m.pop.setAttribute("aria-label", "Chance of profit at expiry: implied " + (popQ === null ? "not available" : pct(popQ, 1)) + ", real world " + (popP === null ? "not available" : pct(popP, 1)));
    const evP = r ? r.ev.p : null, evQ = r ? r.ev.q : null, edge = r ? r.ev.edge : null;
    const tone = (v) => (num(v) === null ? "flat" : v > 0 ? "up" : v < 0 ? "down" : "flat");
    put(m.evP, usd(evP, true), { state: r ? (evP === null ? lawState : null) : es, tone: tone(evP), animate });
    put(m.evQ, usd(evQ, true), { state: r ? null : es, tone: tone(evQ), animate });
    put(m.edge, usd(edge, true), { state: r ? (edge === null ? lawState : null) : es, tone: tone(edge), animate });
    m.grade.replaceChildren(...(r ? [UI.robustness(r.grade, "grade " + r.grade)] : []));
  }

  function lawWhy() {
    const e = engineOf(st.books.get(st.expiry));
    return e && e.lawFrom === null ? "no card with a GARCH law is published for " + st.t + " this session, so there is no real-world distribution to take a probability over" : "the card's law could not be read";
  }

  function fillGreeks(r, es, animate) {
    const m = st.mods;
    const g = r ? r.greeks : null;
    const S = spot();
    const stt = r ? null : es;
    const t = (v) => (num(v) === null ? "flat" : v > 0 ? "up" : v < 0 ? "down" : "flat");
    const sh = g && S ? g.delta$ / S : null;
    put(m.dl, sh === null ? DASH : sg(sh) + Math.abs(sh).toFixed(Math.abs(sh) < 10 ? 1 : 0), { state: stt, unit: "sh", sub: g ? F.money(g.delta$, true) + " delta" : null, tone: t(sh), animate });
    put(m.gm, gusd(g && g.gamma$1pct), { state: stt, unit: "/1%", tone: t(g && g.gamma$1pct), animate });
    put(m.vg, gusd(g && g.vegaPt), { state: stt, unit: "/pt", tone: t(g && g.vegaPt), animate });
    put(m.th, gusd(g && g.thetaDay), { state: stt, unit: "/day", tone: t(g && g.thetaDay), animate });
    const capv = r ? r.capital : null;
    put(m.cap, usd(capv && capv.value), { state: stt, sub: capv ? (capv.kind === "reg-t" ? "Reg-T proxy" : capv.kind === "stock" ? "With stock" : "Max loss") : null, animate });
    put(m.ror, r && num(r.score) !== null ? F.pct(r.score, 1, true) : DASH, { state: stt || (r && num(r.score) === null ? { state: "unavailable", reason: "Return on capital needs the real-world expected value: " + lawWhy() + "." } : null), sub: "EV ÷ capital", tone: t(r && r.score), animate });
  }

  function fillScenario() {
    const m = st.mods;
    if (!m) return;
    const r = st.res;
    const es = engineState();
    if (!r || !r.grid) { m.scn.replaceChildren(UI.silent(r ? { state: "withheld", reason: "The engine returned no scenario grid for this position." } : es, "Scenarios", 220)); return; }
    const g = r.grid, vi = st.vol;
    const lv = st.setup && st.setup.ctx.levels ? st.setup.ctx.levels : {};
    const S = spot();
    const order = g.spot.map((x, i) => i).sort((a, b) => g.spot[b] - g.spot[a]);
    const vals = [];
    for (const i of order) for (let d = 0; d < g.days.length; d++) vals.push(Math.abs(g.pnl[i][vi][d] || 0));
    const max = Math.max(1, ...vals);
    const zi = g.spot.findIndex((x) => Math.abs(x - S) < 1e-6);
    const Z = ["−2 SD", "−1 SD", "−½ SD", "Spot", "+½ SD", "+1 SD", "+2 SD"];
    const tagOf = (i) => {
      if (i < 7) return Z[i];
      const x = g.spot[i];
      const near = (v) => num(v) !== null && Math.abs(v - x) < 1e-3;
      return near(lv.callWall) ? "Call wall" : near(lv.putWall) ? "Put wall" : near(lv.flip) ? "Flip" : "Level";
    };
    const head = h("tr", null, h("th", { scope: "col" }, h("span", { class: "visually-hidden" }, "Spot")),
      ...g.days.map((d, j) => h("th", { scope: "col" }, j === 0 ? "Now" : j === g.days.length - 1 ? F.day(st.legs.filter((l) => l.expiry).map((l) => l.expiry).sort()[0] || st.expiry) : d + "d")));
    const body = order.map((i) => h("tr", { class: i === zi ? "is-spot" : i >= 7 ? "is-level" : null },
      h("th", { scope: "row" }, h("b", { class: "ui-num" }, kf(g.spot[i])), h("span", null, tagOf(i))),
      ...g.days.map((d, j) => {
        const v = g.pnl[i][vi][j];
        const a = Math.sqrt(Math.abs(v || 0) / max);
        return h("td", {
          class: "ui-num" + (i === zi && j === 0 && vi === 1 ? " is-now" : ""), "data-tone": v > 0 ? "up" : v < 0 ? "down" : null,
          style: { "--a": (0.08 + 0.52 * a).toFixed(3), "--d": j * 40 + "ms" },
        }, F.money(v, true));
      })));
    const table = h("table", { class: "tl-scn-t" }, h("caption", { class: "visually-hidden" }, "Profit and loss per lot at each spot and day, volatility " + ["5 points lower", "unchanged", "5 points higher"][vi]), h("thead", null, head), h("tbody", null, body));
    m.scn.replaceChildren(table);
  }

  function fillLegs(r) {
    const m = st.mods;
    const S = spot();
    const rows = st.legs.map((l, i) => {
      const rl = r ? r.legs[i] : null;
      const row = rowOf(l);
      const bid = rl ? rl.bid : row ? num(row.bid) : null, ask = rl ? rl.ask : row ? num(row.ask) : null;
      const badge = l.type === "S" ? "S" : l.type;
      const del = rl && num(rl.delta) !== null ? rl.delta * l.side : null;
      const q = h("span", { class: "tl-qty" },
        h("button", { type: "button", class: "tl-ib", "aria-label": "One fewer of " + legName(l), onclick: () => bump(i, -1) }, MINUS),
        h("b", { class: "ui-num" }, String(l.qty)),
        h("button", { type: "button", class: "tl-ib", "aria-label": "One more of " + legName(l), onclick: () => bump(i, 1) }, "+"));
      return h("div", { class: "tl-leg", role: "listitem", "data-leg": String(i) },
        h("span", { class: "ui-badge", "data-tone": l.type === "C" ? "up" : l.type === "P" ? "down" : null, "aria-label": l.type === "C" ? "Call" : l.type === "P" ? "Put" : "Stock" }, badge),
        h("button", { type: "button", class: "tl-bs", "data-side": l.side > 0 ? "long" : "short", "aria-label": (l.side > 0 ? "Long" : "Short") + ": switch " + legName(l) + " to " + (l.side > 0 ? "short" : "long"), onclick: () => flip(i) }, l.side > 0 ? "Buy" : "Sell"),
        h("span", { class: "tl-leg-m" }, h("b", { class: "ui-num" }, l.type === "S" ? String(l.qty * LOT) : kf(l.K)), h("span", null, l.type === "S" ? "shares at " + F.px(S) : (l.type === "C" ? "call" : "put") + " " + UI.MID + " " + F.day(l.expiry))),
        h("span", { class: "tl-leg-x" },
          h("span", { class: "tl-leg-c ui-num", title: "Delta per share, signed by side" }, h("small", null, "Δ"), del === null ? DASH : sg(del) + Math.abs(del).toFixed(2)),
          h("span", { class: "tl-leg-c ui-num", title: "Implied volatility on the fitted smile" }, h("small", null, "IV"), rl && num(rl.iv) !== null ? pct(rl.iv, 1) : DASH),
          h("span", { class: "tl-leg-c tl-leg-q ui-num", title: "Bid and ask" }, l.type === "S" ? DASH : F.px(bid) + " × " + F.px(ask)),
          h("span", { class: "tl-leg-c ui-num", title: "Model value on the smile" }, h("small", null, "Model"), rl && num(rl.model) !== null ? F.px(rl.model) : DASH)),
        q,
        h("button", { type: "button", class: "tl-ib tl-rm", "aria-label": "Remove " + legName(l), onclick: () => removeLeg(i) }, glyph("x")));
    });
    m.legs.replaceChildren(...rows);
    if (!rows.length) m.legs.append(UI.silent({ state: "quiet", reason: "No legs yet: pick a structure above, or add a leg." }, "Legs", 72));
  }

  function toCustom() {
    if (!st.custom) { st.custom = true; st.userFamily = true; }
  }
  function bump(i, d) {
    const l = st.legs[i];
    if (!l) return;
    l.qty = Math.min(999, l.qty + d);
    if (l.qty <= 0) st.legs.splice(i, 1);
    toCustom();
    reprice();
  }
  function flip(i) { const l = st.legs[i]; if (!l) return; l.side = -l.side; toCustom(); reprice(); }
  function removeLeg(i) { st.legs.splice(i, 1); toCustom(); reprice(); }
  function addLeg() {
    const e = st.setup && st.setup.expiries.get(st.expiry);
    const S = spot();
    const ks = e ? e.callStrikes : (st.books.get(st.expiry) ? st.books.get(st.expiry).calls.map((r) => r.k) : []);
    if (!ks.length || S === null) return;
    const K = ks.reduce((b, k) => (Math.abs(k - S) < Math.abs(b - S) ? k : b), ks[0]);
    st.legs.push({ type: "C", K, side: 1, qty: 1, expiry: st.expiry });
    toCustom();
    reprice();
  }
  function reprice() { st.moved = true; st.domain = null; price(); paint(); }

  function strikesFor(l) {
    const e = st.setup && st.setup.expiries.get(l.expiry);
    if (e) return l.type === "C" ? e.callStrikes : e.putStrikes;
    const b = st.books.get(l.expiry);
    return b ? (l.type === "C" ? b.calls : b.puts).filter((r) => num(r.bid) > 0 && num(r.ask) >= num(r.bid)).map((r) => r.k) : [];
  }

  function domainOf() {
    if (st.drag && st.domain) return st.domain;
    const S = spot();
    const ks = st.legs.filter((l) => l.type !== "S").map((l) => l.K);
    let lo, hi;
    const cx = st.res && st.res.curves ? st.res.curves.x : null;
    if (cx && cx.length) { lo = Math.min(...cx); hi = Math.max(...cx); }
    else {
      const pts = ks.concat(S === null ? [] : [S]);
      if (!pts.length) return null;
      lo = Math.min(...pts) * 0.85; hi = Math.max(...pts) * 1.15;
    }
    for (const k of ks.concat(S === null ? [] : [S])) { lo = Math.min(lo, k); hi = Math.max(hi, k); }
    const pad = (hi - lo) * 0.04;
    st.domain = [Math.max(0, lo - pad), hi + pad];
    return st.domain;
  }

  function series() {
    const r = st.res, mf = st.mf && !st.mf.bad.length ? st.mf : null;
    const dom = domainOf();
    if (!dom) return null;
    const [d0, d1] = dom;
    const inD = (x) => x >= d0 - 1e-9 && x <= d1 + 1e-9;
    let exp = null, today = null, dq = null, dp = null;
    if (r && r.curves) {
      const c = r.curves;
      const idx = c.x.map((x, i) => i).filter((i) => inD(c.x[i]));
      today = idx.map((i) => [c.x[i], c.t0[i]]);
      dq = idx.map((i) => [c.x[i], c.densQ[i]]);
      if (c.densP) dp = smooth(idx.map((i) => [c.x[i], c.densP[i]]));
      if (mf && mf.prof) exp = null; else exp = idx.map((i) => [c.x[i], c.expiry[i]]);
    }
    if (!exp && mf && mf.prof) {
      const cost = r ? costOf(r) / LOT : mf.cost;
      const xs = [d0, d1, ...mf.norm.filter((l) => l.type !== "S").map((l) => l.K).filter(inD)];
      const pr = r ? r.breakevens : mf.prof.breakevens;
      for (const b of pr || []) if (inD(b)) xs.push(b);
      exp = [...new Set(xs)].sort((a, b) => a - b).map((x) => [x, (Q.payoffValue(mf.norm, x) - cost) * LOT]);
    }
    if (!exp) return null;
    return { d0, d1, exp, today, dq, dp };
  }

  function drawPlot(host, w, animate) {
    const m = st.mods;
    const ser = series();
    const phone = w < 600;
    const Hp = phone ? 200 : w < 900 ? 230 : 260;
    const hasD = !!(ser && ser.dq);
    const Hd = hasD ? (phone ? 44 : 56) : 0;
    const top = 26, gap = hasD ? 14 : 0, bottom = 20;
    const H = top + Hp + gap + Hd + bottom;
    if (!ser) {
      host.append(UI.silent(engineState().state === "ok" ? { state: "quiet", reason: "No legs yet." } : engineState(), "Payoff", H));
      placeHandles(null);
      return;
    }
    const left = 6, right = phone ? 58 : 76;
    const x = C.lin(ser.d0, ser.d1, left, w - right);
    const ys = ser.exp.map((p) => p[1]).concat(ser.today ? ser.today.map((p) => p[1]) : [], [0]);
    let v0 = Math.min(...ys), v1 = Math.max(...ys);
    const pad = (v1 - v0) * 0.1 || 1;
    v0 -= pad; v1 += pad;
    const y = C.lin(v0, v1, top + Hp, top);
    const box = h("div", { class: "tl-scrub" });
    host.append(box);
    const svg = C.svgRoot(box, w, H, animate, "Profit and loss per lot against the underlying price, at expiry" + (ser.today ? " and today" : ""));
    const res = st.res, mf = st.mf;
    const intervals = res ? profitIntervals(res) : mf && mf.prof ? mf.prof.profitIntervals : [];
    const zy = y(0);
    const P = ser.exp.map((p) => [x(p[0]), y(p[1])]);
    const d = C.pathOf(P);
    const fill = d + `L${P[P.length - 1][0].toFixed(1)} ${zy.toFixed(1)}L${P[0][0].toFixed(1)} ${zy.toFixed(1)}Z`;
    s("path", { d: fill, class: "tl-wash-up fade", "clip-path": C.clipRect(svg, 0, 0, w, zy) }, svg);
    s("path", { d: fill, class: "tl-wash-dn fade", "clip-path": C.clipRect(svg, 0, zy, w, Math.max(0, top + Hp - zy)) }, svg);
    s("line", { x1: left, x2: w - right, y1: zy, y2: zy, class: "base" }, svg);
    for (const l of st.legs) {
      if (l.type === "S" || !(l.K >= ser.d0 && l.K <= ser.d1)) continue;
      s("line", { x1: x(l.K), x2: x(l.K), y1: top, y2: top + Hp + gap + Hd, class: "tl-kline" }, svg);
    }
    if (ser.today && ser.today.length > 1) s("path", { d: C.monoPath(ser.today.map((p) => [x(p[0]), y(p[1])])), class: "ln tl-today" + (animate ? " draw" : ""), pathLength: 1, style: { "--delay": "120ms" } }, svg);
    s("path", { d, class: "ln tl-exp" + (animate ? " draw" : ""), pathLength: 1 }, svg);
    const S = spot();
    if (S !== null && S >= ser.d0 && S <= ser.d1) {
      const sx = x(S);
      s("line", { x1: sx, x2: sx, y1: top - 2, y2: top + Hp + gap + Hd, class: "tl-spot" }, svg);
      const label = F.px(S);
      const pw = label.length * 6.6 + 14;
      s("rect", { x: sx - pw / 2, y: 2, width: pw, height: 18, rx: 9, class: "tl-spotpill" }, svg);
      s("text", { x: sx, y: 15, text: label, "text-anchor": "middle", class: "tx-ink tx-b" }, svg);
    }
    const bes = res ? res.breakevens : mf && mf.prof ? mf.prof.breakevens : [];
    for (const b of bes || []) if (b >= ser.d0 && b <= ser.d1) C.marker(svg, "ring", x(b), zy, UI.cssVar("--label-1"), 4.5);
    const tags = [];
    const vals = ser.exp.map((p) => p[1]);
    const hiV = Math.max(...vals), loV = Math.min(...vals);
    const pu = res ? res.profitUnbounded : mf && mf.prof && mf.prof.profitUnbounded;
    const lu = res ? res.lossUnbounded : mf && mf.prof && mf.prof.lossUnbounded;
    tags.push({ y: y(hiV), text: pu ? "Unbounded" : F.money(hiV, true), tone: "up" });
    tags.push({ y: y(loV), text: lu ? "Unbounded" : F.money(loV, true), tone: "down" });
    if (ser.today && ser.today.length) {
      const nearS = S === null ? ser.today[ser.today.length - 1] : ser.today.reduce((b, p) => (Math.abs(p[0] - S) < Math.abs(b[0] - S) ? p : b), ser.today[0]);
      tags.push({ y: y(nearS[1]), text: F.money(nearS[1], true), tone: "accent", now: true });
    }
    C.spread(tags, 15, top + 6, top + Hp - 2);
    for (const t of tags) s("text", { x: w - right + 10, y: t.y + 4, text: t.text, class: "tx-b " + (t.now ? "tl-tag-now" : t.tone === "up" ? "tl-tag-up" : "tl-tag-dn") }, svg);
    if (hasD) {
      const base = top + Hp + gap + Hd;
      for (const [a, b] of intervals || []) {
        const xa = x(Math.max(ser.d0, a)), xb = x(b === null ? ser.d1 : Math.min(ser.d1, b));
        if (xb - xa > 0.5) s("rect", { x: xa, y: base - Hd, width: xb - xa, height: Hd, class: "tl-zone" }, svg);
      }
      const yd = C.lin(0, 1.05, base, base - Hd);
      const area = (pts, cls) => {
        const Pp = pts.map((p) => [x(p[0]), yd(p[1])]);
        const pth = C.monoPath(Pp);
        s("path", { d: pth + `L${Pp[Pp.length - 1][0].toFixed(1)} ${base}L${Pp[0][0].toFixed(1)} ${base}Z`, class: cls + "-f fade" }, svg);
        s("path", { d: pth, class: "ln " + cls }, svg);
      };
      area(ser.dq, "tl-dq");
      if (ser.dp) area(ser.dp, "tl-dp");
      s("line", { x1: left, x2: w - right, y1: base, y2: base, class: "hair" }, svg);
      s("text", { x: w - right + 10, y: base - Hd / 2 + 4, text: "Density", class: "tx-3" }, svg);
    }
    for (const t of C.niceTicks(ser.d0, ser.d1, phone ? 4 : 7)) {
      const tx = x(t);
      if (tx < left + 12 || tx > w - right - 12) continue;
      s("text", { x: tx, y: H - 5, text: kf(t), "text-anchor": "middle" }, svg);
    }
    const xsAll = ser.today && ser.today.length ? ser.today.map((p) => p[0]) : ser.exp.map((p) => p[0]);
    C.scrub(box, svg, {
      xs: xsAll.map(x), top, bottom: top + Hp, label: "Payoff",
      onMove: (i) => {
        const X = xsAll[i];
        const e = expAt(ser.exp, X);
        const tv = ser.today && ser.today[i] ? ser.today[i][1] : null;
        const dots = [{ x: x(X), y: y(e), color: e >= 0 ? "--up" : "--down" }];
        if (tv !== null) dots.push({ x: x(X), y: y(tv), color: "--accent" });
        return {
          dots, top: 0,
          parts: [C.part("At " + kf(+X.toFixed(2)), "k"), C.part("Expiry", "k"), h("b", { "data-tone": e > 0 ? "up" : e < 0 ? "down" : null }, F.money(e, true)),
            tv === null ? null : C.part("Today", "k"), tv === null ? null : h("b", { "data-tone": tv > 0 ? "up" : tv < 0 ? "down" : null }, F.money(tv, true))],
        };
      },
    });
    st.x = x;
    st.plotW = w;
    placeHandles(ser);
  }

  function smooth(pts) {
    let v = pts.map((p) => p[1]);
    for (let k = 0; k < 2; k++) v = v.map((y, i) => (i === 0 || i === v.length - 1 ? y : (v[i - 1] + 2 * y + v[i + 1]) / 4));
    const m = Math.max(...v) || 1;
    return pts.map((p, i) => [p[0], v[i] / m]);
  }

  function expAt(pts, X) {
    for (let i = 1; i < pts.length; i++) {
      if (X <= pts[i][0]) { const a = pts[i - 1], b = pts[i]; const t = (X - a[0]) / ((b[0] - a[0]) || 1); return a[1] + t * (b[1] - a[1]); }
    }
    return pts[pts.length - 1][1];
  }

  function profitIntervals(r) {
    if (st.mf && st.mf.prof) return st.mf.prof.profitIntervals;
    const c = r.curves;
    if (!c) return [];
    const out = [];
    let a = null;
    for (let i = 0; i < c.x.length; i++) {
      const p = c.expiry[i] > 0;
      if (p && a === null) a = c.x[i];
      if (!p && a !== null) { out.push([a, c.x[i]]); a = null; }
    }
    if (a !== null) out.push([a, null]);
    return out;
  }

  function placeHandles(ser) {
    const m = st.mods;
    if (!m) return;
    const legs = st.legs.map((l, i) => ({ l, i })).filter((o) => o.l.type !== "S");
    if (!ser || !st.x) { m.rail.replaceChildren(); return; }
    const have = new Map([...m.rail.children].map((n) => [n.dataset.leg, n]));
    const keep = new Set();
    const lanes = [];
    const sorted = legs.slice().sort((a, b) => a.l.K - b.l.K || a.i - b.i);
    for (const o of sorted) {
      const key = String(o.i);
      keep.add(key);
      let b = have.get(key);
      if (!b) {
        b = h("button", { type: "button", class: "tl-handle", role: "slider", "data-leg": key });
        b.addEventListener("pointerdown", (e) => startDrag(e, b));
        b.addEventListener("keydown", (e) => keyDrag(e, b));
        m.rail.append(b);
      }
      const l = o.l;
      const ks = strikesFor(l);
      const txt = (l.side > 0 ? "+" : MINUS) + (l.qty > 1 ? l.qty : "") + l.type + " " + kf(l.K);
      if (b.dataset.text !== txt) { b.dataset.text = txt; b.replaceChildren(h("span", null, txt)); }
      b.dataset.side = l.side > 0 ? "long" : "short";
      b.dataset.type = l.type;
      b.setAttribute("aria-label", legName(l) + " strike");
      b.setAttribute("aria-valuenow", String(l.K));
      b.setAttribute("aria-valuetext", kf(l.K) + " " + (l.type === "C" ? "call" : "put"));
      if (ks.length) { b.setAttribute("aria-valuemin", String(ks[0])); b.setAttribute("aria-valuemax", String(ks[ks.length - 1])); }
      const px = st.x(Math.min(ser.d1, Math.max(ser.d0, l.K)));
      if (!(st.drag && st.drag.b === b)) b.style.setProperty("--x", px.toFixed(1) + "px");
      const wpx = txt.length * 7 + 22;
      let lane = 0;
      while (lanes[lane] !== undefined && px - wpx / 2 < lanes[lane] + 4) lane++;
      lanes[lane] = px + wpx / 2;
      b.style.setProperty("--lane", String(lane));
    }
    for (const [k, n] of have) if (!keep.has(k)) n.remove();
    m.rail.style.setProperty("--lanes", String(Math.max(1, lanes.length)));
  }

  function snapTo(l, K) {
    const ks = strikesFor(l).filter((k) => !st.domain || (k >= st.domain[0] && k <= st.domain[1]));
    if (!ks.length) return l.K;
    return ks.reduce((b, k) => (Math.abs(k - K) < Math.abs(b - K) ? k : b), ks[0]);
  }

  function setStrike(i, K) {
    const l = st.legs[i];
    if (!l || K === l.K) return false;
    l.K = K;
    st.moved = true;
    price();
    fillModules(true);
    writeURL();
    return true;
  }

  function startDrag(e, b) {
    if (e.button !== 0 || !st.x) return;
    const i = Number(b.dataset.leg);
    const l = st.legs[i];
    if (!l) return;
    e.preventDefault();
    domainOf();
    st.drag = { b, i };
    b.classList.add("is-drag");
    try { b.focus({ preventScroll: true }); } catch { b.focus(); }
    try { b.setPointerCapture(e.pointerId); } catch { b.focus(); }
    const rail = st.mods.rail.getBoundingClientRect();
    const move = (ev) => {
      const px = Math.max(st.x(st.domain[0]), Math.min(st.x(st.domain[1]), ev.clientX - rail.left));
      b.style.setProperty("--x", px.toFixed(1) + "px");
      const K = snapTo(l, st.x.inv(px));
      if (K !== l.K) setStrike(i, K);
    };
    const stop = () => {
      b.removeEventListener("pointermove", move);
      b.removeEventListener("pointerup", stop);
      b.removeEventListener("pointercancel", stop);
      b.classList.remove("is-drag");
      st.drag = null;
      st.domain = null;
      paintTiles();
      if (st.mods.chartRec) st.mods.chartRec.redraw(false);
      UI.announce(legName(l) + " strike " + kf(l.K));
    };
    b.addEventListener("pointermove", move);
    b.addEventListener("pointerup", stop);
    b.addEventListener("pointercancel", stop);
  }

  function keyDrag(e, b) {
    const i = Number(b.dataset.leg);
    const l = st.legs[i];
    if (!l) return;
    const ks = strikesFor(l);
    const j = ks.indexOf(l.K);
    let k = null;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") k = ks[Math.min(ks.length - 1, j + 1)];
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") k = ks[Math.max(0, j - 1)];
    else if (e.key === "PageUp") k = ks[Math.min(ks.length - 1, j + 5)];
    else if (e.key === "PageDown") k = ks[Math.max(0, j - 5)];
    if (k === null || k === undefined) return;
    e.preventDefault();
    st.domain = null;
    if (setStrike(i, k)) UI.announce(legName(l) + " strike " + kf(k));
  }

  function payoffInfo() {
    const mf = st.mf;
    const node = h("div");
    if (mf && mf.prof && mf.norm) {
      const S = spot();
      const pts = [];
      const push = (x, what) => {
        if (!(x >= 0)) return;
        const seen = pts.find((p) => Math.abs(p.x - x) < 1e-9);
        if (seen) { if (!seen.what.includes(what)) seen.what.push(what); return; }
        pts.push({ x, what: [what] });
      };
      push(0, "the underlying at zero");
      for (const l of mf.norm) if (l.type !== "S") push(l.K, "a strike");
      for (const b0 of mf.prof.breakevens) push(b0, "breakeven");
      if (S !== null) push(S, "spot today");
      pts.sort((a, b) => a.x - b.x);
      node.append(h("table", { class: "tl-pts" }, h("caption", null, "Profit and loss at expiry at each turning point; between two rows it is a straight line."),
        h("thead", null, h("tr", null, h("th", { scope: "col" }, "Underlying"), h("th", { scope: "col" }, "P&L"), h("th", { scope: "col" }, "What it is"))),
        h("tbody", null, pts.map((p) => h("tr", null, h("th", { scope: "row" }, "$" + kf(p.x)), h("td", null, usd((Q.payoffValue(mf.norm, p.x) - mf.cost) * LOT, true)), h("td", null, p.what.join(", ")))))));
    }
    const es = engineState();
    const lu = mf && mf.prof && mf.prof.lossUnbounded, pu = mf && mf.prof && mf.prof.profitUnbounded;
    return {
      title: "Payoff", state: es.state === "ok" ? null : es.state,
      lead: T("payoff"),
      facts: [["Priced at", st.basis === "fill" ? "Fill: the mid plus a quarter of the spread" : st.basis === "mid" ? "The mid of each leg" : "Natural: ask on buys, bid on sells"],
        ["Lot", "100 shares per contract"]],
      sections: [
        { title: "Exact", lines: [T("payoff-exact")] },
        { title: "Today", lines: [T("payoff-today")] },
        { title: "Bounds", lines: [pu ? T("payoff-pu") : null,
          lu ? T("payoff-lu") : null,
          mf && mf.prof && !lu && mf.prof.maxLossAt && mf.prof.maxLossAt.length === 1 && mf.prof.maxLossAt[0][0] === 0 && mf.prof.maxLossAt[0][1] === 0 ? T("payoff-put") : null] },
        { title: "Drag", lines: [T("payoff-drag")] },
      ],
      notes: [es.state !== "ok" ? es.reason : null],
      node,
    };
  }

  function oddsInfo() {
    const r = st.res;
    const es = engineState();
    const p = r ? r.prob : {};
    const e = r ? r.ev : {};
    return {
      title: "Odds", state: es.state === "ok" ? null : es.state,
      lead: T("odds"),
      facts: r ? [
        ["Implied", pct(p.popQ, 1)], ["Real world", p.popP === null ? DASH : pct(p.popP, 1)],
        ["Max profit, implied", pct(p.pMaxProfitQ, 1)], ["Max profit, real world", p.pMaxProfitP === null ? DASH : pct(p.pMaxProfitP, 1)],
        ["Max loss, implied", pct(p.pMaxLossQ, 1)], ["Max loss, real world", p.pMaxLossP === null ? DASH : pct(p.pMaxLossP, 1)],
        ["Short strike touched, implied", (p.touchShortQ || []).map((v) => pct(v, 0)).join("  ") || DASH],
        ["EV at natural, real world", usd(e.pNatural, true)],
        ["EV range across laws", e.pBand ? usd(e.pBand[0], true) + " to " + usd(e.pBand[2], true) : DASH],
        ["Tail, worst 5%", r.tail ? usd(r.tail.cvar5P, true) : DASH],
        ["Grade", r.grade + " of 3" + (r.gradeWhy && r.gradeWhy.length ? " " + UI.MID + " " + r.gradeWhy.join(", ") : "")],
      ] : [],
      sections: [
        { title: "Expected value", lines: [T("odds-ev")] },
        { title: "Grade", lines: [T("odds-grade")] },
      ],
      notes: [es.state !== "ok" ? es.reason : r && p.popP === null ? "No real-world figure: " + lawWhy() + "." : null],
    };
  }

  function greeksInfo() {
    const r = st.res;
    const g = r ? r.greeks : null;
    const c = st.ctx || {};
    const S = spot(), beta = num(c.beta), idx = c.index ? num(c.index.spot) : null;
    const sh = g && S ? g.delta$ / S : null;
    const bw = sh !== null && beta !== null && idx !== null && idx > 0 ? sh * beta * (S / idx) : null;
    const idxName = (c.index && c.index.symbol) || "the index";
    return {
      title: "Greeks", state: r ? null : engineState().state,
      lead: T("greeks"),
      facts: g ? [
        ["Delta", usd(g.delta$, true) + " " + UI.MID + " " + (sh === null ? DASH : sg(sh) + Math.abs(sh).toFixed(1) + " share-equivalents")],
        ["Delta, smile-adjusted", usd(g.deltaAdj$, true)],
        ["Beta-weighted delta", bw === null ? DASH : sg(bw) + Math.abs(bw).toFixed(1) + " " + idxName + " share-equivalents"],
        ["Gamma", usd(g.gamma$1pct, true) + " of delta per 1% move"], ["Vega", usd(g.vegaPt, true) + " per volatility point"],
        ["Theta", usd(g.thetaDay, true) + " per day"], ["Vanna", usd(g.vannaPt$, true) + " of delta per vol point"], ["Charm", usd(g.charmDay$, true) + " of delta per day"],
        ["Capital", r.capital ? usd(r.capital.value) + " " + UI.MID + " " + r.capital.kind : DASH],
      ] : [],
      sections: [{
        title: "Beta-weighted delta",
        lines: [bw === null
          ? T("greeks-bw")
          : "delta × beta × (this name's price ÷ " + idxName + "'s price) = " + sg(sh) + Math.abs(sh).toFixed(1) + " × " + beta.toFixed(2) + " × (" + F.px(S) + " ÷ " + F.px(idx) + "). Weighted to " + idxName + "; against a different index it is a different number."],
      }, { title: "Return", lines: [T("greeks-ror")] }],
    };
  }

  function scenarioInfo() {
    const r = st.res;
    return {
      title: "Scenarios", state: r && r.grid ? null : engineState().state,
      lead: T("scen"),
      facts: r && r.grid ? [["Spot rows", r.grid.spot.length + (r.grid.spot.length > 7 ? " (walls and the flip where they fall inside two sigma)" : "")], ["Days", r.grid.days.join(", ")]] : [],
      sections: [{ title: "Method", lines: [T("scen-method")] }],
    };
  }

  function legsInfo() {
    return {
      title: "Legs",
      lead: T("legs"),
      facts: [["Mid", T("legs-mid")], ["Fill", T("legs-fill")], ["Natural", T("legs-nat")]],
      notes: [T("legs-link")],
    };
  }

  entry.addEventListener("submit", (e) => {
    e.preventDefault();
    const t = String(input.value || "").trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(t)) {
      status("That is not a symbol this page accepts: one to ten characters, starting with a letter.", "unavailable");
      input.setAttribute("aria-invalid", "true");
      return;
    }
    input.removeAttribute("aria-invalid");
    if (t === st.t && st.ctx) { st.books.clear(); st.setupKey = ""; loadContext(true); return; }
    Object.assign(st, { t, ctx: null, ctxErr: null, expiry: "", back: "", legs: [], urlLegs: null, setup: null, setupKey: "", res: null, mf: null, why: null, tileShown: false, expShown: false, moved: false });
    if (st.custom) { st.custom = false; st.family = null; st.userFamily = false; }
    else if (st.engineFamily) { st.family = null; st.engineFamily = false; }
    st.books.clear(); st.bookErr.clear(); st.pending.clear();
    loadContext(false);
  });

  let rz = 0;
  window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { st.domain = null; }, 120); });
  setInterval(() => { if (st.ctx) paintHero(); }, 30000);

  readURL();
  paint();
  if (st.t) loadContext(false);
})();
