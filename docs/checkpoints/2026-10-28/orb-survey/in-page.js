(() => {
  "use strict";
  if (window.__orbSurvey) return;

  const SVGNS = "http://www.w3.org/2000/svg";
  const CONTROL_SEL = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="tab"], [role="link"], [role="switch"], [role="checkbox"], [role="option"]';
  const MARKS = new Set(["path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "use", "image"]);
  const CHROME_SEL = "#fxTabs, #fxBar, #fxSide, #fxScrim, #askDock, .flows-skip, #nnScreen";
  const SKIP_TEXT = "script, style, template, noscript, title, #fxOracle, #__orbProbe";
  const PART_ORDER = ["badge", "orb", "pill", "toast", "undo", "restore"];

  const r1 = (n) => Math.round(n * 10) / 10;
  const hostEl = () => document.getElementById("fxOracle");

  function shown(e) {
    if (!e || !e.isConnected || e.hidden) return false;
    const r = e.getBoundingClientRect();
    if (r.width < 0.5 || r.height < 0.5) return false;
    if (typeof e.checkVisibility === "function" && !e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    return true;
  }

  function isControl(e) {
    if (!e || e.nodeType !== 1) return false;
    if (e.matches(CONTROL_SEL)) return true;
    const ti = e.getAttribute("tabindex");
    if (ti !== null && ti.trim() !== "" && Number.isFinite(Number(ti)) && Number(ti) >= 0) return true;
    return false;
  }

  function controlAncestor(e) {
    for (let n = e && e.parentElement; n; n = n.parentElement) if (isControl(n)) return n;
    return null;
  }

  function alphaOf(c) {
    if (!c || c === "transparent") return 0;
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return 1;
    const parts = m[1].split(/[ ,/]+/).filter(Boolean);
    if (parts.length < 4) return 1;
    const a = parts[3];
    return a.endsWith("%") ? parseFloat(a) / 100 : parseFloat(a);
  }

  function painted(e) {
    const cs = getComputedStyle(e);
    if (alphaOf(cs.backgroundColor) >= 0.06) return true;
    if (cs.backgroundImage && cs.backgroundImage !== "none") return true;
    const bw = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderRightWidth) + parseFloat(cs.borderBottomWidth) + parseFloat(cs.borderLeftWidth);
    if (bw > 0 && Math.max(alphaOf(cs.borderTopColor), alphaOf(cs.borderLeftColor), alphaOf(cs.borderBottomColor)) >= 0.15) return true;
    return false;
  }

  function outerSvg(e) {
    let svg = e.ownerSVGElement || e.closest("svg");
    while (svg && svg.ownerSVGElement) svg = svg.ownerSVGElement;
    return svg;
  }

  function classify(e) {
    if (isControl(e)) return { kind: "control", sub: e.getAttribute("role") || e.localName };
    if (e.localName === "canvas") return { kind: "graphic", sub: "canvas" };
    if (e.namespaceURI === SVGNS && MARKS.has(e.localName)) return { kind: "graphic", sub: "svg", owner: outerSvg(e) || e };
    if (e.localName === "img" || e.localName === "video") return { kind: "graphic", sub: e.localName };
    if (e.namespaceURI !== SVGNS && e.childElementCount === 0 && !(e.textContent || "").trim() && !["br", "wbr", "html", "body", "head"].includes(e.localName)) {
      const r = e.getBoundingClientRect();
      if (r.width * r.height < 0.25 * innerWidth * innerHeight && painted(e)) return { kind: "graphic", sub: "box" };
    }
    return null;
  }

  function short(e) {
    if (!e || e.nodeType !== 1) return "";
    let s = e.localName;
    if (e.id) s += "#" + e.id;
    const cls = typeof e.className === "string" ? e.className : e.className && e.className.baseVal;
    if (cls && cls.trim()) s += "." + cls.trim().split(/\s+/).slice(0, 2).join(".");
    return s;
  }

  function selOf(e) {
    const out = [];
    for (let n = e, i = 0; n && n.nodeType === 1 && i < 4; n = n.parentElement, i++) {
      out.unshift(short(n));
      if (n.id) break;
    }
    return out.join(" > ");
  }

  const clean = (t, n = 90) => {
    const s = String(t || "").replace(/\s+/g, " ").trim();
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  };

  function nameOf(e) {
    const al = e.getAttribute("aria-label");
    if (al && al.trim()) return clean(al);
    const lb = e.getAttribute("aria-labelledby");
    if (lb) {
      const t = lb.split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean).map((n) => n.textContent).join(" ");
      if (t.trim()) return clean(t);
    }
    if (e.localName === "input" || e.localName === "textarea" || e.localName === "select") {
      const lab = e.labels && e.labels[0] ? e.labels[0].textContent : "";
      return clean(lab || e.getAttribute("placeholder") || e.value || e.name || e.type);
    }
    if (e.localName === "img") return clean(e.getAttribute("alt") || (e.getAttribute("src") || "").split("/").pop());
    const t = e.innerText !== undefined ? e.innerText : e.textContent;
    if (t && t.trim()) return clean(t);
    const title = e.getAttribute("title");
    if (title && title.trim()) return clean(title);
    return "";
  }

  function graphicLabel(e, sub) {
    if (sub === "box") {
      const p = e.parentElement;
      const near = p ? clean(p.getAttribute("aria-label") || p.getAttribute("title") || (p.innerText || ""), 50) : "";
      return "painted box " + short(e) + (near ? " in “" + near + "”" : "");
    }
    if (sub === "canvas" || sub === "img" || sub === "video") {
      let lab = e.getAttribute("aria-label") || e.getAttribute("title") || "";
      for (let n = e.parentElement; !lab && n && n !== document.body; n = n.parentElement) {
        lab = n.getAttribute("aria-label") || (n.id ? "#" + n.id : "");
      }
      return sub + " " + clean(lab, 60);
    }
    const svg = e.localName === "svg" ? e : outerSvg(e);
    let lab = "";
    const uses = svg ? svg.querySelectorAll("use") : [];
    const marks = svg ? svg.querySelectorAll("path, rect, circle, ellipse, line, polyline, polygon, use, image").length : 0;
    if (uses.length === 1 && marks === 1) lab = "icon " + (uses[0].getAttribute("href") || uses[0].getAttribute("xlink:href") || "");
    const t = svg && svg.querySelector(":scope > title");
    if (!lab && t) lab = t.textContent;
    if (svg) {
      lab = lab || svg.getAttribute("aria-label") || "";
      for (let n = svg.parentElement; !lab && n && n !== document.body; n = n.parentElement) lab = n.getAttribute("aria-label") || (n.id ? "#" + n.id : "");
    }
    return "svg" + (marks ? " (" + marks + " marks)" : "") + (lab ? " " + clean(lab, 60) : "");
  }

  function radiusOf(el, w, h) {
    const cs = getComputedStyle(el);
    const v = cs.borderTopLeftRadius || "0px";
    let r = parseFloat(v);
    if (v.endsWith("%")) r = Math.min(w, h) * r / 100;
    if (!Number.isFinite(r)) r = 0;
    return Math.min(r, w / 2, h / 2);
  }

  function partBox(part, el, extra) {
    const b = el.getBoundingClientRect();
    return Object.assign({ part, x: r1(b.left), y: r1(b.top), w: r1(b.width), h: r1(b.height), radius: r1(radiusOf(el, b.width, b.height)) }, extra || {});
  }

  function parts() {
    const h = hostEl();
    if (!h || h.hidden) return [];
    const out = [];
    const orb = h.querySelector(".orc-orb");
    if (shown(orb)) {
      const disc = orb.querySelector(".orc-disc");
      const gl = disc ? disc.querySelector("canvas") : null;
      out.push(partBox("orb", orb, { webgl: !!(gl && gl.width > 2) }));
    }
    const pill = h.querySelector(".orc-pill");
    if (pill && h.classList.contains("has-pill") && shown(pill)) out.push(partBox("pill", pill, { text: clean(pill.textContent, 60) }));
    const badge = h.querySelector(".orc-badge");
    if (shown(badge)) out.push(partBox("badge", badge, { text: badge.textContent }));
    const restore = h.querySelector(".orc-restore");
    if (shown(restore)) out.push(partBox(restore.classList.contains("is-undo") ? "undo" : "restore", restore, { text: clean(restore.textContent, 40) }));
    const toast = h.querySelector(".orc-toast");
    if (shown(toast)) out.push(partBox("toast", toast, { text: clean(toast.textContent, 60) }));
    return out;
  }

  const MSG = (ticker, kind) => ({ id: "orb-survey-" + ticker, ticker, kind, strength: 3, at: Date.now(), say: ticker + " drew flagged flow in one expiry.", facts: [] });

  function drive(state, o) {
    const H = window.__orcHook;
    if (!H) throw new Error("the Neuron hook is not installed");
    const S = H.S;
    const opts = o || {};
    H.dropToast();
    if (S.open) H.setOpen(false);
    S.msgs = [];
    S.undoUntil = 0;
    S.pref = "on";
    if (state === "pill" || state === "badge" || state === "toast") S.msgs = [MSG(opts.ticker || "GOOGL", opts.kind || "cluster")];
    if (state === "badge") S.pref = "quiet";
    if (state === "undo") { S.pref = "off"; S.undoUntil = Date.now() + 10000; }
    if (state === "restore") S.pref = "off";
    H.paint();
    const h = hostEl();
    const pill = h && h.querySelector(".orc-pill");
    if (state === "pill" && pill && opts.pillWidth) pill.style.setProperty("--pw", opts.pillWidth + "px");
    if (state === "toast") H.showToast((opts.ticker || "GOOGL") + " · flow in one expiry");
    return parts();
  }

  function reach() {
    const H = window.__orcHook;
    const S = H ? H.S : null;
    const U = window.FlowsUI || {};
    return {
      hook: !!H,
      flStream: !!(S && typeof S.unsub === "function"),
      rt: !!(U.rt && typeof U.rt.on === "function"),
      pref: S ? S.pref : null,
      route: S ? S.route : null,
      mode: hostEl() ? hostEl().getAttribute("data-oracle") : null,
      coarse: matchMedia("(pointer: coarse)").matches,
      narrow: matchMedia("(max-width: 767.98px)").matches,
      nnOrb: !!(U.nnOrb),
      dockOpen: document.body.classList.contains("has-dock-open"),
    };
  }

  function textRuns(U) {
    const runs = [];
    const range = document.createRange();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (!n.nodeValue || !/\S/.test(n.nodeValue)) return NodeFilter.FILTER_REJECT;
        const p = n.parentElement;
        if (!p || p.closest(SKIP_TEXT)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      range.selectNodeContents(n);
      const b = range.getBoundingClientRect();
      if (b.width <= 0 || b.height <= 0) continue;
      if (b.right <= U.l || b.left >= U.r || b.bottom <= U.t || b.top >= U.b) continue;
      const rects = [];
      for (const r of range.getClientRects()) {
        if (r.width <= 0 || r.height <= 0) continue;
        if (r.right <= U.l || r.left >= U.r || r.bottom <= U.t || r.top >= U.b) continue;
        rects.push([r.left, r.top, r.right, r.bottom]);
      }
      if (!rects.length) continue;
      let a = n.parentElement;
      while (a && a.getClientRects().length === 0) a = a.parentElement;
      if (!a) continue;
      runs.push({ node: n, rects, anchor: a });
    }
    return runs;
  }

  const inRects = (rects, x, y) => {
    for (const r of rects) if (x >= r[0] && x < r[2] && y >= r[1] && y < r[3]) return true;
    return false;
  };

  function insidePart(p, x, y) {
    if (x < p.x || x >= p.x + p.w || y < p.y || y >= p.y + p.h) return false;
    const r = p.radius || 0;
    if (r <= 0) return true;
    const cx = x < p.x + r ? p.x + r : x > p.x + p.w - r ? p.x + p.w - r : x;
    const cy = y < p.y + r ? p.y + r : y > p.y + p.h - r ? p.y + p.h - r : y;
    const dx = x - cx, dy = y - cy;
    return dx * dx + dy * dy <= r * r;
  }

  function enter(U, withProbe) {
    const host = hostEl();
    const style = document.createElement("style");
    style.id = "__orbSurveyStyle";
    style.textContent = "*, *::before, *::after { pointer-events: auto !important; }\n" +
      (withProbe ? "#fxOracle > :not(#__orbProbe) { visibility: hidden !important; }\n#__orbProbe { visibility: visible !important; }\n" : "#fxOracle, #fxOracle * { visibility: hidden !important; }\n");
    document.head.append(style);
    const inert = [...document.querySelectorAll("[inert]")];
    inert.forEach((n) => { n.inert = false; });
    let probe = null;
    if (withProbe && host) {
      const hb = host.getBoundingClientRect();
      probe = document.createElement("div");
      probe.id = "__orbProbe";
      probe.setAttribute("aria-hidden", "true");
      probe.style.cssText = `position:absolute;left:${U.l - hb.left}px;top:${U.t - hb.top}px;width:${U.r - U.l}px;height:${U.b - U.t}px;margin:0;padding:0;border:0;background:transparent;z-index:2147483647;pointer-events:auto;visibility:visible;`;
      host.append(probe);
    }
    return {
      host, probe, inert,
      leave() {
        if (probe) probe.remove();
        style.remove();
        inert.forEach((n) => { n.inert = true; });
      },
    };
  }

  function makeRegistry(env, U) {
    const cache = new Map();
    const items = new Map();
    const cv = new Map();
    let seq = 0;
    const dimmed = (e) => env.inert.some((n) => n.contains(e));
    const owners = new Map();
    function itemOf(e) {
      if (cache.has(e)) return cache.get(e);
      let info = null;
      const k = classify(e);
      if (k && (typeof e.checkVisibility !== "function" || e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))) {
        const host = k.owner || e;
        info = owners.get(host) || null;
        if (!info) {
          const ctl = k.kind === "control" ? null : controlAncestor(host);
          info = {
            key: "e" + seq++, kind: k.kind, sub: k.sub,
            label: k.kind === "control" ? nameOf(host) : graphicLabel(host, k.sub),
            sel: selOf(host), chrome: !!host.closest(CHROME_SEL), inControl: !!ctl, control: ctl ? selOf(ctl) : null, dimmed: dimmed(host), el: host,
          };
          owners.set(host, info);
          items.set(info.key, info);
        }
      }
      cache.set(e, info);
      return info;
    }
    function canvasPainted(c, x, y) {
      let d = cv.get(c);
      if (!d) {
        d = { ok: false };
        try {
          const ctx = c.getContext("2d");
          if (ctx) {
            const r = c.getBoundingClientRect();
            const sx = c.width / r.width, sy = c.height / r.height;
            const x0 = Math.max(0, Math.floor((U.l - r.left) * sx)), y0 = Math.max(0, Math.floor((U.t - r.top) * sy));
            const x1 = Math.min(c.width, Math.ceil((U.r - r.left) * sx)), y1 = Math.min(c.height, Math.ceil((U.b - r.top) * sy));
            if (x1 > x0 && y1 > y0) d = { ok: true, r, sx, sy, x0, y0, w: x1 - x0, h: y1 - y0, data: ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data };
            else d = { ok: true, empty: true };
          }
        } catch (e) { d = { ok: false }; }
        cv.set(c, d);
      }
      if (!d.ok) return null;
      if (d.empty) return false;
      const px = Math.floor((x - d.r.left) * d.sx) - d.x0, py = Math.floor((y - d.r.top) * d.sy) - d.y0;
      if (px < 0 || py < 0 || px >= d.w || py >= d.h) return false;
      return d.data[(py * d.w + px) * 4 + 3] > 8;
    }
    return { itemOf, items, canvasPainted, cvState: (c) => cv.get(c) };
  }

  function coveredText(run, bb) {
    const n = run.node, s = n.nodeValue;
    const range = document.createRange();
    let out = "";
    const lim = Math.min(s.length, 2000);
    for (let i = 0; i < lim; i++) {
      range.setStart(n, i);
      range.setEnd(n, i + 1);
      const r = range.getBoundingClientRect();
      if (r.width <= 0 && r.height <= 0) continue;
      const ow = Math.min(r.right, bb.r) - Math.max(r.left, bb.l), oh = Math.min(r.bottom, bb.b) - Math.max(r.top, bb.t);
      if (ow > 0 && oh > 0 && ow * oh >= 0.25 * Math.max(1, r.width * r.height)) out += s[i];
    }
    return clean(out, 90);
  }

  function sample(spec) {
    const step = spec.step || 2;
    const states = spec.states || {};
    let L = Infinity, T = Infinity, R = -Infinity, B = -Infinity;
    for (const ps of Object.values(states)) for (const p of ps) {
      L = Math.min(L, p.x); T = Math.min(T, p.y); R = Math.max(R, p.x + p.w); B = Math.max(B, p.y + p.h);
    }
    if (!Number.isFinite(L)) return { states: {}, points: 0 };
    L = Math.max(0, Math.floor(L)); T = Math.max(0, Math.floor(T));
    R = Math.min(innerWidth, Math.ceil(R)); B = Math.min(innerHeight, Math.ceil(B));
    const U = { l: L, t: T, r: R, b: B };
    const t0 = performance.now();
    const env = enter(U, true);
    const reg = makeRegistry(env, U);
    const runInfo = new Map();
    const prof = { text: 0, hit: 0, points: 0 };
    const all = [].concat(...Object.values(states));
    const pts = [];
    let unprobed = 0;
    try {
      const runs = textRuns(U);
      runs.forEach((run, i) => {
        const ctl = controlAncestor(run.node.parentElement) || (isControl(run.node.parentElement) ? run.node.parentElement : null);
        runInfo.set("t" + i, {
          key: "t" + i, kind: "text", sub: run.anchor.namespaceURI === SVGNS ? "svg text" : "text", run,
          label: clean(run.node.nodeValue, 90), sel: selOf(run.anchor), chrome: !!run.anchor.closest(CHROME_SEL),
          inControl: !!ctl, control: ctl ? selOf(ctl) : null, dimmed: env.inert.some((n) => n.contains(run.anchor)),
        });
      });
      prof.text = performance.now() - t0;
      for (let y = T + step / 2; y < B; y += step) {
        for (let x = L + step / 2; x < R; x += step) {
          if (!all.some((p) => insidePart(p, x, y))) continue;
          const th = performance.now();
          const stack = document.elementsFromPoint(x, y);
          prof.hit += performance.now() - th;
          prof.points++;
          const pi = env.probe ? stack.indexOf(env.probe) : -1;
          if (pi < 0) { unprobed++; continue; }
          const hits = [];
          const seen = new Set();
          for (let i = 0; i < stack.length; i++) {
            if (i === pi) continue;
            const e = stack[i];
            if (env.host && env.host.contains(e)) continue;
            const info = reg.itemOf(e);
            if (!info || seen.has(info.key)) continue;
            if (info.sub === "canvas" && reg.canvasPainted(e, x, y) === false) continue;
            seen.add(info.key);
            hits.push(info.key, i < pi ? 1 : 0);
          }
          runs.forEach((run, i) => {
            if (!inRects(run.rects, x, y)) return;
            const ai = stack.indexOf(run.anchor);
            if (ai < 0) return;
            hits.push("t" + i, ai < pi ? 1 : 0);
          });
          if (hits.length) pts.push(x, y, hits);
        }
      }
    } finally {
      env.leave();
    }
    const area = step * step;
    const out = {};
    for (const [state, ps] of Object.entries(states)) {
      const ordered = ps.slice().sort((a, b) => PART_ORDER.indexOf(a.part) - PART_ORDER.indexOf(b.part));
      const acc = new Map();
      for (let k = 0; k < pts.length; k += 3) {
        const x = pts[k], y = pts[k + 1], hits = pts[k + 2];
        const owner = ordered.find((p) => insidePart(p, x, y));
        if (!owner) continue;
        for (let j = 0; j < hits.length; j += 2) {
          const id = owner.part + "|" + hits[j] + "|" + hits[j + 1];
          let a = acc.get(id);
          if (!a) { a = { part: owner.part, key: hits[j], over: hits[j + 1], n: 0, l: x, t: y, r: x, b: y }; acc.set(id, a); }
          a.n++;
          if (x < a.l) a.l = x; if (x > a.r) a.r = x; if (y < a.t) a.t = y; if (y > a.b) a.b = y;
        }
      }
      const rows = [];
      for (const a of acc.values()) {
        const info = a.key[0] === "t" ? runInfo.get(a.key) : reg.items.get(a.key);
        if (!info) continue;
        const bb = { l: a.l - step / 2, t: a.t - step / 2, r: a.r + step / 2, b: a.b + step / 2 };
        const row = {
          part: a.part, kind: info.kind, sub: info.sub, label: info.label, sel: info.sel, layer: a.over ? "over" : "under",
          area: a.n * area, box: { x: r1(bb.l), y: r1(bb.t), w: r1(bb.r - bb.l), h: r1(bb.b - bb.t) },
          chrome: info.chrome, inControl: info.inControl, control: info.control, dimmed: info.dimmed,
        };
        if (info.kind === "text") row.covered = coveredText(info.run, bb);
        if (info.sub === "canvas") {
          const st = reg.cvState(info.el);
          row.painted = st && st.ok ? "measured" : "unknown";
        }
        rows.push(row);
      }
      rows.sort((a, b) => b.area - a.area);
      out[state] = { parts: ps, hits: rows };
    }
    return { states: out, region: U, step, points: prof.points, unprobed, ms: Math.round(performance.now() - t0), prof: { text: Math.round(prof.text), hit: Math.round(prof.hit) } };
  }

  function occupied(stack, runsAt, env, reg) {
    let content = null, surface = null;
    for (const e of stack) {
      if (env.host && env.host.contains(e)) continue;
      if (e === document.documentElement || e === document.body) continue;
      if (e.closest(CHROME_SEL)) continue;
      if (!content) {
        const info = reg.itemOf(e);
        if (info) content = info;
      }
      if (!surface) {
        const r = e.getBoundingClientRect();
        if (r.width * r.height < 0.85 * innerWidth * innerHeight && painted(e) &&
            (typeof e.checkVisibility !== "function" || e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))) surface = { sel: selOf(e) };
      }
      if (content && surface) break;
    }
    if (!content) {
      for (const run of runsAt) {
        if (run.anchor.closest(CHROME_SEL)) continue;
        if (stack.indexOf(run.anchor) >= 0) { content = { kind: "text", sub: "text", label: clean(run.node.nodeValue, 90), sel: selOf(run.anchor) }; break; }
      }
    }
    return { content, surface };
  }

  function corner(o) {
    const opts = o || {};
    const vw = innerWidth, vh = innerHeight;
    let cx = vw, cy = vh;
    const tabs = document.getElementById("fxTabs");
    if (tabs && shown(tabs)) cy = Math.min(cy, tabs.getBoundingClientRect().top);
    const dock = document.querySelector(".ak-dock.is-open .ak-dock-panel");
    if (dock && shown(dock) && !matchMedia("(max-width: 1199.98px)").matches) cx = Math.min(cx, dock.getBoundingClientRect().left);
    const RW = Math.min(cx, opts.width || 720), RH = Math.min(cy, opts.height || 480);
    const U = { l: cx - RW, t: cy - RH, r: cx, b: cy };
    const t0 = performance.now();
    const env = enter(U, false);
    const reg = makeRegistry(env, U);
    const best = { d: Infinity, s: Infinity, near: null, free: null, sd: Infinity, ss: Infinity, surf: null, surfS: null, vd: Infinity, vs: Infinity, vnear: null };
    try {
      const runs = textRuns(U);
      let calls = 0;
      const scan = (l, t, r, b, step, keep) => {
        for (let y = t + step / 2; y < b; y += step) {
          for (let x = l + step / 2; x < r; x += step) {
            if (keep && !keep(x, y)) continue;
            calls++;
            const stack = document.elementsFromPoint(x, y);
            const at = runs.filter((run) => inRects(run.rects, x, y));
            const { content, surface } = occupied(stack, at, env, reg);
            const dx = cx - x, dy = cy - y;
            const d = Math.hypot(dx, dy), s = Math.max(dx, dy);
            const vdx = vw - x, vdy = vh - y, vd = Math.hypot(vdx, vdy), vs = Math.max(vdx, vdy);
            if (content) {
              if (vd < best.vd) { best.vd = vd; best.vnear = { x: r1(x), y: r1(y), dx: r1(vdx), dy: r1(vdy), kind: content.kind, sub: content.sub, label: content.label, sel: content.sel }; }
              if (vs < best.vs) best.vs = vs;
              if (d < best.d) { best.d = d; best.near = { x: r1(x), y: r1(y), dx: r1(dx), dy: r1(dy), kind: content.kind, sub: content.sub, label: content.label, sel: content.sel }; }
              if (s < best.s) { best.s = s; best.free = { x: r1(x), y: r1(y), kind: content.kind, sub: content.sub, label: content.label, sel: content.sel }; }
            }
            if (surface) {
              if (d < best.sd) { best.sd = d; best.surf = { x: r1(x), y: r1(y), sel: surface.sel }; }
              if (s < best.ss) { best.ss = s; best.surfS = { sel: surface.sel }; }
            }
          }
        }
      };
      scan(U.l, U.t, U.r, U.b, 12, null);
      const lim = (v) => (Number.isFinite(v) ? v + 14 : -1);
      const dC = lim(best.d), sC = lim(best.s), sdC = lim(best.sd), ssC = lim(best.ss), vC = lim(best.vd), vsC = lim(best.vs);
      const reach = Math.min(RW, RH, Math.max(dC, sdC, vC, 0));
      const useful = (x, y) => {
        const dx = cx - x, dy = cy - y, d = Math.hypot(dx, dy), q = Math.max(dx, dy);
        const vdx = vw - x, vdy = vh - y, vd = Math.hypot(vdx, vdy), vq = Math.max(vdx, vdy);
        return d <= dC || q <= sC || d <= sdC || q <= ssC || vd <= vC || vq <= vsC;
      };
      const count = (st) => {
        let n = 0;
        for (let y = cy - reach + st / 2; y < cy; y += st) for (let x = cx - reach + st / 2; x < cx; x += st) if (useful(x, y)) n++;
        return n;
      };
      let fine = 2;
      while (fine < 12 && count(fine) > 2500) fine++;
      if (reach > 0) scan(cx - reach, cy - reach, cx, cy, fine, useful);
      best.fine = fine;
      best.calls = calls;
    } finally {
      env.leave();
    }
    return {
      cx: r1(cx), cy: r1(cy), regionW: r1(RW), regionH: r1(RH),
      nearest: best.near ? Object.assign({ d: r1(best.d) }, best.near) : null,
      freeSquare: best.free ? Object.assign({ s: r1(best.s) }, best.free) : null,
      surface: best.surf ? { d: r1(best.sd), s: Number.isFinite(best.ss) ? r1(best.ss) : null, sel: best.surf.sel } : null,
      viewport: best.vnear ? Object.assign({ d: r1(best.vd), s: r1(best.vs) }, best.vnear) : null,
      precision: best.fine || 12, calls: best.calls || 0,
      ms: Math.round(performance.now() - t0),
    };
  }

  function scrollInfo() {
    const d = document.documentElement;
    return { y: d.scrollHeight > innerHeight + 1, x: d.scrollWidth > innerWidth + 1, docH: d.scrollHeight, docW: d.scrollWidth, at: Math.round(scrollY) };
  }

  function tabs(sel) {
    const box = document.querySelector(sel);
    if (!box || !shown(box)) return [];
    const list = [...box.querySelectorAll('[role="tab"], button')].filter((b, i, all) => all.indexOf(b) === i && shown(b) && !b.disabled);
    return list.map((b) => ({
      key: b.dataset.tab || b.dataset.v || b.dataset.page || b.dataset.view || b.id || clean(b.textContent, 30),
      label: clean(b.textContent, 30),
      selected: b.getAttribute("aria-selected") === "true" || b.getAttribute("aria-current") === "true" || b.getAttribute("aria-pressed") === "true" || b.classList.contains("is-on"),
    }));
  }

  function clickTab(sel, key) {
    const box = document.querySelector(sel);
    if (!box) return false;
    const b = [...box.querySelectorAll('[role="tab"], button')].find((x) => (x.dataset.tab || x.dataset.v || x.dataset.page || x.dataset.view || x.id || clean(x.textContent, 30)) === key);
    if (!b) return false;
    b.click();
    return true;
  }

  window.__orbSurvey = Object.freeze({ parts, drive, reach, sample, corner, scrollInfo, tabs, clickTab });
})();
