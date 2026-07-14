/* Server-side scoring manifest.
   Keep this in lockstep with the browser curricula; tests verify every entry.
   Points are derived from completed stage indexes so cross-device merges are
   additive and idempotent instead of trusting a mutable client total. */

export const COURSE_STAGE_POINTS = Object.freeze({
  ols: Object.freeze([5, 10, 10, 15, 10, 5, 10, 15, 15, 5, 10, 10, 15, 20, 20, 5, 10, 15, 10, 20]),
  iv2sls: Object.freeze([5, 5, 10, 10, 15, 15, 5, 5, 10, 10, 15, 15, 10, 20, 5, 5, 10, 10, 15, 15, 15, 10, 5, 5, 10, 10, 10, 15, 15, 20, 15]),
  did: Object.freeze([5, 5, 10, 10, 15, 15, 5, 5, 10, 10, 15, 15, 10, 5, 5, 10, 10, 15, 15, 10, 20, 5, 5, 10, 10, 15, 15, 15, 20]),
  var: Object.freeze([5, 5, 10, 10, 15, 15, 20, 5, 10, 10, 10, 15, 15, 15, 5, 10, 10, 10, 15, 15, 15, 10, 5, 10, 10, 10, 15, 15, 10, 20]),
  panel: Object.freeze([5, 5, 10, 15, 15, 15, 5, 10, 5, 10, 15, 15, 5, 10, 10, 10, 15, 15, 15, 10, 10, 5, 10, 10, 5, 10, 15, 15, 15, 10]),
  logit: Object.freeze([5, 5, 10, 10, 15, 15, 10, 5, 5, 10, 10, 15, 15, 10, 15, 5, 5, 10, 10, 15, 15, 20, 20, 20, 5, 5, 10, 10, 15, 15, 15, 10]),
  gmm: Object.freeze([5, 5, 10, 10, 15, 15, 15, 20, 5, 5, 10, 10, 10, 15, 15, 15, 5, 5, 10, 10, 10, 15, 15, 10, 20, 5, 5, 10, 10, 15, 15, 15, 10]),
});

export function pointsForProgress(progress) {
  let total = 0;
  for (const [model, value] of Object.entries(progress || {})) {
    if (!Object.hasOwn(COURSE_STAGE_POINTS, model)) continue;
    const weights = COURSE_STAGE_POINTS[model];
    if (!weights || !Array.isArray(value && value.done)) continue;
    const seen = new Set();
    for (const index of value.done) {
      if (!Number.isInteger(index) || index < 0 || index >= weights.length || seen.has(index)) continue;
      seen.add(index);
      total += weights[index];
    }
  }
  return total;
}
