import { fixedHalfUp } from "./flows-display-round.js";
import { FRESH_CLASSES } from "./flows-freshness.js";

export const SAMPLE_CAP = 64;

export const SPREAD_MIN = 20;

export const TRT_OFFSET_MS = 3 * 3600 * 1000;

const pad = (n, w = 2) => String(n).padStart(w, "0");

export function trtClock(ms, { seconds = false, millis = false } = {}) {
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms + TRT_OFFSET_MS);
  let out = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  if (seconds || millis) out += `:${pad(d.getUTCSeconds())}`;
  if (millis) out += `.${pad(d.getUTCMilliseconds(), 3)}`;
  return out + " TRT";
}

export function createSamples(cap = SAMPLE_CAP) {
  const buf = [];
  let head = 0;
  return {
    add(v) {
      if (!Number.isFinite(v)) return;
      if (buf.length < cap) buf.push(v); else { buf[head] = v; head = (head + 1) % cap; }
    },
    summary() {
      const n = buf.length;
      if (!n) return { n: 0, p50: null, p95: null };
      const xs = buf.slice().sort((a, b) => a - b);
      const at = (q) => xs[Math.min(n - 1, Math.max(0, Math.ceil(q * n) - 1))];
      return { n, p50: at(0.5), p95: at(0.95) };
    },
    clear() { buf.length = 0; head = 0; },
  };
}

export function ageText(sec) {
  if (!Number.isFinite(sec)) return null;
  const s = Math.max(0, sec);
  if (s < 10) return fixedHalfUp(s, 1) + " s";
  if (s < 60) return Math.floor(s) + " s";
  if (s < 3600) return Math.floor(s / 60) + " min";
  return Math.floor(s / 3600) + " h";
}

export function nextTickMs(sec) {
  const s = Math.max(0, sec);
  if (s < 10) return 250 - ((s * 1000) % 250) + 5;
  if (s < 60) return 1000 - ((s * 1000) % 1000) + 5;
  return 60000 - ((s * 1000) % 60000) + 5;
}

export const lagText = (ms) => {
  if (!Number.isFinite(ms)) return null;
  const s = ms / 1000;
  return s < 10 ? fixedHalfUp(s, 1) + " s" : Math.round(s) + " s";
};

export function hubAgeS(hub, nowPerf) {
  if (!hub || !Number.isFinite(hub.atMs) || !Number.isFinite(hub.readAtMs) || !Number.isFinite(hub.perf)) return null;
  return Math.max(0, (hub.atMs - hub.readAtMs + (nowPerf - hub.perf)) / 1000);
}

export const RT_WINDOWS = Object.freeze({ liveS: FRESH_CLASSES.rt.liveS, staleS: FRESH_CLASSES.rt.staleS });

export function verdictOf({ mode, hidden = false, catching = false, closed = null, ageS = null, paused = null, serverAgeS = null }) {
  if (paused) return { state: "paused", tone: "bad", word: "Paused" };
  if (hidden) return { state: "hidden", tone: "idle", word: "Paused while hidden" };
  if (catching) return { state: "catching", tone: "warn", word: "Catching up" };
  if (mode === "off" || mode === "none") {
    if (serverAgeS === null) return { state: "pending", tone: "idle", word: "Connecting" };
    return { state: "server", tone: serverAgeS > 600 ? "warn" : "ok", word: "Server copy" };
  }
  if (closed) return { state: "closed", tone: "idle", word: "Closed" };
  if (ageS === null) return { state: "pending", tone: "idle", word: "Connecting" };
  if (ageS <= RT_WINDOWS.liveS) return { state: "live", tone: "ok", word: "Live" };
  if (ageS <= RT_WINDOWS.staleS) return { state: "delayed", tone: "warn", word: "Delayed" };
  return { state: "stale", tone: "bad", word: "Stale" };
}

const GLYPH = Object.freeze({ ok: "✓", warn: "!", bad: "✕", idle: "○" });

const chip = (id, tone, label, value, title = "") => ({ id, tone, glyph: GLYPH[tone], label, value, title });

function transportWord(mode, pollMs) {
  if (mode === "socket") return "Socket";
  if (mode === "poll") return "Polling " + Math.round(pollMs / 1000) + " s";
  if (mode === "heartbeat") return "Heartbeat";
  return "Rail off";
}

