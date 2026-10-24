import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const FFMPEG = process.env.FFMPEG_PATH || '/usr/bin/ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || '/usr/bin/ffprobe';
const FPS = 15;
const WIDTH = 1920;
const HEIGHT = 1080;
const XFADE_FRAMES = 12;
const XFADE = XFADE_FRAMES / FPS;
const MAX_BYTES = 8 * 1024 * 1024;
const MIN_SECONDS = 20;
const INTRO_FRAMES = 20;
const BASENAME = 'flows-walkthrough-v2';
const MAX_CAPTION_WORDS = 14;

const SCENES = [
  { scene: 1, card: 'title', seconds: 4, caption: 'Flows is an options-flow research site for US equities.' },
  { scene: 2, caption: 'The Home page gathers the day\u2019s flow into a bento of cards.' },
  { scene: 3, caption: 'The Market Floor view lays out flagged options activity across sectors.' },
  { scene: 4, caption: 'The Session river shows how premium moved through the trading day.' },
  { scene: 5, caption: 'A ticker page details one name\u2019s contracts, strikes and expiries.' },
  { scene: 6, caption: 'The Premium desk ranks the largest premium trades of the session.' },
  { scene: 7, caption: 'The Status page shows feed health and job timings for the owner.' },
  { scene: 8, caption: 'The Ask dock opens on Home for questions about the flow.' },
  { scene: 9, card: 'end', seconds: 5, caption: 'Fire and Forget. All figures are sample data and not advice.' }
];

const CARDS = {
  title: { title: 'Flows', subtitle: 'Options-flow research for US equities' },
  end: { title: 'Fire &amp; Forget', subtitle: 'Sample data. Not advice.' }
};

const defaultLog = (...args) => console.log('[film:assemble]', ...args);

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function checkCaptions() {
  for (const s of SCENES) {
    const n = wordCount(s.caption);
    if (n > MAX_CAPTION_WORDS) {
      throw new Error(`Caption for scene ${s.scene} has ${n} words, limit is ${MAX_CAPTION_WORDS}`);
    }
    if (/\btape\b/i.test(s.caption)) {
      throw new Error(`Caption for scene ${s.scene} uses a forbidden word`);
    }
  }
}

