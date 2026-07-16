/* Generated bundle of shared lab scripts. Do not edit; edit the sources and rerun generate-course-payloads.mjs. */

;/* ---- course-catalog.js ---- */
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

  // Per-stage point weights are authored in the curriculum and emitted to
  // window.COURSE_STAGE_POINTS by the generated stage-catalog.js (the same
  // source shared/course-points.js scores against server-side). This file used
  // to carry a hand-maintained copy that silently disagreed with the authored
  // weights for the five academy courses; it now defers to the single source.
  window.TOPIC_META = Object.freeze(topics);
  window.TOPIC_BY_ID = Object.freeze(Object.fromEntries(topics.map((topic) => [topic.id, topic])));
  window.LEARNING_PATHS = Object.freeze([
    Object.freeze({ id: "complete-core", title: "Quant economist", eyebrow: "Complete academy", blurb: "Build statistical foundations, causal reasoning, forecasting, structural dynamics, risk, and modern estimation in one coherent sequence.", courses: Object.freeze(["foundations", "ols", "mle", "logit", "did", "iv2sls", "panel", "forecast", "var", "coint", "gmm", "financial"]) }),
    Object.freeze({ id: "causal", title: "Causal inference", eyebrow: "Policy & research", blurb: "Learn counterfactual reasoning, endogeneity, instruments, panel variation, and moment conditions.", courses: Object.freeze(["foundations", "ols", "did", "iv2sls", "panel", "gmm"]) }),
    Object.freeze({ id: "applied-micro", title: "Applied microeconometrics", eyebrow: "Outcomes & heterogeneity", blurb: "Model continuous and binary outcomes, then exploit panel structure, instruments, and robust estimation.", courses: Object.freeze(["foundations", "ols", "mle", "logit", "panel", "iv2sls", "gmm"]) }),
    Object.freeze({ id: "time-series", title: "Macro forecasting", eyebrow: "Dynamics & nowcasts", blurb: "Move from univariate forecasts to VAR systems, cointegration, error correction, and real-time state estimation.", courses: Object.freeze(["foundations", "ols", "forecast", "var", "coint", "gmm"]) }),
    Object.freeze({ id: "markets-risk", title: "Markets & risk", eyebrow: "Financial econometrics", blurb: "Build likelihood and time-series foundations before volatility, tail-risk, factor, and backtesting applications.", courses: Object.freeze(["foundations", "ols", "mle", "forecast", "gmm", "financial"]) }),
  ]);
})();

;/* ---- skill-catalog.js ---- */
/* =============================================================
   skill-catalog.js — answer-free Academy 2.0 skill taxonomy.

   Every course owns seven durable conceptual skills. Assessment answers live
   in generated banks, never in this lightweight catalogue.
   ============================================================= */
(() => {
  "use strict";

  const seeds = {
    ols: [
      ["least-squares-geometry", "Least-squares geometry", "Compare fitted and observed outcomes through squared residuals.", "the residual pattern and sum of squared errors", "a line that is visually plausible but not the least-squares projection"],
      ["coefficient-interpretation", "Coefficient interpretation", "Interpret a slope conditionally and in the units of the variables.", "units, conditioning variables, and the comparison being made", "a causal or percentage interpretation that the specification does not support"],
      ["matrix-estimator", "The matrix OLS estimator", "Use the rank condition before applying (X'X)^-1X'y.", "the dimensions and rank of the design matrix", "an unidentified coefficient caused by perfect collinearity"],
      ["sampling-uncertainty", "Sampling uncertainty", "Treat an estimate as a random quantity across repeated samples.", "the estimator's sampling distribution and standard error", "confusing the fitted coefficient with a population constant known without error"],
      ["t-inference", "t inference", "Construct tests and intervals from an estimate, null value, and valid standard error.", "the reference distribution, degrees of freedom, and test direction", "a p-value or interval based on the wrong uncertainty estimate"],
      ["gauss-markov", "Gauss-Markov conditions", "Separate unbiasedness assumptions from the homoskedastic efficiency condition.", "linearity, exogeneity, rank, and the error-variance structure", "claiming BLUE or unbiasedness without the assumptions that deliver it"],
      ["robust-standard-errors", "Robust standard errors", "Keep OLS coefficients but replace homoskedastic uncertainty when variance changes with x.", "residual scale across fitted values and leverage", "valid-looking t statistics built from heteroskedastic standard errors"],
    ],
    iv2sls: [
      ["endogeneity", "Endogeneity diagnosis", "Trace why a regressor is correlated with the structural error.", "omitted variables, simultaneity, and measurement error", "treating a predictive relationship as an exogenous source of variation"],
      ["instrument-relevance", "Instrument relevance", "Show that the instrument moves the endogenous regressor conditionally.", "the first-stage coefficient and partial first-stage strength", "an instrument that contributes too little identifying variation"],
      ["exclusion-restriction", "The exclusion restriction", "Defend why the instrument affects the outcome only through treatment.", "institutional pathways and possible direct effects", "a strong first stage paired with an invalid causal channel"],
      ["first-stage", "First-stage design", "Specify the endogenous variable on instruments and all included exogenous controls.", "alignment of controls across both stages", "a generated regressor that does not represent the intended projection"],
      ["two-stage-least-squares", "Two-stage least squares", "Estimate both stages with one coherent IV procedure and IV-standard errors.", "the instrument set, endogenous regressors, and reported covariance", "manual second-stage inference that ignores first-stage estimation"],
      ["weak-instrument-diagnostics", "Weak-instrument diagnostics", "Assess identification strength before interpreting 2SLS.", "first-stage F-type evidence and weak-IV-robust alternatives", "biased and non-normal IV estimates from weak instruments"],
      ["overidentification", "Over-identification diagnostics", "Use extra moments as a joint diagnostic, not proof of validity.", "the J statistic and which exclusion restrictions are jointly tested", "accepting every instrument because a test fails to reject"],
    ],
    did: [
      ["counterfactual-trend", "Counterfactual trends", "Define the untreated trajectory that identifies the treatment effect.", "pre-treatment paths and comparison-group plausibility", "a before-after change contaminated by common shocks"],
      ["two-by-two-did", "The 2x2 DiD estimator", "Subtract the control change from the treated change.", "all four group-time cell means", "mistaking one group's change for the treatment effect"],
      ["did-regression", "DiD regression", "Map the interaction coefficient to the difference-in-differences contrast.", "group, time, interaction coding, and omitted categories", "an interaction coefficient with an ambiguous baseline"],
      ["parallel-trends", "Parallel-trends assessment", "Use design knowledge and pre-period evidence to defend the identifying assumption.", "pre-treatment coefficients, composition, and anticipation", "causal claims when treated and control outcomes were already diverging"],
      ["event-study", "Event-study dynamics", "Normalize one pre-period and read leads separately from lags.", "reference period, confidence intervals, and pre-trend joint tests", "dynamic coefficients misread as independent treatment effects"],
      ["staggered-adoption", "Staggered treatment timing", "Use comparisons that avoid already-treated units as invalid controls.", "cohort timing and treatment-effect heterogeneity", "negative-weight or contaminated two-way fixed-effect comparisons"],
      ["did-inference", "DiD inference", "Cluster uncertainty at the level where treatment shocks persist.", "the assignment level and number of independent clusters", "standard errors that treat correlated observations as independent"],
    ],
    var: [
      ["var-stationarity", "VAR stationarity", "Transform or model persistent series so the system has a defensible stochastic structure.", "roots, trends, and integration properties", "spurious dynamics or unstable forecasts"],
      ["var-lag-selection", "VAR lag selection", "Balance residual dependence against parameter proliferation.", "information criteria and residual autocorrelation", "underfit dynamics or an over-parameterized system"],
      ["var-estimation", "VAR system estimation", "Use the same regressor set in each equation and retain the covariance across shocks.", "equation alignment and residual covariance", "a collection of regressions that loses the system interpretation"],
      ["var-stability", "VAR stability", "Check companion-matrix roots before interpreting long-horizon dynamics.", "root moduli and impulse decay", "explosive responses presented as stable propagation"],
      ["impulse-responses", "Impulse-response functions", "State the shock normalization and identification ordering.", "orthogonalization assumptions and confidence bands", "responses attributed to structural shocks without identification"],
      ["forecast-error-variance", "Forecast-error variance decomposition", "Link forecast uncertainty shares to the same identified shocks as the IRF.", "horizon, ordering, and shares summing to one", "variance shares that change silently with an undocumented ordering"],
      ["granger-forecasting", "Granger causality and forecasting", "Separate predictive content from structural causality and evaluate out of sample.", "joint lag tests and rolling forecast loss", "causal language or in-sample fit mistaken for forecast value"],
    ],
    panel: [
      ["panel-structure", "Panel-data structure", "Index observations by entity and time and preserve repeated-measure dependence.", "balance, missingness, and within-versus-between variation", "standard errors and estimands that ignore the panel structure"],
      ["pooled-bias", "Pooled-OLS bias", "Ask whether time-invariant entity effects correlate with regressors.", "between-entity association and omitted heterogeneity", "a pooled slope driven by permanent entity differences"],
      ["within-estimator", "The within estimator", "Demean by entity to identify slopes from within-entity changes.", "remaining within variation and absorbed variables", "trying to estimate time-invariant effects after demeaning"],
      ["fe-inference", "Fixed-effects inference", "Cluster or otherwise model serial dependence within entities.", "within-entity residual correlation and cluster count", "precise-looking FE estimates with naive iid errors"],
      ["random-effects", "Random-effects assumptions", "Use RE only when entity effects are conditionally uncorrelated with regressors.", "the correlation between effects and covariate histories", "efficient but inconsistent RE estimates"],
      ["hausman", "Hausman comparison", "Interpret FE-versus-RE differences as evidence about the orthogonality restriction.", "coefficient alignment and covariance of the difference", "choosing RE solely because its standard errors are smaller"],
      ["dynamic-panel", "Dynamic-panel identification", "Account for the dependence created by lagged outcomes and transformed errors.", "instrument depth, persistence, and serial-correlation tests", "Nickell bias or instrument proliferation"],
    ],
    logit: [
      ["lpm-limits", "Linear-probability limits", "Use the LPM knowingly and diagnose its probability and variance limitations.", "predictions outside zero-one and heteroskedastic residuals", "treating a linear fit as a globally valid probability model"],
      ["binary-links", "Logit and probit links", "Map a linear index through a monotone CDF into valid probabilities.", "link choice, index scale, and tail behavior", "comparing raw coefficients across links as if scales matched"],
      ["binary-mle", "Binary-response maximum likelihood", "Construct Bernoulli likelihood contributions from predicted probabilities.", "convergence, separation, and the Hessian", "a numerical optimum that is not finite or identified"],
      ["odds-ratios", "Odds-ratio interpretation", "Exponentiate a logit coefficient and state the conditional comparison.", "units of x and the baseline specification", "describing an odds ratio as a percentage-point probability effect"],
      ["marginal-effects", "Marginal effects", "Report probability-scale effects at explicit covariate values or averaged over observations.", "evaluation point and nonlinear heterogeneity", "one constant effect attributed to every observation"],
      ["classification", "Classification performance", "Evaluate thresholds with confusion-matrix tradeoffs and threshold-free summaries.", "class balance, ROC or precision-recall behavior, and costs", "accuracy that hides poor minority-class performance"],
      ["calibration", "Probability calibration", "Compare predicted risks with observed frequencies.", "calibration curves, bins, and proper scoring rules", "well-ranked predictions that are systematically overconfident"],
    ],
    gmm: [
      ["moment-conditions", "Moment conditions", "Translate economic restrictions into population orthogonality equations.", "whether each moment is implied by the maintained assumptions", "sample equations with no defensible population restriction"],
      ["gmm-identification", "GMM identification", "Count parameters and independent informative moments before optimization.", "Jacobian rank and local sensitivity of moments", "a flat criterion with non-unique parameter values"],
      ["gmm-criterion", "The GMM criterion", "Minimize weighted sample-moment violations using a positive-definite matrix.", "moment scaling and criterion curvature", "an optimizer driven by arbitrary measurement units"],
      ["iv-as-gmm", "IV as GMM", "Express instrument exogeneity as E[z u(beta)]=0.", "instrument validity and the mapping to 2SLS", "an IV estimate disconnected from its identifying moments"],
      ["efficient-weighting", "Efficient GMM weighting", "Estimate the inverse covariance of moments and re-optimize.", "first-step residuals and conditioning of the weight matrix", "unstable efficiency gains from a noisy or singular weight matrix"],
      ["j-test", "The J test", "Use over-identifying restrictions to test joint moment compatibility.", "degrees of freedom and which moments exceed parameter count", "treating non-rejection as proof that every moment is true"],
      ["gmm-variance", "Robust GMM variance", "Use the sandwich based on the moment Jacobian and covariance.", "derivative rank, dependence structure, and finite-sample scaling", "standard errors inconsistent with the estimated weighting and moments"],
    ],
    foundations: [
      ["probability-models", "Probability models", "Define a sample space, events, and a coherent distribution before calculating.", "support, normalization, and conditioning information", "probabilities attached to impossible or incomplete events"],
      ["expectation-variance", "Expectation and variance", "Use expectations for location and variance for dispersion around the mean.", "units, existence of moments, and covariance terms", "dropping dependence terms or confusing spread with level"],
      ["law-large-numbers", "Law of Large Numbers", "Connect sample averages to population expectations under stated dependence conditions.", "sample size, dependence, and moment existence", "assuming every average converges regardless of the data process"],
      ["central-limit-theorem", "Central Limit Theorem", "Standardize an estimator and justify its limiting reference distribution.", "rate, variance, and dependence conditions", "normal inference without an applicable asymptotic approximation"],
      ["estimator-properties", "Estimator properties", "Distinguish unbiasedness, consistency, efficiency, and robustness.", "the sampling experiment and asymptotic sequence", "using one desirable property as a synonym for all others"],
      ["monte-carlo", "Monte Carlo experiments", "Repeat a controlled data-generating process and summarize estimator behavior.", "random seed policy, repetitions, bias, variance, and coverage", "a simulation conclusion based on one realization"],
      ["bootstrap", "Bootstrap inference", "Resample units in a way that mirrors the data's dependence structure.", "resampling unit, statistic, and bootstrap distribution", "confidence intervals from a resampling scheme that breaks dependence"],
    ],
    mle: [
      ["likelihood", "Likelihood construction", "Build the joint density or mass as a function of parameters for observed data.", "support, independence factorization, and constants", "an objective that is not the model's likelihood"],
      ["score", "Score equations", "Differentiate the log-likelihood and interpret zero score at an interior optimum.", "gradient magnitude and parameter constraints", "declaring convergence while the score remains large"],
      ["information", "Information and curvature", "Use expected or observed curvature to quantify local precision.", "Hessian sign, conditioning, and information equality", "standard errors from a flat or wrongly signed objective"],
      ["mle-identification", "Likelihood identification", "Verify distinct parameter values imply distinct observable distributions.", "profile likelihoods and curvature in every parameter direction", "multiple parameter combinations fitting identically"],
      ["numerical-optimization", "Numerical optimization", "Scale parameters, use defensible starts, and verify more than one convergence signal.", "gradient, Hessian, bounds, and sensitivity to starts", "a local or boundary solution reported as a unique optimum"],
      ["mle-robust-inference", "Robust likelihood inference", "Use sandwich uncertainty under misspecification while stating the pseudo-true target.", "score covariance versus Hessian curvature", "model-based precision that assumes a false conditional variance"],
      ["model-comparison", "Likelihood model comparison", "Match LR tests to nesting and use information criteria for predictive tradeoffs.", "nesting, parameter counts, and out-of-sample loss", "comparing non-nested models with an invalid reference distribution"],
    ],
    forecast: [
      ["series-transformations", "Series transformations", "Choose levels, logs, differences, or seasonal adjustments for the forecasting target.", "units, trend, seasonality, and invertibility", "a forecast evaluated on a scale different from the decision target"],
      ["univariate-stationarity", "Univariate stationarity", "Distinguish deterministic trend, unit-root persistence, and stationary dynamics.", "rolling moments, roots, and unit-root evidence", "spurious autocorrelation and unreliable long-horizon forecasts"],
      ["acf-pacf", "ACF and PACF diagnostics", "Use correlation patterns as model clues rather than mechanical identification rules.", "sampling bands, residual ACF, and plausible alternatives", "overconfident order selection from noisy sample spikes"],
      ["arma", "ARMA dynamics", "Represent persistent shocks with autoregressive and moving-average terms.", "root conditions, innovation definition, and parsimony", "noninvertible or unstable dynamics"],
      ["arima", "ARIMA modeling", "Difference only as needed, then model remaining serial dependence.", "integration order and overdifferencing symptoms", "forecasts with avoidable noise from excessive differencing"],
      ["forecast-diagnostics", "Forecast diagnostics", "Demand approximately innovation-like residuals and stable parameters.", "residual ACF, variance shifts, and structural breaks", "a fitted model that leaves predictable information unused"],
      ["rolling-evaluation", "Rolling forecast evaluation", "Re-estimate using only information available at each forecast origin.", "time ordering, horizon, benchmark, and loss function", "look-ahead bias or an evaluation unrelated to the user decision"],
    ],
    coint: [
      ["unit-roots", "Unit-root testing", "Specify deterministic terms and interpret tests with their low-power limitations.", "trend specification, lag length, and complementary evidence", "classifying persistence from one test statistic alone"],
      ["spurious-regression", "Spurious regression", "Treat high R-squared among unrelated persistent levels as a warning.", "residual persistence and integration orders", "significant level regressions created by shared stochastic trends"],
      ["engle-granger", "Engle-Granger cointegration", "Estimate a long-run relation and test whether its residual is stationary with correct critical values.", "residual-based unit-root evidence and normalization", "using ordinary unit-root critical values on estimated residuals"],
      ["johansen", "Johansen rank analysis", "Determine cointegration rank in a system before interpreting vectors.", "deterministic specification, lag order, trace and maximum-eigenvalue tests", "selecting a rank without matching the system specification"],
      ["vecm", "Vector error correction", "Combine long-run equilibrium errors with short-run changes.", "adjustment coefficients, cointegrating vectors, and stability", "calling every adjustment coefficient a causal response"],
      ["kalman-filter", "Kalman filtering", "Update a latent-state estimate by balancing prior and measurement uncertainty.", "innovation, Kalman gain, and covariance recursion", "a state estimate that ignores signal-to-noise information"],
      ["nowcasting", "Nowcasting with state space", "Align mixed-frequency releases and update estimates only when new information arrives.", "release calendar, ragged edge, and real-time vintages", "look-ahead bias from revised or not-yet-released observations"],
    ],
    financial: [
      ["returns", "Return measurement", "Use a return definition aligned with compounding, horizon, and portfolio operations.", "prices, dividends, frequency, and simple-versus-log conversion", "mixing return conventions or ignoring corporate actions"],
      ["volatility-clustering", "Volatility clustering", "Model time-varying conditional variance rather than only unconditional dispersion.", "squared-return dependence and regime changes", "risk estimates that assume constant variance through turbulent periods"],
      ["garch", "ARCH and GARCH", "Enforce positive variance and assess persistence of volatility shocks.", "parameter constraints, standardized residuals, and alpha-plus-beta", "negative or near-integrated conditional-variance forecasts"],
      ["value-at-risk", "Value at Risk", "State horizon and tail probability and estimate the corresponding loss quantile.", "coverage rate, distributional assumption, and rolling exceptions", "a VaR number without a horizon, probability, or validation"],
      ["expected-shortfall", "Expected Shortfall", "Average losses beyond the VaR threshold and evaluate tail-model sensitivity.", "tail sample size and joint VaR-ES behavior", "tail severity hidden by a quantile-only risk measure"],
      ["factor-models", "Factor regressions", "Estimate exposures and alpha with returns and factors aligned in frequency and units.", "factor definitions, excess-return construction, and residual diagnostics", "apparent alpha caused by omitted factors or unit mismatch"],
      ["risk-backtesting", "Risk and factor backtesting", "Evaluate models on held-out periods with predeclared diagnostics.", "exception independence, rolling windows, turnover, and benchmark loss", "in-sample fit presented as evidence of deployable risk performance"],
    ],
  };

  const courseSkills = {};
  const skills = [];
  for (const [courseId, rows] of Object.entries(seeds)) {
    courseSkills[courseId] = Object.freeze(rows.map((row, index) => {
      const skill = Object.freeze({
        id: `${courseId}.${row[0]}`,
        courseId,
        order: index + 1,
        title: row[1],
        practice: row[2],
        diagnostic: row[3],
        risk: row[4],
      });
      skills.push(skill);
      return skill.id;
    }));
  }

  window.COURSE_SKILLS = Object.freeze(courseSkills);
  window.SKILL_CATALOG = Object.freeze(skills);
  window.SKILL_BY_ID = Object.freeze(Object.fromEntries(skills.map((skill) => [skill.id, skill])));
})();

