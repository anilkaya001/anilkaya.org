/* =============================================================
   curriculum-academy.js — canonical Academy 2.0 authoring source.

   Five 32-stage courses are built from a shared pedagogical sequence while
   keeping every explanation, diagnostic, skill link, and Python task explicit.
   This file is authoring-only and is excluded from the public static bundle.
   ============================================================= */
(() => {
  "use strict";

  const curricula = window.CURRICULUM || (window.CURRICULUM = {});
  const skillsByCourse = window.COURSE_SKILLS || {};
  const skillById = window.SKILL_BY_ID || {};

  const codeTemplates = {
    sampling: `import numpy as np
rng = np.random.default_rng(42)
n = 40
repetitions = 2000
means = rng.normal(loc=2.0, scale=3.0, size=(repetitions, n)).mean(axis=1)
print(f"Monte Carlo mean: {means.mean():.3f}")
print(f"Monte Carlo SE:   {means.std(ddof=1):.3f}")
print(f"Theory SE:        {3 / np.sqrt(n):.3f}")`,
    likelihood: `import numpy as np
y = np.array([1, 0, 1, 1, 0, 1, 1, 1])
grid = np.linspace(0.05, 0.95, 181)
loglike = np.array([(y*np.log(p) + (1-y)*np.log(1-p)).sum() for p in grid])
p_hat = grid[np.argmax(loglike)]
print(f"Grid MLE: {p_hat:.3f}")
print(f"Sample mean: {y.mean():.3f}")`,
    ar: `import numpy as np
rng = np.random.default_rng(7)
phi = 0.72
y = np.zeros(160)
for t in range(1, len(y)):
    y[t] = phi*y[t-1] + rng.normal(scale=0.8)
X, target = y[:-1, None], y[1:]
phi_hat = np.linalg.lstsq(X, target, rcond=None)[0][0]
forecast = phi_hat*y[-1]
print(f"Estimated persistence: {phi_hat:.3f}")
print(f"One-step forecast: {forecast:.3f}")`,
    kalman: `prior_mean, prior_var = 1.2, 0.9
measurement, measurement_var = 2.0, 0.4
gain = prior_var / (prior_var + measurement_var)
posterior_mean = prior_mean + gain*(measurement-prior_mean)
posterior_var = (1-gain)*prior_var
print(f"Kalman gain: {gain:.3f}")
print(f"Posterior state: {posterior_mean:.3f}")
print(f"Posterior variance: {posterior_var:.3f}")`,
    garch: `import numpy as np
omega, alpha, beta = 0.04, 0.10, 0.84
shock2 = 2.25
variance = 1.0
path = []
for horizon in range(12):
    variance = omega + alpha*shock2 + beta*variance
    path.append(variance)
    shock2 = variance
print("Variance path:", np.round(path, 3))
print(f"Persistence alpha+beta: {alpha+beta:.2f}")`,
    frontier: `import numpy as np
rng = np.random.default_rng(11)
factor = rng.normal(0.006, 0.04, 240)
asset = 0.001 + 1.25*factor + rng.normal(0, 0.025, 240)
X = np.column_stack([np.ones(len(factor)), factor])
alpha, beta = np.linalg.lstsq(X, asset, rcond=None)[0]
print(f"Monthly alpha: {alpha:.4f}")
print(f"Factor beta:   {beta:.3f}")`,
  };

  const challengeTemplates = {
    sampling: {
      task: "Complete the simulation so estimate contains the sample mean and se contains its analytical standard error.",
      starter: `import numpy as np
sample = np.array([1.2, 2.1, 1.7, 2.5, 1.9])
estimate = ...
se = ...`,
      tests: `assert np.isclose(estimate, sample.mean())
assert np.isclose(se, sample.std(ddof=1)/np.sqrt(len(sample)))
print("grader: estimate and standard error are correct")`,
      hints: ["Use the sample mean for estimate.", "Use ddof=1, divide the sample standard deviation by sqrt(n)."],
    },
    likelihood: {
      task: "Compute the Bernoulli log-likelihood over the grid and save the maximizing probability as p_hat.",
      starter: `import numpy as np
y = np.array([1, 1, 0, 1, 0, 1])
grid = np.linspace(0.05, 0.95, 181)
loglike = ...
p_hat = ...`,
      tests: `expected = np.array([(y*np.log(p)+(1-y)*np.log(1-p)).sum() for p in grid])
assert np.allclose(loglike, expected)
assert np.isclose(p_hat, grid[np.argmax(expected)])
print("grader: likelihood and maximizer are correct")`,
      hints: ["Each observation contributes y log(p)+(1-y) log(1-p).", "Evaluate every grid value, then use argmax."],
    },
    ar: {
      task: "Estimate an AR(1) coefficient by least squares and store the final one-step forecast.",
      starter: `import numpy as np
y = np.array([0.2, 0.4, 0.1, 0.5, 0.7, 0.6])
phi_hat = ...
forecast = ...`,
      tests: `expected = np.linalg.lstsq(y[:-1, None], y[1:], rcond=None)[0][0]
assert np.isclose(phi_hat, expected)
assert np.isclose(forecast, expected*y[-1])
print("grader: AR estimate and forecast are correct")`,
      hints: ["Regress y[1:] on y[:-1] without an intercept.", "The one-step forecast is phi_hat times the last observation."],
    },
    kalman: {
      task: "Complete the scalar Kalman update by calculating gain and posterior_mean.",
      starter: `prior_mean, prior_var = 0.5, 1.0
measurement, measurement_var = 1.4, 0.25
gain = ...
posterior_mean = ...`,
      tests: `expected_gain = prior_var/(prior_var+measurement_var)
expected_mean = prior_mean+expected_gain*(measurement-prior_mean)
assert abs(gain-expected_gain) < 1e-10
assert abs(posterior_mean-expected_mean) < 1e-10
print("grader: Kalman update is correct")`,
      hints: ["Gain is prior variance divided by total prior-plus-measurement variance.", "Update the prior by gain times the measurement innovation."],
    },
    garch: {
      task: "Calculate the next conditional variance and the persistence of this GARCH(1,1) model.",
      starter: `omega, alpha, beta = 0.03, 0.12, 0.82
last_shock2, last_variance = 1.8, 0.9
next_variance = ...
persistence = ...`,
      tests: `assert abs(next_variance-(omega+alpha*last_shock2+beta*last_variance)) < 1e-10
assert abs(persistence-(alpha+beta)) < 1e-10
assert next_variance > 0
print("grader: variance forecast and persistence are correct")`,
      hints: ["Use omega + alpha times the squared shock + beta times lagged variance.", "Persistence is alpha + beta."],
    },
    frontier: {
      task: "Estimate alpha and beta in the one-factor model using least squares.",
      starter: `import numpy as np
factor = np.array([-0.03, 0.01, 0.04, -0.01, 0.02, 0.05])
asset = np.array([-0.02, 0.02, 0.06, -0.01, 0.04, 0.07])
X = np.column_stack([np.ones(len(factor)), factor])
alpha, beta = ...`,
      tests: `expected = np.linalg.lstsq(X, asset, rcond=None)[0]
assert np.allclose([alpha, beta], expected)
print("grader: factor alpha and beta are correct")`,
      hints: ["Use np.linalg.lstsq with X and asset.", "The returned coefficient vector contains alpha, then beta."],
    },
  };

  const courses = [
    {
      id: "foundations", title: "Statistical Foundations, Simulation & Asymptotics",
      modules: [
        ["probability", "Probability models and random variables", "Build coherent probability models and translate them into simulated data.", "Probability statements become useful only after the support, conditioning information, and data-generating experiment are explicit.", "sampling", 0, 1],
        ["sampling", "Sampling distributions", "See estimators as random variables across repeated samples.", "A sampling distribution answers what would vary if the full sampling process were repeated, not what varies inside one fitted dataset.", "sampling", 1, 2],
        ["estimators", "Estimator properties", "Separate bias, variance, consistency, and efficiency.", "Finite-sample bias and asymptotic consistency are different claims; an estimator can trade bias for lower mean-squared error.", "sampling", 2, 4],
        ["asymptotics", "LLN, CLT, and asymptotic inference", "Connect probability limits to usable large-sample uncertainty.", "The LLN supports convergence of averages; the CLT supplies a scaled limiting distribution when its regularity conditions hold.", "sampling", 3, 4],
        ["simulation-bootstrap", "Monte Carlo and bootstrap", "Validate estimators through controlled repetition and defensible resampling.", "Monte Carlo varies simulated datasets from a known process; bootstrap varies resamples from observed data and must preserve dependence.", "sampling", 5, 6],
      ],
    },
    {
      id: "mle", title: "Maximum Likelihood & Numerical Econometrics",
      modules: [
        ["likelihood", "Building likelihoods", "Turn a probability model into an objective for observed data.", "A likelihood is the joint density or mass evaluated at the data and viewed as a function of parameters; support and factorization are part of the model.", "likelihood", 0, 1],
        ["score-information", "Score and information", "Use first and second derivatives to characterize estimation and precision.", "The score measures local slope; the information measures curvature and identifies directions in which the data are informative.", "likelihood", 1, 2],
        ["identification", "Identification and profile likelihood", "Detect observationally equivalent parameters before trusting optimization.", "Numerical convergence cannot repair identification: a flat profile or rank-deficient Hessian signals that the data do not separate parameters.", "likelihood", 2, 3],
        ["optimization", "Numerical optimization", "Scale, initialize, constrain, and verify nonlinear estimators.", "A credible optimum survives alternative starting values and has a small gradient, admissible parameters, and sensible curvature.", "likelihood", 4, 3],
        ["inference-comparison", "Robust inference and model comparison", "Match covariance estimators and comparison tools to the maintained model.", "Model-based information, sandwich uncertainty, likelihood-ratio tests, and information criteria answer different questions.", "likelihood", 5, 6],
      ],
    },
    {
      id: "forecast", title: "Univariate Time Series & Forecasting",
      modules: [
        ["transformations", "Targets, transformations, and stationarity", "Define the forecasting target before choosing a model.", "Logs, differences, seasonal adjustments, and levels change the estimand; every forecast must be transformed back consistently.", "ar", 0, 1],
        ["correlation", "ACF, PACF, and dependence", "Read sample correlation patterns as evidence, not an automatic order selector.", "Autocorrelation diagnostics are noisy and should be combined with a plausible data process, residual checks, and forecast validation.", "ar", 1, 2],
        ["arma", "ARMA dynamics", "Combine persistent states with transitory innovations.", "Autoregressive terms propagate past outcomes; moving-average terms propagate past innovations, subject to stability and invertibility.", "ar", 2, 3],
        ["arima", "ARIMA and seasonal structure", "Difference parsimoniously and model the remaining dynamics.", "Overdifferencing amplifies noise; underdifferencing leaves persistent residual structure and unstable long-horizon uncertainty.", "ar", 3, 4],
        ["evaluation", "Rolling-origin forecast evaluation", "Judge forecasts using information that was genuinely available at each origin.", "A benchmark, horizon, estimation window, and loss function must be fixed before comparing models out of sample.", "ar", 5, 6],
      ],
    },
    {
      id: "coint", title: "Cointegration, VECM & State-Space Models",
      modules: [
        ["unit-roots", "Unit roots and spurious regression", "Distinguish persistent stochastic trends from stable relationships.", "Unrelated integrated series can produce impressive t statistics and R-squared; residual persistence reveals the spurious fit.", "ar", 0, 1],
        ["engle-granger", "Engle-Granger cointegration", "Test whether a linear combination of integrated variables is stationary.", "Residual-based critical values differ from ordinary unit-root tests because the long-run relation is estimated first.", "ar", 2, 1],
        ["johansen", "Johansen systems and rank", "Determine how many stationary long-run relations a multivariate system contains.", "Rank tests depend on deterministic terms and lag order; normalization then gives interpretable cointegrating vectors.", "kalman", 3, 4],
        ["vecm", "Vector error correction", "Combine short-run changes with adjustment toward long-run equilibrium.", "The cointegrating vector defines disequilibrium; adjustment coefficients describe which variables respond to that gap.", "kalman", 4, 5],
        ["state-space", "State-space filtering and nowcasting", "Estimate latent states and update them as noisy releases arrive.", "The Kalman filter weighs prior and measurement uncertainty; a real-time nowcast must also respect release dates and data vintages.", "kalman", 5, 6],
      ],
    },
    {
      id: "financial", title: "Financial Econometrics, Risk & Factor Models",
      modules: [
        ["returns", "Returns, compounding, and factor data", "Align price changes, dividends, frequency, and factor units.", "Simple and log returns serve different aggregation operations; factor regressions also require excess returns and synchronized dates.", "frontier", 0, 5],
        ["volatility", "Volatility clustering and ARCH", "Model predictable variation in conditional second moments.", "Squared returns often remain dependent after returns themselves look uncorrelated, motivating variance rather than mean dynamics.", "garch", 1, 2],
        ["garch", "GARCH persistence and forecasting", "Propagate volatility shocks under positivity and stationarity constraints.", "Alpha controls news response, beta controls variance persistence, and alpha plus beta governs the decay of a volatility shock.", "garch", 2, 1],
        ["tail-risk", "VaR and Expected Shortfall", "Quantify both a tail threshold and the severity beyond it.", "Risk measures require a horizon and probability; exception coverage and clustering test whether forecasts work sequentially.", "garch", 3, 4],
        ["factors-backtests", "Factor models and backtesting", "Estimate exposures and evaluate risk models on held-out periods.", "Alpha, beta, residual risk, tail exceptions, and turnover must be interpreted against a predeclared benchmark and information set.", "frontier", 5, 6],
      ],
    },
  ];

  function stageMeta(type, id, skillIds, estimatedMinutes, difficulty, extra) {
    return { type, id, skillIds, estimatedMinutes, difficulty, ...extra };
  }

  function moduleFor(course, row, moduleIndex) {
    const [id, title, summary, lesson, kind, primaryIndex, secondaryIndex] = row;
    const skillIds = skillsByCourse[course.id] || [];
    const primaryId = skillIds[primaryIndex];
    const secondaryId = skillIds[secondaryIndex];
    const primary = skillById[primaryId];
    const secondary = skillById[secondaryId];
    if (!primary || !secondary) throw new Error(`Missing Academy skill metadata for ${course.id}:${id}`);
    const base = `${course.id}-${id}`;
    const challenge = challengeTemplates[kind];
    const difficulty = moduleIndex < 2 ? "core" : moduleIndex < 4 ? "applied" : "advanced";
    const stages = [
      stageMeta("read", `${base}-guide`, [primaryId, secondaryId], 7, difficulty, {
        title: `${title}: research guide`,
        html: `<h2>${title}</h2><p class="lead">${summary}</p><p>${lesson}</p><div class="callout"><b>Workflow.</b> ${primary.practice}</div><p><b>Diagnostic:</b> Inspect ${primary.diagnostic}. The main failure to avoid is ${primary.risk}.</p>`,
      }),
      stageMeta("conceptlab", `${base}-lab`, [primaryId], 6, difficulty, {
        title: `${primary.title} intuition lab`,
        note: `Move the control and explain the shape before running Python. Focus on ${primary.diagnostic}.`,
        kind,
        param: { label: kind === "sampling" ? "Sample size" : kind === "likelihood" ? "Candidate parameter" : kind === "ar" ? "Persistence" : kind === "kalman" ? "Measurement precision" : kind === "garch" ? "Shock persistence" : "Factor exposure", min: kind === "sampling" ? 10 : 0.05, max: kind === "sampling" ? 250 : 0.95, step: kind === "sampling" ? 10 : 0.05, value: kind === "sampling" ? 40 : 0.65 },
        insight: lesson,
      }),
      stageMeta("code", `${base}-worked`, [primaryId], 10, difficulty, {
        title: `${title}: worked Python model`,
        note: `Run the reproducible example, then change one assumption and compare the output.`,
        code: codeTemplates[kind],
      }),
      stageMeta("codechallenge", `${base}-challenge`, [primaryId], 12, difficulty, {
        title: `${primary.title} code challenge`,
        note: challenge.task,
        starter: challenge.starter,
        tests: challenge.tests,
        hints: challenge.hints,
        success: `The numerical result and the ${primary.title.toLowerCase()} workflow both pass the grader.`,
      }),
      stageMeta("case", `${base}-case`, [secondaryId], 8, difficulty, {
        title: `${secondary.title}: model decision`,
        note: `A team is about to report results without checking ${secondary.diagnostic}.`,
        steps: [
          { prompt: "What is the best next action?", choices: [secondary.practice, "Increase decimal precision and report immediately.", "Drop observations until the preferred coefficient appears."], answer: 0, explain: `The defensible workflow is to ${secondary.practice.charAt(0).toLowerCase()}${secondary.practice.slice(1)}` },
          { prompt: "Which risk should the final report address explicitly?", choices: ["Only whether the sample mean is positive.", secondary.risk, "Whether every coefficient has the same sign."], answer: 1, explain: `The relevant failure mode is ${secondary.risk}.` },
        ],
      }),
      stageMeta("match", `${base}-match`, [secondaryId], 7, difficulty, {
        title: `${secondary.title}: evidence map`,
        note: "Match each research role to the course-specific evidence.",
        pairs: [
          { left: "Good practice", right: secondary.practice },
          { left: "Diagnostic evidence", right: secondary.diagnostic },
          { left: "Failure to guard against", right: secondary.risk },
        ],
      }),
    ];
    if (moduleIndex >= 3) {
      stages.push(stageMeta("quiz", `${base}-checkpoint`, [primaryId, secondaryId], 6, difficulty, {
        variantId: `${base}-checkpoint-v1`,
        title: `${title} checkpoint`,
        prompt: `Which action makes the ${primary.title.toLowerCase()} analysis most defensible?`,
        choices: ["Rely on the headline coefficient alone.", primary.practice, "Skip diagnostics because the code executed.", "Choose the specification with the smallest p-value."],
        answer: 1,
        hint: `Think about the workflow and ${primary.diagnostic}.`,
        explain: primary.practice,
      }));
    }
    return { id, title: `${moduleIndex + 1} · ${title}`, summary, stages };
  }

  for (const course of courses) {
    curricula[course.id] = {
      id: course.id,
      title: course.title,
      modules: course.modules.map((row, index) => moduleFor(course, row, index)),
    };
  }
})();
