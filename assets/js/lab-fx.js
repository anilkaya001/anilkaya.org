/* =============================================================
   lab-fx.js — the delight layer. Tasteful, GPU-composited motion
   that makes correct answers feel great and wrong ones feel kind.
   Vanilla, dependency-free, and fully reduced-motion aware.
   Exposes window.FX = { confetti, correct, wrong, floatPoints,
   moduleDone, celebrate }.
   ============================================================= */
(() => {
  "use strict";

  const GOLD = ["#da9100", "#c9c6ac", "#af983f", "#f1d27a", "#ece8d8"];
  const reduce = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const rectOf = (el) => (el && el.getBoundingClientRect ? el.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 });

  // ---- shared confetti canvas (one element, reused) -----------
  let cv, cx, parts = [], raf = 0;
  function ensureCanvas() {
    if (cv) return;
    cv = document.createElement("canvas");
    cv.className = "fx-canvas";
    cx = cv.getContext("2d");
    document.body.appendChild(cv);
    sizeCanvas();
    window.addEventListener("resize", sizeCanvas, { passive: true });
  }
  function sizeCanvas() {
    if (!cv) return;
    const d = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = innerWidth * d; cv.height = innerHeight * d;
    cx.setTransform(d, 0, 0, d, 0, 0);
  }
  function tick() {
    raf = 0;
    cx.clearRect(0, 0, innerWidth, innerHeight);
    let alive = 0;
    for (const p of parts) {
      if (p.life <= 0) continue;
      alive++;
      p.vy += 0.12;                 // gravity
      p.vx *= 0.99;
      p.x += p.vx; p.y += p.vy;
      p.rot += p.vr;
      p.life -= 1;
      cx.save();
      cx.globalAlpha = Math.max(0, Math.min(1, p.life / 22));
      cx.fillStyle = p.color;
      cx.translate(p.x, p.y); cx.rotate(p.rot);
      if (p.round) { cx.beginPath(); cx.arc(0, 0, p.s * 0.5, 0, 6.283); cx.fill(); }
      else cx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6);
      cx.restore();
    }
    if (alive > 0) raf = requestAnimationFrame(tick);
    else { parts.length = 0; cx.clearRect(0, 0, innerWidth, innerHeight); }
  }
  function burst(x, y, n, spread, power) {
    ensureCanvas();
    for (let i = 0; i < n; i++) {
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * spread;
      const sp = power * (0.45 + Math.random() * 0.85);
      parts.push({
        x, y,
        vx: Math.cos(ang) * sp + (Math.random() - 0.5) * 2,
        vy: Math.sin(ang) * sp,
        rot: Math.random() * 6.283, vr: (Math.random() - 0.5) * 0.4,
        s: 5 + Math.random() * 7, color: GOLD[(Math.random() * GOLD.length) | 0],
        round: Math.random() < 0.35, life: 60 + Math.random() * 36,
      });
    }
    if (parts.length > 700) parts.splice(0, parts.length - 700);
    if (!raf) raf = requestAnimationFrame(tick);
  }

  function confetti(originEl, opts = {}) {
    if (reduce()) return;
    const r = rectOf(originEl);
    burst(r.left + r.width / 2, r.top + r.height / 2, opts.count || 70, opts.spread || 1.5, opts.power || 9);
  }

  // ---- success / error on an element ---------------------------
  function ring(el, cls) {
    if (!el) return;
    const r = rectOf(el);
    const g = document.createElement("span");
    g.className = "fx-ring " + cls;
    g.style.left = r.left + r.width / 2 + "px";
    g.style.top = r.top + r.height / 2 + "px";
    document.body.appendChild(g);
    g.addEventListener("animationend", () => g.remove(), { once: true });
    setTimeout(() => g.remove(), 900);
  }

  function correct(el) {
    ring(el, "fx-ring--ok");
    confetti(el, { count: 80, power: 10 });
  }

  function wrong(el) {
    if (el && !reduce()) {
      el.classList.add("fx-shake");
      setTimeout(() => el.classList.remove("fx-shake"), 450);
    }
    ring(el, "fx-ring--err");
  }

  // ---- floating "+N points" near the badge --------------------
  function floatPoints(n, anchorEl) {
    if (!n) return;
    if (anchorEl) {
      anchorEl.classList.remove("fx-pop"); void anchorEl.offsetWidth; anchorEl.classList.add("fx-pop");
      setTimeout(() => anchorEl.classList.remove("fx-pop"), 600);
    }
    if (reduce()) return;
    const r = rectOf(anchorEl);
    const f = document.createElement("span");
    f.className = "fx-points";
    f.textContent = "+" + n;
    f.style.left = (anchorEl ? r.left + r.width / 2 : innerWidth / 2) + "px";
    f.style.top = (anchorEl ? r.top : 80) + "px";
    document.body.appendChild(f);
    f.addEventListener("animationend", () => f.remove(), { once: true });
    setTimeout(() => f.remove(), 1300);
  }

  // ---- module / topic completion ------------------------------
  function moduleDone(el) {
    if (el) { el.classList.add("fx-glow"); setTimeout(() => el.classList.remove("fx-glow"), 1400); }
    if (el) confetti(el, { count: 36, power: 7, spread: 2 });
  }

  function celebrate(msg) {
    // big banner + a couple of confetti volleys from the top
    const b = document.createElement("div");
    b.className = "fx-banner";
    b.innerHTML = '<span class="fx-banner__check" aria-hidden="true">✓</span><span>' +
      String(msg || "Done!").replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m])) + "</span>";
    document.body.appendChild(b);
    requestAnimationFrame(() => b.classList.add("in"));
    if (!reduce()) {
      const volley = (x) => burst(x, innerHeight * 0.28, 70, 2.2, 12);
      volley(innerWidth * 0.5);
      setTimeout(() => { volley(innerWidth * 0.28); volley(innerWidth * 0.72); }, 220);
    }
    setTimeout(() => { b.classList.remove("in"); setTimeout(() => b.remove(), 400); }, 1500);
  }

  // ---- significance ignite: the regression table's hero moment -
  // significant p-values flare gold->green; their rows get a brief
  // underline sweep, staggered top-down so the table "resolves".
  function ignite(container) {
    if (!container || reduce()) return;
    container.querySelectorAll(".sig").forEach((el, i) => {
      el.style.setProperty("--i", i);
      el.classList.remove("fx-ignite"); void el.offsetWidth; el.classList.add("fx-ignite");
      el.addEventListener("animationend", () => el.classList.remove("fx-ignite"), { once: true });
    });
    container.querySelectorAll(".sigrow").forEach((el, i) => {
      el.style.setProperty("--i", i);
      el.classList.remove("fx-sweep"); void el.offsetWidth; el.classList.add("fx-sweep");
      el.addEventListener("animationend", () => el.classList.remove("fx-sweep"), { once: true });
    });
  }

  // ---- a freshly-estimated figure "develops" (first arrival) ---
  function reveal(img, opts = {}) {
    if (!img) return;
    if (reduce()) { img.style.clipPath = "none"; img.style.opacity = "1"; img.style.transform = "none"; return; }
    img.classList.add("fx-develop");
    img.style.transitionDelay = Math.min(opts.stagger || 0, 6) * 70 + "ms";
    requestAnimationFrame(() => requestAnimationFrame(() => img.classList.add("in")));
    img.addEventListener("transitionend", () => {
      img.classList.remove("fx-develop", "in"); img.style.transitionDelay = "";
    }, { once: true });
  }

  // ---- interactive before/after crossfade (slider re-runs) -----
  function swap(container, img) {
    if (!container) return;
    if (reduce()) { container.innerHTML = ""; container.appendChild(img); return; }
    const olds = Array.from(container.children);
    for (let i = 0; i < olds.length - 1; i++) olds[i].remove(); // cap stack at 2
    const prev = container.lastElementChild;
    container.style.position = "relative";
    img.style.opacity = "0";
    container.appendChild(img);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      img.style.transition = "opacity 280ms var(--ease)"; img.style.opacity = "1";
      if (prev) {
        prev.style.position = "absolute"; prev.style.inset = "0 0 auto 0"; prev.style.width = "100%";
        prev.style.pointerEvents = "none"; prev.style.transition = "opacity 280ms var(--ease)"; prev.style.opacity = "0";
        const done = () => prev.remove();
        prev.addEventListener("transitionend", done, { once: true }); setTimeout(done, 420);
      }
    }));
  }

  // ---- Run button: charge/release + honest meniscus ------------
  function runState(btn, state) {
    if (!btn) return;
    if (state === "busy") { btn.classList.add("fx-busy"); btn.setAttribute("aria-busy", "true"); }
    else {
      btn.classList.remove("fx-busy"); btn.removeAttribute("aria-busy");
      if (!reduce()) { btn.classList.remove("fx-fire"); void btn.offsetWidth; btn.classList.add("fx-fire"); setTimeout(() => btn.classList.remove("fx-fire"), 280); }
    }
  }

  // ---- result handoff: bloom + nudge-scroll only if off-screen -
  function landed(el, opts = {}) {
    if (!el) return;
    if (!reduce()) { el.classList.remove("fx-bloom"); void el.offsetWidth; el.classList.add("fx-bloom"); setTimeout(() => el.classList.remove("fx-bloom"), 560); }
    const noPref = window.matchMedia("(prefers-reduced-motion: no-preference)").matches;
    if (opts.scrollIfBelowFold !== false && noPref) {
      const r = rectOf(el);
      if (r.bottom > innerHeight - 8 || r.top < 60) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  // ---- points fly as a coin arc into the badge ----------------
  function coin(originEl, badgeEl, amount) {
    if (!badgeEl || !amount) return;
    if (reduce() || !originEl) { floatPoints(amount, badgeEl); return; }
    const o = rectOf(originEl), b = rectOf(badgeEl);
    const x0 = o.left + o.width / 2, y0 = o.top + o.height / 2;
    const x1 = b.left + b.width / 2, y1 = b.top + b.height / 2;
    const midX = (x0 + x1) / 2, midY = Math.min(y0, y1) - 64;     // arc apex above the path
    const c = document.createElement("span");
    c.className = "fx-coin"; c.textContent = "+" + amount; c.setAttribute("aria-hidden", "true");
    document.body.appendChild(c);
    const anim = c.animate([
      { transform: `translate(${x0}px,${y0}px) translate(-50%,-50%) scale(0.7)`, opacity: 0 },
      { transform: `translate(${midX}px,${midY}px) translate(-50%,-50%) scale(1.15)`, opacity: 1, offset: 0.5 },
      { transform: `translate(${x1}px,${y1}px) translate(-50%,-50%) scale(0.5)`, opacity: 0.85 },
    ], { duration: 560, easing: "cubic-bezier(0.22,1,0.36,1)", fill: "forwards" });
    let done = false;
    const land = () => {
      if (done) return; done = true; c.remove();
      badgeEl.classList.remove("fx-pop"); void badgeEl.offsetWidth; badgeEl.classList.add("fx-pop");
      setTimeout(() => badgeEl.classList.remove("fx-pop"), 600);
    };
    anim.onfinish = land; setTimeout(land, 720);
  }

  // ---- streak flame: breathing when lit, flare on increment ---
  function streakUp(el) {
    if (!el || reduce()) return;
    el.classList.remove("fx-flare"); void el.offsetWidth; el.classList.add("fx-flare");
    el.addEventListener("animationend", () => el.classList.remove("fx-flare"), { once: true });
  }
  function setStreakState(el, state) {
    if (!el) return;
    el.classList.toggle("fx-lit", state === "lit" && !reduce());
  }

  // ---- directional page-turn between stages (guide+work) ------
  function pageTurn(el, dir, swapFn) {
    if (!el) return;
    if (reduce()) { swapFn(); return; }
    const d = dir < 0 ? -1 : 1;
    el.style.transition = "transform 0.2s var(--ease), opacity 0.2s var(--ease)";
    el.style.transform = "translateY(" + d * 16 + "px)"; el.style.opacity = "0";
    setTimeout(() => {
      swapFn();
      el.style.transition = "none";
      el.style.transform = "translateY(" + -d * 18 + "px)"; el.style.opacity = "0";
      requestAnimationFrame(() => requestAnimationFrame(() => {
        el.style.transition = "transform 0.3s var(--ease), opacity 0.3s var(--ease)";
        el.style.transform = "none"; el.style.opacity = "1";
      }));
    }, 200);
  }

  window.FX = { confetti, correct, wrong, floatPoints, moduleDone, celebrate, ignite, reveal, swap, runState, landed, coin, streakUp, setStreakState, pageTurn };
})();
