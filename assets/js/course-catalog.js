/* =============================================================
   course-catalog.js — lightweight academy metadata.
   Loaded by the catalogue and course shell; detailed course stages live in
   one generated JSON payload per topic under /assets/data/courses/.
   ============================================================= */
(() => {
  "use strict";

  const topics = [
    {
      id: "ols", slug: "ordinary-least-squares", num: "01", title: "Ordinary Least Squares",
      shortTitle: "OLS", level: "Beginner", stages: 20, modules: 4,
      blurb: "The line of best fit, how it's computed, inference, and the assumptions behind it.",
      tags: ["regression", "inference", "foundations"], prerequisites: [],
      outcomes: ["Estimate and interpret a linear model", "Read uncertainty and confidence intervals", "Diagnose heteroskedasticity and use robust standard errors"],
    },
    {
      id: "iv2sls", slug: "instrumental-variables-2sls", num: "02", title: "Instrumental Variables & 2SLS",
      shortTitle: "IV & 2SLS", level: "Intermediate", stages: 31, modules: 4,
      blurb: "When OLS is biased by endogeneity, and how an instrument plus 2SLS rescues it.",
      tags: ["causal inference", "endogeneity", "diagnostics"], prerequisites: ["ols"],
      outcomes: ["Explain endogeneity and instrument validity", "Estimate two-stage least squares", "Diagnose weak and over-identified models"],
    },
    {
      id: "did", slug: "difference-in-differences", num: "03", title: "Difference-in-Differences",
      shortTitle: "DiD", level: "Intermediate", stages: 29, modules: 4,
      blurb: "Treatment effects from before/after × treated/control, parallel trends, event studies.",
      tags: ["causal inference", "policy", "panel"], prerequisites: ["ols"],
      outcomes: ["Construct the 2×2 DiD estimator", "Defend the parallel-trends assumption", "Interpret dynamic event-study estimates"],
    },
    {
      id: "var", slug: "vector-autoregression", num: "04", title: "Vector Autoregression (VAR)",
      shortTitle: "VAR", level: "Advanced", stages: 30, modules: 4,
      blurb: "Joint dynamics of several series: estimation, impulse responses, Granger causality.",
      tags: ["time series", "forecasting", "macro"], prerequisites: ["ols"],
      outcomes: ["Estimate and select a VAR", "Interpret impulse responses and FEVD", "Test predictive content and build forecasts"],
    },
    {
      id: "panel", slug: "panel-fixed-random-effects", num: "05", title: "Panel Data: Fixed & Random Effects",
      shortTitle: "Panel FE & RE", level: "Advanced", stages: 30, modules: 4,
      blurb: "Unobserved heterogeneity, pooled-OLS bias, the within estimator, FE vs RE.",
      tags: ["panel", "causal inference", "heterogeneity"], prerequisites: ["ols"],
      outcomes: ["Recognize unobserved-heterogeneity bias", "Estimate fixed effects by within transformation", "Choose between fixed and random effects"],
    },
    {
      id: "logit", slug: "logit-probit", num: "06", title: "Logit & Probit (Binary Outcomes)",
      shortTitle: "Logit & Probit", level: "Intermediate", stages: 32, modules: 4,
      blurb: "Binary outcomes: the logistic model, odds ratios, marginal effects, classification.",
      tags: ["binary outcomes", "maximum likelihood", "classification"], prerequisites: ["ols"],
      outcomes: ["Explain why linear probability models fail", "Interpret odds ratios and marginal effects", "Evaluate classification and ROC performance"],
    },
    {
      id: "gmm", slug: "generalized-method-of-moments", num: "07", title: "Generalized Method of Moments (GMM)",
      shortTitle: "GMM", level: "Advanced", stages: 33, modules: 4,
      blurb: "Moment conditions as a unifying estimator, IV-GMM, over-identification, efficiency.",
      tags: ["estimation theory", "moments", "instruments"], prerequisites: ["ols", "iv2sls"],
      outcomes: ["Translate assumptions into moment conditions", "Connect IV and GMM", "Use over-identification tests and efficient weighting"],
    },
  ].map((topic) => Object.freeze({ ...topic, tags: Object.freeze(topic.tags), prerequisites: Object.freeze(topic.prerequisites), outcomes: Object.freeze(topic.outcomes) }));

  const points = {
    ols: [5, 10, 10, 15, 10, 5, 10, 15, 15, 5, 10, 10, 15, 20, 20, 5, 10, 15, 10, 20],
    iv2sls: [5, 5, 10, 10, 15, 15, 5, 5, 10, 10, 15, 15, 10, 20, 5, 5, 10, 10, 15, 15, 15, 10, 5, 5, 10, 10, 10, 15, 15, 20, 15],
    did: [5, 5, 10, 10, 15, 15, 5, 5, 10, 10, 15, 15, 10, 5, 5, 10, 10, 15, 15, 10, 20, 5, 5, 10, 10, 15, 15, 15, 20],
    var: [5, 5, 10, 10, 15, 15, 20, 5, 10, 10, 10, 15, 15, 15, 5, 10, 10, 10, 15, 15, 15, 10, 5, 10, 10, 10, 15, 15, 10, 20],
    panel: [5, 5, 10, 15, 15, 15, 5, 10, 5, 10, 15, 15, 5, 10, 10, 10, 15, 15, 15, 10, 10, 5, 10, 10, 5, 10, 15, 15, 15, 10],
    logit: [5, 5, 10, 10, 15, 15, 10, 5, 5, 10, 10, 15, 15, 10, 15, 5, 5, 10, 10, 15, 15, 20, 20, 20, 5, 5, 10, 10, 15, 15, 15, 10],
    gmm: [5, 5, 10, 10, 15, 15, 15, 20, 5, 5, 10, 10, 10, 15, 15, 15, 5, 5, 10, 10, 10, 15, 15, 10, 20, 5, 5, 10, 10, 15, 15, 15, 10],
  };

  window.TOPIC_META = Object.freeze(topics);
  window.TOPIC_BY_ID = Object.freeze(Object.fromEntries(topics.map((topic) => [topic.id, topic])));
  window.COURSE_STAGE_POINTS = Object.freeze(Object.fromEntries(Object.entries(points).map(([id, values]) => [id, Object.freeze(values)])));
  window.LEARNING_PATHS = Object.freeze([
    Object.freeze({ id: "complete-core", title: "Complete core", eyebrow: "Start here", blurb: "Build from regression foundations to causal, panel, time-series, limited-outcome, and moment-based methods.", courses: Object.freeze(["ols", "logit", "did", "iv2sls", "panel", "var", "gmm"]) }),
    Object.freeze({ id: "causal", title: "Causal inference", eyebrow: "Policy & research", blurb: "Learn counterfactual reasoning, endogeneity, instruments, panel variation, and moment conditions.", courses: Object.freeze(["ols", "did", "iv2sls", "panel", "gmm"]) }),
    Object.freeze({ id: "applied-micro", title: "Applied microeconometrics", eyebrow: "Outcomes & heterogeneity", blurb: "Model continuous and binary outcomes, then exploit panel structure and instruments.", courses: Object.freeze(["ols", "logit", "panel", "iv2sls", "gmm"]) }),
    Object.freeze({ id: "time-series", title: "Time-series systems", eyebrow: "Dynamics & forecasts", blurb: "Establish regression fluency, then study multivariate dynamics and general moment estimation.", courses: Object.freeze(["ols", "var", "gmm"]) }),
  ]);
})();
