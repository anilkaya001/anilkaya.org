const INSTALL = () => {
  const w = window;
  if (w.__vc) return false;
  const queue = new Map();
  let nextId = 0;
  let t = performance.now();
  const real = { raf: w.requestAnimationFrame, caf: w.cancelAnimationFrame };
  const vc = {
    get t() { return t; },
    pending: () => queue.size,
    tick(step) {
      t += step;
      const run = [...queue.values()];
      queue.clear();
      for (const cb of run) cb(t);
    },
    advance(ms, step = 16) {
      let left = ms;
      while (left > 1e-9) {
        const s = Math.min(step, left);
        vc.tick(s);
        left -= s;
      }
      return t;
    },
    until(pred, maxMs, step = 16) {
      const t0 = t;
      while (t - t0 < maxMs) {
        if (pred()) return t - t0;
        vc.tick(step);
      }
      return pred() ? t - t0 : null;
    },
    restore() {
      w.requestAnimationFrame = real.raf;
      w.cancelAnimationFrame = real.caf;
      delete performance.now;
      const left = [...queue.values()];
      queue.clear();
      for (const cb of left) real.raf.call(w, cb);
      delete w.__vc;
    },
  };
  w.requestAnimationFrame = (cb) => { queue.set(++nextId, cb); return nextId; };
  w.cancelAnimationFrame = (id) => { queue.delete(id); };
  performance.now = () => t;
  w.__vc = vc;
  return true;
};

export const installClock = (page) => page.evaluate(INSTALL);
export const restoreClock = (page) => page.evaluate(() => { if (window.__vc) window.__vc.restore(); });
export const advance = (page, ms) => page.evaluate((ms) => window.__vc.advance(ms), ms);

export const pointer = (page, sel, steps) => page.evaluate(({ sel, steps }) => {
  const vc = window.__vc;
  const cv = document.querySelector(sel);
  const r = cv.getBoundingClientRect();
  const send = (type, x, y) => {
    const ev = new PointerEvent(type, { pointerId: 7, pointerType: "mouse", isPrimary: true, bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1 });
    Object.defineProperty(ev, "timeStamp", { value: vc.t });
    cv.dispatchEvent(ev);
  };
  for (const s of steps) {
    if (s.wait) vc.advance(s.wait);
    send(s.type, r.left + s.x, r.top + s.y);
  }
}, { sel, steps });

export const flick = (page, sel, o) => {
  const { cx, cy, dx = 0, dy = 0, n = 4, every = 20, up = true } = o;
  const steps = [{ type: "pointerdown", x: cx, y: cy }];
  for (let i = 1; i <= n; i++) steps.push({ type: "pointermove", x: cx + dx * i, y: cy + dy * i, wait: every });
  if (up) steps.push({ type: "pointerup", x: cx + dx * n, y: cy + dy * n, wait: every });
  return pointer(page, sel, steps);
};
