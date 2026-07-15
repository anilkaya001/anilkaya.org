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
    {
      id: "foundations", slug: "statistical-foundations-simulation-asymptotics", num: "08", title: "Statistical Foundations, Simulation & Asymptotics",
      shortTitle: "Foundations", level: "Beginner", stages: 32, modules: 5,
      blurb: "Probability, sampling distributions, estimator properties, asymptotics, Monte Carlo, and bootstrap inference.",
      tags: ["probability", "simulation", "asymptotics"], prerequisites: [],
      outcomes: ["Reason from probability models to estimators", "Use LLN and CLT arguments correctly", "Validate inference with simulation and bootstrap"],
    },
    {
      id: "mle", slug: "maximum-likelihood-numerical-econometrics", num: "09", title: "Maximum Likelihood & Numerical Econometrics",
      shortTitle: "MLE", level: "Intermediate", stages: 32, modules: 5,
      blurb: "Likelihood construction, score and information, identification, optimization, robust inference, and model comparison.",
      tags: ["maximum likelihood", "optimization", "inference"], prerequisites: ["foundations", "ols"],
      outcomes: ["Construct and diagnose likelihood estimators", "Verify numerical convergence and identification", "Choose valid likelihood-based inference and comparison tools"],
    },
    {
      id: "forecast", slug: "univariate-time-series-forecasting", num: "10", title: "Univariate Time Series & Forecasting",
      shortTitle: "Forecasting", level: "Intermediate", stages: 32, modules: 5,
      blurb: "Stationarity, ACF/PACF, ARMA and ARIMA modeling, diagnostics, and honest rolling-origin forecast evaluation.",
      tags: ["time series", "ARIMA", "forecasting"], prerequisites: ["foundations", "ols"],
      outcomes: ["Specify parsimonious univariate time-series models", "Diagnose residual dependence and instability", "Compare forecasts without look-ahead bias"],
    },
    {
      id: "coint", slug: "cointegration-vecm-state-space", num: "11", title: "Cointegration, VECM & State-Space Models",
      shortTitle: "Cointegration & State Space", level: "Advanced", stages: 32, modules: 5,
      blurb: "Unit roots, cointegration rank, error correction, Kalman filtering, latent states, and real-time nowcasting.",
      tags: ["cointegration", "VECM", "state space"], prerequisites: ["forecast", "var"],
      outcomes: ["Distinguish spurious regression from cointegration", "Estimate and interpret VECM systems", "Filter latent states and build real-time nowcasts"],
    },
    {
      id: "financial", slug: "financial-econometrics-risk-factor-models", num: "12", title: "Financial Econometrics, Risk & Factor Models",
      shortTitle: "Financial Econometrics", level: "Expert", stages: 32, modules: 5,
      blurb: "Returns, volatility clustering, ARCH/GARCH, VaR and Expected Shortfall, factor models, and backtesting.",
      tags: ["GARCH", "risk", "factor models"], prerequisites: ["mle", "forecast", "gmm"],
      outcomes: ["Forecast conditional volatility", "Backtest VaR and Expected Shortfall", "Estimate and diagnose factor exposures and alpha"],
    },
  ].map((topic) => Object.freeze({ ...topic, tags: Object.freeze(topic.tags), prerequisites: Object.freeze(topic.prerequisites), outcomes: Object.freeze(topic.outcomes) }));

  const academyPoints = () => Object.freeze(Array.from({ length: 32 }, (_, index) => {
    const stage = index % 6;
    return stage === 0 ? 5 : stage === 1 || stage === 2 ? 10 : stage === 3 ? 20 : stage === 4 || stage === 5 ? 15 : 10;
  }));
  const points = {
    ols: [5, 10, 10, 15, 10, 5, 10, 15, 15, 5, 10, 10, 15, 20, 20, 5, 10, 15, 10, 20],
    iv2sls: [5, 5, 10, 10, 15, 15, 5, 5, 10, 10, 15, 15, 10, 20, 5, 5, 10, 10, 15, 15, 15, 10, 5, 5, 10, 10, 10, 15, 15, 20, 15],
    did: [5, 5, 10, 10, 15, 15, 5, 5, 10, 10, 15, 15, 10, 5, 5, 10, 10, 15, 15, 10, 20, 5, 5, 10, 10, 15, 15, 15, 20],
    var: [5, 5, 10, 10, 15, 15, 20, 5, 10, 10, 10, 15, 15, 15, 5, 10, 10, 10, 15, 15, 15, 10, 5, 10, 10, 10, 15, 15, 10, 20],
    panel: [5, 5, 10, 15, 15, 15, 5, 10, 5, 10, 15, 15, 5, 10, 10, 10, 15, 15, 15, 10, 10, 5, 10, 10, 5, 10, 15, 15, 15, 10],
    logit: [5, 5, 10, 10, 15, 15, 10, 5, 5, 10, 10, 15, 15, 10, 15, 5, 5, 10, 10, 15, 15, 20, 20, 20, 5, 5, 10, 10, 15, 15, 15, 10],
    gmm: [5, 5, 10, 10, 15, 15, 15, 20, 5, 5, 10, 10, 10, 15, 15, 15, 5, 5, 10, 10, 10, 15, 15, 10, 20, 5, 5, 10, 10, 15, 15, 15, 10],
    foundations: academyPoints(),
    mle: academyPoints(),
    forecast: academyPoints(),
    coint: academyPoints(),
    financial: academyPoints(),
  };

  window.TOPIC_META = Object.freeze(topics);
  window.TOPIC_BY_ID = Object.freeze(Object.fromEntries(topics.map((topic) => [topic.id, topic])));
  window.COURSE_STAGE_POINTS = Object.freeze(Object.fromEntries(Object.entries(points).map(([id, values]) => [id, Object.freeze(values)])));
  window.LEARNING_PATHS = Object.freeze([
    Object.freeze({ id: "complete-core", title: "Quant economist", eyebrow: "Complete academy", blurb: "Build statistical foundations, causal reasoning, forecasting, structural dynamics, risk, and modern estimation in one coherent sequence.", courses: Object.freeze(["foundations", "ols", "mle", "logit", "did", "iv2sls", "panel", "forecast", "var", "coint", "gmm", "financial"]) }),
    Object.freeze({ id: "causal", title: "Causal inference", eyebrow: "Policy & research", blurb: "Learn counterfactual reasoning, endogeneity, instruments, panel variation, and moment conditions.", courses: Object.freeze(["foundations", "ols", "did", "iv2sls", "panel", "gmm"]) }),
    Object.freeze({ id: "applied-micro", title: "Applied microeconometrics", eyebrow: "Outcomes & heterogeneity", blurb: "Model continuous and binary outcomes, then exploit panel structure, instruments, and robust estimation.", courses: Object.freeze(["foundations", "ols", "mle", "logit", "panel", "iv2sls", "gmm"]) }),
    Object.freeze({ id: "time-series", title: "Macro forecasting", eyebrow: "Dynamics & nowcasts", blurb: "Move from univariate forecasts to VAR systems, cointegration, error correction, and real-time state estimation.", courses: Object.freeze(["foundations", "ols", "forecast", "var", "coint", "gmm"]) }),
    Object.freeze({ id: "markets-risk", title: "Markets & risk", eyebrow: "Financial econometrics", blurb: "Build likelihood and time-series foundations before volatility, tail-risk, factor, and backtesting applications.", courses: Object.freeze(["foundations", "ols", "mle", "forecast", "gmm", "financial"]) }),
  ]);
})();
