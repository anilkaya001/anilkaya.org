/* =============================================================
   particles.js — Data-Oriented gold particle field
   Self-contained, dependency-free, GPU-composited 2D canvas.
   Hardened for iOS Safari: alpha:true (screen-blend bug), a calm
   twinkle under reduced-motion instead of a dead frame, bfcache/
   focus resume hooks + watchdog, robust sizing, and a ?fxdebug
   overlay. Toggles: ?srcover (force source-over), ?boost (2x).
   ============================================================= */
(() => {
  "use strict";

  const canvas = document.getElementById("field");
  if (!canvas) return;
  // alpha:true — WebKit mishandles 'screen' compositing on an alpha-less
  // backing store and renders the canvas black on iOS; a real alpha
  // channel fixes it (the explicit trail fills still keep it dark).
  const ctx = canvas.getContext("2d", { alpha: true });

  const Q = location.search;
  const DEBUG = /[?&]fxdebug/.test(Q);
  const FORCE_SRC_OVER = /[?&]srcover/.test(Q);
  const BOOST = /[?&]boost/.test(Q) ? 2 : 1;

  // Under reduced-motion we keep a CALM, non-translating twinkle. A single
  // static frame is visually indistinguishable from "nothing rendered" on a
  // real phone; steady in-place opacity respects WCAG 2.3.3 (which targets
  // large-scale motion) while staying clearly alive.
  const REDUCE = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const calm = REDUCE;

  // --- Tuning ---------------------------------------------------
  const area = window.innerWidth * window.innerHeight;
  const COUNT = Math.max(900, Math.min(3000, Math.round(area / 720)));

  const SPEED = 0.8;
  const MAX_SIZE = 1.2;
  const FOV = 700;
  const PLANCK_H_BAR = 0.8;
  const BOHR_RADIUS = 160;
  const N_LEVELS = 6;

  const PALETTE = ["#af983f", "#da9100", "#c9c6ac", "#f1d27a", "#8a6f2e"];
  const LINK_COLOR = "#c9c6ac";
  const TRAIL_BG = "rgba(8, 7, 4, 0.40)";

  // --- DOD buffers ---------------------------------------------
  const pX = new Float32Array(COUNT), pY = new Float32Array(COUNT), pZ = new Float32Array(COUNT);
  const vX = new Float32Array(COUNT), vY = new Float32Array(COUNT), vZ = new Float32Array(COUNT);
  const pPhase = new Float32Array(COUNT);
  const pEnergyLevel = new Uint8Array(COUNT);
  const pSpin = new Int8Array(COUNT);
  const pEntangled = new Uint16Array(COUNT);
  const pColor = new Uint8Array(COUNT);
  const sX = new Float32Array(COUNT), sY = new Float32Array(COUNT), sScale = new Float32Array(COUNT);
  const pVisible = new Uint8Array(COUNT);
  const pUncertainty = new Float32Array(COUNT);

  const state = {
    targetPitch: Math.PI / 8, targetYaw: Math.PI / 4,
    pitch: 0, yaw: 0,
    width: 0, height: 0, dpr: 1,
    isObserved: false, time: 0, running: false,
  };
  let lastTime = (typeof performance !== "undefined" ? performance.now() : 0);
  let frameCount = 0;

  function resize() {
    const r = canvas.getBoundingClientRect();
    const vv = window.visualViewport;
    let w = r.width || (vv && vv.width) || window.innerWidth || document.documentElement.clientWidth;
    let h = r.height || (vv && vv.height) || window.innerHeight || document.documentElement.clientHeight;
    if (!w || !h || w < 1 || h < 1) { requestAnimationFrame(resize); return; }  // retry until laid out
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    // keep the backing store inside WebKit's per-side (4096) / area (16.7M) caps
    while (dpr > 0.75 && (w * dpr > 4096 || h * dpr > 4096 || w * dpr * h * dpr > 16777216)) dpr -= 0.25;
    state.dpr = dpr; state.width = w; state.height = h;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function pointerMove(e) {
    const cx = state.width / 2, cy = state.height / 2;
    state.targetYaw = ((e.clientX - cx) / cx) * Math.PI;
    state.targetPitch = ((e.clientY - cy) / cy) * (Math.PI / 2);
  }

  function seed() {
    for (let i = 0; i < COUNT; i++) {
      pEnergyLevel[i] = (Math.random() * N_LEVELS | 0) + 1;
      const radius = pEnergyLevel[i] * BOHR_RADIUS + (Math.random() * 30 - 15);
      const theta = Math.random() * Math.PI * 2;
      pX[i] = radius * Math.cos(theta);
      pY[i] = (Math.random() - 0.5) * 20;
      pZ[i] = radius * Math.sin(theta);
      pPhase[i] = Math.random() * Math.PI * 2;
      pSpin[i] = Math.random() > 0.5 ? 1 : -1;
      if (i % 2 === 0 && i < COUNT - 1) {
        pEntangled[i] = i + 1; pEntangled[i + 1] = i; pSpin[i + 1] = -pSpin[i];
      } else if (i % 2 !== 0) {
        pEntangled[i] = i - 1;
      } else {
        pEntangled[i] = i;   // odd COUNT: the last particle self-pairs instead of latching onto particle 0
      }
      pColor[i] = Math.random() * PALETTE.length | 0;
      const orbitSpeed = 6.0 / pEnergyLevel[i];
      vX[i] = (-pZ[i] / radius) * orbitSpeed;
      vY[i] = 0;
      vZ[i] = (pX[i] / radius) * orbitSpeed;
    }
  }

  function frame(time) {
    frameCount++;
    let dt = time - lastTime;
    lastTime = time;
    if (dt > 50 || isNaN(dt)) dt = 16;
    const dtScale = dt * 0.05;
    state.time += dtScale;
    const motion = calm ? 0 : 1;

    const cx = state.width / 2, cy = state.height / 2;

    if (!state.isObserved && !calm) {
      state.targetYaw += 0.002;
      state.targetPitch = Math.sin(state.time * 0.005) * 0.15 + Math.PI / 8;
    }
    state.yaw += (state.targetYaw - state.yaw) * 0.08;
    state.pitch += (state.targetPitch - state.pitch) * 0.08;

    const cosY = Math.cos(state.yaw), sinY = Math.sin(state.yaw);
    const cosX = Math.cos(state.pitch), sinX = Math.sin(state.pitch);

    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;   // a particle's depthAlpha leaks in from the prior frame and would dilute the trail clear
    ctx.fillStyle = state.isObserved ? "rgba(8, 7, 4, 0.60)" : TRAIL_BG;
    ctx.fillRect(0, 0, state.width, state.height);
    ctx.globalCompositeOperation = FORCE_SRC_OVER ? "source-over" : "screen";

    for (let i = 0; i < COUNT; i++) {
      if (isNaN(pX[i]) || isNaN(pY[i]) || isNaN(pZ[i])) {
        const radius = pEnergyLevel[i] * BOHR_RADIUS, theta = Math.random() * Math.PI * 2;
        pX[i] = radius * Math.cos(theta); pY[i] = 0; pZ[i] = radius * Math.sin(theta);
        vX[i] = vY[i] = vZ[i] = 0;
      }

      const dist = Math.sqrt(pX[i] * pX[i] + pY[i] * pY[i] + pZ[i] * pZ[i]) + 0.1;
      const invDist = 1.0 / dist;
      const targetRadius = pEnergyLevel[i] * BOHR_RADIUS * 1.3;
      const orbitalForce = (targetRadius - dist) * 0.03;

      let forceX = pX[i] * invDist * orbitalForce;
      let forceY = -pY[i] * 0.2;
      let forceZ = pZ[i] * invDist * orbitalForce;

      const orbitSpeed = 5.0 / (pEnergyLevel[i] * 0.8);
      forceX += (-pZ[i] * invDist) * orbitSpeed - vX[i] * 0.05;
      forceZ += (pX[i] * invDist) * orbitSpeed - vZ[i] * 0.05;
      forceY -= vY[i] * 0.1;

      pPhase[i] += pEnergyLevel[i] * 0.05 * dtScale;     // keeps advancing -> twinkle
      if (!state.isObserved && !calm) {
        forceX += Math.sin(pPhase[i]) * 0.3 * pSpin[i];
        forceY += Math.cos(pPhase[i] * 2) * 0.15;
        forceZ += Math.sin(pPhase[i]) * 0.3 * -pSpin[i];
      }

      vX[i] += forceX * dtScale * motion; vY[i] += forceY * dtScale * motion; vZ[i] += forceZ * dtScale * motion;

      const velSq = vX[i] * vX[i] + vY[i] * vY[i] + vZ[i] * vZ[i];
      if (velSq > 36.0) {
        const inv = 6.0 / Math.sqrt(velSq);
        vX[i] *= inv; vY[i] *= inv; vZ[i] *= inv;
      }

      const partner = pEntangled[i];
      if (!calm && Math.random() < 0.005 && partner < COUNT) {
        pEnergyLevel[i] = (Math.random() * N_LEVELS | 0) + 1;
        pEnergyLevel[partner] = pEnergyLevel[i];
      }

      const momentum = Math.sqrt(vX[i] * vX[i] + vY[i] * vY[i] + vZ[i] * vZ[i]);
      pUncertainty[i] = state.isObserved ? 0 : Math.min(momentum * PLANCK_H_BAR * 3.0, 10.0);

      pX[i] += vX[i] * SPEED * dtScale * motion;
      pY[i] += vY[i] * SPEED * dtScale * motion;
      pZ[i] += vZ[i] * SPEED * dtScale * motion;

      const x1 = pX[i] * cosY - pZ[i] * sinY;
      const z1 = pZ[i] * cosY + pX[i] * sinY;
      const y1 = pY[i] * cosX - z1 * sinX;
      const z2 = z1 * cosX + pY[i] * sinX;
      const finalZ = z2 + 1500;

      if (finalZ > 10) {
        const scale = FOV / finalZ;
        sX[i] = cx + x1 * scale; sY[i] = cy + y1 * scale; sScale[i] = scale;
        pVisible[i] = 1;
      } else {
        pVisible[i] = 0;
      }
    }

    // Entanglement links
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = LINK_COLOR;
    for (let i = 0; i < COUNT; i += 2) {
      const p = pEntangled[i];
      if (pVisible[i] && pVisible[p] && p < COUNT && !state.isObserved &&
          pEnergyLevel[i] === pEnergyLevel[p]) {
        const dx = sX[i] - sX[p], dy = sY[i] - sY[p];
        if (dx * dx + dy * dy < 250000) {
          ctx.globalAlpha = Math.min(Math.min(sScale[i], 0.12) * BOOST, 0.5);
          ctx.beginPath();
          ctx.moveTo(sX[i], sY[i]);
          ctx.lineTo(sX[p], sY[p]);
          ctx.stroke();
        }
      }
    }

    // Particles
    for (let i = 0; i < COUNT; i++) {
      if (!pVisible[i]) continue;
      const rs = sScale[i];
      const depthAlpha = Math.min(rs * 1.5, 1.0);
      ctx.fillStyle = PALETTE[pColor[i]];
      let jx = 0, jy = 0, a = depthAlpha;
      if (calm) {
        a = depthAlpha * (0.4 + 0.45 * (0.5 + 0.5 * Math.sin(pPhase[i] * 0.6)));   // twinkle in place
      } else if (!state.isObserved) {
        const amt = Math.min(pUncertainty[i] * 0.3 * rs, 4.0);
        jx = (Math.random() - 0.5) * amt;
        jy = (Math.random() - 0.5) * amt;
        a = depthAlpha * 0.8;
      }
      ctx.globalAlpha = Math.min(1, a * BOOST);
      ctx.beginPath();
      ctx.arc(sX[i] + jx, sY[i] + jy, MAX_SIZE * rs * BOOST, 0, Math.PI * 2);
      ctx.fill();
    }

    if (!document.hidden) {
      requestAnimationFrame(frame);
    } else {
      state.running = false;
    }
  }

  function start() {
    if (state.running) return;
    state.running = true;
    lastTime = (typeof performance !== "undefined" ? performance.now() : 0);
    requestAnimationFrame(frame);
  }

  function startDebug() {
    const d = document.createElement("div");
    d.style.cssText = "position:fixed;top:0;left:0;z-index:9999;pointer-events:none;font:11px/1.45 monospace;color:#5f5;background:rgba(0,0,0,.7);padding:5px 7px;white-space:pre;max-width:70vw";
    document.body.appendChild(d);
    const upd = () => {
      let probe = "n/a";
      try { const px = ctx.getImageData(canvas.width >> 1, canvas.height >> 1, 1, 1).data; probe = px[0] + "," + px[1] + "," + px[2] + "," + px[3]; } catch (e) { probe = "err"; }
      d.textContent =
        "frames:" + frameCount + "  running:" + state.running + "\n" +
        "vis:" + document.visibilityState + "  reduced-motion:" + window.matchMedia("(prefers-reduced-motion: reduce)").matches + "\n" +
        "css:" + Math.round(state.width) + "x" + Math.round(state.height) + "  buffer:" + canvas.width + "x" + canvas.height + "\n" +
        "dpr:" + state.dpr + " (raw " + (window.devicePixelRatio || 1) + ")  count:" + COUNT + "\n" +
        "center-pixel rgba:" + probe + (FORCE_SRC_OVER ? "  [srcover]" : "") + (BOOST > 1 ? "  [boost]" : "");
      requestAnimationFrame(upd);
    };
    upd();
  }

  function init() {
    resize();
    seed();

    let rt;
    const onResize = () => { clearTimeout(rt); rt = setTimeout(resize, 150); };
    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("orientationchange", () => setTimeout(resize, 250), { passive: true });
    window.addEventListener("load", resize);
    if (window.visualViewport) window.visualViewport.addEventListener("resize", onResize, { passive: true });
    // settle iOS viewport / toolbar / bfcache geometry
    requestAnimationFrame(() => requestAnimationFrame(resize));
    setTimeout(resize, 400);

    // Pointer "observe" (collapse the field) only makes sense when it moves.
    if (!calm) {
      // Only the field itself "collapses" on press — taps on the topbar,
      // links or the CTA must navigate cleanly without disturbing the field.
      const onUI = (e) => e.target && e.target.closest && e.target.closest(".topbar, a, button, input, label");
      window.addEventListener("pointerdown", (e) => { if (onUI(e)) return; state.isObserved = true; pointerMove(e); });
      window.addEventListener("pointermove", (e) => { if (state.isObserved) pointerMove(e); });
      window.addEventListener("pointerup", () => { state.isObserved = false; });
      window.addEventListener("pointercancel", () => { state.isObserved = false; });
      canvas.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
    }

    // Resume hooks — visibilitychange misses iOS bfcache restores (pageshow).
    document.addEventListener("visibilitychange", () => { if (!document.hidden) start(); });
    window.addEventListener("focus", () => { if (!document.hidden) start(); });
    window.addEventListener("pageshow", () => { requestAnimationFrame(resize); if (!document.hidden) start(); });
    setInterval(() => { if (!document.hidden && !state.running) start(); }, 1000);  // watchdog

    if (DEBUG) startDebug();
    start();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
