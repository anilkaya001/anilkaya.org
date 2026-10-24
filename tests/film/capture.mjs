import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { launch } from '../lib/browser.mjs';

const FPS = 15;
const SLOT_MS = 1000 / FPS;
const WIDTH = 1920;
const HEIGHT = 1080;
const VIEWPORT = { width: WIDTH, height: HEIGHT };
const RIBBON_ID = 'flows-film-ribbon';
const RIBBON_TEXT = 'Sample data';
const REQUIRED_VARS = ['--bg-elev', '--ink', '--hairline', '--font-ui'];

const RIBBON_CSS = `#${RIBBON_ID}{position:fixed!important;inset:auto auto 20px 20px!important;margin:0!important;z-index:2147483647!important;display:inline-flex!important;align-items:center!important;padding:8px 14px!important;background:var(--bg-elev)!important;color:var(--ink)!important;border:1px solid var(--hairline)!important;border-radius:999px!important;font-family:var(--font-ui)!important;font-size:15px!important;font-weight:600!important;line-height:1.2!important;letter-spacing:.02em!important;pointer-events:none!important;overflow:visible!important;width:auto!important;height:auto!important;max-width:none!important;opacity:1!important;visibility:visible!important;box-shadow:none!important;transform:none!important;filter:none!important}`;

const LOADERS = {
  'home-fixtures.mjs': () => import('../lib/home-fixtures.mjs'),
  'market-fixtures.mjs': () => import('../lib/market-fixtures.mjs'),
  'glass-world.mjs': () => import('../lib/glass-world.mjs'),
  'status-world.mjs': () => import('../lib/status-world.mjs')
};

const moduleCache = new Map();

async function loadHelper(file) {
  if (moduleCache.has(file)) return moduleCache.get(file);
  let mod = null;
  try {
    mod = await LOADERS[file]();
  } catch {
    mod = null;
  }
  moduleCache.set(file, mod);
  return mod;
}

async function resolveHelper(candidates) {
  for (const [file, name] of candidates) {
    const mod = await loadHelper(file);
    if (mod && typeof mod[name] === 'function') return { mod, fn: mod[name], file, name };
  }
  return null;
}

async function requireHelper(candidates, label) {
  const found = await resolveHelper(candidates);
  if (!found) {
    const tried = candidates.map(([f, n]) => `${n} in ${f}`).join(', ');
    throw new Error(`no helper opens the ${label} (tried ${tried})`);
  }
  return found;
}

async function richNow() {
  const mod = await loadHelper('market-fixtures.mjs');
  return mod && mod.RICH_NOW !== undefined ? mod.RICH_NOW : undefined;
}

