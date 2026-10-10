let pinned = null;

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export function pinStamp(value, { dryRun = false } = {}) {
  pinned = null;
  if (value === undefined || value === null || value === "") return null;
  if (!dryRun) return null;
  const text = String(value);
  const ms = INSTANT.test(text) ? Date.parse(text) : NaN;
  if (!Number.isFinite(ms)) throw new Error(`FLOWS_DRY_NOW must be an ISO instant ending in Z, got ${JSON.stringify(text)}`);
  pinned = ms;
  return new Date(ms).toISOString();
}

export function stampPinned() {
  return pinned !== null;
}

export function stampDate() {
  return new Date(pinned !== null ? pinned : Date.now());
}

export function stampNow() {
  return stampDate().toISOString();
}
