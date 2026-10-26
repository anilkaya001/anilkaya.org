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