function withNow(opts, now) {
  return now === undefined ? opts : { ...opts, now };
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function ease(t) {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function frameName(i) {
  return `f${String(i + 1).padStart(5, '0')}.jpg`;
}

async function ensureRibbon(page) {
  return page.evaluate(({ id, css, text, vars }) => {
    let style = document.getElementById(`${id}-style`);
    if (!style) {
      style = document.createElement('style');
      style.id = `${id}-style`;
      style.textContent = css;
      (document.head || document.documentElement).appendChild(style);
    }
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.setAttribute('aria-hidden', 'true');
      el.setAttribute('data-film', 'ribbon');
      el.textContent = text;
      if ('popover' in el) el.popover = 'manual';
      document.body.appendChild(el);
    }
    if (el.textContent !== text) el.textContent = text;
    if (el.parentNode !== document.body) document.body.appendChild(el);
    if (typeof el.showPopover === 'function' && el.hasAttribute('popover')) {
      let others = 0;
      try {
        const open = el.matches(':popover-open') ? 1 : 0;
        others = document.querySelectorAll(':modal, :popover-open').length - open;
      } catch {
        others = 0;
      }
      const key = String(others);
      try {
        if (!el.matches(':popover-open')) {
          el.showPopover();
          el.dataset.layer = key;
        } else if (el.dataset.layer !== key) {
          el.hidePopover();
          el.showPopover();
          el.dataset.layer = key;
        }
      } catch {
        el.dataset.layer = key;
      }
    }
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(document.documentElement);
    const missing = vars.filter((v) => !cs.getPropertyValue(v).trim());
    const onScreen = r.width > 0 && r.height > 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 && r.left >= -1 && r.top >= -1;
    return { visible: onScreen && el.textContent === text, missing };
  }, { id: RIBBON_ID, css: RIBBON_CSS, text: RIBBON_TEXT, vars: REQUIRED_VARS });
}

async function pageHasContent(page) {
  return page.evaluate(() => {
    const b = document.body;
    if (!b) return false;
    const r = b.getBoundingClientRect();
    if (r.width <= 0) return false;
    const text = (b.innerText || '').replace('Sample data', '').trim();
    const media = b.querySelector('canvas, svg, img, video');
    return text.length > 0 || Boolean(media);
  });
}

async function scrollInfo(page) {
  return page.evaluate(() => {
    const se = document.scrollingElement || document.documentElement;
    return { max: Math.max(0, se.scrollHeight - innerHeight), y: se.scrollY || window.scrollY || 0 };
  });
}

async function scrollTo(page, y) {
  await page.evaluate((top) => {
    window.scrollTo({ top, left: 0, behavior: 'instant' });
  }, Math.round(y));
}

async function largestCanvas(page) {
  return page.evaluate(() => {
    let best = null;
    for (const c of document.querySelectorAll('canvas')) {
      const r = c.getBoundingClientRect();
      const w = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
      const h = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
      const area = w * h;
      if (area > 0 && (!best || area > best.area)) {
        best = { x: Math.max(r.left, 0), y: Math.max(r.top, 0), width: w, height: h, area };
      }
    }
    return best;
  });
}

async function findTiles(page) {
  return page.evaluate(() => {
    const selectors = ['[data-tile]', '.tile', '.bento > *', '[class*="bento"] > *', 'main section > article', 'main article', 'main section'];
    const sy = window.scrollY || 0;
    for (const sel of selectors) {
      const found = [];
      for (const el of document.querySelectorAll(sel)) {
        if (el.id === 'flows-film-ribbon') continue;
        const r = el.getBoundingClientRect();
        if (r.width < 80 || r.height < 60) continue;
        if (r.width > innerWidth * 0.98 && r.height > innerHeight * 0.9) continue;
        found.push({ x: r.left + r.width / 2, y: r.top + sy + r.height / 2 });
      }
      if (found.length >= 3) return found.slice(0, 6);
    }
    return [];
  });
}

async function findLargestSphere(page) {
  return page.evaluate(() => {
    const selectors = ['[data-sphere]', '.sphere', '[class*="sphere"]', '[data-bubble]', '.bubble', 'svg circle'];
    let best = null;
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        if (r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) continue;
        if (r.width > innerWidth * 0.8 && r.height > innerHeight * 0.8) continue;
        const area = r.width * r.height;
        if (!best || area > best.area) best = { x: r.left + r.width / 2, y: r.top + r.height / 2, area };
      }
      if (best) return best;
    }
    return null;
  });
}

function makeMouseFollower(startX, startY) {
  return { x: startX, y: startY };
}

async function followTo(page, ctx, tx, ty, k) {
  ctx.mouse.x += (tx - ctx.mouse.x) * k;
  ctx.mouse.y += (ty - ctx.mouse.y) * k;
  await page.mouse.move(Math.round(ctx.mouse.x), Math.round(ctx.mouse.y));
}

async function scrollSetup(page) {
  const info = await scrollInfo(page);
  return { maxScroll: Math.min(info.max, 720), baseY: info.y, mouse: makeMouseFollower(WIDTH * 0.5, HEIGHT * 0.45) };
}

async function scrollStep(page, i, n, ctx) {
  const p = n > 1 ? i / (n - 1) : 0;
  if (ctx.maxScroll > 0) {
    const y = ctx.baseY + (ctx.maxScroll - ctx.baseY) * 0.55 * Math.sin(Math.PI * ease(p));
    await scrollTo(page, Math.max(0, y));
  }
  const tx = WIDTH * (0.42 + 0.16 * Math.sin(p * Math.PI * 1.5));
  const ty = HEIGHT * (0.42 + 0.08 * Math.cos(p * Math.PI));
  await followTo(page, ctx, tx, ty, 0.12);
}

async function homeSetup(page) {
  const base = await scrollSetup(page);
  return { ...base, tiles: await findTiles(page) };
}

