const PENDING = { status: 200, contentType: "application/json", body: JSON.stringify({ status: "pending" }) };
const LK_URL = /\/api\/flows\/lk\?/;

const lower = (headers) => Object.fromEntries(Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), String(v)]));

export function lkEntry(answer) {
  const h = lower(answer.headers);
  const status = answer.status || 200;
  let body = answer.json;
  if (body === undefined && typeof answer.body === "string") { try { body = JSON.parse(answer.body); } catch { body = null; } }
  const fresh = h["x-fresh-state"] ? {
    state: h["x-fresh-state"], reason: h["x-fresh-reason"] || null, klass: h["x-fresh-class"] || null,
    readAt: h["x-fresh-read-at"] || null, source: h["x-fresh-source"] || null, cadenceS: Number(h["x-fresh-cadence"]) || 0,
    session: h["x-fresh-session"] || null, liveUntil: h["x-fresh-live-until"] || null, staleAt: h["x-fresh-stale-at"] || null,
  } : undefined;
  const phase = h["x-fresh-phase"] ? { phase: h["x-fresh-phase"], endsAt: h["x-fresh-phase-ends"] || null } : null;
  const serverNow = h["x-server-now"] ? Number(h["x-server-now"]) : null;
  const pending = status !== 200 || !body || typeof body !== "object" || body.status === "pending";
  const entry = pending ? { status: "pending" } : { status: "ok", payload: body, updatedAt: Number(h["x-payload-updated"]) || null };
  if (fresh) entry.fresh = fresh;
  return { entry, phase, serverNow };
}

export function lkEnvelope(answers, base = null) {
  const env = { serverNow: base ? base.serverNow : null, phase: base ? base.phase : null, keys: { ...(base ? base.keys : {}) } };
  for (const [k, answer] of Object.entries(answers)) {
    const { entry, phase, serverNow } = lkEntry(answer);
    env.keys[k] = entry;
    if (phase) env.phase = phase;
    if (serverNow !== null) env.serverNow = serverNow;
  }
  return env;
}

export async function lkMock(target, { stub = false } = {}) {
  const mocks = new Map();
  const capture = (handler, request) => new Promise((resolve, reject) => {
    const fake = {
      request: () => request, fulfill: (o) => resolve(o || {}), fallback: () => resolve(null), continue: () => resolve(null),
      abort: () => resolve({ status: 0 }), fetch: () => Promise.reject(new Error("an lk mock answers from its fixture, never the network")),
    };
    Promise.resolve().then(() => handler(fake, request)).catch(reject);
  });
  await target.route(LK_URL, async (route) => {
    const request = route.request();
    const keys = (new URL(request.url()).searchParams.get("k") || "").split(",").map((k) => k.trim()).filter(Boolean);
    if (keys.length === 1) {
      const handler = mocks.get(keys[0]);
      return handler ? handler(route, request) : route.fallback();
    }
    if (!keys.some((k) => mocks.has(k))) return route.fallback();
    let base = null;
    if (!stub && keys.some((k) => !mocks.has(k))) {
      const real = await route.fetch();
      base = real.ok() ? await real.json() : null;
    }
    const answers = {};
    for (const k of keys) {
      const handler = mocks.get(k);
      const answer = handler ? await capture(handler, request) : null;
      if (answer) answers[k] = answer;
      else if (!base || !base.keys || !base.keys[k]) answers[k] = PENDING;
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(lkEnvelope(answers, base)) });
  });
  return { set: (k, handler) => { mocks.set(k, handler); }, unset: (k) => { mocks.delete(k); } };
}
