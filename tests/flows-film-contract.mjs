import assert from "node:assert/strict";
import { existsSync, statSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { aboutPage } from "../shared/flows-pages.js";
import { flowsFilmRows } from "../server/routes/flows-film.js";
import { captureScenes } from "./film/capture.mjs";
import { assembleFilm } from "./film/assemble.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const imgDir = join(root, "assets", "img");
const base = "flows-walkthrough-v2";
const MAX_MP4 = 8 * 1024 * 1024;

async function toHtml(out) {
  const v = await out;
  if (typeof v === "string") return v;
  if (v && typeof v.text === "function") return await v.text();
  if (v && typeof v.body === "string") return v.body;
  if (v && typeof v.html === "string") return v.html;
  return String(v ?? "");
}

function stripTags(s) {
  return s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

assert.equal(typeof captureScenes, "function", "the capture tool exports captureScenes");
assert.equal(typeof assembleFilm, "function", "the assembly tool exports assembleFilm");

const html = await toHtml(aboutPage());

const filmMatch = html.match(/<section[^>]*aria-labelledby="aFilm"[\s\S]*?<\/section>/);
assert.ok(filmMatch, "about page has the aFilm section");
const film = filmMatch[0];
assert.match(film, /<h2[^>]*id="aFilm"[^>]*>\s*The walkthrough\s*<\/h2>/);

const videoMatch = film.match(/<video\b[^>]*>/);
assert.ok(videoMatch, "about page has a video element");
const videoTag = videoMatch[0];
assert.match(videoTag, /\bposter="\/assets\/img\/flows-walkthrough-v2\.jpg"/);
assert.match(videoTag, /\bcontrols\b/);
assert.match(videoTag, /\bpreload="none"/);
assert.match(videoTag, /\bplaysinline\b/);
assert.doesNotMatch(videoTag, /\bautoplay\b/i);
assert.doesNotMatch(videoTag, /\bloop\b/i);
assert.doesNotMatch(html, /<video\b[^>]*\bautoplay\b/i);

assert.match(film, /<source\b[^>]*src="\/flows\/about\/film\.mp4"[^>]*>/);
const trackMatch = film.match(/<track\b[^>]*>/);
assert.ok(trackMatch, "video has a track element");
const trackTag = trackMatch[0];
assert.match(trackTag, /\bkind="captions"/);
assert.match(trackTag, /\bsrclang="en"/);
assert.match(trackTag, /\blabel="English"/);
assert.match(trackTag, /\bsrc="\/assets\/img\/flows-walkthrough-v2\.vtt"/);
assert.match(trackTag, /\bdefault\b/);

const captionTexts = [];
for (const m of html.matchAll(/<(figcaption|caption)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
  captionTexts.push(stripTags(m[2]));
}
assert.ok(captionTexts.length > 0, "about page has at least one figcaption");
for (const text of captionTexts) {
  assert.doesNotMatch(text, /tape/i, `caption must not mention the banned word: ${text}`);
  assert.match(text, /sample|Sample/, `caption must mention sample data: ${text}`);
}

for (const ext of ["mp4", "jpg", "vtt"]) {
  const p = join(imgDir, `${base}.${ext}`);
  assert.ok(existsSync(p), `${base}.${ext} is committed`);
  {
    const st = statSync(p);
    assert.ok(st.isFile(), `${base}.${ext} is a file`);
    assert.ok(st.size > 0, `${base}.${ext} is not empty`);
  }
}

const mp4 = join(imgDir, `${base}.mp4`);
if (existsSync(mp4)) {
  assert.ok(statSync(mp4).size < MAX_MP4, "mp4 is under 8 MB");
}

const vtt = join(imgDir, `${base}.vtt`);
if (existsSync(vtt)) {
  const body = readFileSync(vtt, "utf8");
  assert.match(body, /^\uFEFF?WEBVTT/);
  assert.doesNotMatch(body, /tape/i, "captions must not mention the banned word");
}


{
  const bytes = new Uint8Array(1000).map((_, i) => i % 251);
  const env = { ASSETS: { fetch: async () => new Response(bytes, { status: 200 }) } };
  const [row] = flowsFilmRows();
  assert.equal(row.path, "/flows/about/film.mp4");
  const call = (range, method = "GET", e = env) => row.handler({ request: new Request("https://x.test/flows/about/film.mp4", { method, headers: range ? { Range: range } : {} }), env: e, url: new URL("https://x.test/flows/about/film.mp4") });
  const whole = await call(null);
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get("accept-ranges"), "bytes");
  assert.equal((await whole.arrayBuffer()).byteLength, 1000);
  const part = await call("bytes=10-19");
  assert.equal(part.status, 206);
  assert.equal(part.headers.get("content-range"), "bytes 10-19/1000");
  assert.deepEqual([...new Uint8Array(await part.arrayBuffer())], [...bytes.slice(10, 20)]);
  const open = await call("bytes=990-");
  assert.equal(open.headers.get("content-range"), "bytes 990-999/1000");
  const suffix = await call("bytes=-5");
  assert.equal(suffix.headers.get("content-range"), "bytes 995-999/1000");
  assert.equal((await call("bytes=0-99999")).headers.get("content-range"), "bytes 0-999/1000");
  assert.equal((await call("bytes=2000-")).status, 416);
  assert.equal((await call("bytes=0-9", "HEAD")).status, 206);
  await assert.rejects(call(null, "GET", { ...env, FLOWS_FRONT_DOOR: "off" }));
  await assert.rejects(call(null, "GET", { ASSETS: { fetch: async () => new Response("", { status: 404 }) } }));
}

console.log("✓ flows-film: the About page carries the walkthrough as a captioned video with a poster, no autoplay, a sample-data caption and no banned word, and the film files stay under 8 MB");