async function homeStep(page, i, n, ctx) {
  const p = n > 1 ? i / (n - 1) : 0;
  let scrollY = ctx.baseY;
  if (ctx.maxScroll > 0) {
    scrollY = Math.max(0, ctx.baseY + (Math.min(ctx.maxScroll, 420) - ctx.baseY) * Math.sin(Math.PI * ease(p)));
    await scrollTo(page, scrollY);
  }
  if (ctx.tiles.length) {
    const idx = clamp(Math.floor(p * ctx.tiles.length), 0, ctx.tiles.length - 1);
    const t = ctx.tiles[idx];
    await followTo(page, ctx, t.x, clamp(t.y - scrollY, 10, HEIGHT - 10), 0.14);
  } else {
    await followTo(page, ctx, WIDTH * (0.3 + 0.4 * p), HEIGHT * 0.45, 0.1);
  }
}

async function floorSetup(page) {
  const box = await largestCanvas(page);
  const b = box || { x: 0, y: 0, width: WIDTH, height: HEIGHT };
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  return {
    box: b,
    cx,
    cy,
    down: false,
    mouse: makeMouseFollower(cx, cy),
    segments: [
      { a: 20, b: 130, dx: 0.3, dy: 0.04 },
      { a: 150, b: 232, dx: -0.2, dy: -0.07 }
    ]
  };
}

async function floorStep(page, i, n, ctx) {
  const seg = ctx.segments.find((s) => i >= s.a && i <= s.b && s.b < n);
  if (!seg) {
    if (ctx.down) {
      await page.mouse.up();
      ctx.down = false;
    }
    const p = n > 1 ? i / (n - 1) : 0;
    await followTo(page, ctx, ctx.cx + Math.sin(p * Math.PI * 2) * 12, ctx.cy + Math.cos(p * Math.PI * 2) * 8, 0.2);
    return;
  }
  if (i === seg.a) {
    await page.mouse.move(Math.round(ctx.mouse.x), Math.round(ctx.mouse.y));
    await page.mouse.down();
    ctx.down = true;
    ctx.segStart = { x: ctx.mouse.x, y: ctx.mouse.y };
  }
  const t = ease((i - seg.a) / (seg.b - seg.a));
  const start = ctx.segStart || { x: ctx.cx, y: ctx.cy };
  const x = clamp(start.x + seg.dx * ctx.box.width * t, ctx.box.x + 4, ctx.box.x + ctx.box.width - 4);
  const y = clamp(start.y + seg.dy * ctx.box.height * t, ctx.box.y + 4, ctx.box.y + ctx.box.height - 4);
  ctx.mouse.x = x;
  ctx.mouse.y = y;
  await page.mouse.move(Math.round(x), Math.round(y), { steps: 2 });
  if (i === seg.b) {
    await page.mouse.up();
    ctx.down = false;
  }
}

async function floorCleanup(page, ctx) {
  if (ctx && ctx.down) {
    await page.mouse.up();
    ctx.down = false;
  }
}

async function sessionSetup(page) {
  const sphere = await findLargestSphere(page);
  const box = await largestCanvas(page);
  const target = sphere || (box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : { x: WIDTH / 2, y: HEIGHT / 2 });
  return { target, mouse: makeMouseFollower(clamp(target.x - 520, 20, WIDTH - 20), clamp(target.y + 180, 20, HEIGHT - 20)), refreshed: false };
}

async function sessionStep(page, i, n, ctx) {
  const p = n > 1 ? i / (n - 1) : 0;
  if (!ctx.refreshed && p >= 0.3) {
    const again = await findLargestSphere(page);
    if (again) ctx.target = again;
    ctx.refreshed = true;
  }
  if (p < 0.45) {
    await followTo(page, ctx, ctx.target.x, ctx.target.y, 0.08);
  } else {
    const a = (i / FPS) * Math.PI;
    await followTo(page, ctx, ctx.target.x + Math.cos(a) * 3, ctx.target.y + Math.sin(a) * 3, 0.5);
  }
}

async function dockSetup(page) {
  const base = await homeSetup(page);
  const mod = await loadHelper('home-fixtures.mjs');
  if (!mod || typeof mod.openDock !== 'function') throw new Error('openDock is not available in home-fixtures.mjs');
  return { ...base, openDock: mod.openDock, dockAt: 30, dockPromise: null, dockError: null };
}

