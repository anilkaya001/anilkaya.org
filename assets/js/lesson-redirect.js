/* Static-preview fallback; production uses a permanent Worker redirect. */
const legacyCourseSlugs = {
  ols: "ordinary-least-squares",
  iv2sls: "instrumental-variables-2sls",
  did: "difference-in-differences",
  var: "vector-autoregression",
  panel: "panel-fixed-random-effects",
  logit: "logit-probit",
  gmm: "generalized-method-of-moments",
};
const legacyTopic = new URLSearchParams(location.search).get("m");
const legacySlug = Object.hasOwn(legacyCourseSlugs, legacyTopic) ? legacyCourseSlugs[legacyTopic] : null;
location.replace((legacySlug ? "/lab/" + legacySlug + "/" : "/lab/") + location.hash);
