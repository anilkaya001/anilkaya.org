/* Generated server-side scoring manifest. */
export const COURSE_STAGE_POINTS = Object.freeze({
  "ols": Object.freeze([5,10,10,15,10,5,10,15,15,5,10,10,15,20,20,5,10,15,10,20]),
  "iv2sls": Object.freeze([5,5,10,10,15,15,5,5,10,10,15,15,10,20,5,5,10,10,15,15,15,10,5,5,10,10,10,15,15,20,15]),
  "did": Object.freeze([5,5,10,10,15,15,5,5,10,10,15,15,10,5,5,10,10,15,15,10,20,5,5,10,10,15,15,15,20]),
  "var": Object.freeze([5,5,10,10,15,15,20,5,10,10,10,15,15,15,5,10,10,10,15,15,15,10,5,10,10,10,15,15,10,20]),
  "panel": Object.freeze([5,5,10,15,15,15,5,10,5,10,15,15,5,10,10,10,15,15,15,10,10,5,10,10,5,10,15,15,15,10]),
  "logit": Object.freeze([5,5,10,10,15,15,10,5,5,10,10,15,15,10,15,5,5,10,10,15,15,20,20,20,5,5,10,10,15,15,15,10]),
  "gmm": Object.freeze([5,5,10,10,15,15,15,20,5,5,10,10,10,15,15,15,5,5,10,10,10,15,15,10,20,5,5,10,10,15,15,15,10]),
  "foundations": Object.freeze([5,10,10,20,15,15,5,10,10,20,15,15,5,10,10,20,15,15,5,10,10,20,15,15,15,5,10,10,20,15,15,15]),
  "mle": Object.freeze([5,10,10,20,15,15,5,10,10,20,15,15,5,10,10,20,15,15,5,10,10,20,15,15,15,5,10,10,20,15,15,15]),
  "forecast": Object.freeze([5,10,10,20,15,15,5,10,10,20,15,15,5,10,10,20,15,15,5,10,10,20,15,15,15,5,10,10,20,15,15,15]),
  "coint": Object.freeze([5,10,10,20,15,15,5,10,10,20,15,15,5,10,10,20,15,15,5,10,10,20,15,15,15,5,10,10,20,15,15,15]),
  "financial": Object.freeze([5,10,10,20,15,15,5,10,10,20,15,15,5,10,10,20,15,15,5,10,10,20,15,15,15,5,10,10,20,15,15,15]),
});
export function pointsForProgress(progress) { let total=0; for (const [model,value] of Object.entries(progress||{})) { if (!Object.hasOwn(COURSE_STAGE_POINTS,model)||!Array.isArray(value&&value.done)) continue; const weights=COURSE_STAGE_POINTS[model], seen=new Set(); for (const index of value.done) { if (!Number.isInteger(index)||index<0||index>=weights.length||seen.has(index)) continue; seen.add(index); total+=weights[index]; } } return total; }