async function dockStep(page, i, n, ctx) {
  if (i === ctx.dockAt && !ctx.dockPromise) {
    ctx.dockPromise = Promise.resolve()
      .then(() => ctx.openDock(page))
      .catch((e) => {
        ctx.dockError = e;
      });
  }
  if (!ctx.dockPromise) {
    await followTo(page, ctx, WIDTH * 0.78, HEIGHT * 0.82, 0.12);
  }
}

async function dockFinish(page, ctx) {
  if (ctx.dockPromise) await ctx.dockPromise;
  if (!ctx.dockPromise) throw new Error('Ask dock was never opened');
  if (ctx.dockError) throw new Error(`openDock failed: ${ctx.dockError.message || ctx.dockError}`);
}

function sceneDefs() {
  return [
    {
      scene: 2,
      name: 'home-bento',
      seconds: 10,
      open: async (browser) => {
        const h = await requireHelper([['home-fixtures.mjs', 'openHome']], 'Home page');
        return h.fn(browser, { viewport: VIEWPORT, rich: true, reduced: false });
      },
      setup: homeSetup,
      step: homeStep
    },
    {
      scene: 3,
      name: 'market-floor',
      seconds: 10,
      open: async (browser) => {
        const h = await requireHelper([['market-fixtures.mjs', 'openMarket']], 'Market page');
        return h.fn(browser, withNow({ rich: true, viewport: VIEWPORT, hash: '#view=floor', reduced: false }, h.mod.RICH_NOW));
      },
      setup: floorSetup,
      step: floorStep,
      cleanup: floorCleanup
    },
    {
      scene: 4,
      name: 'market-session',
      seconds: 8,
      open: async (browser) => {
        const h = await requireHelper([['market-fixtures.mjs', 'openMarket']], 'Market page');
        return h.fn(browser, withNow({ rich: true, viewport: VIEWPORT, hash: '#view=session', reduced: false }, h.mod.RICH_NOW));
      },
      setup: sessionSetup,
      step: sessionStep
    },
    {
      scene: 5,
      name: 'ticker',
      seconds: 10,
      open: async (browser) => {
        const h = await requireHelper([['glass-world.mjs', 'openGlass']], 'Ticker page');
        return h.fn(browser, { kind: 'ticker', viewport: VIEWPORT, reduced: false });
      },
      setup: scrollSetup,
      step: scrollStep
    },
    {
      scene: 7,
      name: 'status',
      seconds: 8,
      open: async (browser) => {
        const w = await loadHelper('status-world.mjs');
        if (!w || typeof w.serve !== 'function' || typeof w.world !== 'function') throw new Error('no helper opens the Status page');
        const context = await browser.newContext({ viewport: VIEWPORT });
        const page = await context.newPage();
        await page.clock.install({ time: w.NOW });
        await w.serve(page, w.world());
        await page.goto('https://example.test/flows/status/');
        await page.waitForSelector('main', { timeout: 15000 });
        return { page, context };
      },
      setup: scrollSetup,
      step: scrollStep
    },
    {
      scene: 8,
      name: 'ask-dock',
      seconds: 8,
      open: async (browser) => {
        const h = await requireHelper([['home-fixtures.mjs', 'openHome']], 'Home page');
        return h.fn(browser, { viewport: VIEWPORT, rich: true, reduced: false });
      },
      setup: dockSetup,
      step: dockStep,
      finish: dockFinish
    }
  ];
}

async function closePage(page) {
  if (!page) return;
  try {
    await page.context().close();
  } catch {
    try {
      await page.close();
    } catch {
      return;
    }
  }
}

