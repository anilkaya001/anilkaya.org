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