;/* ---- stage-catalog.js ---- */
/* Generated by scripts/generate-course-payloads.mjs. Do not edit. */
(() => {
  "use strict";
  const ids = {"ols":["ols-line-01","ols-line-02","ols-line-03","ols-line-04","ols-line-05","ols-math-01","ols-math-02","ols-math-03","ols-math-04","ols-inference-01","ols-inference-02","ols-inference-03","ols-inference-04","ols-inference-05","ols-inference-06","ols-assumptions-01","ols-assumptions-02","ols-assumptions-03","ols-assumptions-04","ols-assumptions-05"],"iv2sls":["iv2sls-why-ols-fails-01","iv2sls-why-ols-fails-02","iv2sls-why-ols-fails-03","iv2sls-why-ols-fails-04","iv2sls-why-ols-fails-05","iv2sls-why-ols-fails-06","iv2sls-instruments-01","iv2sls-instruments-02","iv2sls-instruments-03","iv2sls-instruments-04","iv2sls-instruments-05","iv2sls-instruments-06","iv2sls-instruments-07","iv2sls-instruments-08","iv2sls-2sls-01","iv2sls-2sls-02","iv2sls-2sls-03","iv2sls-2sls-04","iv2sls-2sls-05","iv2sls-2sls-06","iv2sls-2sls-07","iv2sls-2sls-08","iv2sls-diagnostics-01","iv2sls-diagnostics-02","iv2sls-diagnostics-03","iv2sls-diagnostics-04","iv2sls-diagnostics-05","iv2sls-diagnostics-06","iv2sls-diagnostics-07","iv2sls-diagnostics-08","iv2sls-diagnostics-09"],"did":["did-idea-01","did-idea-02","did-idea-03","did-idea-04","did-idea-05","did-idea-06","did-2x2-01","did-2x2-02","did-2x2-03","did-2x2-04","did-2x2-05","did-2x2-06","did-2x2-07","did-parallel-trends-01","did-parallel-trends-02","did-parallel-trends-03","did-parallel-trends-04","did-parallel-trends-05","did-parallel-trends-06","did-parallel-trends-07","did-parallel-trends-08","did-event-study-01","did-event-study-02","did-event-study-03","did-event-study-04","did-event-study-05","did-event-study-06","did-event-study-07","did-event-study-08"],"var":["var-from-ar1-to-var-01","var-from-ar1-to-var-02","var-from-ar1-to-var-03","var-from-ar1-to-var-04","var-from-ar1-to-var-05","var-from-ar1-to-var-06","var-from-ar1-to-var-07","var-estimation-lag-selection-01","var-estimation-lag-selection-02","var-estimation-lag-selection-03","var-estimation-lag-selection-04","var-estimation-lag-selection-05","var-estimation-lag-selection-06","var-estimation-lag-selection-07","var-irf-fevd-01","var-irf-fevd-02","var-irf-fevd-03","var-irf-fevd-04","var-irf-fevd-05","var-irf-fevd-06","var-irf-fevd-07","var-irf-fevd-08","var-granger-forecasting-01","var-granger-forecasting-02","var-granger-forecasting-03","var-granger-forecasting-04","var-granger-forecasting-05","var-granger-forecasting-06","var-granger-forecasting-07","var-granger-forecasting-08"],"panel":["panel-heterogeneity-01","panel-heterogeneity-02","panel-heterogeneity-03","panel-heterogeneity-04","panel-heterogeneity-05","panel-heterogeneity-06","panel-pooled-bias-01","panel-pooled-bias-02","panel-pooled-bias-03","panel-pooled-bias-04","panel-pooled-bias-05","panel-pooled-bias-06","panel-fixed-effects-01","panel-fixed-effects-02","panel-fixed-effects-03","panel-fixed-effects-04","panel-fixed-effects-05","panel-fixed-effects-06","panel-fixed-effects-07","panel-fixed-effects-08","panel-fixed-effects-09","panel-random-effects-01","panel-random-effects-02","panel-random-effects-03","panel-random-effects-04","panel-random-effects-05","panel-random-effects-06","panel-random-effects-07","panel-random-effects-08","panel-random-effects-09"],"logit":["logit-why-lpm-fails-01","logit-why-lpm-fails-02","logit-why-lpm-fails-03","logit-why-lpm-fails-04","logit-why-lpm-fails-05","logit-why-lpm-fails-06","logit-why-lpm-fails-07","logit-the-model-01","logit-the-model-02","logit-the-model-03","logit-the-model-04","logit-the-model-05","logit-the-model-06","logit-the-model-07","logit-the-model-08","logit-interpreting-coefficients-01","logit-interpreting-coefficients-02","logit-interpreting-coefficients-03","logit-interpreting-coefficients-04","logit-interpreting-coefficients-05","logit-interpreting-coefficients-06","logit-interpreting-coefficients-07","logit-interpreting-coefficients-08","logit-interpreting-coefficients-09","logit-fit-and-classification-01","logit-fit-and-classification-02","logit-fit-and-classification-03","logit-fit-and-classification-04","logit-fit-and-classification-05","logit-fit-and-classification-06","logit-fit-and-classification-07","logit-fit-and-classification-08"],"gmm":["gmm-moments-01","gmm-moments-02","gmm-moments-03","gmm-moments-04","gmm-moments-05","gmm-moments-06","gmm-moments-07","gmm-moments-08","gmm-iv-01","gmm-iv-02","gmm-iv-03","gmm-iv-04","gmm-iv-05","gmm-iv-06","gmm-iv-07","gmm-iv-08","gmm-overid-01","gmm-overid-02","gmm-overid-03","gmm-overid-04","gmm-overid-05","gmm-overid-06","gmm-overid-07","gmm-overid-08","gmm-overid-09","gmm-efficient-01","gmm-efficient-02","gmm-efficient-03","gmm-efficient-04","gmm-efficient-05","gmm-efficient-06","gmm-efficient-07","gmm-efficient-08"],"foundations":["foundations-probability-guide","foundations-probability-lab","foundations-probability-worked","foundations-probability-challenge","foundations-probability-case","foundations-probability-match","foundations-sampling-guide","foundations-sampling-lab","foundations-sampling-worked","foundations-sampling-challenge","foundations-sampling-case","foundations-sampling-match","foundations-estimators-guide","foundations-estimators-lab","foundations-estimators-worked","foundations-estimators-challenge","foundations-estimators-case","foundations-estimators-match","foundations-asymptotics-guide","foundations-asymptotics-lab","foundations-asymptotics-worked","foundations-asymptotics-challenge","foundations-asymptotics-case","foundations-asymptotics-match","foundations-asymptotics-checkpoint","foundations-simulation-bootstrap-guide","foundations-simulation-bootstrap-lab","foundations-simulation-bootstrap-worked","foundations-simulation-bootstrap-challenge","foundations-simulation-bootstrap-case","foundations-simulation-bootstrap-match","foundations-simulation-bootstrap-checkpoint"],"mle":["mle-likelihood-guide","mle-likelihood-lab","mle-likelihood-worked","mle-likelihood-challenge","mle-likelihood-case","mle-likelihood-match","mle-score-information-guide","mle-score-information-lab","mle-score-information-worked","mle-score-information-challenge","mle-score-information-case","mle-score-information-match","mle-identification-guide","mle-identification-lab","mle-identification-worked","mle-identification-challenge","mle-identification-case","mle-identification-match","mle-optimization-guide","mle-optimization-lab","mle-optimization-worked","mle-optimization-challenge","mle-optimization-case","mle-optimization-match","mle-optimization-checkpoint","mle-inference-comparison-guide","mle-inference-comparison-lab","mle-inference-comparison-worked","mle-inference-comparison-challenge","mle-inference-comparison-case","mle-inference-comparison-match","mle-inference-comparison-checkpoint"],"forecast":["forecast-transformations-guide","forecast-transformations-lab","forecast-transformations-worked","forecast-transformations-challenge","forecast-transformations-case","forecast-transformations-match","forecast-correlation-guide","forecast-correlation-lab","forecast-correlation-worked","forecast-correlation-challenge","forecast-correlation-case","forecast-correlation-match","forecast-arma-guide","forecast-arma-lab","forecast-arma-worked","forecast-arma-challenge","forecast-arma-case","forecast-arma-match","forecast-arima-guide","forecast-arima-lab","forecast-arima-worked","forecast-arima-challenge","forecast-arima-case","forecast-arima-match","forecast-arima-checkpoint","forecast-evaluation-guide","forecast-evaluation-lab","forecast-evaluation-worked","forecast-evaluation-challenge","forecast-evaluation-case","forecast-evaluation-match","forecast-evaluation-checkpoint"],"coint":["coint-unit-roots-guide","coint-unit-roots-lab","coint-unit-roots-worked","coint-unit-roots-challenge","coint-unit-roots-case","coint-unit-roots-match","coint-engle-granger-guide","coint-engle-granger-lab","coint-engle-granger-worked","coint-engle-granger-challenge","coint-engle-granger-case","coint-engle-granger-match","coint-johansen-guide","coint-johansen-lab","coint-johansen-worked","coint-johansen-challenge","coint-johansen-case","coint-johansen-match","coint-vecm-guide","coint-vecm-lab","coint-vecm-worked","coint-vecm-challenge","coint-vecm-case","coint-vecm-match","coint-vecm-checkpoint","coint-state-space-guide","coint-state-space-lab","coint-state-space-worked","coint-state-space-challenge","coint-state-space-case","coint-state-space-match","coint-state-space-checkpoint"],"financial":["financial-returns-guide","financial-returns-lab","financial-returns-worked","financial-returns-challenge","financial-returns-case","financial-returns-match","financial-volatility-guide","financial-volatility-lab","financial-volatility-worked","financial-volatility-challenge","financial-volatility-case","financial-volatility-match","financial-garch-guide","financial-garch-lab","financial-garch-worked","financial-garch-challenge","financial-garch-case","financial-garch-match","financial-tail-risk-guide","financial-tail-risk-lab","financial-tail-risk-worked","financial-tail-risk-challenge","financial-tail-risk-case","financial-tail-risk-match","financial-tail-risk-checkpoint","financial-factors-backtests-guide","financial-factors-backtests-lab","financial-factors-backtests-worked","financial-factors-backtests-challenge","financial-factors-backtests-case","financial-factors-backtests-match","financial-factors-backtests-checkpoint"]};
  const points = {"ols":[5,10,10,15,10,5,10,15,15,5,10,10,15,20,20,5,10,15,10,20],"iv2sls":[5,5,10,10,15,15,5,5,10,10,15,15,10,20,5,5,10,10,15,15,15,10,5,5,10,10,10,15,15,20,15],"did":[5,5,10,10,15,15,5,5,10,10,15,15,10,5,5,10,10,15,15,10,20,5,5,10,10,15,15,15,20],"var":[5,5,10,10,15,15,20,5,10,10,10,15,15,15,5,10,10,10,15,15,15,10,5,10,10,10,15,15,10,20],"panel":[5,5,10,15,15,15,5,10,5,10,15,15,5,10,10,10,15,15,15,10,10,5,10,10,5,10,15,15,15,10],"logit":[5,5,10,10,15,15,10,5,5,10,10,15,15,10,15,5,5,10,10,15,15,20,20,20,5,5,10,10,15,15,15,10],"gmm":[5,5,10,10,15,15,15,20,5,5,10,10,10,15,15,15,5,5,10,10,10,15,15,10,20,5,5,10,10,15,15,15,10],"foundations":[5,10,10,20,15,15,5,10,10,20,15,15,5,10,10,20,15,15,5,10,10,20,15,15,15,5,10,10,20,15,15,15],"mle":[5,10,10,20,15,15,5,10,10,20,15,15,5,10,10,20,15,15,5,10,10,20,15,15,15,5,10,10,20,15,15,15],"forecast":[5,10,10,20,15,15,5,10,10,20,15,15,5,10,10,20,15,15,5,10,10,20,15,15,15,5,10,10,20,15,15,15],"coint":[5,10,10,20,15,15,5,10,10,20,15,15,5,10,10,20,15,15,5,10,10,20,15,15,15,5,10,10,20,15,15,15],"financial":[5,10,10,20,15,15,5,10,10,20,15,15,5,10,10,20,15,15,5,10,10,20,15,15,15,5,10,10,20,15,15,15]};
  window.COURSE_STAGE_IDS = Object.freeze(Object.fromEntries(Object.entries(ids).map(([id, list]) => [id, Object.freeze(list)])));
  window.COURSE_STAGE_POINTS = Object.freeze(Object.fromEntries(Object.entries(points).map(([id, values]) => [id, Object.freeze(values)])));
})();

