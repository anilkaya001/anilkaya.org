const fin = (v) => typeof v === "number" && Number.isFinite(v);

export function eventTerms(front, back) {
  const s1 = front ? front.vol : null, t1 = front ? front.T : null;
  const s2 = back ? back.vol : null, t2 = back ? back.T : null;
  const none = { diffusiveVol: null, eventSd: null, eventMeanAbs: null };
  if (!fin(s1) || !fin(s2) || !fin(t1) || !fin(t2) || !(t1 > 0) || !(t2 > t1)) return { ...none, code: "input-absent" };
  const sd2 = (s2 * s2 * t2 - s1 * s1 * t1) / (t2 - t1);
  if (!(sd2 > 0)) return { ...none, code: "calendar-arbitrage" };
  const j2 = t1 * t2 * (s1 - s2) * (s1 + s2) / (t2 - t1);
  if (!(j2 > 0)) return { ...none, diffusiveVol: Math.sqrt(sd2), code: "no-premium" };
  const j = Math.sqrt(j2);
  return { diffusiveVol: Math.sqrt(sd2), eventSd: j, eventMeanAbs: j * Math.sqrt(2 / Math.PI), code: null };
}

export const EVENT_RESOLUTION = Object.freeze({
  z: 2,
  dv: 0.005,
  dvFloor: 0.0025,
  minFront: 1 / 365,
  minGap: 7 / 365,
  minSd: 0.0025,
});

const legDv = (leg) => {
  const v = leg && leg.dv;
  return fin(v) && v > 0 ? Math.max(EVENT_RESOLUTION.dvFloor, v) : EVENT_RESOLUTION.dv;
};

export function assessEvent(front, back) {
  const R = EVENT_RESOLUTION;
  const base = eventTerms(front, back);
  const out = (code, extra = {}) => ({ diffusiveVol: null, eventSd: null, eventMeanAbs: null, code, ...extra });
  if (base.code === "input-absent") return base;
  if (front.T < R.minFront) return out("front-too-short");
  if (back.T - front.T < R.minGap) return out("pair-too-close");
  if (base.code !== null) return base;
  const s1 = front.vol, s2 = back.vol;
  const d1 = legDv(front), d2 = legDv(back);
  const gap = s1 * s1 - s2 * s2;
  const need = 2 * R.z * Math.sqrt(s1 * s1 * d1 * d1 + s2 * s2 * d2 * d2);
  const resolution = { ratio: gap / (need / R.z), dv1: d1, dv2: d2 };
  if (!(gap > need)) return out("below-resolution", { diffusiveVol: base.diffusiveVol, resolution });
  if (!(base.eventSd >= R.minSd)) return out("immaterial", { diffusiveVol: base.diffusiveVol, resolution });
  return { ...base, resolution };
}