function cardHtml(kind) {
  const card = CARDS[kind];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
:root {
  --card-bg-core: #16264d;
  --card-bg-mid: #0b1530;
  --card-bg-edge: #040814;
  --card-glow: rgba(96, 140, 255, 0.22);
  --card-glass: rgba(255, 255, 255, 0.06);
  --card-glass-edge: rgba(255, 255, 255, 0.14);
  --card-shadow: rgba(0, 0, 0, 0.45);
  --card-title: #ffffff;
  --card-subtitle: rgba(226, 234, 255, 0.78);
  --card-rule: rgba(160, 190, 255, 0.55);
  --card-ribbon-bg: #f2b33d;
  --card-ribbon-ink: #1a1203;
  --card-ribbon-shadow: rgba(0, 0, 0, 0.35);
  --p: 1;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body {
  width: ${WIDTH}px;
  height: ${HEIGHT}px;
  overflow: hidden;
}
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Helvetica, Arial, "Noto Sans", "Liberation Sans", sans-serif;
  background: radial-gradient(ellipse 70% 80% at 50% 42%, var(--card-bg-core) 0%, var(--card-bg-mid) 52%, var(--card-bg-edge) 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  -webkit-font-smoothing: antialiased;
}
.glow {
  position: absolute;
  width: 1100px;
  height: 1100px;
  left: 50%;
  top: 46%;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: radial-gradient(circle, var(--card-glow) 0%, transparent 62%);
  opacity: var(--p);
}
.panel {
  position: relative;
  padding: 88px 132px 96px;
  border-radius: 40px;
  background: var(--card-glass);
  border: 1px solid var(--card-glass-edge);
  box-shadow: 0 40px 120px var(--card-shadow);
  backdrop-filter: blur(24px);
  text-align: center;
  opacity: var(--p);
  transform: translateY(calc((1 - var(--p)) * 28px)) scale(calc(0.97 + var(--p) * 0.03));
}
h1 {
  color: var(--card-title);
  font-size: 168px;
  font-weight: 700;
  letter-spacing: -0.035em;
  line-height: 1;
}
.rule {
  width: 120px;
  height: 4px;
  margin: 44px auto 40px;
  border-radius: 2px;
  background: var(--card-rule);
}
p {
  color: var(--card-subtitle);
  font-size: 48px;
  font-weight: 400;
  letter-spacing: -0.005em;
}
.ribbon {
  position: absolute;
  top: 58px;
  right: -86px;
  width: 400px;
  transform: rotate(45deg);
  background: var(--card-ribbon-bg);
  color: var(--card-ribbon-ink);
  text-align: center;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 14px 0;
  box-shadow: 0 8px 24px var(--card-ribbon-shadow);
}
</style>
</head>
<body>
<div class="glow"></div>
<main class="panel">
<h1>${card.title}</h1>
<div class="rule"></div>
<p>${card.subtitle}</p>
</main>
<div class="ribbon">Sample data</div>
</body>
</html>`;
}

function ease(t) {
  const c = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - c, 3);
}

async function linkFile(src, dest) {
  try {
    await fs.symlink(src, dest);
  } catch {
    await fs.copyFile(src, dest);
  }
}

async function renderCards(cards, stageDir, log) {
  if (!cards.length) return;
  const { launch } = await import('../lib/browser.mjs');
  const browser = await launch();
  try {
    const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    for (const item of cards) {
      const total = Math.round(item.seconds * FPS);
      const dir = path.join(stageDir, `s${String(item.scene).padStart(2, '0')}`);
      await fs.mkdir(dir, { recursive: true });
      await page.setContent(cardHtml(item.card), { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      const animated = Math.min(INTRO_FRAMES, total);
      let lastPath = null;
      for (let i = 0; i < animated; i += 1) {
        const p = animated > 1 ? ease(i / (animated - 1)) : 1;
        await page.evaluate((v) => document.documentElement.style.setProperty('--p', String(v)), p);
        lastPath = path.join(dir, `${String(i + 1).padStart(5, '0')}.png`);
        await page.screenshot({ path: lastPath, type: 'png', clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });
      }
      for (let i = animated; i < total; i += 1) {
        await linkFile(lastPath, path.join(dir, `${String(i + 1).padStart(5, '0')}.png`));
      }
      item.dir = dir;
      item.ext = '.png';
      item.count = total;
      log(`rendered ${item.card} card, ${total} frames`);
    }
    await context.close();
  } finally {
    await browser.close();
  }
}

function sortFrames(names) {
  return names
    .filter((n) => /\.(png|jpe?g)$/i.test(n))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

async function isDir(p) {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

function frameNumber(name) {
  const m = /(\d+)\.[a-z]+$/i.exec(name);
  return m ? Number(m[1]) : NaN;
}

function boundIndex(files, marker, fallback) {
  if (marker === undefined || marker === null) return fallback;
  if (typeof marker === 'string') {
    const base = path.basename(marker);
    const idx = files.indexOf(base);
    return idx >= 0 ? idx : fallback;
  }
  if (typeof marker === 'number') {
    const idx = files.findIndex((f) => frameNumber(f) === marker);
    return idx >= 0 ? idx : fallback;
  }
  return fallback;
}

async function resolveSceneFrames(entry, framesDir) {
  const n = Number(entry.scene);
  const pad = String(n).padStart(2, '0');
  const candidates = [entry.dir, entry.path, entry.folder]
    .filter((v) => typeof v === 'string' && v)
    .map((v) => (path.isAbsolute(v) ? v : path.join(framesDir, v)));
  candidates.push(
    path.join(framesDir, `scene-${pad}`),
    path.join(framesDir, `scene-${n}`),
    path.join(framesDir, `scene${pad}`),
    path.join(framesDir, `scene${n}`),
    path.join(framesDir, `s${pad}`),
    path.join(framesDir, pad),
    path.join(framesDir, String(n)),
    path.join(framesDir, String(entry.scene))
  );
  for (const dir of candidates) {
    if (!(await isDir(dir))) continue;
    let files = sortFrames(await fs.readdir(dir));
    if (Array.isArray(entry.frames) && entry.frames.length) {
      const wanted = new Set(entry.frames.map((f) => path.basename(String(f))));
      const picked = files.filter((f) => wanted.has(f));
      if (picked.length) files = picked;
    }
    if (!files.length) continue;
    const start = boundIndex(files, entry.first, 0);
    const end = boundIndex(files, entry.last, files.length - 1);
    if (end >= start) files = files.slice(start, end + 1);
    const ext = path.extname(files[0]).toLowerCase();
    files = files.filter((f) => path.extname(f).toLowerCase() === ext);
    return { dir, files, ext };
  }
  return null;
}

async function stageCapture(item, source, stageDir) {
  const dir = path.join(stageDir, `s${String(item.scene).padStart(2, '0')}`);
  await fs.mkdir(dir, { recursive: true });
  for (let i = 0; i < source.files.length; i += 1) {
    await linkFile(path.join(source.dir, source.files[i]), path.join(dir, `${String(i + 1).padStart(5, '0')}${source.ext}`));
  }
  item.dir = dir;
  item.ext = source.ext;
  item.count = source.files.length;
}

function run(cmd, args, log) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; if (err.length > 200000) err = err.slice(-100000); });
    child.on('error', (e) => reject(new Error(`Failed to start ${cmd}: ${e.message}`)));
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ out, err });
      } else {
        const tail = err.split('\n').slice(-25).join('\n');
        if (log) log(tail);
        reject(new Error(`${path.basename(cmd)} exited with code ${code}\n${tail}`));
      }
    });
  });
}

function vttTime(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(r).padStart(3, '0')}`;
}

function buildTimeline(items) {
  let acc = 0;
  items.forEach((item, i) => {
    item.duration = item.count / FPS;
    item.start = i === 0 ? 0 : acc - XFADE;
    acc = item.start + item.duration;
  });
  const total = acc;
  items.forEach((item, i) => {
    item.cueStart = i === 0 ? 0 : item.start + XFADE / 2;
    item.cueEnd = i === items.length - 1 ? total : item.start + item.duration - XFADE / 2;
  });
  return total;
}

function buildFilter(items) {
  const parts = items.map((item, i) =>
    `[${i}:v]fps=${FPS},scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p,settb=AVTB[v${i}]`
  );
  let prev = 'v0';
  for (let i = 1; i < items.length; i += 1) {
    const label = i === items.length - 1 ? 'vout' : `x${i}`;
    parts.push(`[${prev}][v${i}]xfade=transition=fade:duration=${XFADE.toFixed(3)}:offset=${items[i].start.toFixed(3)}[${label}]`);
    prev = label;
  }
  if (items.length === 1) parts.push('[v0]null[vout]');
  return parts.join(';');
}

function buildVtt(items) {
  const lines = ['WEBVTT', ''];
  items.forEach((item, i) => {
    lines.push(String(i + 1));
    lines.push(`${vttTime(item.cueStart)} --> ${vttTime(item.cueEnd)}`);
    lines.push(item.caption);
    lines.push('');
  });
  return lines.join('\n');
}

async function probe(file, log) {
  const { out } = await run(FFPROBE, [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,codec_name,pix_fmt:format=duration,size',
    '-of', 'json',
    file
  ], log);
  const data = JSON.parse(out);
  const stream = (data.streams || [])[0] || {};
  const format = data.format || {};
  return {
    width: Number(stream.width),
    height: Number(stream.height),
    codec: stream.codec_name,
    pixFmt: stream.pix_fmt,
    duration: Number(format.duration),
    size: Number(format.size)
  };
}

async function readManifest(framesDir) {
  const file = path.join(framesDir, 'manifest.json');
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (e) {
    throw new Error(`Cannot read manifest at ${file}: ${e.message}`);
  }
  const data = JSON.parse(raw);
  const list = Array.isArray(data) ? data : Array.isArray(data?.scenes) ? data.scenes : null;
  if (!list) throw new Error(`Manifest at ${file} is not an array of scenes`);
  return list;
}

export async function assembleFilm({ framesDir, outDir, log = defaultLog } = {}) {
  if (!framesDir) throw new Error('framesDir is required');
  if (!outDir) throw new Error('outDir is required');
  checkCaptions();
  const framesRoot = path.resolve(framesDir);
  const outRoot = path.resolve(outDir);
  await fs.mkdir(outRoot, { recursive: true });
  const manifest = await readManifest(framesRoot);
  const byScene = new Map();
  for (const entry of manifest) {
    const n = Number(entry?.scene);
    if (Number.isFinite(n)) byScene.set(n, entry);
  }
  const stageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flows-film-'));
  try {
    const items = [];
    const cards = [];
    for (const def of SCENES) {
      if (def.card) {
        const item = { scene: def.scene, card: def.card, seconds: def.seconds, caption: def.caption };
        items.push(item);
        cards.push(item);
        continue;
      }
      const entry = byScene.get(def.scene);
      if (!entry) {
        log(`scene ${def.scene} skipped: not in manifest`);
        continue;
      }
      if (entry.skipped) {
        log(`scene ${def.scene} skipped: ${entry.reason || 'no reason given'}`);
        continue;
      }
      const source = await resolveSceneFrames(entry, framesRoot);
      if (!source) {
        log(`scene ${def.scene} skipped: no frames found`);
        continue;
      }
      if (source.files.length <= XFADE_FRAMES * 2) {
        log(`scene ${def.scene} skipped: only ${source.files.length} frames`);
        continue;
      }
      const item = { scene: def.scene, caption: def.caption };
      await stageCapture(item, source, stageDir);
      items.push(item);
      log(`scene ${def.scene}: ${item.count} frames from ${source.dir}`);
    }
    await renderCards(cards, stageDir, log);
    const total = buildTimeline(items);
    log(`timeline ${total.toFixed(2)} s across ${items.length} scenes`);

    const mp4 = path.join(outRoot, `${BASENAME}.mp4`);
    const poster = path.join(outRoot, `${BASENAME}.jpg`);
    const vtt = path.join(outRoot, `${BASENAME}.vtt`);

    const inputs = [];
    for (const item of items) {
      inputs.push('-framerate', String(FPS), '-start_number', '1', '-f', 'image2', '-i', path.join(item.dir, `%05d${item.ext}`));
    }
    await run(FFMPEG, [
      '-hide_banner', '-loglevel', 'error', '-y',
      ...inputs,
      '-filter_complex', buildFilter(items),
      '-map', '[vout]',
      '-an',
      '-c:v', 'libx264',
      '-preset', 'slow',
      '-crf', '26',
      '-pix_fmt', 'yuv420p',
      '-profile:v', 'high',
      '-r', String(FPS),
      '-movflags', '+faststart',
      mp4
    ], log);
    log(`wrote ${mp4}`);

    const captured = items.filter((i) => !i.card);
    const posterItem = captured.find((i) => i.scene === 2) || captured[0] || items[0];
    const posterIndex = posterItem.scene === 2 ? Math.min(40, posterItem.count) : Math.min(40, posterItem.count);
    const posterFrame = path.join(posterItem.dir, `${String(posterIndex).padStart(5, '0')}${posterItem.ext}`);
    await run(FFMPEG, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', posterFrame,
      '-vf', 'scale=1280:720:flags=lanczos,format=yuvj420p',
      '-frames:v', '1',
      '-update', '1',
      '-q:v', '3',
      poster
    ], log);
    log(`wrote ${poster} from scene ${posterItem.scene} frame ${posterIndex}`);

    await fs.writeFile(vtt, buildVtt(items), 'utf8');
    log(`wrote ${vtt}`);

    const info = await probe(mp4, log);
    const stat = await fs.stat(mp4);
    const size = stat.size;
    const problems = [];
    if (size > MAX_BYTES) problems.push(`file is ${(size / 1048576).toFixed(2)} MB, limit is 8 MB`);
    if (info.width !== WIDTH || info.height !== HEIGHT) problems.push(`resolution is ${info.width}x${info.height}, expected ${WIDTH}x${HEIGHT}`);
    if (!Number.isFinite(info.duration) || info.duration < MIN_SECONDS) problems.push(`duration is ${info.duration} s, minimum is ${MIN_SECONDS} s`);
    if (problems.length) throw new Error(`Film check failed for ${mp4}: ${problems.join('; ')}`);
    log(`verified ${info.width}x${info.height}, ${info.duration.toFixed(2)} s, ${(size / 1048576).toFixed(2)} MB`);

    return {
      mp4,
      poster,
      vtt,
      duration: info.duration,
      size,
      scenes: items.map((i) => ({ scene: i.scene, start: i.start, duration: i.duration, frames: i.count }))
    };
  } finally {
    await fs.rm(stageDir, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--frames') opts.framesDir = argv[++i];
    else if (a.startsWith('--frames=')) opts.framesDir = a.slice(9);
    else if (a === '--out') opts.outDir = argv[++i];
    else if (a.startsWith('--out=')) opts.outDir = a.slice(6);
  }
  return opts;
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invoked === fileURLToPath(import.meta.url)) {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.framesDir || !opts.outDir) {
    console.error('Usage: node tests/film/assemble.mjs --frames <dir> --out <dir>');
    process.exit(2);
  }
  assembleFilm({ framesDir: opts.framesDir, outDir: opts.outDir, log: defaultLog })
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(`[film:assemble] ${e.message}`);
      process.exit(1);
    });
}