;/* ---- mastery.js ---- */
/* =============================================================
   mastery.js — pure browser-side mastery scheduling.
   No DOM or storage access; callers own persistence and rendering.
   ============================================================= */
(() => {
  "use strict";

  const LEVEL_MIN = 0;
  const LEVEL_MAX = 5;
  const INTERVAL_DAYS = Object.freeze([1, 3, 7, 21, 60]);
  const MAX_COUNT = 1_000_000;
  const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
  const ATTEMPT_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
  const plainObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);

  function safeCount(value) {
    const count = Number(value);
    return Number.isSafeInteger(count) && count >= 0 ? Math.min(MAX_COUNT, count) : 0;
  }

  function safeTimestamp(value) {
    const timestamp = Number(value);
    return Number.isSafeInteger(timestamp) && timestamp >= 0 ? timestamp : 0;
  }

  function normalizeAttemptId(value) {
    return typeof value === "string" && ATTEMPT_ID_PATTERN.test(value) ? value : null;
  }

  function normalizeDay(value) {
    if (typeof value !== "string") return null;
    const match = value.match(DAY_PATTERN);
    if (!match) return null;
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return value;
  }

  function requireDay(value) {
    const day = normalizeDay(value);
    if (!day) throw new TypeError("today must be a valid YYYY-MM-DD date");
    return day;
  }

  function addDays(value, count) {
    const day = requireDay(value);
    if (!Number.isSafeInteger(count)) throw new TypeError("count must be an integer");
    const date = new Date(`${day}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + count);
    return date.toISOString().slice(0, 10);
  }

  function normalizeRecord(value) {
    const source = plainObject(value) ? value : {};
    const rawLevel = Number(source.level);
    const level = Number.isInteger(rawLevel) && rawLevel >= LEVEL_MIN && rawLevel <= LEVEL_MAX ? rawLevel : LEVEL_MIN;
    const attempts = safeCount(source.attempts);
    const correct = Math.min(attempts, safeCount(source.correct));
    return {
      level,
      dueDay: normalizeDay(source.dueDay),
      attempts,
      correct,
      lastResult: typeof source.lastResult === "boolean" ? source.lastResult : null,
      lastAttemptId: normalizeAttemptId(source.lastAttemptId),
      updatedAt: safeTimestamp(source.updatedAt),
    };
  }

  function intervalForLevel(value) {
    const level = Number(value);
    if (!Number.isInteger(level) || level < LEVEL_MIN || level > LEVEL_MAX) {
      throw new TypeError("level must be an integer from 0 through 5");
    }
    return INTERVAL_DAYS[Math.max(1, level) - 1];
  }

  function applyMastery(record, options) {
    if (!plainObject(options) || typeof options.correct !== "boolean") {
      throw new TypeError("correct must be boolean");
    }
    if (options.hinted != null && typeof options.hinted !== "boolean") {
      throw new TypeError("hinted must be boolean");
    }
    if (options.attemptId != null && normalizeAttemptId(options.attemptId) == null) {
      throw new TypeError("attemptId is invalid");
    }
    if (options.updatedAt != null && safeTimestamp(options.updatedAt) !== options.updatedAt) {
      throw new TypeError("updatedAt must be a non-negative safe integer");
    }

    const previous = normalizeRecord(record);
    const today = requireDay(options.today);
    const attemptId = normalizeAttemptId(options.attemptId);
    if (attemptId && attemptId === previous.lastAttemptId) return previous;

    const hinted = options.hinted === true;
    let level;
    if (!options.correct) level = LEVEL_MIN;
    else if (hinted) level = Math.min(previous.level, 1);
    else level = Math.min(LEVEL_MAX, previous.level + 1);

    const attempts = Math.min(MAX_COUNT, previous.attempts + 1);
    const correct = Math.min(attempts, previous.correct + (options.correct ? 1 : 0));
    const updatedAt = options.updatedAt == null
      ? Date.parse(`${today}T00:00:00Z`)
      : options.updatedAt;

    return {
      level,
      dueDay: addDays(today, options.correct && !hinted ? intervalForLevel(level) : 1),
      attempts,
      correct,
      lastResult: options.correct,
      lastAttemptId: attemptId,
      updatedAt,
    };
  }

  const apply = applyMastery;
  const schedule = applyMastery;

  function isDue(record, today) {
    const value = normalizeRecord(record);
    if (value.attempts === 0) return false;
    const day = requireDay(today);
    return value.dueDay == null || value.dueDay <= day;
  }

  function bankItems(bank) {
    if (Array.isArray(bank)) return bank;
    return plainObject(bank) && Array.isArray(bank.items) ? bank.items : [];
  }

  function masteryItems(mastery) {
    if (!plainObject(mastery)) return {};
    return plainObject(mastery.items) ? mastery.items : mastery;
  }

  function completedStages(progress) {
    if (!plainObject(progress)) return new Map();
    const completed = new Map();
    for (const [course, value] of Object.entries(progress)) {
      if (!plainObject(value) || !Array.isArray(value.done)) continue;
      completed.set(course, new Set(value.done.filter((index) => Number.isSafeInteger(index) && index >= 0)));
    }
    return completed;
  }

  function courseId(item) {
    if (typeof item.courseId === "string" && item.courseId) return item.courseId;
    return typeof item.id === "string" ? item.id.split(":", 1)[0] : "";
  }

  function isCompleted(item, completed) {
    const course = courseId(item);
    return Number.isSafeInteger(item.stageIndex) && completed.get(course)?.has(item.stageIndex) === true;
  }

  function reviewCandidates(bank, mastery, progress, today) {
    const day = requireDay(today);
    const records = masteryItems(mastery);
    const completed = completedStages(progress);
    const seen = new Set();
    const candidates = [];

    for (const item of bankItems(bank)) {
      if (!plainObject(item) || typeof item.id !== "string" || !item.id || seen.has(item.id)) continue;
      seen.add(item.id);
      if (!isCompleted(item, completed)) continue;
      const record = normalizeRecord(Object.hasOwn(records, item.id) ? records[item.id] : null);
      candidates.push({
        item,
        record,
        due: record.attempts === 0 || record.dueDay == null || record.dueDay <= day,
        course: courseId(item),
      });
    }
    return candidates;
  }

  function dueCount(bank, mastery, progress, today) {
    return reviewCandidates(bank, mastery, progress, today).filter((candidate) => candidate.due).length;
  }

  function selectSession(bank, mastery, progress, today, limit = 5) {
    requireDay(today);
    if (!Number.isSafeInteger(limit) || limit < 0 || limit > 100) {
      throw new TypeError("limit must be an integer from 0 through 100");
    }
    if (limit === 0) return [];

    const candidates = reviewCandidates(bank, mastery, progress, today).filter((candidate) => candidate.due);
    candidates.sort((a, b) =>
      Number(b.due) - Number(a.due) ||
      a.record.level - b.record.level ||
      String(a.record.dueDay || "").localeCompare(String(b.record.dueDay || "")) ||
      a.item.id.localeCompare(b.item.id));

    const selected = [];
    const deferred = [];
    const perCourse = new Map();
    for (const candidate of candidates) {
      if (selected.length >= limit) break;
      const count = perCourse.get(candidate.course) || 0;
      if (count >= 2) {
        deferred.push(candidate);
        continue;
      }
      selected.push(candidate.item);
      perCourse.set(candidate.course, count + 1);
    }
    for (const candidate of deferred) {
      if (selected.length >= limit) break;
      selected.push(candidate.item);
    }
    return selected;
  }

  window.MasteryScheduler = Object.freeze({
    LEVEL_MIN,
    LEVEL_MAX,
    INTERVAL_DAYS,
    normalizeDay,
    addDays,
    normalizeRecord,
    intervalForLevel,
    apply,
    applyMastery,
    schedule,
    isDue,
    dueCount,
    selectSession,
  });
})();

;/* ---- skill-mastery.js ---- */
/* Browser build of the Academy 2.0 conceptual-skill scheduler. */
(() => {
  "use strict";
  const LEVEL_MIN=0, LEVEL_MAX=5, INTERVAL_DAYS=Object.freeze([1,3,7,21,60]);
  const DAY=/^(\d{4})-(\d{2})-(\d{2})$/, ATTEMPT=/^[A-Za-z0-9._:-]{1,128}$/;
  const object=(value)=>!!value&&typeof value==="object"&&!Array.isArray(value);
  const count=(value)=>Number.isSafeInteger(Number(value))&&Number(value)>=0?Math.min(1000000,Number(value)):0;
  function normalizeDay(value){if(typeof value!=="string")return null;const match=value.match(DAY);if(!match)return null;const date=new Date(Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3])));return date.getUTCFullYear()===Number(match[1])&&date.getUTCMonth()===Number(match[2])-1&&date.getUTCDate()===Number(match[3])?value:null;}
  function addDays(value,amount){const day=normalizeDay(value);if(!day||!Number.isSafeInteger(amount))throw new TypeError("A valid day and integer interval are required");const date=new Date(`${day}T00:00:00Z`);date.setUTCDate(date.getUTCDate()+amount);return date.toISOString().slice(0,10);}
  function normalizeRecord(value){const source=object(value)?value:{},level=Number(source.level),attempts=count(source.attempts);return{level:Number.isInteger(level)&&level>=0&&level<=5?level:0,dueDay:normalizeDay(source.dueDay),attempts,correct:Math.min(attempts,count(source.correct)),lastResult:typeof source.lastResult==="boolean"?source.lastResult:null,lastAttemptId:typeof source.lastAttemptId==="string"&&ATTEMPT.test(source.lastAttemptId)?source.lastAttemptId:null,updatedAt:Number.isSafeInteger(Number(source.updatedAt))&&Number(source.updatedAt)>=0?Number(source.updatedAt):0};}
  function apply(record,options){if(!object(options)||typeof options.correct!=="boolean"||typeof options.hinted!=="boolean"||!normalizeDay(options.today))throw new TypeError("Invalid skill attempt");if(options.attemptId!=null&&(typeof options.attemptId!=="string"||!ATTEMPT.test(options.attemptId)))throw new TypeError("Invalid attempt id");const previous=normalizeRecord(record);if(options.attemptId&&previous.lastAttemptId===options.attemptId)return previous;const cleanCorrect=options.correct&&!options.hinted;const level=cleanCorrect?Math.min(5,previous.level+1):options.correct?previous.level:Math.max(0,previous.level-1);const interval=cleanCorrect?INTERVAL_DAYS[Math.max(1,level)-1]:1;const attempts=Math.min(1000000,previous.attempts+1);return{level,dueDay:addDays(options.today,interval),attempts,correct:Math.min(attempts,previous.correct+(options.correct?1:0)),lastResult:options.correct,lastAttemptId:options.attemptId||null,updatedAt:Number.isSafeInteger(options.updatedAt)&&options.updatedAt>=0?options.updatedAt:Date.parse(`${options.today}T00:00:00Z`)};}
  function selectWeakestSkills(skillIds,mastery,today,limit=3){if(!normalizeDay(today)||!Array.isArray(skillIds)||!Number.isInteger(limit)||limit<0||limit>20)throw new TypeError("Invalid challenge selection");const records=object(mastery)?mastery:{};return[...new Set(skillIds)].map((skillId)=>({skillId,record:normalizeRecord(records[skillId])})).filter(({record})=>record.attempts===0||record.dueDay==null||record.dueDay<=today).sort((a,b)=>a.record.level-b.record.level||String(a.record.dueDay||"").localeCompare(String(b.record.dueDay||""))||a.skillId.localeCompare(b.skillId)).slice(0,limit).map(({skillId})=>skillId);}
  window.SkillMasteryScheduler=Object.freeze({LEVEL_MIN,LEVEL_MAX,INTERVAL_DAYS,normalizeDay,addDays,normalizeRecord,apply,selectWeakestSkills});
})();

;/* ---- storage.js ---- */
/* =============================================================
   storage.js — validated, owner-scoped, failure-safe persistence.

   Learning state is stored separately for the anonymous learner and for
   every verified account. The legacy keys remain an anonymous-only mirror
   during migration so existing learners keep their progress. Guide width is
   deliberately device-wide and is never part of a learning-data reset.
   ============================================================= */
(() => {
  "use strict";

  const ANONYMOUS = "anonymous";
  const FORMAT_VERSION = 2;
  const KEYS = Object.freeze({
    // Legacy keys. These are read and mirrored only for the anonymous scope.
    progress: "iewt:progress",
    gamify: "iewt:gamify",
    progressPrefix: "iewt:progress:v2:",
    gamifyPrefix: "iewt:gamify:v2:",
    masteryPrefix: "iewt:mastery:v2:",
    masteryOutboxPrefix: "iewt:mastery-outbox:v2:",
    placementPrefix: "iewt:placement:v2:",
    syncPrefix: "iewt:sync:v2:",
    stableProgressPrefix: "iewt:progress:v3:",
    skillMasteryPrefix: "iewt:skill-mastery:v3:",
    skillOutboxPrefix: "iewt:skill-outbox:v3:",
    preferencesPrefix: "iewt:preferences:v3:",
    projectsPrefix: "iewt:projects:v3:",
    activeOwner: "iewt:activeOwner",
    guideWidth: "iewt:guideW",
    legacyGuideWidth: "iewt:splitW",
  });
  const memory = new Map();
  // A failed write/removal makes memory authoritative until a later write
  // succeeds. Otherwise readable but stale localStorage can undo this tab's
  // current state after QuotaExceededError or another write-only failure.
  const dirty = new Set();
  let activeOwner = ANONYMOUS;

  const plainObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
  const safeInteger = (value, fallback = 0, max = Number.MAX_SAFE_INTEGER) =>
    Number.isSafeInteger(Number(value)) && Number(value) >= 0 && Number(value) <= max ? Number(value) : fallback;

  function emit(name, detail) {
    if (typeof document === "undefined" || typeof document.dispatchEvent !== "function") return;
    if (typeof CustomEvent === "function") document.dispatchEvent(new CustomEvent(name, { detail }));
    else document.dispatchEvent(new Event(name));
  }

  function readRaw(key) {
    if (dirty.has(key)) return memory.get(key) ?? null;
    try {
      const value = localStorage.getItem(key);
      if (value != null) memory.set(key, value);
      return value != null ? value : memory.get(key) ?? null;
    } catch { return memory.get(key) ?? null; }
  }

  function writeRaw(key, value) {
    const text = String(value);
    memory.set(key, text);
    try { localStorage.setItem(key, text); dirty.delete(key); }
    catch { dirty.add(key); /* In-memory fallback remains authoritative. */ }
  }

  function removeRaw(key) {
    memory.delete(key);
    try { localStorage.removeItem(key); dirty.delete(key); }
    catch { dirty.add(key); /* Treat the in-memory tombstone as authoritative. */ }
  }

  function parseRaw(key) {
    const raw = readRaw(key);
    if (raw == null) return null;
    try { return JSON.parse(raw); }
    catch { return null; }
  }

  function normalizeOwner(value) {
    if (value == null || value === "" || value === ANONYMOUS) return ANONYMOUS;
    const id = String(value).trim();
    // Account ids come from the verified session endpoint. Bound their size so
    // corrupt or unexpected responses cannot create unbounded storage keys.
    if (!id || id.length > 256 || !/^[A-Za-z0-9._:@-]+$/.test(id)) {
      throw new TypeError("Invalid learning-state owner");
    }
    return `user:${id}`;
  }

  function publicOwner(owner = activeOwner) {
    return owner === ANONYMOUS ? null : owner.slice("user:".length);
  }

  function scopedKey(kind, owner = activeOwner) {
    const prefix = kind === "progress" ? KEYS.progressPrefix :
      kind === "gamify" ? KEYS.gamifyPrefix :
      kind === "mastery" ? KEYS.masteryPrefix :
      kind === "masteryOutbox" ? KEYS.masteryOutboxPrefix :
      kind === "placement" ? KEYS.placementPrefix :
      kind === "stableProgress" ? KEYS.stableProgressPrefix :
      kind === "skillMastery" ? KEYS.skillMasteryPrefix :
      kind === "skillOutbox" ? KEYS.skillOutboxPrefix :
      kind === "preferences" ? KEYS.preferencesPrefix :
      kind === "projects" ? KEYS.projectsPrefix : KEYS.syncPrefix;
    return prefix + encodeURIComponent(owner);
  }

  const v3Kind = (kind) => ["stableProgress", "skillMastery", "skillOutbox", "preferences", "projects"].includes(kind);
  const envelopeVersion = (kind) => v3Kind(kind) ? 3 : FORMAT_VERSION;

  function cleanGeneration(value, fallback = null) {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
  }

  function readSync(owner = activeOwner) {
    const envelope = parseRaw(scopedKey("sync", owner));
    const generation = plainObject(envelope) && envelope.version === FORMAT_VERSION && envelope.owner === owner ?
      cleanGeneration(envelope.generation) : null;
    return generation == null ? writeSync(0, owner) : generation;
  }

  function writeSync(value, owner = activeOwner) {
    const generation = cleanGeneration(value);
    if (generation == null) throw new TypeError("Invalid learning-state generation");
    writeRaw(scopedKey("sync", owner), JSON.stringify({
      version: FORMAT_VERSION,
      owner,
      generation,
    }));
    return generation;
  }

  function topicLimit(id) {
    const topics = window.TOPIC_META || [];
    const meta = topics.find((topic) => topic.id === id);
    if (meta && Number.isInteger(meta.stages)) return meta.stages;
    const curricula = window.CURRICULUM || {};
    const course = Object.hasOwn(curricula, id) ? curricula[id] : null;
    if (course) return course.modules.reduce((total, module) => total + module.stages.length, 0);
    // Scripts are deferred in dependency order, but persistence must still be
    // non-destructive if catalogue metadata is delayed or unavailable. Apply a
    // conservative temporary bound; the next read with metadata loaded will
    // enforce the exact per-course limit and discard unknown ids.
    return !topics.length && !Object.keys(curricula).length && /^[a-z0-9_-]{1,64}$/.test(id) ? 10000 : 0;
  }

  function cleanProgress(value) {
    const source = plainObject(value) ? value : {};
    const clean = {};
    for (const [id, entry] of Object.entries(source)) {
      const limit = topicLimit(id);
      if (!limit || !plainObject(entry) || !Array.isArray(entry.done)) continue;
      const done = [...new Set(entry.done.filter((index) => Number.isInteger(index) && index >= 0 && index < limit))]
        .sort((a, b) => a - b);
      clean[id] = { done };
    }
    return clean;
  }

  function cleanStableProgress(value) {
    const source = plainObject(value) ? value : {};
    const catalogue = window.COURSE_STAGE_IDS || {};
    const clean = {};
    for (const [courseId, entry] of Object.entries(source)) {
      const allowed = Array.isArray(catalogue[courseId]) ? new Set(catalogue[courseId]) : null;
      if (!allowed || !plainObject(entry) || !Array.isArray(entry.done)) continue;
      const done = [...new Set(entry.done.filter((stageId) => typeof stageId === "string" && allowed.has(stageId)))];
      done.sort((a, b) => catalogue[courseId].indexOf(a) - catalogue[courseId].indexOf(b));
      clean[courseId] = { done };
    }
    return clean;
  }

  function normalizeDay(value) {
    if (value == null || value === "") return null;
    const match = String(value).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!match) return null;
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function cleanGamify(value) {
    const source = plainObject(value) ? value : {};
    return {
      points: safeInteger(source.points),
      streak: safeInteger(source.streak, 0, 100000),
      last: normalizeDay(source.last),
    };
  }

  const validItemId = (value) => typeof value === "string" && /^[a-z0-9][a-z0-9:._-]{0,127}$/i.test(value);
  const validAttemptId = (value) => typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value);

  function cleanMastery(value) {
    const source = plainObject(value) ? value : {};
    const clean = {};
    for (const [itemId, record] of Object.entries(source).slice(0, 1000)) {
      if (!validItemId(itemId) || !plainObject(record)) continue;
      const level = Number(record.level);
      const dueDay = normalizeDay(record.dueDay);
      if (!Number.isSafeInteger(level) || level < 0 || level > 5 || !dueDay) continue;
      const attempts = safeInteger(record.attempts, 0, 1000000);
      clean[itemId] = {
        level,
        dueDay,
        attempts,
        correct: Math.min(attempts, safeInteger(record.correct, 0, 1000000)),
        lastResult: typeof record.lastResult === "boolean" ? record.lastResult : null,
        lastAttemptId: validAttemptId(record.lastAttemptId) ? record.lastAttemptId : null,
        updatedAt: safeInteger(record.updatedAt),
      };
    }
    return clean;
  }

  function cleanMasteryOutbox(value) {
    if (!Array.isArray(value)) return [];
    const clean = [];
    const seen = new Set();
    for (const event of value.slice(-500)) {
      if (!plainObject(event) || !validItemId(event.itemId) || !validAttemptId(event.attemptId) || seen.has(event.attemptId)) continue;
      const day = normalizeDay(event.day);
      if (!day || typeof event.correct !== "boolean" || typeof event.hinted !== "boolean") continue;
      seen.add(event.attemptId);
      clean.push({
        attemptId: event.attemptId,
        itemId: event.itemId,
        correct: event.correct,
        hinted: event.hinted,
        day,
      });
    }
    return clean;
  }

  function cleanSkillOutbox(value) {
    if (!Array.isArray(value)) return [];
    const clean = [];
    const seen = new Set();
    for (const event of value.slice(-500)) {
      if (!plainObject(event) || !validItemId(event.skillId) || !validItemId(event.itemId) || !validAttemptId(event.attemptId) || seen.has(event.attemptId)) continue;
      const day = normalizeDay(event.day);
      if (!day || typeof event.correct !== "boolean" || typeof event.hinted !== "boolean") continue;
      seen.add(event.attemptId);
      clean.push({ attemptId: event.attemptId, skillId: event.skillId, itemId: event.itemId, correct: event.correct, hinted: event.hinted, day });
    }
    return clean;
  }

  const PROJECT_IDS = new Set(["macro-forecasting-desk", "fx-volatility-risk", "factor-pricing-lab"]);
  const PROJECT_MODES = new Set(["guided", "unguided"]);
  function cleanProjects(value) {
    const source = plainObject(value) ? value : {};
    const clean = {};
    for (const [projectId, entry] of Object.entries(source)) {
      if (!PROJECT_IDS.has(projectId) || !plainObject(entry) || !PROJECT_MODES.has(entry.mode) || !Array.isArray(entry.done)) continue;
      clean[projectId] = { mode: entry.mode, done: [...new Set(entry.done.filter((taskId) => typeof taskId === "string" && /^[a-z0-9-]{2,64}$/.test(taskId)))].slice(0, 24) };
    }
    return clean;
  }

  const PATH_IDS = new Set(["complete-core", "causal", "applied-micro", "time-series", "markets-risk"]);
  function cleanPreferences(value) {
    const source = plainObject(value) ? value : {};
    return {
      activePathId: PATH_IDS.has(source.activePathId) ? source.activePathId : "complete-core",
      sessionMinutes: [10, 20, 45].includes(Number(source.sessionMinutes)) ? Number(source.sessionMinutes) : 20,
      weeklyGoalMinutes: Number.isSafeInteger(Number(source.weeklyGoalMinutes)) && Number(source.weeklyGoalMinutes) >= 30 && Number(source.weeklyGoalMinutes) <= 1200 ? Number(source.weeklyGoalMinutes) : 120,
    };
  }

  const PLACEMENT_BANDS = new Set(["foundation", "applied", "advanced"]);
  const PLACEMENT_TOPICS = new Set(["ols", "iv2sls", "did", "var", "panel", "logit", "gmm"]);

  function cleanPlacement(value) {
    if (value == null) return null;
    if (!plainObject(value) || !PLACEMENT_BANDS.has(value.band) || !PLACEMENT_TOPICS.has(value.recommendedTopic)) return null;
    const score = Number(value.score);
    const total = Number(value.total);
    const completedDay = normalizeDay(value.completedDay);
    const expectedBand = score <= 6 ? "foundation" : score <= 11 ? "applied" : "advanced";
    const latestDay = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (!Number.isSafeInteger(score) || total !== 15 || score < 0 || score > total || !completedDay ||
        completedDay > latestDay || value.band !== expectedBand) {
      return null;
    }
    return { band: value.band, score, total, completedDay, recommendedTopic: value.recommendedTopic };
  }

  function cleanFor(kind, value) {
    if (kind === "progress") return cleanProgress(value);
    if (kind === "stableProgress") return cleanStableProgress(value);
    if (kind === "gamify") return cleanGamify(value);
    if (kind === "mastery" || kind === "skillMastery") return cleanMastery(value);
    if (kind === "placement") return cleanPlacement(value);
    if (kind === "skillOutbox") return cleanSkillOutbox(value);
    if (kind === "preferences") return cleanPreferences(value);
    if (kind === "projects") return cleanProjects(value);
    return cleanMasteryOutbox(value);
  }

  function emptyFor(kind) {
    if (["progress", "stableProgress", "mastery", "skillMastery", "projects"].includes(kind)) return {};
    if (kind === "masteryOutbox" || kind === "skillOutbox") return [];
    if (kind === "placement") return null;
    if (kind === "preferences") return cleanPreferences({});
    return { points: 0, streak: 0, last: null };
  }

  function readScoped(kind, owner = activeOwner) {
    const envelope = parseRaw(scopedKey(kind, owner));
    if (plainObject(envelope) && envelope.version === envelopeVersion(kind) && envelope.owner === owner) {
      return cleanFor(kind, envelope.value);
    }

    // Pre-v2 values have no owner identity. They are therefore eligible only
    // for the anonymous scope and are immediately migrated into an envelope.
    const legacy = owner === ANONYMOUS && (kind === "progress" || kind === "gamify") ? parseRaw(KEYS[kind]) : null;
    const value = cleanFor(kind, legacy ?? emptyFor(kind));
    writeScoped(kind, value, owner);
    return value;
  }

  function writeScoped(kind, value, owner = activeOwner) {
    const clean = cleanFor(kind, value);
    writeRaw(scopedKey(kind, owner), JSON.stringify({
      version: envelopeVersion(kind),
      owner,
      value: clean,
    }));
    // Keep old anonymous-only integrations working during the migration. An
    // authenticated scope is never copied into these unscoped legacy keys.
    if (owner === ANONYMOUS && (kind === "progress" || kind === "gamify")) writeRaw(KEYS[kind], JSON.stringify(clean));
    return clean;
  }

  function removeScoped(kind, owner = activeOwner) {
    removeRaw(scopedKey(kind, owner));
    if (owner === ANONYMOUS && (kind === "progress" || kind === "gamify")) removeRaw(KEYS[kind]);
  }

  function hasScopedState(owner) {
    return readRaw(scopedKey("progress", owner)) != null || readRaw(scopedKey("gamify", owner)) != null ||
      readRaw(scopedKey("mastery", owner)) != null || readRaw(scopedKey("masteryOutbox", owner)) != null ||
      readRaw(scopedKey("placement", owner)) != null || readRaw(scopedKey("stableProgress", owner)) != null ||
      readRaw(scopedKey("skillMastery", owner)) != null || readRaw(scopedKey("skillOutbox", owner)) != null ||
      readRaw(scopedKey("preferences", owner)) != null || readRaw(scopedKey("projects", owner)) != null ||
      readRaw(scopedKey("sync", owner)) != null;
  }

  function hasOwnerState(ownerId) {
    try { return hasScopedState(normalizeOwner(ownerId)); }
    catch { return false; }
  }

  function hasLearningState(progressValue, gamifyValue, masteryValue, masteryOutboxValue, placementValue, stableValue = {}, skillValue = {}, skillOutboxValue = [], projectValue = {}) {
    return Object.values(progressValue).some((entry) => Array.isArray(entry.done) && entry.done.length) ||
      gamifyValue.points > 0 || gamifyValue.streak > 0 || gamifyValue.last != null ||
      Object.keys(masteryValue).length > 0 || masteryOutboxValue.length > 0 || placementValue != null ||
      Object.values(stableValue).some((entry) => Array.isArray(entry.done) && entry.done.length) ||
      Object.keys(skillValue).length > 0 || skillOutboxValue.length > 0 || Object.keys(projectValue).length > 0;
  }

  function bindOwner(ownerId, options = {}) {
    const next = normalizeOwner(ownerId);
    const previous = activeOwner;
    const claimAnonymous = options.claimAnonymous !== false;

    // A first-time account can claim work completed before sign-in. Existing
    // account scopes never absorb anonymous/device data, which prevents one
    // known account from contaminating another on a shared browser.
    if (next !== ANONYMOUS && next !== previous && claimAnonymous && !hasScopedState(next)) {
      const anonymousProgress = readScoped("progress", ANONYMOUS);
      const anonymousGamify = readScoped("gamify", ANONYMOUS);
      const anonymousMastery = readScoped("mastery", ANONYMOUS);
      const anonymousMasteryOutbox = readScoped("masteryOutbox", ANONYMOUS);
      const anonymousPlacement = readScoped("placement", ANONYMOUS);
      const anonymousStableProgress = readScoped("stableProgress", ANONYMOUS);
      const anonymousSkillMastery = readScoped("skillMastery", ANONYMOUS);
      const anonymousSkillOutbox = readScoped("skillOutbox", ANONYMOUS);
      const anonymousProjects = readScoped("projects", ANONYMOUS);
      const anonymousPreferences = readScoped("preferences", ANONYMOUS);
      if (hasLearningState(anonymousProgress, anonymousGamify, anonymousMastery, anonymousMasteryOutbox, anonymousPlacement, anonymousStableProgress, anonymousSkillMastery, anonymousSkillOutbox, anonymousProjects)) {
        writeScoped("progress", anonymousProgress, next);
        writeScoped("gamify", anonymousGamify, next);
        writeScoped("mastery", anonymousMastery, next);
        writeScoped("masteryOutbox", anonymousMasteryOutbox, next);
        writeScoped("placement", anonymousPlacement, next);
        writeScoped("stableProgress", anonymousStableProgress, next);
        writeScoped("skillMastery", anonymousSkillMastery, next);
        writeScoped("skillOutbox", anonymousSkillOutbox, next);
        writeScoped("projects", anonymousProjects, next);
        writeScoped("preferences", anonymousPreferences, next);
        removeScoped("progress", ANONYMOUS);
        removeScoped("gamify", ANONYMOUS);
        removeScoped("mastery", ANONYMOUS);
        removeScoped("masteryOutbox", ANONYMOUS);
        removeScoped("placement", ANONYMOUS);
        removeScoped("stableProgress", ANONYMOUS);
        removeScoped("skillMastery", ANONYMOUS);
        removeScoped("skillOutbox", ANONYMOUS);
        removeScoped("projects", ANONYMOUS);
        removeScoped("preferences", ANONYMOUS);
      }
    }

    activeOwner = next;
    if (options.announce === true) writeRaw(KEYS.activeOwner, next);
    if (next !== previous) {
      emit("iewt:owner-changed", {
        owner: publicOwner(next),
        previousOwner: publicOwner(previous),
        anonymous: next === ANONYMOUS,
      });
    }
    return publicOwner(next);
  }

  function ownerFromMarker(value) {
    if (value === ANONYMOUS) return null;
    if (typeof value === "string" && value.startsWith("user:") && value.length <= 261) return publicOwner(value);
    return undefined;
  }

  function announcedOwner() {
    return ownerFromMarker(readRaw(KEYS.activeOwner));
  }

  function ownerMatches(ownerId) {
    let expected;
    try { expected = normalizeOwner(ownerId); }
    catch { return false; }
    if (expected !== activeOwner) return false;
    const announced = readRaw(KEYS.activeOwner);
    return announced == null || announced === expected;
  }

  function progress() {
    const clean = readScoped("progress");
    return writeScoped("progress", clean);
  }

  function setProgress(value) {
    return writeScoped("progress", value);
  }

  function stableFromLegacy(value = progress()) {
    const ids = window.COURSE_STAGE_IDS || {};
    const migrated = {};
    for (const [courseId, entry] of Object.entries(value || {})) {
      if (!Array.isArray(ids[courseId]) || !Array.isArray(entry && entry.done)) continue;
      migrated[courseId] = { done: entry.done.map((index) => ids[courseId][index]).filter((stageId) => typeof stageId === "string") };
    }
    return cleanStableProgress(migrated);
  }

  function stableProgress() {
    let clean = readScoped("stableProgress");
    if (!Object.values(clean).some((entry) => entry.done.length)) {
      const migrated = stableFromLegacy();
      if (Object.values(migrated).some((entry) => entry.done.length)) clean = writeScoped("stableProgress", migrated);
    }
    return writeScoped("stableProgress", clean);
  }

  function setStableProgress(value) {
    return writeScoped("stableProgress", value);
  }

  function gamify() {
    const clean = readScoped("gamify");
    return writeScoped("gamify", clean);
  }

  function setGamify(value) {
    return writeScoped("gamify", value);
  }

  function mastery() {
    const clean = readScoped("mastery");
    return writeScoped("mastery", clean);
  }

  function setMastery(value) {
    return writeScoped("mastery", value);
  }

  function masteryOutbox() {
    const clean = readScoped("masteryOutbox");
    return writeScoped("masteryOutbox", clean);
  }

  function setMasteryOutbox(value) {
    return writeScoped("masteryOutbox", value);
  }

  function queueMasteryAttempt(event) {
    const pending = masteryOutbox();
    if (!pending.some((entry) => entry.attemptId === event.attemptId)) pending.push(event);
    return setMasteryOutbox(pending);
  }

  function removeMasteryAttempt(attemptId) {
    return setMasteryOutbox(masteryOutbox().filter((event) => event.attemptId !== attemptId));
  }

  function skillMastery() {
    return writeScoped("skillMastery", readScoped("skillMastery"));
  }

  function setSkillMastery(value) {
    return writeScoped("skillMastery", value);
  }

  function skillOutbox() {
    return writeScoped("skillOutbox", readScoped("skillOutbox"));
  }

  function setSkillOutbox(value) {
    return writeScoped("skillOutbox", value);
  }

  function queueSkillAttempt(event) {
    const pending = skillOutbox();
    if (!pending.some((entry) => entry.attemptId === event.attemptId)) pending.push(event);
    return setSkillOutbox(pending);
  }

  function removeSkillAttempt(attemptId) {
    return setSkillOutbox(skillOutbox().filter((event) => event.attemptId !== attemptId));
  }

  function preferences() {
    return writeScoped("preferences", readScoped("preferences"));
  }

  function setPreferences(value) {
    return writeScoped("preferences", value);
  }

  function projects() {
    return writeScoped("projects", readScoped("projects"));
  }

  function setProjects(value) {
    return writeScoped("projects", value);
  }

  function placement() {
    const clean = readScoped("placement");
    return writeScoped("placement", clean);
  }

  function setPlacement(value) {
    return writeScoped("placement", value);
  }

  function syncGeneration(ownerId = publicOwner()) {
    return readSync(normalizeOwner(ownerId));
  }

  function setSyncGeneration(value, ownerId = publicOwner()) {
    return writeSync(value, normalizeOwner(ownerId));
  }

  function resetLearning(ownerId = publicOwner(), options = {}) {
    const owner = normalizeOwner(ownerId);
    const generation = options.generation == null ? readSync(owner) : cleanGeneration(options.generation);
    if (generation == null) throw new TypeError("Invalid learning-state generation");
    removeScoped("progress", owner);
    removeScoped("gamify", owner);
    removeScoped("mastery", owner);
    removeScoped("masteryOutbox", owner);
    removeScoped("placement", owner);
    removeScoped("stableProgress", owner);
    removeScoped("skillMastery", owner);
    removeScoped("skillOutbox", owner);
    removeScoped("projects", owner);
    // Materialize clean owner-bound state immediately so subsequent reads and
    // other same-page components cannot observe a removed legacy value.
    const cleanProgress = writeScoped("progress", {}, owner);
    const cleanGamify = writeScoped("gamify", emptyFor("gamify"), owner);
    const cleanMastery = writeScoped("mastery", {}, owner);
    const cleanMasteryOutbox = writeScoped("masteryOutbox", [], owner);
    const cleanPlacementState = writeScoped("placement", null, owner);
    const cleanStableProgress = writeScoped("stableProgress", {}, owner);
    const cleanSkillMastery = writeScoped("skillMastery", {}, owner);
    const cleanSkillOutbox = writeScoped("skillOutbox", [], owner);
    const cleanProjects = writeScoped("projects", {}, owner);
    writeSync(generation, owner);
    if (options.announce !== false) {
      emit("iewt:storage-reset", { owner: publicOwner(owner), anonymous: owner === ANONYMOUS, generation });
    }
    return { progress: cleanProgress, stableProgress: cleanStableProgress, gamify: cleanGamify, mastery: cleanMastery, masteryOutbox: cleanMasteryOutbox, skillMastery: cleanSkillMastery, skillOutbox: cleanSkillOutbox, projects: cleanProjects, placement: cleanPlacementState, generation };
  }

  function removeAnonymousProgress(model, indexes) {
    if (typeof model !== "string" || !Array.isArray(indexes)) return readScoped("progress", ANONYMOUS);
    const removed = new Set(indexes.filter((index) => Number.isInteger(index) && index >= 0));
    const value = readScoped("progress", ANONYMOUS);
    if (value[model] && Array.isArray(value[model].done)) {
      const done = value[model].done.filter((index) => !removed.has(index));
      if (done.length) value[model] = { done };
      else delete value[model];
    }
    return writeScoped("progress", value, ANONYMOUS);
  }

  function removeAnonymousStableProgress(courseId, stageIds) {
    if (typeof courseId !== "string" || !Array.isArray(stageIds)) return readScoped("stableProgress", ANONYMOUS);
    const removed = new Set(stageIds.filter((stageId) => typeof stageId === "string"));
    const value = readScoped("stableProgress", ANONYMOUS);
    if (value[courseId] && Array.isArray(value[courseId].done)) {
      const done = value[courseId].done.filter((stageId) => !removed.has(stageId));
      if (done.length) value[courseId] = { done };
      else delete value[courseId];
    }
    return writeScoped("stableProgress", value, ANONYMOUS);
  }

  function setAnonymousGamify(value) {
    return writeScoped("gamify", value, ANONYMOUS);
  }

  function guideWidth() {
    let value = Number(readRaw(KEYS.guideWidth));
    if (!(value >= 25 && value <= 72)) value = Number(readRaw(KEYS.legacyGuideWidth));
    if (!(value >= 25 && value <= 72)) return null;
    writeRaw(KEYS.guideWidth, value.toFixed(1));
    removeRaw(KEYS.legacyGuideWidth);
    return value;
  }

  function setGuideWidth(value) {
    const width = Math.max(25, Math.min(72, Number(value)));
    if (!Number.isFinite(width)) return null;
    writeRaw(KEYS.guideWidth, width.toFixed(1));
    removeRaw(KEYS.legacyGuideWidth);
    return width;
  }

  if (typeof window.addEventListener === "function") {
    window.addEventListener("storage", (event) => {
      if (event.key !== KEYS.activeOwner || event.newValue === activeOwner) return;
      // Storage events do not fire in the writing tab. In this receiving tab,
      // refresh the in-memory cache before notifying Auth so an external
      // removal or account switch cannot be masked by a stale cached marker.
      if (event.newValue == null) memory.delete(KEYS.activeOwner);
      else memory.set(KEYS.activeOwner, event.newValue);
      dirty.delete(KEYS.activeOwner);
      emit("iewt:owner-external", { owner: ownerFromMarker(event.newValue) });
    });
  }

  window.IEWTStorage = Object.freeze({
    KEYS,
    owner: () => publicOwner(),
    announcedOwner,
    ownerMatches,
    hasOwnerState,
    bindOwner,
    setOwner: bindOwner,
    progress,
    setProgress,
    stableProgress,
    setStableProgress,
    stableFromLegacy,
    gamify,
    setGamify,
    mastery,
    setMastery,
    masteryOutbox,
    setMasteryOutbox,
    queueMasteryAttempt,
    removeMasteryAttempt,
    skillMastery,
    setSkillMastery,
    skillOutbox,
    setSkillOutbox,
    queueSkillAttempt,
    removeSkillAttempt,
    preferences,
    setPreferences,
    projects,
    setProjects,
    placement,
    setPlacement,
    syncGeneration,
    setSyncGeneration,
    resetLearning,
    removeAnonymousProgress,
    removeAnonymousStableProgress,
    setAnonymousGamify,
    guideWidth,
    setGuideWidth,
    normalizeDay,
  });
})();

;/* ---- gamify.js ---- */
/* =============================================================
   gamify.js — points + daily streak.
   Points accrue per completed stage; the streak counts consecutive
   days with activity. Stored on-device, and synced to the backend
   (when signed in) via window.Auth.pushStats.
   ============================================================= */
(() => {
  "use strict";
  const store = window.IEWTStorage;
  const write = (state) => store.setGamify(state);
  const day = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  let remotePointFloor = 0;

  function emit(name, detail) {
    if (typeof CustomEvent === "function") document.dispatchEvent(new CustomEvent(name, { detail }));
    else document.dispatchEvent(new Event(name));
  }

  function derivedPoints() {
    const manifest = window.COURSE_STAGE_POINTS;
    if (!manifest || typeof manifest !== "object") return null;
    let total = 0;
    const progress = store.progress();
    for (const [model, value] of Object.entries(progress)) {
      if (!Object.hasOwn(manifest, model) || !Array.isArray(value && value.done)) continue;
      const weights = manifest[model];
      for (const index of new Set(value.done)) {
        if (Number.isInteger(index) && index >= 0 && index < weights.length) total += weights[index];
      }
    }
    return total;
  }

  function read() {
    const state = store.gamify();
    const points = derivedPoints();
    const reconciled = points == null ? state.points : Math.max(points, remotePointFloor);
    if (state.points !== reconciled) {
      state.points = reconciled;
      return write(state);
    }
    return state;
  }

  const Gamify = {
    get() { return read(); },
    award(points) {
      const delta = Number(points);
      if (!Number.isSafeInteger(delta) || delta <= 0) return read();
      const s = store.gamify();
      const prevStreak = s.streak || 0;
      const exact = derivedPoints();
      s.points = exact == null ? Math.min(Number.MAX_SAFE_INTEGER, (s.points || 0) + delta) : Math.max(exact, remotePointFloor);
      const today = day(new Date());
      if (s.last !== today) {
        const y = new Date(); y.setDate(y.getDate() - 1);
        s.streak = (s.last === day(y)) ? Math.min(100000, (s.streak || 0) + 1) : 1;
        s.last = today;
      }
      write(s); this.paint();
      if ((s.streak || 0) > prevStreak && window.FX && window.FX.streakUp) {
        document.querySelectorAll("[data-gamify] .gstreak").forEach((el) => window.FX.streakUp(el));
      }
      if (window.Auth && typeof window.Auth.pushStats === "function") void window.Auth.pushStats(s);
      return s;
    },
    // Count a completed mastery-review session as learning activity without
    // minting repeatable course points.
    touch() {
      const s = read();
      const today = day(new Date());
      if (s.last === today) { this.paint(); return s; }
      const previous = s.streak || 0;
      const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
      s.streak = s.last === day(yesterday) ? Math.min(100000, previous + 1) : 1;
      s.last = today;
      write(s);
      this.paint();
      if (s.streak > previous && window.FX && window.FX.streakUp) {
        document.querySelectorAll("[data-gamify] .gstreak").forEach((el) => window.FX.streakUp(el));
      }
      if (window.Auth && typeof window.Auth.pushStats === "function") void window.Auth.pushStats(s);
      return s;
    },
    // Merge the server-derived total and the newest activity date.
    merge(s, options = {}) {
      const c = read();
      const remote = s && typeof s === "object" ? s : {};
      const remoteLast = store.normalizeDay(remote.last);
      const localLast = store.normalizeDay(c.last);
      const remotePoints = Number.isSafeInteger(remote.points) && remote.points >= 0 ? remote.points : 0;
      if (options.progressComplete === true) remotePointFloor = 0;
      else if (options.progressComplete === false) remotePointFloor = Math.max(remotePointFloor, remotePoints);
      const exact = derivedPoints();
      const latest = !localLast || (remoteLast && remoteLast > localLast) ? "remote" :
        !remoteLast || localLast > remoteLast ? "local" : "same";
      const streak = latest === "remote" ? remote.streak : latest === "local" ? c.streak : Math.max(c.streak || 0, remote.streak || 0);
      write({
        points: exact == null ? Math.max(c.points || 0, remotePoints) : Math.max(exact, remotePointFloor),
        streak: Number(streak) || 0,
        last: latest === "remote" ? remoteLast : localLast || remoteLast,
      });
      this.paint();
    },
    // Reset both persisted stats and the in-memory server-point floor. The
    // authenticated reset flow clears storage only after DELETE /api/progress
    // succeeds and therefore passes { storageAlreadyCleared: true } here.
    reset(options = {}) {
      remotePointFloor = 0;
      if (options.storageAlreadyCleared !== true) {
        write({ points: 0, streak: 0, last: null });
      }
      this.paint();
      const state = read();
      emit("iewt:gamify-reset", { state });
      return state;
    },
    paint() {
      const s = read();
      document.querySelectorAll("[data-gamify]").forEach((el) => {
        const points = document.createElement("span");
        points.className = "gpts"; points.title = "Points"; points.textContent = "★ " + (s.points || 0);
        const streak = document.createElement("span");
        streak.className = "gstreak"; streak.title = "Day streak"; streak.textContent = "🔥 " + (s.streak || 0);
        el.replaceChildren(points, streak);
      });
      if (window.FX && window.FX.setStreakState) {
        document.querySelectorAll("[data-gamify] .gstreak").forEach((el) => window.FX.setStreakState(el, (s.streak || 0) > 0 ? "lit" : "none"));
      }
    },
  };
  window.Gamify = Gamify;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => Gamify.paint(), { once: true });
  }
  // Like the academy UI, gamify.js is deferred and can safely paint before a
  // CSP-blocked third-party defer allows DOMContentLoaded to fire in Safari.
  Gamify.paint();
  // A server-derived floor is meaningful only for the account that supplied
  // it. Never carry that closure state into an anonymous or different account
  // scope on a shared browser.
  document.addEventListener("iewt:owner-changed", () => {
    remotePointFloor = 0;
    Gamify.paint();
  });
})();

;/* ---- auth.js ---- */
/* =============================================================
   auth.js — account, synchronization, and reset coordination.

   All server mutations share one serialized lane and carry a mutation epoch.
   Reset invalidates queued work, waits for an in-flight mutation to finish,
   deletes server state, and only then clears the matching local owner scope.
   ============================================================= */
(() => {
  "use strict";
  let user = null, backend = false;
  let authStatus = "checking", lastError = null;
  let mutationEpoch = 0, mutationTail = Promise.resolve();
  let resetting = false, resetPromise = null;
  const store = window.IEWTStorage;
  // Snapshot the anonymous profile before later deferred scripts can record a
  // course interaction. If the initial account probe resolves to a returning account, only the
  // post-snapshot delta is transferred; pre-existing anonymous work remains an
  // isolated device profile.
  const bootAnonymousProgress = store.progress();
  const bootAnonymousGamify = store.gamify();
  const bootAnonymousStableProgress = store.stableProgress();
  let accountScopeExisted = false;
  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });

  function emit(name, detail) {
    if (typeof CustomEvent === "function") document.dispatchEvent(new CustomEvent(name, { detail }));
    else document.dispatchEvent(new Event(name));
  }

  function setStatus(value, error = null) {
    authStatus = value;
    lastError = error;
    emit("iewt:auth-state", { status: value, user, error });
  }

  let toastEl;
  window.toast = (msg, ms = 4200) => {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "toast";
      toastEl.setAttribute("role", "status");
      toastEl.setAttribute("aria-live", "polite");
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => toastEl.classList.remove("show"), ms);
  };

  async function getJSON(url, opts = {}) {
    const response = await fetch(url, { credentials: "same-origin", ...opts });
    const contentType = response.headers.get("content-type") || "";
    let value = null;
    if (contentType.includes("application/json")) {
      try { value = await response.json(); }
      catch { /* handled by the response validation below */ }
    }
    if (!response.ok || value == null) {
      const error = new Error("request-failed");
      error.status = response.status;
      error.code = value && value.error && value.error.code ? value.error.code : "request_failed";
      const bodyGeneration = value && value.generation;
      const headerGeneration = response.headers.get("x-iewt-generation");
      error.generation = parseGeneration(bodyGeneration, parseGeneration(headerGeneration));
      throw error;
    }
    return value;
  }

  function ownerHeaders(owner, extra = {}) {
    return { ...extra, "X-IEWT-Owner": owner };
  }

  function parseGeneration(value, fallback = null) {
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
    if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)) {
      const parsed = Number(value);
      if (Number.isSafeInteger(parsed)) return parsed;
    }
    return fallback;
  }

  function payloadGeneration(payload) {
    const generation = parseGeneration(payload && payload.generation);
    if (generation == null) {
      const error = new Error("invalid-generation");
      error.code = "invalid_generation";
      throw error;
    }
    return generation;
  }

  const putJSON = (url, body, owner, generation) => getJSON(url, {
    method: "PUT",
    headers: ownerHeaders(owner, {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-IEWT-Generation": String(generation),
    }),
    body: JSON.stringify(body),
  });

  const deleteProgress = (owner) => getJSON("/api/progress", {
    method: "DELETE",
    headers: ownerHeaders(owner, { Accept: "application/json" }),
  });

  const deletePlacement = (owner, generation) => getJSON("/api/placement", {
    method: "DELETE",
    headers: ownerHeaders(owner, {
      Accept: "application/json",
      "X-IEWT-Generation": String(generation),
    }),
  });

  function enqueue(operation) {
    const result = mutationTail.catch(() => undefined).then(operation);
    // Keep the lane usable after one request fails while still returning the
    // original result/rejection to the caller that owns that operation.
    mutationTail = result.catch(() => undefined);
    return result;
  }

  function current(owner, epoch, allowReset = false) {
    return epoch === mutationEpoch && !!user && user.id === owner &&
      store.ownerMatches(owner) && (allowReset || !resetting);
  }

  function capturedOwnerActive(owner) {
    return owner == null ? !user && store.owner() == null :
      !!user && user.id === owner && store.ownerMatches(owner);
  }

  function replaceStaleGeneration(owner, generation, options = {}) {
    const localGeneration = store.syncGeneration(owner);
    if (generation < localGeneration) {
      const error = new Error("stale-generation-response");
      error.code = "stale_generation";
      throw error;
    }
    if (generation === localGeneration) return false;

    const active = capturedOwnerActive(owner);
    store.resetLearning(owner, { generation, announce: active });
    if (active && window.Gamify && typeof window.Gamify.reset === "function") {
      window.Gamify.reset({ storageAlreadyCleared: true });
    }
    if (options.invalidate === true) mutationEpoch++;
    if (active) {
      emit("iewt:progress-reset", { owner, generation, remote: true });
      emit("iewt:synced", { owner, progressComplete: true, statsComplete: true, masteryComplete: true, placementComplete: true, reset: true, remote: true });
    }
    return true;
  }

  function acceptGeneration(payload, owner) {
    const generation = payloadGeneration(payload);
    return { generation, replaced: replaceStaleGeneration(owner, generation) };
  }

  function handleGenerationConflict(error, owner) {
    const generation = parseGeneration(error && error.generation);
    if (!error || error.code !== "reset_required" || generation == null) return false;
    if (generation <= store.syncGeneration(owner)) return false;
    return replaceStaleGeneration(owner, generation, { invalidate: true });
  }

  function doneSet(value) {
    return new Set(Array.isArray(value && value.done) ?
      value.done.filter((index) => Number.isInteger(index) && index >= 0) : []);
  }

  function mergeLocalProgress(model, done) {
    if (typeof model !== "string" || !Array.isArray(done)) return null;
    const progress = store.progress();
    const union = new Set([...doneSet(progress[model]), ...doneSet({ done })]);
    progress[model] = { done: [...union].sort((a, b) => a - b) };
    const saved = store.setProgress(progress);
    return saved[model] && saved[model].done;
  }

  function followingDay(value) {
    const date = new Date(`${value}T00:00:00Z`);
    if (!Number.isFinite(date.getTime())) return null;
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
  }

  function mergeLocalActivity(stats) {
    const state = store.gamify();
    const activityDay = store.normalizeDay(stats && stats.last);
    const currentDay = store.normalizeDay(state.last);
    if (activityDay && (!currentDay || activityDay > currentDay)) {
      state.streak = currentDay && followingDay(currentDay) === activityDay ?
        Math.min(100000, (state.streak || 0) + 1) : 1;
      state.last = activityDay;
    }
    return store.setGamify(state);
  }

  function validMasteryItem(value) {
    return typeof value === "string" && /^[a-z0-9][a-z0-9:._-]{0,127}$/i.test(value);
  }

  function newAttemptId() {
    if (crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    const bytes = new Uint32Array(4);
    crypto.getRandomValues(bytes);
    return "r_" + [...bytes].map((value) => value.toString(36)).join("_");
  }

  function validAttemptId(value) {
    return typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
  }

  function localDay() {
    const date = new Date();
    const local = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    // The server rejects any activity day beyond UTC-tomorrow (a local calendar
    // can sit one day ahead of UTC near midnight). Clamp a fast clock to that
    // ceiling so we never queue an attempt the server will permanently 400.
    const max = new Date(Date.now() + 86400000);
    const utcMax = `${max.getUTCFullYear()}-${String(max.getUTCMonth() + 1).padStart(2, "0")}-${String(max.getUTCDate()).padStart(2, "0")}`;
    return local <= utcMax ? local : utcMax;
  }

  const PLACEMENT_BANDS = new Set(["foundation", "applied", "advanced"]);
  const PLACEMENT_TOPICS = new Set(["ols", "iv2sls", "did", "var", "panel", "logit", "gmm"]);

  function placementValue(value) {
    if (value == null) return null;
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        !PLACEMENT_BANDS.has(value.band) || !PLACEMENT_TOPICS.has(value.recommendedTopic)) return undefined;
    const completedDay = store.normalizeDay(value.completedDay);
    const expectedBand = value.score <= 6 ? "foundation" : value.score <= 11 ? "applied" : "advanced";
    const latestDay = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (!Number.isSafeInteger(value.score) || value.total !== 15 || value.score < 0 || value.score > value.total ||
        value.band !== expectedBand || !completedDay || completedDay > latestDay) return undefined;
    return {
      band: value.band,
      score: value.score,
      total: value.total,
      completedDay,
      recommendedTopic: value.recommendedTopic,
    };
  }

  function saveMasteryRecord(itemId, record) {
    const mastery = store.mastery();
    mastery[itemId] = record;
    const saved = store.setMastery(mastery);
    if (!saved[itemId]) throw new Error("invalid-mastery-record");
    return saved[itemId];
  }

  function saveSkillRecord(skillId, record) {
    const mastery = store.skillMastery();
    mastery[skillId] = record;
    const saved = store.setSkillMastery(mastery);
    if (!saved[skillId]) throw new Error("invalid-skill-mastery-record");
    return saved[skillId];
  }

  // A 4xx that is not a generation/reset conflict (e.g. a validation reject on a
  // malformed day or an item dropped by payload regeneration) will never
  // succeed on retry. Draining must drop it and move on, or one poison event
  // blocks every attempt queued behind it forever. Missing/5xx status ⇒ network
  // or server transient ⇒ keep and retry later.
  function isPoison(error) {
    if (!error || typeof error.status !== "number" || error.status < 400 || error.status >= 500) return false;
    return error.code !== "reset_required" && error.code !== "invalid_generation" && error.code !== "stale_generation";
  }

  async function flushSkillOutbox(owner, epoch, generation) {
    let complete = true;
    for (const event of store.skillOutbox()) {
      if (!current(owner, epoch)) return false;
      try {
        const payload = await putJSON("/api/v2/attempt", event, owner, generation);
        if (!current(owner, epoch)) return false;
        const accepted = acceptGeneration(payload, owner);
        if (accepted.generation !== generation || accepted.replaced) return false;
        if (!payload.record || typeof payload.record !== "object" || Array.isArray(payload.record)) throw new Error("invalid-skill-response");
        saveSkillRecord(event.skillId, payload.record);
        store.removeSkillAttempt(event.attemptId);
      } catch (error) {
        handleGenerationConflict(error, owner);
        if (current(owner, epoch)) emit("iewt:sync-error", { area: "skills", error: error.code || error.message });
        complete = false;
        if (isPoison(error)) { store.removeSkillAttempt(event.attemptId); continue; }
        break;
      }
    }
    return complete && store.skillOutbox().length === 0;
  }

  function mergeStableProgress(remote, local) {
    const merged = {};
    for (const source of [remote, local]) {
      for (const [courseId, value] of Object.entries(source || {})) {
        const done = new Set((merged[courseId] && merged[courseId].done) || []);
        for (const stageId of Array.isArray(value && value.done) ? value.done : []) done.add(stageId);
        merged[courseId] = { done: [...done] };
      }
    }
    return store.setStableProgress(merged);
  }

  async function pullAcademyState(payload, owner, epoch, generation) {
    if (!payload || !Object.hasOwn(payload, "stableProgress")) return { stableComplete: false, skillComplete: false, preferencesComplete: false, projectsComplete: false };
    let stableComplete = false, skillComplete = false, preferencesComplete = false, projectsComplete = false;

    try {
      const remote = payload.stableProgress;
      if (!remote || typeof remote !== "object" || Array.isArray(remote)) throw new Error("invalid-stable-progress");
      const merged = mergeStableProgress(remote, store.stableProgress());
      for (const [courseId, value] of Object.entries(merged)) {
        const remoteDone = new Set(Array.isArray(remote[courseId] && remote[courseId].done) ? remote[courseId].done : []);
        for (const stageId of value.done) {
          if (remoteDone.has(stageId)) continue;
          const saved = await putJSON("/api/v2/progress", { courseId, stageId, complete: true }, owner, generation);
          if (!current(owner, epoch)) return { stableComplete, skillComplete, preferencesComplete, projectsComplete };
          const accepted = acceptGeneration(saved, owner);
          if (accepted.generation !== generation || accepted.replaced) return { stableComplete, skillComplete, preferencesComplete, projectsComplete };
        }
      }
      stableComplete = true;
    } catch (error) {
      handleGenerationConflict(error, owner);
      if (current(owner, epoch)) emit("iewt:sync-error", { area: "stable-progress", error: error.code || error.message });
    }

    try {
      if (!payload.skillMastery || typeof payload.skillMastery !== "object" || Array.isArray(payload.skillMastery)) throw new Error("invalid-skill-mastery");
      store.setSkillMastery(payload.skillMastery);
      skillComplete = await flushSkillOutbox(owner, epoch, generation);
    } catch (error) {
      handleGenerationConflict(error, owner);
      if (current(owner, epoch)) emit("iewt:sync-error", { area: "skills", error: error.code || error.message });
    }

    try {
      const local = store.preferences();
      const selected = accountScopeExisted ? payload.preferences : local;
      const saved = accountScopeExisted ? { preferences: selected, generation } :
        await putJSON("/api/v2/preferences", selected, owner, generation);
      if (!current(owner, epoch)) return { stableComplete, skillComplete, preferencesComplete, projectsComplete };
      const accepted = acceptGeneration(saved, owner);
      if (accepted.generation !== generation || accepted.replaced || !saved.preferences) throw new Error("invalid-preferences-response");
      store.setPreferences(saved.preferences);
      preferencesComplete = true;
    } catch (error) {
      handleGenerationConflict(error, owner);
      if (current(owner, epoch)) emit("iewt:sync-error", { area: "preferences", error: error.code || error.message });
    }

    try {
      if (!payload.projects || typeof payload.projects !== "object" || Array.isArray(payload.projects)) throw new Error("invalid-projects");
      const local = store.projects();
      const merged = { ...payload.projects };
      for (const [projectId, value] of Object.entries(local)) {
        const remote = payload.projects[projectId];
        merged[projectId] = {
          mode: value.mode || (remote && remote.mode) || "guided",
          done: [...new Set([...(remote && remote.done || []), ...(value.done || [])])],
        };
      }
      for (const [projectId, value] of Object.entries(merged)) {
        const remote = payload.projects[projectId];
        if (remote && remote.mode === value.mode && remote.done.length === value.done.length && value.done.every((taskId) => remote.done.includes(taskId))) continue;
        const saved = await putJSON("/api/v2/project", { projectId, mode: value.mode, completedTaskIds: value.done }, owner, generation);
        if (!current(owner, epoch)) return { stableComplete, skillComplete, preferencesComplete, projectsComplete };
        const accepted = acceptGeneration(saved, owner);
        if (accepted.generation !== generation || accepted.replaced || !saved.project) throw new Error("invalid-project-response");
        merged[projectId] = saved.project;
      }
      store.setProjects(merged);
      projectsComplete = true;
    } catch (error) {
      handleGenerationConflict(error, owner);
      if (current(owner, epoch)) emit("iewt:sync-error", { area: "projects", error: error.code || error.message });
    }

    return { stableComplete, skillComplete, preferencesComplete, projectsComplete };
  }

  async function flushMasteryOutbox(owner, epoch, generation) {
    let complete = true;
    for (const event of store.masteryOutbox()) {
      if (!current(owner, epoch)) return false;
      try {
        const payload = await putJSON("/api/mastery", event, owner, generation);
        if (!current(owner, epoch)) return false;
        const accepted = acceptGeneration(payload, owner);
        if (accepted.generation !== generation || accepted.replaced) return false;
        if (!payload.record || typeof payload.record !== "object" || Array.isArray(payload.record)) {
          throw new Error("invalid-mastery-response");
        }
        saveMasteryRecord(event.itemId, payload.record);
        store.removeMasteryAttempt(event.attemptId);
      } catch (error) {
        handleGenerationConflict(error, owner);
        if (current(owner, epoch)) emit("iewt:sync-error", { area: "mastery", error: error.code || error.message });
        complete = false;
        if (isPoison(error)) { store.removeMasteryAttempt(event.attemptId); continue; }
        break;
      }
    }
    return complete && store.masteryOutbox().length === 0;
  }

  async function pullAll(epoch, owner, bootstrapPayload = null) {
    return enqueue(async () => {
      if (!current(owner, epoch)) return false;
      let progressComplete = false, statsComplete = false, masteryComplete = false, placementComplete = false;
      let progressUploaded = false;

      try {
        const payload = bootstrapPayload || await getJSON("/api/progress", {
          headers: ownerHeaders(owner, { Accept: "application/json" }),
        });
        if (!current(owner, epoch)) return false;
        const { generation } = acceptGeneration(payload, owner);
        const remote = payload.progress;
        if (!remote || typeof remote !== "object" || Array.isArray(remote)) throw new Error("invalid-progress");

        const local = store.progress();
        const combined = { ...remote };
        for (const [model, value] of Object.entries(local)) {
          const union = new Set([...doneSet(remote[model]), ...doneSet(value)]);
          combined[model] = { done: [...union].sort((a, b) => a - b) };
        }
        const merged = store.setProgress(combined);
        const pending = Object.entries(merged).filter(([model, value]) => {
          const remoteDone = doneSet(remote[model]);
          return value.done.some((index) => !remoteDone.has(index));
        });
        if (pending.length) {
          await Promise.all(pending.map(([model, value]) =>
            putJSON("/api/progress", { model, done: value.done }, owner, generation)));
          progressUploaded = true;
        }
        if (!current(owner, epoch)) return false;
        progressComplete = true;
      } catch (error) {
        handleGenerationConflict(error, owner);
        if (current(owner, epoch)) emit("iewt:sync-error", { area: "progress", error: error.code || error.message });
      }

      try {
        if (!current(owner, epoch)) return false;
        // The bootstrap snapshot precedes any local progress uploads made just
        // above. Refresh stats only in that merge case so derived points match
        // the newly unioned D1 progress; the usual hydration remains one read.
        const payload = bootstrapPayload && !progressUploaded ? bootstrapPayload : await getJSON("/api/stats", {
          headers: ownerHeaders(owner, { Accept: "application/json" }),
        });
        if (!current(owner, epoch)) return false;
        const { generation, replaced } = acceptGeneration(payload, owner);
        if (replaced) progressComplete = false;
        const remote = payload.stats;
        if (!remote || typeof remote !== "object" || Array.isArray(remote)) throw new Error("invalid-stats");
        if (window.Gamify) {
          window.Gamify.merge(remote, { progressComplete });
          const local = window.Gamify.get();
          const remoteLast = store.normalizeDay(remote.last);
          const remoteStreak = Number.isSafeInteger(Number(remote.streak)) ? Number(remote.streak) : 0;
          // Streak writes are needed only when this device contributed newer
          // activity. Points are always derived by the Worker from progress.
          if (local.last !== remoteLast || local.streak !== remoteStreak) {
            const saved = await putJSON("/api/stats", { streak: local.streak || 0, last: local.last || null }, owner, generation);
            if (!current(owner, epoch)) return false;
            if (saved.stats) window.Gamify.merge(saved.stats, { progressComplete });
          }
        }
        statsComplete = true;
      } catch (error) {
        handleGenerationConflict(error, owner);
        if (current(owner, epoch)) emit("iewt:sync-error", { area: "stats", error: error.code || error.message });
      }

      try {
        if (!current(owner, epoch)) return false;
        const payload = bootstrapPayload || await getJSON("/api/mastery", {
          headers: ownerHeaders(owner, { Accept: "application/json" }),
        });
        if (!current(owner, epoch)) return false;
        const { generation, replaced } = acceptGeneration(payload, owner);
        if (replaced) { progressComplete = false; statsComplete = false; }
        const remote = payload.mastery;
        if (!remote || typeof remote !== "object" || Array.isArray(remote)) throw new Error("invalid-mastery");
        store.setMastery(remote);
        masteryComplete = await flushMasteryOutbox(owner, epoch, generation);
      } catch (error) {
        handleGenerationConflict(error, owner);
        if (current(owner, epoch)) emit("iewt:sync-error", { area: "mastery", error: error.code || error.message });
      }

      try {
        if (!current(owner, epoch)) return false;
        const payload = bootstrapPayload || await getJSON("/api/placement", {
          headers: ownerHeaders(owner, { Accept: "application/json" }),
        });
        if (!current(owner, epoch)) return false;
        const { generation, replaced } = acceptGeneration(payload, owner);
        if (replaced) { progressComplete = false; statsComplete = false; masteryComplete = false; }
        const remote = placementValue(payload.placement);
        if (remote === undefined) throw new Error("invalid-placement");
        const local = store.placement();
        let selected = remote;
        if (local && (!remote || local.completedDay >= remote.completedDay)) {
          const saved = await putJSON("/api/placement", local, owner, generation);
          if (!current(owner, epoch)) return false;
          const accepted = acceptGeneration(saved, owner);
          if (accepted.generation !== generation || accepted.replaced) return false;
          selected = placementValue(saved.placement);
          if (selected === undefined || selected == null) throw new Error("invalid-placement-response");
        }
        store.setPlacement(selected);
        placementComplete = true;
      } catch (error) {
        handleGenerationConflict(error, owner);
        if (current(owner, epoch)) emit("iewt:sync-error", { area: "placement", error: error.code || error.message });
      }

      if (!current(owner, epoch)) return false;
      const academy = await pullAcademyState(bootstrapPayload, owner, epoch, store.syncGeneration(owner));
      if (!current(owner, epoch)) return false;
      emit("iewt:synced", { owner, progressComplete, statsComplete, masteryComplete, placementComplete, ...academy });
      return progressComplete && statsComplete && masteryComplete && placementComplete &&
        Object.values(academy).every(Boolean);
    });
  }

  function safeResetError(error) {
    const wrapped = new Error("Your account progress could not be reset. Nothing was removed from this device.");
    wrapped.code = error && error.code ? error.code : "reset_failed";
    wrapped.status = error && error.status;
    return wrapped;
  }

  async function resetProgress() {
    await ready;
    if (resetPromise) return resetPromise;

    const signedIn = !!user;
    const owner = user && user.id;
    const epoch = ++mutationEpoch;
    resetting = true;
    setStatus("resetting");
    emit("iewt:reset-state", { state: "starting", signedIn });

    const operation = enqueue(async () => {
      // A signed-in reset is server-first. A failed DELETE preserves local
      // state; a successful DELETE always clears the owner captured above,
      // even if another account becomes active while the request is pending.
      if (signedIn) {
        if (!backend || !current(owner, epoch, true)) throw new Error("account-changed");
        const payload = await deleteProgress(owner);
        const generation = payloadGeneration(payload);
        const active = capturedOwnerActive(owner);
        const cleared = store.resetLearning(owner, { generation, announce: active });
        if (active && window.Gamify && typeof window.Gamify.reset === "function") {
          window.Gamify.reset({ storageAlreadyCleared: true });
        }
        const result = { ok: true, signedIn, owner, generation, active, cleared };
        if (active) {
          emit("iewt:progress-reset", result);
          emit("iewt:synced", { owner, progressComplete: true, statsComplete: true, masteryComplete: true, placementComplete: true, reset: true, generation });
          setStatus("ready");
        } else if (authStatus === "resetting") {
          setStatus("account-changed");
        }
        emit("iewt:reset-state", { state: "success", signedIn, owner, active, generation });
        return result;
      }

      const generation = store.syncGeneration(null);
      const active = capturedOwnerActive(null);
      const cleared = store.resetLearning(null, { generation, announce: active });
      if (active && window.Gamify && typeof window.Gamify.reset === "function") {
        window.Gamify.reset({ storageAlreadyCleared: true });
      }
      const result = { ok: true, signedIn, owner: null, generation, active, cleared };
      if (active) {
        emit("iewt:progress-reset", result);
        emit("iewt:synced", { owner: null, progressComplete: true, statsComplete: true, masteryComplete: true, placementComplete: true, reset: true, generation });
        setStatus(backend ? "ready" : "offline");
      } else if (authStatus === "resetting") {
        setStatus("account-changed");
      }
      emit("iewt:reset-state", { state: "success", signedIn, owner: null, active, generation });
      return result;
    });

    resetPromise = operation.catch((error) => {
      const safe = safeResetError(error);
      if (capturedOwnerActive(owner)) setStatus("error", safe.message);
      else if (authStatus === "resetting") setStatus("account-changed");
      emit("iewt:reset-state", { state: "error", signedIn, error: safe.message, code: safe.code });
      throw safe;
    }).finally(() => {
      resetting = false;
      resetPromise = null;
    });
    return resetPromise;
  }

  async function recordMasteryAttempt(itemId, options = {}) {
    if (authStatus === "checking" || authStatus === "syncing") await ready;
    if (resetting) throw new Error("Learning data is being reset. Try again in a moment.");
    if (!validMasteryItem(itemId) || typeof options.correct !== "boolean" || typeof options.hinted !== "boolean") {
      throw new TypeError("Invalid mastery attempt");
    }
    const day = store.normalizeDay(options.day || localDay());
    const attemptId = options.attemptId || newAttemptId();
    if (!day || !validAttemptId(attemptId)) throw new TypeError("Invalid mastery attempt");
    const scheduler = window.MasteryScheduler;
    if (!scheduler || typeof scheduler.apply !== "function") throw new Error("Review engine is unavailable.");

    const event = { itemId, correct: options.correct, hinted: options.hinted, attemptId, day };
    const previous = store.mastery()[itemId] || null;
    const localRecord = saveMasteryRecord(itemId, scheduler.apply(previous, {
      correct: event.correct,
      hinted: event.hinted,
      attemptId: event.attemptId,
      today: event.day,
    }));
    store.queueMasteryAttempt(event);
    emit("iewt:mastery-state", { itemId, record: localRecord, synced: false });

    if (!backend || !user) return { record: localRecord, synced: false };
    const owner = user.id, epoch = mutationEpoch;
    return enqueue(async () => {
      if (!current(owner, epoch)) return { record: localRecord, synced: false };
      const generation = store.syncGeneration(owner);
      try {
        const payload = await putJSON("/api/mastery", event, owner, generation);
        if (!current(owner, epoch)) return { record: localRecord, synced: false };
        const accepted = acceptGeneration(payload, owner);
        if (accepted.generation !== generation || accepted.replaced) return { record: localRecord, synced: false };
        if (!payload.record || typeof payload.record !== "object" || Array.isArray(payload.record)) {
          throw new Error("invalid-mastery-response");
        }
        const record = saveMasteryRecord(itemId, payload.record);
        store.removeMasteryAttempt(attemptId);
        emit("iewt:mastery-state", { itemId, record, synced: true, duplicate: !!payload.duplicate });
        return { record, synced: true, duplicate: !!payload.duplicate };
      } catch (error) {
        handleGenerationConflict(error, owner);
        if (current(owner, epoch)) emit("iewt:sync-error", { area: "mastery", error: error.code || error.message });
        return { record: localRecord, synced: false };
      }
    });
  }

  async function recordSkillAttempt(skillId, itemId, options = {}) {
    if (authStatus === "checking" || authStatus === "syncing") await ready;
    if (resetting) throw new Error("Learning data is being reset. Try again in a moment.");
    if (!validMasteryItem(skillId) || !validMasteryItem(itemId) || typeof options.correct !== "boolean" || typeof options.hinted !== "boolean") {
      throw new TypeError("Invalid skill attempt");
    }
    const day = store.normalizeDay(options.day || localDay());
    const attemptId = options.attemptId || newAttemptId();
    if (!day || !validAttemptId(attemptId)) throw new TypeError("Invalid skill attempt");
    const scheduler = window.SkillMasteryScheduler;
    if (!scheduler || typeof scheduler.apply !== "function") throw new Error("Skill mastery engine is unavailable.");
    const event = { skillId, itemId, correct: options.correct, hinted: options.hinted, attemptId, day };
    const previous = store.skillMastery()[skillId] || null;
    const localRecord = saveSkillRecord(skillId, scheduler.apply(previous, {
      correct: event.correct,
      hinted: event.hinted,
      attemptId: event.attemptId,
      today: event.day,
    }));
    store.queueSkillAttempt(event);
    emit("iewt:skill-state", { skillId, record: localRecord, synced: false });
    if (!backend || !user) return { record: localRecord, synced: false };

    const owner = user.id, epoch = mutationEpoch;
    return enqueue(async () => {
      if (!current(owner, epoch)) return { record: localRecord, synced: false };
      const generation = store.syncGeneration(owner);
      try {
        const payload = await putJSON("/api/v2/attempt", event, owner, generation);
        if (!current(owner, epoch)) return { record: localRecord, synced: false };
        const accepted = acceptGeneration(payload, owner);
        if (accepted.generation !== generation || accepted.replaced) return { record: localRecord, synced: false };
        const record = saveSkillRecord(skillId, payload.record);
        store.removeSkillAttempt(attemptId);
        emit("iewt:skill-state", { skillId, record, synced: true, duplicate: !!payload.duplicate });
        return { record, synced: true, duplicate: !!payload.duplicate };
      } catch (error) {
        handleGenerationConflict(error, owner);
        if (current(owner, epoch)) emit("iewt:sync-error", { area: "skills", error: error.code || error.message });
        return { record: localRecord, synced: false };
      }
    });
  }

  async function savePreferences(value) {
    if (authStatus === "checking" || authStatus === "syncing") await ready;
    if (resetting) throw new Error("Learning data is being reset. Try again in a moment.");
    const local = store.setPreferences(value);
    emit("iewt:preferences-state", { preferences: local, synced: false });
    if (!backend || !user) return { preferences: local, synced: false };
    const owner = user.id, epoch = mutationEpoch;
    return enqueue(async () => {
      if (!current(owner, epoch)) return { preferences: local, synced: false };
      const generation = store.syncGeneration(owner);
      try {
        const payload = await putJSON("/api/v2/preferences", local, owner, generation);
        if (!current(owner, epoch)) return { preferences: local, synced: false };
        const accepted = acceptGeneration(payload, owner);
        if (accepted.generation !== generation || accepted.replaced || !payload.preferences) return { preferences: local, synced: false };
        const saved = store.setPreferences(payload.preferences);
        emit("iewt:preferences-state", { preferences: saved, synced: true });
        return { preferences: saved, synced: true };
      } catch (error) {
        handleGenerationConflict(error, owner);
        if (current(owner, epoch)) emit("iewt:sync-error", { area: "preferences", error: error.code || error.message });
        return { preferences: local, synced: false };
      }
    });
  }

  async function saveProject(projectId, mode, completedTaskIds) {
    if (authStatus === "checking" || authStatus === "syncing") await ready;
    if (resetting) throw new Error("Learning data is being reset. Try again in a moment.");
    const projects = store.projects();
    projects[projectId] = { mode, done: completedTaskIds };
    const local = store.setProjects(projects);
    if (!local[projectId]) throw new TypeError("Invalid project progress");
    emit("iewt:project-state", { projectId, project: local[projectId], synced: false });
    if (!backend || !user) return { project: local[projectId], synced: false };
    const owner = user.id, epoch = mutationEpoch;
    return enqueue(async () => {
      if (!current(owner, epoch)) return { project: local[projectId], synced: false };
      const generation = store.syncGeneration(owner);
      try {
        const payload = await putJSON("/api/v2/project", { projectId, mode: local[projectId].mode, completedTaskIds: local[projectId].done }, owner, generation);
        if (!current(owner, epoch)) return { project: local[projectId], synced: false };
        const accepted = acceptGeneration(payload, owner);
        if (accepted.generation !== generation || accepted.replaced || !payload.project) return { project: local[projectId], synced: false };
        local[projectId] = payload.project;
        store.setProjects(local);
        emit("iewt:project-state", { projectId, project: payload.project, synced: true });
        return { project: payload.project, synced: true };
      } catch (error) {
        handleGenerationConflict(error, owner);
        if (current(owner, epoch)) emit("iewt:sync-error", { area: "projects", error: error.code || error.message });
        return { project: local[projectId], synced: false };
      }
    });
  }

  async function savePlacement(value) {
    if (authStatus === "checking" || authStatus === "syncing") await ready;
    if (resetting) throw new Error("Learning data is being reset. Try again in a moment.");
    const placement = placementValue(value);
    if (!placement) throw new TypeError("Invalid placement result");
    const local = store.setPlacement(placement);
    emit("iewt:placement-state", { placement: local, synced: false });
    if (!backend || !user) return { placement: local, synced: false };

    const owner = user.id, epoch = mutationEpoch;
    return enqueue(async () => {
      if (!current(owner, epoch)) return { placement: local, synced: false };
      const generation = store.syncGeneration(owner);
      try {
        const payload = await putJSON("/api/placement", local, owner, generation);
        if (!current(owner, epoch)) return { placement: local, synced: false };
        const accepted = acceptGeneration(payload, owner);
        if (accepted.generation !== generation || accepted.replaced) return { placement: local, synced: false };
        const saved = placementValue(payload.placement);
        if (!saved) throw new Error("invalid-placement-response");
        store.setPlacement(saved);
        emit("iewt:placement-state", { placement: saved, synced: true });
        return { placement: saved, synced: true };
      } catch (error) {
        const reset = handleGenerationConflict(error, owner);
        if (current(owner, epoch)) emit("iewt:sync-error", { area: "placement", error: error.code || error.message });
        if (reset) return { placement: null, synced: false, saved: false, reset: true };
        return { placement: local, synced: false, saved: true };
      }
    });
  }

  async function clearPlacement() {
    if (authStatus === "checking" || authStatus === "syncing") await ready;
    if (resetting) throw new Error("Learning data is being reset. Try again in a moment.");
    if (!backend || !user) {
      store.setPlacement(null);
      emit("iewt:placement-state", { placement: null, synced: false, cleared: true });
      return { placement: null, synced: false };
    }

    const owner = user.id, epoch = mutationEpoch;
    return enqueue(async () => {
      if (!current(owner, epoch)) throw new Error("account-changed");
      const generation = store.syncGeneration(owner);
      try {
        const payload = await deletePlacement(owner, generation);
        if (!current(owner, epoch)) throw new Error("account-changed");
        const accepted = acceptGeneration(payload, owner);
        if (accepted.generation !== generation || accepted.replaced) throw new Error("reset-required");
        store.setPlacement(null);
        emit("iewt:placement-state", { placement: null, synced: true, cleared: true });
        return { placement: null, synced: true };
      } catch (error) {
        const reset = handleGenerationConflict(error, owner);
        if (reset) {
          emit("iewt:placement-state", { placement: null, synced: true, cleared: true, reset: true });
          return { placement: null, synced: true, reset: true };
        }
        if (current(owner, epoch)) emit("iewt:sync-error", { area: "placement", error: error.code || error.message });
        throw error;
      }
    });
  }

  const Auth = {
    user() { return user; },
    isSignedIn() { return !!user; },
    hasBackend() { return backend; },
    status() { return authStatus; },
    error() { return lastError; },
    isResetting() { return resetting; },
    whenReady() { return ready; },
    signIn() {
      if (backend) location.href = "/auth/google";
      else window.toast("Google sign-in is unavailable right now. Progress is still saved on this device.");
    },
    async signOut() {
      if (!backend || !user || resetting) return false;
      const owner = user.id;
      const epoch = ++mutationEpoch;
      setStatus("signing-out");
      try {
        await getJSON("/auth/logout", {
          method: "POST",
          headers: ownerHeaders(owner, { Accept: "application/json" }),
        });
        if (!user || user.id !== owner || epoch !== mutationEpoch) return false;
        user = null;
        store.bindOwner(null, { claimAnonymous: false, announce: true });
        setStatus("ready");
        location.href = "/lab/";
        return true;
      } catch (error) {
        if (user && user.id === owner && epoch === mutationEpoch) {
          setStatus("error", "Sign out could not be completed.");
          window.toast("Sign out could not be completed. Your account and saved progress are unchanged.");
        }
        return false;
      }
    },
    async pushProgress(model, done) {
      // A course interaction can land during the initial account request. Wait
      // for owner binding, then merge that exact interaction into the verified
      // account scope instead of leaking the whole anonymous/device profile.
      const waitedForOwner = authStatus === "checking" || authStatus === "syncing";
      if (waitedForOwner && !resetting) await ready;
      if (!backend || !user || resetting) return false;
      const owner = user.id, epoch = mutationEpoch;
      let transferable = done;
      if (waitedForOwner && accountScopeExisted) {
        const baseline = doneSet(bootAnonymousProgress[model]);
        transferable = Array.isArray(done) ? done.filter((index) => !baseline.has(index)) : done;
      }
      const completed = mergeLocalProgress(model, transferable);
      if (!completed) return false;
      if (waitedForOwner && accountScopeExisted) store.removeAnonymousProgress(model, transferable);
      emit("iewt:synced", { owner, progressComplete: false, statsComplete: false, local: true });
      return enqueue(async () => {
        if (!current(owner, epoch)) return false;
        const generation = store.syncGeneration(owner);
        try {
          await putJSON("/api/progress", { model, done: completed }, owner, generation);
          return current(owner, epoch);
        } catch (error) {
          handleGenerationConflict(error, owner);
          if (current(owner, epoch)) emit("iewt:sync-error", { area: "progress", error: error.code || error.message });
          return false;
        }
      });
    },
    async pushStableProgress(courseId, stageId) {
      const waitedForOwner = authStatus === "checking" || authStatus === "syncing";
      if (waitedForOwner && !resetting) await ready;
      if (resetting || typeof courseId !== "string" || typeof stageId !== "string") return false;
      const progress = store.stableProgress();
      const done = new Set(Array.isArray(progress[courseId] && progress[courseId].done) ? progress[courseId].done : []);
      done.add(stageId);
      progress[courseId] = { done: [...done] };
      const saved = store.setStableProgress(progress);
      if (!saved[courseId] || !saved[courseId].done.includes(stageId)) return false;
      if (!backend || !user) return true;
      const owner = user.id, epoch = mutationEpoch;
      if (waitedForOwner && accountScopeExisted) {
        const baseline = new Set((bootAnonymousStableProgress[courseId] && bootAnonymousStableProgress[courseId].done) || []);
        if (!baseline.has(stageId)) store.removeAnonymousStableProgress(courseId, [stageId]);
      }
      return enqueue(async () => {
        if (!current(owner, epoch)) return false;
        const generation = store.syncGeneration(owner);
        try {
          await putJSON("/api/v2/progress", { courseId, stageId, complete: true }, owner, generation);
          return current(owner, epoch);
        } catch (error) {
          handleGenerationConflict(error, owner);
          if (current(owner, epoch)) emit("iewt:sync-error", { area: "stable-progress", error: error.code || error.message });
          return false;
        }
      });
    },
    async pushStats(stats) {
      const waitedForOwner = authStatus === "checking" || authStatus === "syncing";
      if (waitedForOwner && !resetting) await ready;
      if (!backend || !user || resetting) return false;
      const owner = user.id, epoch = mutationEpoch;
      const local = mergeLocalActivity(stats);
      if (waitedForOwner && accountScopeExisted) store.setAnonymousGamify(bootAnonymousGamify);
      const snapshot = { streak: local.streak || 0, last: local.last || null };
      return enqueue(async () => {
        if (!current(owner, epoch)) return false;
        const generation = store.syncGeneration(owner);
        try {
          const saved = await putJSON("/api/stats", snapshot, owner, generation);
          if (!current(owner, epoch)) return false;
          if (saved.stats && window.Gamify) window.Gamify.merge(saved.stats);
          return true;
        } catch (error) {
          handleGenerationConflict(error, owner);
          if (current(owner, epoch)) emit("iewt:sync-error", { area: "stats", error: error.code || error.message });
          return false;
        }
      });
    },
    recordMasteryAttempt,
    recordSkillAttempt,
    savePreferences,
    saveProject,
    savePlacement,
    clearPlacement,
    resetProgress,
    resetLearningData: resetProgress,
  };

  async function initialPayload() {
    try {
      return {
        payload: await getJSON("/api/v2/bootstrap", { headers: { Accept: "application/json" } }),
        bootstrap: true,
        academy: true,
      };
    } catch (error) {
      // During a rolling deploy, an older Worker can serve a newly cached
      // client. Only a route-level absence falls back; real backend failures
      // remain visible instead of being masked by a second request sequence.
      if (!error || (error.status !== 404 && error.status !== 405)) throw error;
      try {
        return {
          payload: await getJSON("/api/bootstrap", { headers: { Accept: "application/json" } }),
          bootstrap: true,
          academy: false,
        };
      } catch (legacyError) {
        if (!legacyError || (legacyError.status !== 404 && legacyError.status !== 405)) throw legacyError;
        return {
          payload: await getJSON("/api/me", { headers: { Accept: "application/json" } }),
          bootstrap: false,
          academy: false,
        };
      }
    }
  }

  async function init() {
    setStatus("checking");
    try {
      const initial = await initialPayload();
      const payload = initial.payload;
      backend = true;
      if (!payload || typeof payload !== "object" || Array.isArray(payload) || !("user" in payload)) {
        throw new Error("invalid-user-response");
      }
      if (payload.user != null && (!payload.user || typeof payload.user.id !== "string" || !payload.user.id.trim())) {
        throw new Error("invalid-user");
      }
      user = payload.user ? { ...payload.user, id: payload.user.id.trim() } : null;
      accountScopeExisted = !!user && store.hasOwnerState(user.id);
      store.bindOwner(user && user.id, { claimAnonymous: true, announce: true });
      if (user) {
        setStatus("syncing");
        await pullAll(mutationEpoch, user.id, initial.bootstrap ? payload : null);
      }
      if (authStatus !== "account-changed") setStatus("ready");
    } catch (error) {
      backend = false;
      user = null;
      // A network failure does not prove that another tab signed out, so do
      // not overwrite the cross-tab owner marker. This page stays anonymous.
      store.bindOwner(null, { claimAnonymous: false, announce: false });
      setStatus("offline", error && error.message ? error.message : "offline");
    } finally {
      resolveReady();
      emit("iewt:auth-ready", { status: authStatus, user });
    }
  }

  document.addEventListener("iewt:owner-external", (event) => {
    const observed = event.detail && event.detail.owner;
    if (!user || observed === user.id) return;
    // Another tab verified a different account (or signed out). Stop using the
    // stale cookie/account association immediately; a navigation will perform
    // a fresh account check before this tab can sync again.
    mutationEpoch++;
    user = null;
    store.bindOwner(null, { claimAnonymous: false, announce: false });
    setStatus("account-changed");
    emit("iewt:auth-ready", { status: authStatus, user: null });
    emit("iewt:synced", { owner: null, progressComplete: false, statsComplete: false, masteryComplete: false, placementComplete: false });
  });

  window.Auth = Object.freeze(Auth);
  void init();
})();