export function stripModel(m) {
  const nowPerf = m.nowPerf;
  const ageS = hubAgeS(m.hub, nowPerf);
  const serverAgeS = Number.isFinite(m.serverReadAtMs) ? Math.max(0, (m.nowMs - m.serverReadAtMs) / 1000) : null;
  const verdict = verdictOf({ mode: m.mode, hidden: m.hidden, catching: m.catching, closed: m.closed, ageS, paused: m.paused, serverAgeS });
  const chips = [];
  let value;
  if (verdict.state === "paused") value = m.paused;
  else if (verdict.state === "hidden") value = "refetching on return";
  else if (verdict.state === "catching") value = "refetching";
  else if (verdict.state === "server") value = `as of ${m.serverReadAtMs ? trtClock(m.serverReadAtMs, { seconds: true }) : "—"}`;
  else if (verdict.state === "closed") value = m.closedText || "market closed";
  else if (verdict.state === "pending") value = "no read yet";
  else value = `${transportWord(m.mode, m.pollMs)} · hub read ${ageText(ageS)} ago`;
  let title = "";
  if (m.hub && Number.isFinite(m.hub.atMs)) title = `Last frame ${trtClock(m.hub.atMs, { millis: true })}. Live within ${RT_WINDOWS.liveS} s, stale after ${RT_WINDOWS.staleS} s. Counted from the frame's own stamps, without the trip to this browser.`;
  if (verdict.state === "delayed") value += ` · live under ${RT_WINDOWS.liveS} s`;
  if (verdict.state === "stale" && m.hub && Number.isFinite(m.hub.readAtMs)) value += ` · figures to ${trtClock(m.hub.readAtMs, { seconds: true })}`;
  if (m.holdText && ["live", "delayed", "stale"].includes(verdict.state)) value += ` · ${m.holdText}`;
  chips.push(chip("feed", verdict.tone, verdict.word, value, title));
  chips.push(chip("newest", m.newestEndMs ? "ok" : "idle", "Newest window", m.newestEndMs ? trtClock(m.newestEndMs, { seconds: true }) : "—", "Window end, as the vendor stamps it, to the second."));
  const lag = m.lag || { n: 0, p50: null, p95: null };
  const tr = m.transit || { n: 0, p50: null, p95: null };
  let lagValue;
  if (m.mode === "off" || m.mode === "none") lagValue = "— rail off";
  else if (!lag.n) lagValue = "— no new windows yet";
  else if (lag.n < SPREAD_MIN) lagValue = `${lagText(lag.p50)} p50 · n ${lag.n}`;
  else lagValue = `${lagText(lag.p50)} p50 · ${lagText(lag.p95)} p95 · n ${lag.n}`;
  chips.push(chip("lag", lag.n ? "ok" : "idle", "Vendor to hub", lagValue, "Hub read time minus the window's own stamp. Both are server clocks; the vendor stamps whole seconds."));
  let transitValue;
  if (m.mode !== "socket") transitValue = m.mode === "poll" ? "— not measured while polling" : "—";
  else if (!tr.n) transitValue = "— too few frames";
  else transitValue = `+${lagText(tr.p50)} over best seen · n ${tr.n} · estimate`;
  chips.push(chip("transit", m.mode === "socket" && tr.n ? "ok" : "idle", "Hub to screen", transitValue, "Receive time minus the hub's send time, less the smallest seen. An estimate: the two clocks are not synchronised."));
  const held = Number.isFinite(m.held) ? m.held : null;
  const seen = Number.isFinite(m.seen) ? m.seen : null;
  let heldValue = held === null ? "—" : `${held} held` + (seen !== null ? ` of ${seen} seen` : "");
  if (m.pageOnly) heldValue += ` · ${m.pageOnly} not in the server copy`;
  chips.push(chip("held", held === null ? "idle" : "ok", "Windows", heldValue, "The largest windows by premium that this page has seen today."));
  const p = m.parity || { state: "pending" };
  const d = m.drift || { runs: 0, count: 0, events: 0, at: null, rebuiltAt: null };
  let checkTone = "idle";
  let checkValue = "not yet checked";
  if (p.state === "mismatch") { checkTone = "bad"; checkValue = p.text || "this browser computed a different figure than the server"; }
  else if (d.count > 0) { checkTone = "bad"; checkValue = d.rebuiltAt ? `drift ${d.events} · rebuilt ${trtClock(d.rebuiltAt, { seconds: true })}` : `drift ${d.count}`; }
  else if (p.state === "ok" && d.runs > 0) { checkTone = "ok"; checkValue = `server match ${p.at ? trtClock(p.at, { seconds: true }) : "—"} · drift 0 · ${d.runs} checks`; }
  else if (p.state === "ok") { checkTone = "ok"; checkValue = `server match ${p.at ? trtClock(p.at, { seconds: true }) : "—"}`; }
  chips.push(chip("check", checkTone, "Recompute", checkValue, "The live books are checked against a full recompute and the server's figures."));
  const tide = m.tide;
  if (tide && Number.isFinite(tide.atMs)) {
    const newer = Number.isFinite(tide.newer) ? tide.newer : 0;
    chips.push(chip("tide", "ok", "Sector tide", `to ${trtClock(tide.atMs)}` + (newer ? ` · ${newer} newer held ${newer === 1 ? "window" : "windows"} not in it` : ""), "Outside is the sector tide less held windows ending by its last bar."));
  } else chips.push(chip("tide", "idle", "Sector tide", "—", "No sector tide is read for this session."));
  return { verdict, chips, ageS };
}

export function countFrame(from, to, p) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || !(p < 1)) return to;
  const e = 1 - Math.pow(1 - Math.max(0, p), 3);
  return Math.round(from + (to - from) * e) + 0;
}

export function textHash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(16).padStart(8, "0");
}
