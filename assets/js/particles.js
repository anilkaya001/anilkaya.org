(() => {
  "use strict";

  const TAU = Math.PI * 2;
  const REST_DIST = 1500;
  const REST_YAW = Math.PI / 4;
  const REST_PITCH = 0.34;
  const DOLLY_MS = 2000;
  const DOLLY_PULL = 0.58;
  const DOLLY_TILT = 0.14;
  const DOLLY_SWING = 0.5;
  const APERTURE = 5;
  const BLUR_MAX = 20;
  const FOCUS_LEAD = 420;
  const FOG_LEAD = 300;
  const FOG_SPAN = 2600;
  const FOG_FLOOR = 0.16;

  function fitPlane(xs, ys, zs, n, out) {
    let sx = 0, sz = 0, sy = 0, sxx = 0, sxz = 0, szz = 0, sxy = 0, szy = 0;
    for (let i = 0; i < n; i++) {
      const x = xs[i], y = ys[i], z = zs[i];
      sx += x; sz += z; sy += y;
      sxx += x * x; sxz += x * z; szz += z * z;
      sxy += x * y; szy += z * y;
    }
    const c00 = sxx * szz - sxz * sxz;
    const c01 = sxz * sz - sx * szz;
    const c02 = sx * sxz - sxx * sz;
    const c11 = n * szz - sz * sz;
    const c12 = sx * sz - n * sxz;
    const c22 = n * sxx - sx * sx;
    const det = n * c00 + sx * c01 + sz * c02;
    if (!(n >= 3) || !(Math.abs(det) > 1e-10 * n * sxx * szz)) return false;
    out[0] = (c00 * sy + c01 * sxy + c02 * szy) / det;
    out[1] = (c01 * sy + c11 * sxy + c12 * szy) / det;
    out[2] = (c02 * sy + c12 * sxy + c22 * szy) / det;
    return true;
  }

  function blurOf(depth, focus) {
    const c = APERTURE * Math.abs(depth - focus) / depth;
    return c > BLUR_MAX ? BLUR_MAX : c;
  }

  function fogOf(depth, focus) {
    const f = 1 - (depth - focus + FOG_LEAD) / FOG_SPAN;
    return f > 1 ? 1 : f < FOG_FLOOR ? FOG_FLOOR : f;
  }

  function dollyAt(ms) {
    if (!(ms < DOLLY_MS)) return 1;
    if (!(ms > 0)) return 0;
    const t = ms / DOLLY_MS;
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(2 - 2 * t, 3) / 2;
  }

  if (typeof document === "undefined") {
    globalThis.__FieldTest = Object.freeze({ fitPlane, blurOf, fogOf, dollyAt, DOLLY_MS, REST_DIST });
    return;
  }

  const canvas = document.getElementById("field");
  if (!canvas) return;

  const ctx = canvas.getContext("2d", { alpha: true });

  const Q = location.search;
  const DEBUG = /[?&]fxdebug/.test(Q);
  const BOOST = /[?&]boost/.test(Q) ? 2 : 1;

  const REDUCE = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const calm = REDUCE;

  const area = window.innerWidth * window.innerHeight;
  const COUNT = Math.max(700, Math.min(2200, Math.round(area / 1080)));

  const SPEED = 0.8;
  const FOV = 700;
  const NEAR = 60;
  const PLANCK_H_BAR = 0.8;
  const BOHR_RADIUS = 160;
  const ORBIT_GAIN = 1.3;
  const N_LEVELS = 6;

  const CORE = 2.2;
  const CORE_MIN = 0.3;
  const DEFOCUS_DIM = 0.9;
  const LEVELS = 6;
  const SPRITE_PX = [24, 24, 32, 32, 48, 64];
  const SPRITE_ROW = 64;
  const SPRITE_GLOW = 0.2;
  const SPRITE_HOT = 0.7;
  const BLOOM_FROM = 0.78;
  const BLOOM_LEVEL = 3;
  const BLOOM_SIZE = 7;
  const BLOOM_ALPHA = 0.3;

  const TILT = 0.15;
  const TILT_RATE_A = 0.0026;
  const TILT_RATE_B = 0.0019;
  const TILT_PHASE_A = 0.6;
  const TILT_PHASE_B = 0.2;
  const DISC_SPREAD = 42;
  const HALO_SPREAD = 280;
  const HALO_SHARE = 0.15;
  const BRIGHTEST = 26;

  const GRID_R = 1300;
  const GRID_STEP = 130;
  const GRID_N = 10;
  const GRID_SEG = 8;
  const RIM_SEG = 56;
  const GRID_ALPHA = 0.15;
  const RESID_ALPHA = 0.36;
  const FOOT = 1.5;
  const FOOT_ALPHA = 0.5;
  const FOOT_COLOR = 2;
  const LINK_ALPHA = 0.1;
  const LINK_RANGE = 320;
  const BUCKETS = 6;
  const SOFT_WIDTH = 3.2;
  const SOFT_ALPHA = 0.42;
  const SOFT_FROM = 2.4;
  const SEG_MAX = 1536;

  const ZONE_CAP = 0.05;
  const ZONE_FEATHER = 90;
  const ZONE_LINES = 0.18;

  const DRIFT = 0.12;
  const SWAY = 0.05;
  const PAR_YAW = 0.2;
  const PAR_PITCH = 0.09;
  const ORBIT_YAW = Math.PI;
  const ORBIT_PITCH = Math.PI / 2;
  const PITCH_MIN = 0.04;
  const PITCH_MAX = 1.45;
  const SPRING = 26;
  const DAMP = 8.6;
  const SCROLL_PITCH = 0.62;
  const SCROLL_PULL = 0.3;
  const CY_WIDE = 0.64;
  const CY_TALL = 0.72;
  const CY_SCROLL = 0.56;
  const HOLD_MS = 140;

  const PALETTE = ["#af983f", "#da9100", "#c9c6ac", "#f1d27a", "#8a6f2e"];
  const LINK_COLOR = "#af983f";
  const GRID_COLOR = "#c9c6ac";
  const RESID_COLOR = "#f1d27a";

  const TRAIL_FADE = 0.40;
  const TRAIL_FADE_OBSERVED = 0.60;

  const pX = new Float32Array(COUNT), pY = new Float32Array(COUNT), pZ = new Float32Array(COUNT);
  const vX = new Float32Array(COUNT), vY = new Float32Array(COUNT), vZ = new Float32Array(COUNT);
  const pPhase = new Float32Array(COUNT);
  const pEnergyLevel = new Uint8Array(COUNT);
  const pSpin = new Int8Array(COUNT);
  const pEntangled = new Uint16Array(COUNT);
  const pColor = new Uint8Array(COUNT);
  const pLum = new Float32Array(COUNT);
  const pRes = new Float32Array(COUNT);
  const sX = new Float32Array(COUNT), sY = new Float32Array(COUNT), sDepth = new Float32Array(COUNT);
  const pVisible = new Uint8Array(COUNT);
  const pUncertainty = new Float32Array(COUNT);
  const brightest = new Uint16Array(Math.min(BRIGHTEST, COUNT));

  const plane = new Float64Array(3);
  const seg = new Float32Array(SEG_MAX * 4);
  const segBucket = new Uint8Array(SEG_MAX);
  const segUsed = new Uint8Array(BUCKETS * 2);
  const atlas = document.createElement("canvas");
  const spriteHalf = new Float32Array(LEVELS);
  const spriteAt = new Uint16Array(LEVELS);
  const zone = { on: false, x: 0, y: 0, hw: 0, hh: 0 };

  const state = {
    yaw: calm ? REST_YAW : REST_YAW - DOLLY_SWING, pitch: calm ? REST_PITCH : REST_PITCH + DOLLY_TILT, yawV: 0, pitchV: 0,
    baseYaw: REST_YAW, dragYaw: 0, dragPitch: 0, flick: 0, held: false,
    parX: 0, parY: 0,
    scroll: 0, scrollV: 0, scrollTarget: 0,
    intro: calm ? DOLLY_MS : 0, dist: REST_DIST, focus: REST_DIST - FOCUS_LEAD,
    fov: FOV, unit: 1, cx: 0, cy: 0, cyRest: CY_WIDE, spread: 1,
    width: 0, height: 0, dpr: 1,
    isObserved: false, time: 0, running: false,
  };
  let lastTime = (typeof performance !== "undefined" ? performance.now() : 0);
  let frameCount = 0;
  let loopToken = 0;
  let ready = false;
  let onScreen = true;
  let segN = 0;
  let qx = 0, qy = 0, qd = 0;
  let cosY = 1, sinY = 0, cosX = 1, sinX = 0;

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  function measureZone() {
    const hero = document.querySelector(".hero");
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    if (hero) {
      for (const el of hero.children) {
        const q = el.getBoundingClientRect();
        if (!q.width || !q.height) continue;
        if (q.left < l) l = q.left;
        if (q.top < t) t = q.top;
        if (q.right > r) r = q.right;
        if (q.bottom > b) b = q.bottom;
      }
    }
    zone.on = r > l && b > t;
    if (!zone.on) return;
    zone.x = (l + r) / 2; zone.y = (t + b) / 2;
    zone.hw = (r - l) / 2; zone.hh = (b - t) / 2;
  }

  function capAt(x, y) {
    const dx = Math.abs(x - zone.x) - zone.hw, dy = Math.abs(y - zone.y) - zone.hh;
    if (dx >= ZONE_FEATHER || dy >= ZONE_FEATHER) return 1;
    const d = dx > 0 ? (dy > 0 ? Math.sqrt(dx * dx + dy * dy) : dx) : (dy > 0 ? dy : 0);
    return d >= ZONE_FEATHER ? 1 : ZONE_CAP + (1 - ZONE_CAP) * (d / ZONE_FEATHER);
  }

  function readScroll() {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    state.scrollTarget = max > 1 ? clamp(window.scrollY / max, 0, 1) : 0;
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    const vv = window.visualViewport;
    let w = r.width || (vv && vv.width) || window.innerWidth || document.documentElement.clientWidth;
    let h = r.height || (vv && vv.height) || window.innerHeight || document.documentElement.clientHeight;
    if (!w || !h || w < 1 || h < 1) { requestAnimationFrame(resize); return; }
    let dpr = Math.min(window.devicePixelRatio || 1, 2);

    while (dpr > 0.75 && (w * dpr > 4096 || h * dpr > 4096 || w * dpr * h * dpr > 16777216)) dpr -= 0.25;
    if (ready && w === state.width && h === state.height && dpr === state.dpr) return;
    state.dpr = dpr; state.width = w; state.height = h;
    state.unit = clamp(Math.sqrt(w * h) / 1100, 0.7, 1.6);
    state.fov = FOV * state.unit;
    state.cyRest = CY_TALL + (CY_WIDE - CY_TALL) * clamp((w / h - 0.6) / 0.7, 0, 1);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    measureZone();
    if (calm && ready) still();
  }

  function gauss() {
    const u = 1 - Math.random(), v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
  }

  function breath(phase) {
    return 0.8 + 0.2 * Math.sin(phase * 0.31);
  }

  function seed() {
    const tiltA = TILT * Math.sin(TILT_PHASE_A), tiltB = TILT * Math.cos(TILT_PHASE_B);
    for (let i = 0; i < COUNT; i++) {
      pEnergyLevel[i] = (Math.random() * N_LEVELS | 0) + 1;
      const radius = pEnergyLevel[i] * BOHR_RADIUS * ORBIT_GAIN + (Math.random() * 30 - 15);
      const theta = Math.random() * TAU;
      pX[i] = radius * Math.cos(theta);
      pZ[i] = radius * Math.sin(theta);
      pPhase[i] = Math.random() * TAU;
      pSpin[i] = Math.random() > 0.5 ? 1 : -1;
      if (i % 2 === 0 && i < COUNT - 1) {
        pEntangled[i] = i + 1; pEntangled[i + 1] = i; pSpin[i + 1] = -pSpin[i];
      } else if (i % 2 !== 0) {
        pEntangled[i] = i - 1;
      } else {
        pEntangled[i] = i;
      }
      pColor[i] = Math.random() * PALETTE.length | 0;
      const halo = Math.random() < HALO_SHARE;
      const u = Math.random();
      pRes[i] = gauss() * (halo ? HALO_SPREAD : DISC_SPREAD);
      pLum[i] = halo ? 0.5 + 0.5 * u : 0.32 + 0.68 * u * u;
      pY[i] = tiltA * pX[i] + tiltB * pZ[i] + pRes[i] * breath(pPhase[i]);
      const orbitSpeed = 6.0 / pEnergyLevel[i];
      vX[i] = (-pZ[i] / radius) * orbitSpeed;
      vY[i] = 0;
      vZ[i] = (pX[i] / radius) * orbitSpeed;
    }
    const order = Array.from({ length: COUNT }, (_, i) => i).sort((a, b) => pLum[b] - pLum[a] || a - b);
    for (let k = 0; k < brightest.length; k++) brightest[k] = order[k];
  }

  function profile(b, r) {
    if (r >= 1) return 0;
    const disc = 0.78 * b;
    const edge = 0.07 + 0.2 * (1 - b);
    const lo = disc - edge > 0 ? disc - edge : 0;
    const t = clamp((r - lo) / (disc + edge - lo), 0, 1);
    const tail = 1 - r;
    const a = (1 - t * t * (3 - 2 * t)) * (1 - 0.22 * b) + SPRITE_GLOW * (1 - b) * tail * tail;
    return a > 1 ? 1 : a;
  }

  function buildSprites() {
    let wide = 0;
    for (let level = 0; level < LEVELS; level++) { spriteAt[level] = wide; wide += SPRITE_PX[level]; }
    atlas.width = wide;
    atlas.height = SPRITE_ROW * PALETTE.length;
    const g = atlas.getContext("2d");
    for (let level = 0; level < LEVELS; level++) {
      const b = level / (LEVELS - 1);
      const size = SPRITE_PX[level];
      const mid = size / 2;
      const peak = profile(b, 0);
      let hm = 1;
      for (let r = 0; r < 1; r += 0.005) if (profile(b, r) < peak / 2) { hm = r; break; }
      spriteHalf[level] = 1 / hm;
      for (let c = 0; c < PALETTE.length; c++) {
        const rgb = parseInt(PALETTE[c].slice(1), 16);
        const cr = rgb >> 16, cg = (rgb >> 8) & 255, cb = rgb & 255;
        const img = g.createImageData(size, size);
        const d = img.data;
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const dx = (x + 0.5 - mid) / mid, dy = (y + 0.5 - mid) / mid;
            const r = Math.sqrt(dx * dx + dy * dy);
            const hot = SPRITE_HOT * (1 - b) * clamp(1 - r / 0.24, 0, 1);
            const o = (y * size + x) * 4;
            d[o] = cr + (255 - cr) * hot;
            d[o + 1] = cg + (255 - cg) * hot;
            d[o + 2] = cb + (255 - cb) * hot;
            d[o + 3] = profile(b, r) * 255;
          }
        }
        g.putImageData(img, spriteAt[level], c * SPRITE_ROW);
      }
    }
  }

  function camera(sec) {
    const s = state;
    if (!calm) {
      s.intro = Math.min(DOLLY_MS, s.intro + sec * 1000);
      if (!s.isObserved) s.baseYaw += DRIFT * sec;
      if (!s.held) {
        s.dragYaw += s.flick * sec;
        s.flick *= Math.exp(-sec * 2.4);
        s.dragPitch *= Math.exp(-sec * 0.45);
      }
      s.scrollV += ((s.scrollTarget - s.scroll) * 46 - s.scrollV * 11.5) * sec;
      s.scroll += s.scrollV * sec;
      s.spread += ((s.isObserved ? 0.12 : 1) - s.spread) * (1 - Math.exp(-sec * 5));
    }
    const ease = dollyAt(s.intro);
    const sway = calm ? 0 : Math.sin(s.time * 0.005) * SWAY;
    const targetYaw = s.baseYaw + s.dragYaw - s.parX * PAR_YAW - (1 - ease) * DOLLY_SWING;
    const targetPitch = clamp(REST_PITCH + sway + s.dragPitch - s.parY * PAR_PITCH + s.scroll * SCROLL_PITCH + (1 - ease) * DOLLY_TILT, PITCH_MIN, PITCH_MAX);
    if (calm) {
      s.yaw = targetYaw; s.pitch = targetPitch;
    } else {
      s.yawV += ((targetYaw - s.yaw) * SPRING - s.yawV * DAMP) * sec;
      s.yaw += s.yawV * sec;
      s.pitchV += ((targetPitch - s.pitch) * SPRING - s.pitchV * DAMP) * sec;
      s.pitch += s.pitchV * sec;
    }
    s.dist = REST_DIST * (1 + DOLLY_PULL * (1 - ease)) * (1 + SCROLL_PULL * s.scroll);
    s.focus = s.dist - FOCUS_LEAD;
    s.cx = s.width / 2;
    s.cy = s.height * (s.cyRest + (CY_SCROLL - s.cyRest) * s.scroll);
    cosY = Math.cos(s.yaw); sinY = Math.sin(s.yaw);
    cosX = Math.cos(s.pitch); sinX = Math.sin(s.pitch);
  }

  function project(x, y, z) {
    const x1 = x * cosY - z * sinY;
    const z1 = z * cosY + x * sinY;
    qd = z1 * cosX + y * sinX + state.dist;
    if (!(qd > NEAR)) return false;
    const scale = state.fov / qd;
    qx = state.cx + x1 * scale;
    qy = state.cy + (y * cosX - z1 * sinX) * scale;
    return true;
  }

  function pushSeg(x1, y1, x2, y2, a, soft) {
    if (segN >= SEG_MAX || !(a > 0)) return;
    if (zone.on) a *= ZONE_LINES + (1 - ZONE_LINES) * (capAt((x1 + x2) / 2, (y1 + y2) / 2) - ZONE_CAP) / (1 - ZONE_CAP);
    const step = Math.ceil((a > 1 ? 1 : a) * BUCKETS) - 1;
    if (step < 0) return;
    const bucket = soft ? step + BUCKETS : step;
    const o = segN * 4;
    seg[o] = x1; seg[o + 1] = y1; seg[o + 2] = x2; seg[o + 3] = y2;
    segBucket[segN++] = bucket;
    segUsed[bucket] = 1;
  }

  function strokeSegs(color, width, alpha) {
    ctx.strokeStyle = color;
    for (let b = 0; b < BUCKETS * 2; b++) {
      if (!segUsed[b]) continue;
      segUsed[b] = 0;
      const soft = b >= BUCKETS;
      ctx.beginPath();
      for (let k = 0; k < segN; k++) {
        if (segBucket[k] !== b) continue;
        const o = k * 4;
        ctx.moveTo(seg[o], seg[o + 1]);
        ctx.lineTo(seg[o + 2], seg[o + 3]);
      }
      ctx.lineWidth = soft ? width * SOFT_WIDTH : width;
      ctx.globalAlpha = Math.min(1, alpha * BOOST * (soft ? SOFT_ALPHA : 1) * ((soft ? b - BUCKETS : b) + 1) / BUCKETS);
      ctx.stroke();
    }
    segN = 0;
  }

  function drawPlane() {
    const a = plane[0], b = plane[1], c = plane[2];
    const focus = state.focus, unit = state.unit;
    for (let axis = 0; axis < 2; axis++) {
      for (let k = -GRID_N; k <= GRID_N; k++) {
        const u = k * GRID_STEP;
        const half = Math.sqrt(GRID_R * GRID_R - u * u);
        let px = 0, py = 0, pd = 0, ok = false;
        for (let n = 0; n <= GRID_SEG; n++) {
          const v = -half + (2 * half * n) / GRID_SEG;
          const x = axis ? v : u, z = axis ? u : v;
          const seen = project(x, a + b * x + c * z, z);
          if (ok && seen) {
            const depth = (pd + qd) / 2;
            pushSeg(px, py, qx, qy, fogOf(depth, focus), blurOf(depth, focus) * unit > SOFT_FROM);
          }
          px = qx; py = qy; pd = qd; ok = seen;
        }
      }
    }
    let px = 0, py = 0, pd = 0, ok = false;
    for (let n = 0; n <= RIM_SEG; n++) {
      const t = (n / RIM_SEG) * TAU;
      const x = GRID_R * Math.cos(t), z = GRID_R * Math.sin(t);
      const seen = project(x, a + b * x + c * z, z);
      if (ok && seen) {
        const depth = (pd + qd) / 2;
        pushSeg(px, py, qx, qy, fogOf(depth, focus), blurOf(depth, focus) * unit > SOFT_FROM);
      }
      px = qx; py = qy; pd = qd; ok = seen;
    }
    strokeSegs(GRID_COLOR, 1, GRID_ALPHA);
  }

  function drawResiduals() {
    const a = plane[0], b = plane[1], c = plane[2];
    const focus = state.focus, unit = state.unit;
    const px = SPRITE_PX[0], row = FOOT_COLOR * SPRITE_ROW;
    for (let k = 0; k < brightest.length; k++) {
      const i = brightest[k];
      if (!pVisible[i]) continue;
      if (!project(pX[i], a + b * pX[i] + c * pZ[i], pZ[i])) continue;
      const lit = fogOf(qd, focus) * pLum[i];
      pushSeg(sX[i], sY[i], qx, qy, lit, blurOf(qd, focus) * unit > SOFT_FROM);
      const half = (FOOT * state.fov / qd + CORE_MIN) * spriteHalf[0];
      ctx.globalAlpha = Math.min(1, lit * FOOT_ALPHA * BOOST * (zone.on ? capAt(qx, qy) : 1));
      ctx.drawImage(atlas, spriteAt[0], row, px, px, qx - half, qy - half, half * 2, half * 2);
    }
    strokeSegs(RESID_COLOR, 0.8, RESID_ALPHA);
  }

  function drawLinks() {
    if (state.isObserved) return;
    const focus = state.focus, unit = state.unit, range = LINK_RANGE * LINK_RANGE;
    for (let i = 0; i < COUNT; i += 2) {
      const p = pEntangled[i];
      if (p >= COUNT || !pVisible[i] || !pVisible[p] || pEnergyLevel[i] !== pEnergyLevel[p]) continue;
      const dx = sX[i] - sX[p], dy = sY[i] - sY[p];
      if (dx * dx + dy * dy >= range) continue;
      const depth = (sDepth[i] + sDepth[p]) / 2;
      const sharp = 1 - blurOf(depth, focus) * unit / 4;
      if (sharp > 0) pushSeg(sX[i], sY[i], sX[p], sY[p], fogOf(depth, focus) * sharp, false);
    }
    strokeSegs(LINK_COLOR, 0.5, LINK_ALPHA);
  }

  function renderFrame(time) {
    let dt = time - lastTime;
    lastTime = time;
    if (dt > 50 || isNaN(dt)) dt = 16;
    if (dt < 0) dt = 0;
    const dtScale = dt * 0.05;
    state.time += dtScale;
    const motion = calm ? 0 : 1;

    camera(dt / 1000);

    const cx = state.cx, cy = state.cy, fov = state.fov, dist = state.dist, focus = state.focus, unit = state.unit;
    const edge = (BLUR_MAX * unit + 24) * 1.3;
    const right = state.width + edge, bottom = state.height + edge;
    const tiltA = TILT * Math.sin(state.time * TILT_RATE_A + TILT_PHASE_A);
    const tiltB = TILT * Math.cos(state.time * TILT_RATE_B + TILT_PHASE_B);
    const spread = state.spread;
    const loose = !state.isObserved && !calm;

    ctx.globalCompositeOperation = "destination-out";
    ctx.globalAlpha = 1;

    ctx.fillStyle = "rgba(0, 0, 0, " +
      (state.isObserved ? TRAIL_FADE_OBSERVED : TRAIL_FADE) + ")";
    ctx.fillRect(0, 0, state.width, state.height);
    ctx.globalCompositeOperation = "source-over";

    for (let i = 0; i < COUNT; i++) {
      if (isNaN(pX[i]) || isNaN(pY[i]) || isNaN(pZ[i])) {
        const radius = pEnergyLevel[i] * BOHR_RADIUS, theta = Math.random() * TAU;
        pX[i] = radius * Math.cos(theta); pY[i] = 0; pZ[i] = radius * Math.sin(theta);
        vX[i] = vY[i] = vZ[i] = 0;
      }

      if (motion) {
        const flat = Math.sqrt(pX[i] * pX[i] + pZ[i] * pZ[i]) + 0.1;
        const invFlat = 1.0 / flat;
        const targetRadius = pEnergyLevel[i] * BOHR_RADIUS * ORBIT_GAIN;
        const orbitalForce = (targetRadius - flat) * 0.03;

        let forceX = pX[i] * invFlat * orbitalForce;
        let forceZ = pZ[i] * invFlat * orbitalForce;
        const rest = tiltA * pX[i] + tiltB * pZ[i] + pRes[i] * spread * breath(pPhase[i]);
        let forceY = (rest - pY[i]) * 0.03 - vY[i] * 0.16;

        const orbitSpeed = 5.0 / (pEnergyLevel[i] * 0.8);
        forceX += (-pZ[i] * invFlat) * orbitSpeed - vX[i] * 0.05;
        forceZ += (pX[i] * invFlat) * orbitSpeed - vZ[i] * 0.05;

        pPhase[i] += pEnergyLevel[i] * 0.05 * dtScale;
        if (loose) {
          forceX += Math.sin(pPhase[i]) * 0.3 * pSpin[i];
          forceY += Math.cos(pPhase[i] * 2) * 0.15;
          forceZ += Math.sin(pPhase[i]) * 0.3 * -pSpin[i];
        }

        vX[i] += forceX * dtScale; vY[i] += forceY * dtScale; vZ[i] += forceZ * dtScale;

        const velSq = vX[i] * vX[i] + vY[i] * vY[i] + vZ[i] * vZ[i];
        if (velSq > 36.0) {
          const inv = 6.0 / Math.sqrt(velSq);
          vX[i] *= inv; vY[i] *= inv; vZ[i] *= inv;
        }

        const partner = pEntangled[i];
        if (Math.random() < 0.005 && partner < COUNT) {
          pEnergyLevel[i] = (Math.random() * N_LEVELS | 0) + 1;
          pEnergyLevel[partner] = pEnergyLevel[i];
        }

        const momentum = Math.sqrt(vX[i] * vX[i] + vY[i] * vY[i] + vZ[i] * vZ[i]);
        pUncertainty[i] = state.isObserved ? 0 : Math.min(momentum * PLANCK_H_BAR * 3.0, 10.0);

        pX[i] += vX[i] * SPEED * dtScale;
        pY[i] += vY[i] * SPEED * dtScale;
        pZ[i] += vZ[i] * SPEED * dtScale;
      }

      const x1 = pX[i] * cosY - pZ[i] * sinY;
      const z1 = pZ[i] * cosY + pX[i] * sinY;
      const depth = z1 * cosX + pY[i] * sinX + dist;

      if (depth > NEAR) {
        const scale = fov / depth;
        const x = cx + x1 * scale, y = cy + (pY[i] * cosX - z1 * sinX) * scale;
        if (x > -edge && x < right && y > -edge && y < bottom) {
          sX[i] = x; sY[i] = y; sDepth[i] = depth;
          pVisible[i] = 1;
        } else {
          pVisible[i] = 0;
        }
      } else {
        pVisible[i] = 0;
      }
    }

    fitPlane(pX, pY, pZ, COUNT, plane);
    drawPlane();
    drawLinks();
    drawResiduals();

    for (let i = 0; i < COUNT; i++) {
      if (!pVisible[i]) continue;
      const depth = sDepth[i];
      const core = CORE * fov / depth + CORE_MIN;
      const blur = blurOf(depth, focus) * unit;
      const rad = core + blur;
      const soft = blur / rad;
      let level = (soft * LEVELS) | 0;
      if (level >= LEVELS) level = LEVELS - 1;
      let a = pLum[i] * fogOf(depth, focus) * (1 - soft * DEFOCUS_DIM) * (0.84 + 0.16 * Math.sin(pPhase[i] * 0.6)) * BOOST;
      let x = sX[i], y = sY[i];
      if (zone.on) {
        const cap = capAt(x, y);
        if (a > cap) a = cap;
      }
      if (a < 0.01) continue;
      if (loose) {
        const amt = Math.min(pUncertainty[i] * 0.22 * (fov / depth) * (1 - soft), 2.5);
        x += (Math.random() - 0.5) * amt;
        y += (Math.random() - 0.5) * amt;
      }
      const half = rad * spriteHalf[level];
      const px = SPRITE_PX[level];
      const row = pColor[i] * SPRITE_ROW;
      ctx.globalAlpha = a > 1 ? 1 : a;
      ctx.drawImage(atlas, spriteAt[level], row, px, px, x - half, y - half, half * 2, half * 2);
      if (pLum[i] > BLOOM_FROM && level < 2) {
        const wide = rad * BLOOM_SIZE;
        ctx.globalAlpha = a * BLOOM_ALPHA;
        ctx.drawImage(atlas, spriteAt[BLOOM_LEVEL], row, SPRITE_PX[BLOOM_LEVEL], SPRITE_PX[BLOOM_LEVEL], x - wide, y - wide, wide * 2, wide * 2);
      }
    }
  }

  function frame(time, token) {
    if (token !== loopToken) return;
    frameCount++;
    try {
      renderFrame(time);
    } catch (err) {
      if (DEBUG) console.error("particles: frame error", err);
    }
    if (!document.hidden && onScreen) {
      requestAnimationFrame((t) => frame(t, token));
    } else {
      state.running = false;
    }
  }

  function still() {
    frameCount++;
    ctx.clearRect(0, 0, state.width, state.height);
    try {
      for (let n = 0; n < 8; n++) renderFrame(lastTime);
    } catch (err) {
      if (DEBUG) console.error("particles: frame error", err);
    }
  }

  function start() {
    if (calm) return;
    if (state.running || document.hidden || !onScreen) return;
    state.running = true;
    lastTime = (typeof performance !== "undefined" ? performance.now() : 0);
    const token = ++loopToken;
    requestAnimationFrame((t) => frame(t, token));
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
        "plane: y = " + plane[0].toFixed(1) + " + " + plane[1].toFixed(3) + "x + " + plane[2].toFixed(3) + "z  dist:" + Math.round(state.dist) + "  scroll:" + state.scroll.toFixed(2) + "\n" +
        "center-pixel rgba:" + probe + (BOOST > 1 ? "  [boost]" : "");
      requestAnimationFrame(upd);
    };
    upd();
  }

  function init() {
    resize();
    seed();
    buildSprites();

    let rt;
    const onResize = () => { clearTimeout(rt); rt = setTimeout(resize, 150); };
    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("orientationchange", () => setTimeout(resize, 250), { passive: true });
    window.addEventListener("load", resize);
    if (window.visualViewport) window.visualViewport.addEventListener("resize", onResize, { passive: true });

    requestAnimationFrame(() => requestAnimationFrame(resize));
    setTimeout(resize, 400);

    if (!calm) {
      const onUI = (e) => e.target && e.target.closest && e.target.closest(".topbar, .market-board, .market-ticker, .disclaimer, a, button, input, label");
      let pid = -1, touch = false, holdTimer = 0;
      let x0 = 0, y0 = 0, yaw0 = 0, pitch0 = 0, lastX = 0, lastT = 0;
      const release = (glide) => {
        pid = -1;
        clearTimeout(holdTimer);
        state.held = false;
        state.isObserved = false;
        if (!glide) state.flick = 0;
      };
      window.addEventListener("pointerdown", (e) => {
        if (onUI(e) || (e.pointerType === "mouse" && e.button !== 0)) return;
        pid = e.pointerId; touch = e.pointerType === "touch";
        x0 = lastX = e.clientX; y0 = e.clientY; lastT = e.timeStamp;
        yaw0 = state.dragYaw; pitch0 = state.dragPitch;
        state.flick = 0; state.held = true;
        clearTimeout(holdTimer);
        if (touch) holdTimer = setTimeout(() => { if (pid === e.pointerId) state.isObserved = true; }, HOLD_MS);
        else state.isObserved = true;
      });
      window.addEventListener("pointermove", (e) => {
        if (e.pointerId === pid) {
          const dx = e.clientX - x0;
          if (touch && Math.abs(dx) > 6) state.isObserved = true;
          state.dragYaw = yaw0 + (dx / state.width) * ORBIT_YAW;
          if (!touch) state.dragPitch = pitch0 + ((e.clientY - y0) / state.height) * ORBIT_PITCH;
          const lag = e.timeStamp - lastT;
          if (lag > 0) state.flick = clamp(state.flick * 0.5 + 0.5 * ((e.clientX - lastX) / state.width) * ORBIT_YAW / (lag / 1000), -6, 6);
          lastX = e.clientX; lastT = e.timeStamp;
        } else if (pid < 0 && e.pointerType !== "touch") {
          state.parX = clamp((e.clientX / state.width) * 2 - 1, -1, 1);
          state.parY = clamp((e.clientY / state.height) * 2 - 1, -1, 1);
        }
      });
      window.addEventListener("pointerup", (e) => { if (e.pointerId === pid) release(e.timeStamp - lastT < 90); });
      window.addEventListener("pointercancel", (e) => { if (e.pointerId === pid) release(false); });
      document.documentElement.addEventListener("pointerleave", () => { state.parX = 0; state.parY = 0; });
      window.addEventListener("scroll", readScroll, { passive: true });
      window.addEventListener("resize", readScroll, { passive: true });
      readScroll();
      state.scroll = state.scrollTarget;
      if (window.visualViewport) {
        const zoomed = () => canvas.classList.toggle("field--zoomed", window.visualViewport.scale > 1.01);
        window.visualViewport.addEventListener("resize", zoomed, { passive: true });
      }
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(measureZone);
      setTimeout(measureZone, 1300);
    }

    if ("IntersectionObserver" in window) {
      new IntersectionObserver((entries) => {
        onScreen = entries[entries.length - 1].isIntersecting;
        if (onScreen) start();
      }).observe(canvas);
    }

    document.addEventListener("visibilitychange", () => { if (!document.hidden) start(); });
    window.addEventListener("focus", () => { if (!document.hidden) start(); });
    window.addEventListener("pageshow", () => { requestAnimationFrame(resize); if (!document.hidden) start(); });
    canvas.addEventListener("contextrestored", () => {
      ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
      buildSprites();
      if (calm) still();
    });

    if (DEBUG) startDebug();
    ready = true;
    if (calm) return still();

    let seenFrames = -1;
    setInterval(() => {
      if (document.hidden || !onScreen) { seenFrames = frameCount; return; }
      if (!state.running || frameCount === seenFrames) {
        state.running = false;
        start();
      }
      seenFrames = frameCount;
    }, 1000);
    start();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