async function captureScene(browser, def, outDir, log) {
  const sceneDir = join(outDir, String(def.scene));
  const total = Math.round(def.seconds * FPS);
  let page = null;
  let ctx = null;
  await rm(sceneDir, { recursive: true, force: true });
  try {
    const opened = await def.open(browser);
    page = opened && opened.page ? opened.page : opened;
    if (!page || typeof page.screenshot !== 'function') throw new Error('helper did not return a page');
    const vp = page.viewportSize();
    if (!vp || vp.width !== WIDTH || vp.height !== HEIGHT) await page.setViewportSize(VIEWPORT);
    await page.evaluate(() => (document.fonts ? document.fonts.ready.then(() => true) : true));
    if (!(await pageHasContent(page))) throw new Error('page rendered no visible content');
    const first = await ensureRibbon(page);
    if (first.missing.length) log(`[film] scene ${def.scene}: custom properties not defined on page: ${first.missing.join(', ')}`);
    if (!first.visible) throw new Error('Sample data ribbon is not visible');
    ctx = def.setup ? await def.setup(page) : {};
    await mkdir(sceneDir, { recursive: true });
    let stepWarned = false;
    const started = performance.now();
    for (let i = 0; i < total; i += 1) {
      if (def.step) {
        try {
          await def.step(page, i, total, ctx);
        } catch (e) {
          if (!stepWarned) {
            log(`[film] scene ${def.scene}: motion step failed at frame ${i + 1}: ${e.message || e}`);
            stepWarned = true;
          }
        }
      }
      const ribbon = await ensureRibbon(page);
      if (!ribbon.visible) throw new Error(`Sample data ribbon not visible at frame ${i + 1}`);
      await page.clock.runFor(SLOT_MS).catch(() => {});
      await page.screenshot({ path: join(sceneDir, frameName(i)), type: 'jpeg', quality: 88, animations: 'allow', fullPage: false, caret: 'hide' });
    }
    if (def.finish) await def.finish(page, ctx);
    const wall = (performance.now() - started) / 1000;
    log(`[film] scene ${def.scene} ${def.name}: ${total} frames in ${wall.toFixed(1)} s`);
    return {
      scene: def.scene,
      name: def.name,
      frames: total,
      first: frameName(0),
      last: frameName(total - 1),
      durationSeconds: total / FPS,
      fps: FPS,
      dir: String(def.scene)
    };
  } catch (e) {
    const reason = String((e && e.message) || e);
    await rm(sceneDir, { recursive: true, force: true });
    log(`[film] scene ${def.scene} ${def.name} skipped: ${reason}`);
    return { scene: def.scene, name: def.name, skipped: true, reason };
  } finally {
    if (def.cleanup && page && ctx) {
      try {
        await def.cleanup(page, ctx);
      } catch {
        ctx = null;
      }
    }
    await closePage(page);
  }
}

export async function captureScenes({ outDir, log, only = null } = {}) {
  if (!outDir) throw new Error('captureScenes requires outDir');
  const say = typeof log === 'function' ? log : (m) => console.log(m);
  const root = resolve(outDir);
  await mkdir(root, { recursive: true });
  const scenes = [];
  let browser = null;
  try {
    browser = await launch();
    for (const def of sceneDefs().filter((d) => !only || only.includes(d.scene))) {
      scenes.push(await captureScene(browser, def, root, say));
    }
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        say(`[film] browser close failed: ${e.message || e}`);
      }
    }
  }
  const manifest = {
    film: 'Flows walkthrough v2',
    width: WIDTH,
    height: HEIGHT,
    fps: FPS,
    ribbon: RIBBON_TEXT,
    scenes
  };
  if (only) {
    try {
      const prev = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
      const keep = prev.scenes.filter((s) => !only.includes(s.scene));
      manifest.scenes = [...keep, ...scenes].sort((a, b) => a.scene - b.scene);
    } catch {
      manifest.scenes = scenes;
    }
  }
  await writeFile(join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const captured = scenes.filter((s) => !s.skipped).length;
  say(`[film] manifest written: ${captured} captured, ${scenes.length - captured} skipped`);
  return manifest;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--out') {
      out.outDir = argv[i + 1];
      i += 1;
    } else if (a.startsWith('--out=')) {
      out.outDir = a.slice('--out='.length);
    } else if (a === '--only') {
      out.only = argv[i + 1].split(',').map(Number);
      i += 1;
    }
  }
  return out;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.outDir) {
    console.error('usage: node tests/film/capture.mjs --out <dir>');
    process.exitCode = 2;
  } else {
    captureScenes({ outDir: args.outDir, only: args.only, log: (m) => console.log(m) })
      .then((m) => {
        if (!m.scenes.some((s) => !s.skipped)) process.exitCode = 1;
      })
      .catch((e) => {
        console.error(`[film] capture failed: ${(e && e.stack) || e}`);
        process.exitCode = 1;
      });
  }
}
