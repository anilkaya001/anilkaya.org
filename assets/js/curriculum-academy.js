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

  // Runnable interactive concept labs (slider-driven live Python), keyed by
  // stage id. Authored + verified to replace the former static conceptlab SVGs.
  const conceptLabs = {
    "foundations-probability-lab": {
      "note": "Set the mixing weight and separation: the two-component model defines one normalized density, and the simulated draws fall exactly under it.",
      "params": [
        {
          "name": "p",
          "label": "Mixing weight p (component A)",
          "min": 0,
          "max": 1,
          "step": 0.05,
          "value": 0.3
        },
        {
          "name": "sep",
          "label": "Component separation",
          "min": 0,
          "max": 6,
          "step": 0.5,
          "value": 3
        }
      ],
      "template": "import numpy as np, matplotlib.pyplot as plt\nfrom scipy import stats\nrng = np.random.default_rng(0)\np = {{p}}; sep = {{sep}}; n = 4000\n# model: with prob p draw N(-sep/2,1), else N(+sep/2,1)\nz = rng.random(n) < p\nx = np.where(z, rng.normal(-sep/2, 1, n), rng.normal(sep/2, 1, n))\ngrid = np.linspace(-7, 7, 500)\ndens = p*stats.norm.pdf(grid, -sep/2, 1) + (1-p)*stats.norm.pdf(grid, sep/2, 1)\nplt.figure(figsize=(6,3.7))\nplt.hist(x, bins=55, density=True, color='#da9100', alpha=0.5, label='simulated draws')\nplt.plot(grid, dens, color='#c9c6ac', lw=2, label='model density')\nplt.legend(); plt.xlabel('x'); plt.ylabel('density')\nplt.title(f'two-component model: p={p:.2f}, separation={sep:.1f}')\nmodel_mean = p*(-sep/2) + (1-p)*(sep/2)\nprint(f'model mean = {model_mean:.3f}, empirical mean = {x.mean():.3f}')\nprint(f'density integrates to {np.trapz(dens, grid):.3f} (a coherent model normalizes to 1)')\n"
    },
    "foundations-sampling-lab": {
      "note": "Increase n: the wide spread of a single dataset stays fixed, but the sampling distribution of the mean concentrates as sigma/sqrt(n).",
      "params": [
        {
          "name": "n",
          "label": "Sample size n",
          "min": 5,
          "max": 400,
          "step": 5,
          "value": 40
        }
      ],
      "template": "import numpy as np, matplotlib.pyplot as plt\nrng = np.random.default_rng(0)\nn = int({{n}}); reps = 3000\n# skewed population: exponential, mean=2, sd=2\nsamples = rng.exponential(2.0, size=(reps, n))\nmeans = samples.mean(axis=1)\nplt.figure(figsize=(6,3.7))\nplt.hist(samples[0], bins=40, density=True, color='#da9100', alpha=0.35, label='one dataset (raw x)')\nplt.hist(means, bins=40, density=True, color='#3b6ea5', alpha=0.6, label='sampling dist of mean')\nplt.axvline(2.0, color='#c9c6ac', lw=2, label='population mean')\nplt.legend(); plt.xlabel('value'); plt.ylabel('density')\nplt.title(f'n={n}: SE(mean)={means.std(ddof=1):.3f} vs theory {2.0/np.sqrt(n):.3f}')\nprint(f'mean of sample means = {means.mean():.3f} (population mean = 2.000)')\nprint(f'empirical SE = {means.std(ddof=1):.3f}, sigma/sqrt(n) = {2.0/np.sqrt(n):.3f}')\n"
    },
    "foundations-estimators-lab": {
      "note": "Shrink the sample mean toward zero: at lambda=1 it is unbiased, but for a weak signal an intermediate lambda trades a little bias for lower MSE.",
      "params": [
        {
          "name": "mu",
          "label": "True mean mu (signal)",
          "min": 0,
          "max": 3,
          "step": 0.1,
          "value": 0.5
        },
        {
          "name": "lam",
          "label": "Shrinkage lambda",
          "min": 0,
          "max": 1.2,
          "step": 0.05,
          "value": 1
        }
      ],
      "template": "import numpy as np, matplotlib.pyplot as plt\nrng = np.random.default_rng(0)\nmu = {{mu}}; lam = {{lam}}; n = 20; reps = 4000\nsamples = rng.normal(mu, 1.0, size=(reps, n))\nxbar = samples.mean(axis=1)\nest = lam * xbar                      # shrinkage estimator toward 0\nbias = est.mean() - mu; var = est.var(); mse = np.mean((est - mu)**2)\nlams = np.linspace(0, 1.2, 60)\nmse_curve = [np.mean((L*xbar - mu)**2) for L in lams]\nbest = lams[int(np.argmin(mse_curve))]\nplt.figure(figsize=(6,3.7))\nplt.plot(lams, mse_curve, color='#c9c6ac', lw=2, label='MSE(lambda)')\nplt.axvline(lam, color='#da9100', lw=2, label=f'chosen lambda={lam:.2f}')\nplt.scatter([lam], [mse], color='#da9100', zorder=5)\nplt.xlabel('shrinkage lambda'); plt.ylabel('MSE'); plt.legend()\nplt.title(f'bias={bias:.3f}, var={var:.3f}, MSE={mse:.3f}')\nprint(f'unbiased mean (lambda=1): MSE={np.mean((xbar-mu)**2):.3f}')\nprint(f'chosen lambda={lam:.2f}: bias={bias:.3f}, variance={var:.3f}, MSE={mse:.3f}; MSE-optimal lambda approx {best:.2f}')\n"
    },
    "foundations-asymptotics-lab": {
      "note": "Raise n: even though the parent is a skewed exponential, the standardized sample mean sqrt(n)(xbar-mu)/sigma flattens into the standard normal.",
      "params": [
        {
          "name": "n",
          "label": "Sample size n",
          "min": 1,
          "max": 200,
          "step": 1,
          "value": 3
        }
      ],
      "template": "import numpy as np, matplotlib.pyplot as plt\nfrom scipy import stats\nrng = np.random.default_rng(0)\nn = int({{n}}); reps = 5000\n# skewed parent: exponential, mean=1, sd=1\nsamples = rng.exponential(1.0, size=(reps, n))\nzstat = np.sqrt(n) * (samples.mean(axis=1) - 1.0) / 1.0\ngrid = np.linspace(-4, 4, 300)\nplt.figure(figsize=(6,3.7))\nplt.hist(zstat, bins=45, density=True, color='#da9100', alpha=0.5, label='sqrt(n)(xbar-mu)/sigma')\nplt.plot(grid, stats.norm.pdf(grid), color='#c9c6ac', lw=2, label='N(0,1)')\nplt.legend(); plt.xlabel('standardized mean'); plt.ylabel('density')\nplt.title(f'CLT from a skewed parent, n={n}')\nprint(f'n={n}: skew of standardized mean = {stats.skew(zstat):.3f} (shrinks toward 0)')\nprint(f'empirical variance = {zstat.var():.3f} (approaches 1)')\n"
    },
    "foundations-simulation-bootstrap-lab": {
      "note": "Adjust the observed sample size and the number of resamples: the bootstrap distribution of the mean recovers a standard error and 95% interval from one dataset alone.",
      "params": [
        {
          "name": "n",
          "label": "Observed sample size n",
          "min": 20,
          "max": 200,
          "step": 10,
          "value": 60
        },
        {
          "name": "B",
          "label": "Bootstrap resamples B",
          "min": 200,
          "max": 3000,
          "step": 100,
          "value": 1000
        }
      ],
      "template": "import numpy as np, matplotlib.pyplot as plt\nrng = np.random.default_rng(0)\nn = int({{n}}); B = int({{B}})\n# one observed sample from a skewed process (gamma, mean=4)\ndata = rng.gamma(2.0, 2.0, n)\nidx = rng.integers(0, n, size=(B, n))\nboot_means = data[idx].mean(axis=1)\nlo, hi = np.percentile(boot_means, [2.5, 97.5])\nplt.figure(figsize=(6,3.7))\nplt.hist(boot_means, bins=40, density=True, color='#da9100', alpha=0.55, label='bootstrap means')\nplt.axvline(data.mean(), color='#c9c6ac', lw=2, label='observed sample mean')\nplt.axvline(lo, color='#3b6ea5', ls='--'); plt.axvline(hi, color='#3b6ea5', ls='--', label='95% CI')\nplt.legend(); plt.xlabel('resampled mean'); plt.ylabel('density')\nplt.title(f'nonparametric bootstrap: n={n}, B={B}')\nprint(f'bootstrap SE = {boot_means.std(ddof=1):.3f} vs analytic s/sqrt(n) = {data.std(ddof=1)/np.sqrt(n):.3f}')\nprint(f'95% percentile CI = [{lo:.3f}, {hi:.3f}]')\n"
    },
    "mle-likelihood-lab": {
      "note": "Set the true rate and sample size, then watch the Poisson log-likelihood curve tighten around its peak (the MLE = sample mean) as n grows.",
      "params": [
        {
          "name": "lam",
          "label": "True rate λ",
          "min": 0.5,
          "max": 8,
          "step": 0.1,
          "value": 3
        },
        {
          "name": "n",
          "label": "Sample size n",
          "min": 20,
          "max": 400,
          "step": 20,
          "value": 100
        }
      ],
      "template": "\nimport numpy as np, matplotlib.pyplot as plt\nfrom scipy.special import gammaln\nrng = np.random.default_rng(0)\nn = int({{n}}); lam_true = {{lam}}\nx = rng.poisson(lam_true, n)                     # observed counts (support: 0,1,2,...)\nmle = x.mean()                                   # Poisson MLE = sample mean\ngrid = np.linspace(0.2, max(2*lam_true, 2*mle) + 2, 300)\n# log-likelihood as a FUNCTION of lambda for the fixed observed data\nll = (x[:, None]*np.log(grid[None, :]) - grid[None, :] - gammaln(x+1)[:, None]).sum(0)\nplt.figure(figsize=(6, 3.7))\nplt.plot(grid, ll, color=\"#da9100\", lw=2)\nplt.axvline(mle, color=\"#3a7d44\", ls=\"--\", lw=1.5, label=f\"MLE = {mle:.2f}\")\nplt.axvline(lam_true, color=\"#8a8a8a\", ls=\":\", lw=1.5, label=f\"true λ = {lam_true:.2f}\")\nplt.xlabel(\"λ\"); plt.ylabel(\"log-likelihood  ℓ(λ)\")\nplt.title(\"Poisson log-likelihood over the observed counts\"); plt.legend()\nprint(f\"MLE (sample mean) = {mle:.3f}   true lambda = {lam_true:.3f}\")\nprint(f\"max log-likelihood = {ll.max():.2f}\")\n"
    },
    "mle-score-information-lab": {
      "note": "Change n and σ and watch the score function: it crosses zero at the MLE, and its slope there IS the information n/σ² that sets the estimate's precision.",
      "params": [
        {
          "name": "n",
          "label": "Sample size n",
          "min": 20,
          "max": 400,
          "step": 20,
          "value": 80
        },
        {
          "name": "sigma",
          "label": "Noise σ",
          "min": 0.5,
          "max": 4,
          "step": 0.1,
          "value": 1
        }
      ],
      "template": "\nimport numpy as np, matplotlib.pyplot as plt\nrng = np.random.default_rng(0)\nn = int({{n}}); sigma = {{sigma}}\nx = rng.normal(2.0, sigma, n)                    # Normal, unknown mean mu, known sigma\nxbar = x.mean()                                  # MLE of mu = where the score = 0\nmu = np.linspace(xbar - 3, xbar + 3, 200)\nscore = (x[:, None] - mu[None, :]).sum(0) / sigma**2   # d/dmu of log-likelihood\ninfo = n / sigma**2                              # Fisher information = -slope of score\nplt.figure(figsize=(6, 3.7))\nplt.plot(mu, score, color=\"#1f6feb\", lw=2, label=\"score S(μ)\")\nplt.axhline(0, color=\"#8a8a8a\", lw=1)\nplt.axvline(xbar, color=\"#3a7d44\", ls=\"--\", lw=1.5, label=f\"MLE = {xbar:.2f}\")\nplt.xlabel(\"μ\"); plt.ylabel(\"score  S(μ)\")\nplt.title(f\"Information I = n/σ² = {info:.1f}  (steeper = more informative)\")\nplt.legend()\nprint(f\"Fisher information I(mu) = {info:.2f}\")\nprint(f\"asymptotic SE = sqrt(1/I) = {np.sqrt(1/info):.4f}\")\n"
    },
    "mle-identification-lab": {
      "note": "Push the regressor correlation ρ toward 1: the profile log-likelihood ridge for β₁ goes flat and the X'X condition number and SE explode — the data can't separate the two effects.",
      "params": [
        {
          "name": "rho",
          "label": "Regressor correlation ρ",
          "min": 0,
          "max": 0.99,
          "step": 0.01,
          "value": 0.5
        },
        {
          "name": "n",
          "label": "Sample size n",
          "min": 40,
          "max": 400,
          "step": 20,
          "value": 150
        }
      ],
      "template": "\nimport numpy as np, statsmodels.api as sm, matplotlib.pyplot as plt\nrng = np.random.default_rng(0)\nn = int({{n}}); rho = {{rho}}\nx1 = rng.normal(0, 1, n)\nx2 = rho*x1 + np.sqrt(1 - rho**2)*rng.normal(0, 1, n)   # correlated regressor\ny = 1.0*x1 + 1.0*x2 + rng.normal(0, 1, n)               # true betas both = 1\nX = np.column_stack([np.ones(n), x1, x2])\nres = sm.OLS(y, X).fit()\nse1 = res.bse[1]; cond = np.linalg.cond(X.T @ X)\n# profile log-likelihood over beta1, concentrating out const, beta2, sigma\nZ = np.column_stack([np.ones(n), x2]); Zp = np.linalg.pinv(Z)\nb1 = np.linspace(1 - 3, 1 + 3, 150); prof = []\nfor b in b1:\n    r = y - b*x1\n    resid = r - Z @ (Zp @ r)\n    s2 = np.mean(resid**2)\n    prof.append(-0.5*n*(np.log(2*np.pi*s2) + 1))\nplt.figure(figsize=(6, 3.7))\nplt.plot(b1, prof, color=\"#b5179e\", lw=2)\nplt.axvline(1.0, color=\"#8a8a8a\", ls=\":\", lw=1.5, label=\"true β₁ = 1\")\nplt.xlabel(\"β₁\"); plt.ylabel(\"profile log-likelihood\")\nplt.title(f\"cond(X'X) = {cond:,.0f}   SE(β̂₁) = {se1:.2f}\"); plt.legend()\nprint(f\"condition number of X'X = {cond:,.0f}\")\nprint(f\"SE of beta1 = {se1:.3f}  (flat profile => weak identification)\")\n"
    },
    "mle-optimization-lab": {
      "note": "The mixture negative log-likelihood is symmetric with two minima; slide the optimizer's start across the local maximum at 0 and watch it converge to a different solution.",
      "params": [
        {
          "name": "x0",
          "label": "Optimizer start μ₀",
          "min": -6,
          "max": 6,
          "step": 0.5,
          "value": -4
        },
        {
          "name": "sep",
          "label": "Mode separation",
          "min": 1.5,
          "max": 5,
          "step": 0.5,
          "value": 3
        }
      ],
      "template": "\nimport numpy as np, matplotlib.pyplot as plt\nfrom scipy.optimize import minimize\nrng = np.random.default_rng(0)\nsep = {{sep}}; x0 = {{x0}}\nz = rng.random(300) < 0.5\ndata = np.where(z, rng.normal(sep, 1, 300), rng.normal(-sep, 1, 300))\ndef nll(mu):\n    m = np.atleast_1d(mu)[0]\n    dens = 0.5*np.exp(-0.5*(data - m)**2) + 0.5*np.exp(-0.5*(data + m)**2)\n    return -np.sum(np.log(dens + 1e-12))\ngrid = np.linspace(-sep - 3, sep + 3, 400)\ncurve = np.array([nll(m) for m in grid])\nopt = minimize(nll, x0, method=\"Nelder-Mead\")\nmstar = opt.x[0]\ngrad = (nll(mstar + 1e-4) - nll(mstar - 1e-4)) / 2e-4\nplt.figure(figsize=(6, 3.7))\nplt.plot(grid, curve, color=\"#d1495b\", lw=2)\nplt.axvline(x0, color=\"#8a8a8a\", ls=\":\", lw=1.5, label=f\"start = {x0:.1f}\")\nplt.axvline(mstar, color=\"#3a7d44\", ls=\"--\", lw=1.5, label=f\"converged μ = {mstar:.2f}\")\nplt.xlabel(\"μ\"); plt.ylabel(\"negative log-likelihood\")\nplt.title(\"Multimodal objective: the start decides the basin\"); plt.legend()\nprint(f\"start = {x0:.2f}  ->  converged mu = {mstar:.3f}\")\nprint(f\"gradient at solution = {grad:.2e}  (small => a local optimum, not necessarily unique)\")\n"
    },
    "mle-inference-comparison-lab": {
      "note": "Turn up the heteroskedasticity γ: at γ=0 the classical and sandwich (HC3) standard errors agree, but as the conditional variance bends they diverge — only the sandwich estimator tracks the truth.",
      "params": [
        {
          "name": "gamma",
          "label": "Heteroskedasticity γ",
          "min": 0,
          "max": 2,
          "step": 0.1,
          "value": 1
        },
        {
          "name": "n",
          "label": "Sample size n",
          "min": 60,
          "max": 500,
          "step": 20,
          "value": 200
        }
      ],
      "template": "\nimport numpy as np, statsmodels.api as sm, matplotlib.pyplot as plt\nrng = np.random.default_rng(0)\nn = int({{n}}); g = {{gamma}}\nx = rng.normal(0, 1, n)\nsd = np.exp(g*x)                                  # variance depends on x => heteroskedastic\ny = 1 + 2*x + sd*rng.normal(0, 1, n)              # true slope = 2\nres = sm.OLS(y, sm.add_constant(x)).fit()\nse_model = res.bse[1]                             # model-based (assumes homoskedasticity)\nse_sand = float(res.HC3_se[1])                    # sandwich / robust SE\nplt.figure(figsize=(6, 3.7))\nbars = plt.bar([\"model-based\", \"sandwich (HC3)\"], [se_model, se_sand],\n               color=[\"#8a8a8a\", \"#1f6feb\"])\nfor b, v in zip(bars, [se_model, se_sand]):\n    plt.text(b.get_x() + b.get_width()/2, v, f\"{v:.3f}\", ha=\"center\", va=\"bottom\")\nplt.ylabel(\"SE of slope β̂₁\")\nplt.title(f\"γ = {g:.1f}:  robust / model-based ratio = {se_sand/se_model:.2f}\")\nprint(f\"model-based SE = {se_model:.4f}   sandwich SE = {se_sand:.4f}\")\nprint(f\"ratio (=1 only under homoskedasticity) = {se_sand/se_model:.3f}\")\n"
    },
    "forecast-transformations-lab": {
      "note": "Drag the Box-Cox power λ. Watch the variance of the first vs second half of the series equalise as λ→0 (the log) — the transform picks the scale on which the target is well-behaved.",
      "params": [
        {
          "name": "lam",
          "label": "Box-Cox power λ",
          "min": -0.5,
          "max": 1.5,
          "step": 0.1,
          "value": 0
        }
      ],
      "template": "\nimport numpy as np, matplotlib.pyplot as plt\nrng = np.random.default_rng(0); n = 240\nt = np.arange(n)\nlevel = np.exp(0.012 * t)                       # smooth exponential trend\ny = level * np.exp(0.35 * rng.normal(0, 1, n))  # multiplicative error grows with level\nlam = {{lam}}\nz = (np.power(y, lam) - 1) / lam if abs(lam) > 1e-6 else np.log(y)\nhalf = n // 2\nv1, v2 = z[:half].var(), z[half:].var()          # variance homogeneity check\nplt.figure(figsize=(6, 3.7))\nplt.plot(t, z, color=\"#da9100\", lw=1.2)\nplt.axvline(half, color=\"#c9c6ac\", ls=\"--\", lw=1)\nplt.xlabel(\"time\"); plt.ylabel(f\"Box-Cox(y, lambda={lam:g})\")\nplt.title(f\"var(early)={v1:.3f}   var(late)={v2:.3f}   ratio={v2/v1:.2f}\")\nprint(f\"lambda={lam:g}: variance ratio (late/early) = {v2/v1:.2f}  (near 1 = stabilised)\")\nprint(\"lambda=0 (log) turns multiplicative errors additive; forecasts must be back-transformed on this scale\")\n"
    },
    "forecast-correlation-lab": {
      "note": "Drag the AR persistence φ. The orange sample ACF wobbles around the smooth population curve φ^k, and several spikes past lag 5 pierce the dashed bands purely from sampling noise — evidence, not a mechanical order rule.",
      "params": [
        {
          "name": "phi",
          "label": "AR persistence φ",
          "min": 0.05,
          "max": 0.95,
          "step": 0.05,
          "value": 0.65
        }
      ],
      "template": "\nimport numpy as np, matplotlib.pyplot as plt\nfrom statsmodels.tsa.stattools import acf\nrng = np.random.default_rng(0); n = 160\nphi = {{phi}}\ny = np.zeros(n)\nfor k in range(1, n):\n    y[k] = phi * y[k-1] + rng.normal(0, 1)\nnlags = 20\nr = acf(y, nlags=nlags, fft=False)\nband = 1.96 / np.sqrt(n)                          # white-noise sampling band\ntheo = phi ** np.arange(nlags + 1)               # population ACF of AR(1)\nspurious = int(np.sum(np.abs(r[6:]) > band))     # lags 6+ are ~0 in truth\nlags = np.arange(nlags + 1)\nplt.figure(figsize=(6, 3.7))\nplt.vlines(lags, 0, r, color=\"#da9100\", lw=3)\nplt.plot(lags, theo, \"o-\", color=\"#5b8a72\", ms=3, lw=1, label=\"population phi^k\")\nplt.axhline(band, color=\"#c9c6ac\", ls=\"--\", lw=1)\nplt.axhline(-band, color=\"#c9c6ac\", ls=\"--\", lw=1)\nplt.axhline(0, color=\"#888\", lw=0.8)\nplt.xlabel(\"lag\"); plt.ylabel(\"sample ACF\"); plt.legend(fontsize=8)\nplt.title(f\"phi={phi:g}: {spurious} spikes cross the band past lag 5 (all noise)\")\nprint(f\"lag-1 sample ACF = {r[1]:.3f}   population phi = {phi:g}\")\nprint(f\"{spurious} spurious spikes exceed +/-{band:.3f} past lag 5 -- diagnostics are noisy\")\n"
    },
    "forecast-arma-lab": {
      "note": "Set the AR φ and MA θ. The bars are the impulse response (MA(∞) weights): θ lifts the lag-1 response, then φ decays every horizon geometrically — persistent state vs transitory innovation.",
      "params": [
        {
          "name": "phi",
          "label": "AR φ",
          "min": -0.9,
          "max": 0.9,
          "step": 0.05,
          "value": 0.6
        },
        {
          "name": "theta",
          "label": "MA θ",
          "min": -0.9,
          "max": 0.9,
          "step": 0.05,
          "value": 0.5
        }
      ],
      "template": "\nimport numpy as np, matplotlib.pyplot as plt\nfrom statsmodels.tsa.arima_process import ArmaProcess\nphi = {{phi}}\ntheta = {{theta}}\nproc = ArmaProcess(np.array([1, -phi]), np.array([1, theta]))\nh = 16\nirf = proc.arma2ma(lags=h)                        # MA(inf) weights = response to a unit shock\nlags = np.arange(h)\nplt.figure(figsize=(6, 3.7))\nplt.vlines(lags, 0, irf, color=\"#da9100\", lw=3)\nplt.plot(lags, phi ** lags, \"o-\", color=\"#5b8a72\", ms=3, lw=1, label=\"pure AR (phi^k)\")\nplt.axhline(0, color=\"#888\", lw=0.8)\nplt.xlabel(\"horizon k\"); plt.ylabel(\"response to a unit shock\")\nplt.legend(fontsize=8)\nplt.title(f\"ARMA(1,1) phi={phi:g}, theta={theta:g}   stable={proc.isstationary}\")\nprint(f\"impulse response: psi0={irf[0]:.2f}, psi1={irf[1]:.2f}, psi2={irf[2]:.2f}\")\nprint(f\"MA adds {theta:g} at lag 1; AR then decays every horizon at rate {phi:g}\")\n"
    },
    "forecast-arima-lab": {
      "note": "Drag the differencing order d applied to a random walk. d=1 whitens it; d=2 or more overdifferences — variance climbs and the lag-1 autocorrelation is pushed toward -0.5, the classic overdifferencing symptom.",
      "params": [
        {
          "name": "d",
          "label": "Differencing order d",
          "min": 0,
          "max": 3,
          "step": 1,
          "value": 2
        }
      ],
      "template": "\nimport numpy as np, matplotlib.pyplot as plt\nfrom statsmodels.tsa.stattools import acf\nrng = np.random.default_rng(0); n = 300\neps = rng.normal(0, 1, n)\ny = np.cumsum(eps)            # I(1) random walk: exactly one difference is correct\nd = int({{d}})\nw = y.copy()\nfor _ in range(d):\n    w = np.diff(w)\nlag1 = acf(w, nlags=1, fft=False)[1] if len(w) > 2 else float(\"nan\")\nplt.figure(figsize=(6, 3.7))\nplt.plot(w, color=\"#da9100\", lw=1)\nplt.axhline(0, color=\"#888\", lw=0.8)\nplt.xlabel(\"time\"); plt.ylabel(f\"(1-L)^{d} y\")\nplt.title(f\"d={d}: var={w.var():.2f}   lag-1 ACF={lag1:.2f}\")\nprint(f\"d={d}: variance={w.var():.3f}, lag-1 autocorr={lag1:.3f}\")\nprint(\"d=1 whitens the walk; d>=2 overdifferences -> variance rises, lag-1 ACF -> -0.5\")\n"
    },
    "forecast-evaluation-lab": {
      "note": "Set the true persistence φ and the rolling estimation window. Each origin re-fits AR(1) on only its own past and forecasts one step; the bars compare its out-of-sample RMSE against the random-walk benchmark that was fixed in advance.",
      "params": [
        {
          "name": "phi",
          "label": "True persistence φ",
          "min": 0,
          "max": 0.95,
          "step": 0.05,
          "value": 0.7
        },
        {
          "name": "win",
          "label": "Estimation window",
          "min": 30,
          "max": 120,
          "step": 10,
          "value": 80
        }
      ],
      "template": "\nimport numpy as np, matplotlib.pyplot as plt\nrng = np.random.default_rng(0); n = 220\nphi = {{phi}}\ny = np.zeros(n)\nfor k in range(1, n):\n    y[k] = phi * y[k-1] + rng.normal(0, 1)\nwin = int({{win}})\nerr_ar, err_naive = [], []\nfor o in range(win, n - 1):               # each origin uses only information up to o\n    past = y[o-win:o]\n    b = np.dot(past[:-1], past[1:]) / np.dot(past[:-1], past[:-1])  # AR(1) fit on the window\n    err_ar.append(y[o+1] - b * y[o])      # 1-step AR forecast\n    err_naive.append(y[o+1] - y[o])       # random-walk benchmark\nrmse_ar = np.sqrt(np.mean(np.square(err_ar)))\nrmse_naive = np.sqrt(np.mean(np.square(err_naive)))\nplt.figure(figsize=(6, 3.7))\nplt.bar([\"AR(1) rolling\", \"naive (RW)\"], [rmse_ar, rmse_naive], color=[\"#da9100\", \"#c9c6ac\"])\nplt.ylabel(\"out-of-sample RMSE\")\nplt.title(f\"phi={phi:g}, window={win}: benchmark/model = {rmse_naive/rmse_ar:.2f}x\")\nprint(f\"rolling-origin RMSE  AR(1)={rmse_ar:.3f}  naive={rmse_naive:.3f}\")\nprint(\"only each origin's past is used; benchmark, horizon and window are fixed before comparing\")\n"
    },
    "coint-unit-roots-lab": {
      "note": "Regress one series on a totally unrelated one — push persistence toward 1 and watch the spurious t-stat and R-squared explode even though nothing links them.",
      "params": [
        {
          "name": "phi",
          "label": "Persistence φ",
          "min": 0.5,
          "max": 1,
          "step": 0.05,
          "value": 0.95
        },
        {
          "name": "n",
          "label": "Sample length n",
          "min": 40,
          "max": 300,
          "step": 10,
          "value": 150
        }
      ],
      "template": "import numpy as np, statsmodels.api as sm, matplotlib.pyplot as plt\nrng = np.random.default_rng(0)\nn = int({{n}}); phi = {{phi}}\ndef ar1(phi, n, rng):\n    e = rng.normal(0, 1, n); y = np.zeros(n)\n    for t in range(1, n):\n        y[t] = phi*y[t-1] + e[t]\n    return y\nx = ar1(phi, n, rng)      # two INDEPENDENT series\ny = ar1(phi, n, rng)      # nothing links them at all\nres = sm.OLS(y, sm.add_constant(x)).fit()\ntstat = res.tvalues[1]; r2 = res.rsquared\nfig, ax = plt.subplots(1, 2, figsize=(7.2, 3.4))\nax[0].plot(x, color='#da9100', lw=1.2, label='x')\nax[0].plot(y, color='#4f8fba', lw=1.2, label='y')\nax[0].legend(fontsize=8); ax[0].set_title('Two INDEPENDENT series')\nax[1].scatter(x, y, s=10, color='#8888aa', alpha=0.5)\nxs = np.linspace(x.min(), x.max(), 50)\nax[1].plot(xs, res.params[0] + res.params[1]*xs, color='#c0392b', lw=2)\nax[1].set_title(f'|t|={abs(tstat):.1f}   R2={r2:.2f}')\nplt.tight_layout()\nprint(f'phi={phi:.2f}  n={n}  slope t-stat={tstat:.2f}  R2={r2:.3f}')\nprint('These series are unrelated, so an honest |t| should exceed 2 only ~5% of the time.')\n"
    },
    "coint-engle-granger-lab": {
      "note": "Two series share a stochastic trend; slide the equilibrium-error persistence toward 1 and watch the residual stop mean-reverting and the residual-based cointegration p-value collapse.",
      "params": [
        {
          "name": "rho",
          "label": "Equilibrium-error persistence ρ",
          "min": 0.5,
          "max": 0.99,
          "step": 0.01,
          "value": 0.9
        },
        {
          "name": "beta",
          "label": "True cointegrating slope β",
          "min": 0.5,
          "max": 2.5,
          "step": 0.1,
          "value": 1.5
        }
      ],
      "template": "import numpy as np, statsmodels.api as sm\nfrom statsmodels.tsa.stattools import coint, adfuller\nimport matplotlib.pyplot as plt\nrng = np.random.default_rng(0)\nn = 200; rho = {{rho}}; beta = {{beta}}\ntrend = np.cumsum(rng.normal(0, 1, n))        # common I(1) stochastic trend\nz = np.zeros(n)                               # equilibrium error, AR(1) rho\nfor t in range(1, n):\n    z[t] = rho*z[t-1] + rng.normal(0, 0.5)\nx = trend + rng.normal(0, 0.3, n)\ny = beta*trend + z                            # y and x share the trend\nt_eg, p_eg, _ = coint(y, x)                   # residual-based critical values\nres = sm.OLS(y, sm.add_constant(x)).fit()     # step 1: long-run relation\nresid = res.resid                             # step 2: test this residual\nadf_p = adfuller(resid, autolag='AIC')[1]     # WRONG crit values for est. resid\nfig, ax = plt.subplots(1, 2, figsize=(7.2, 3.4))\nax[0].plot(x, color='#da9100', label='x'); ax[0].plot(y, color='#4f8fba', label='y')\nax[0].legend(fontsize=8); ax[0].set_title('Levels share a trend')\nax[1].plot(resid, color='#c0392b'); ax[1].axhline(0, color='#888', lw=0.8)\nax[1].set_title('Estimated equilibrium residual')\nplt.tight_layout()\nprint(f'rho={rho:.2f}  beta_hat={res.params[1]:.2f} (true {beta:.2f})')\nprint(f'Engle-Granger p={p_eg:.3f} (residual-based crit) vs naive ADF-on-residual p={adf_p:.3f}')\n"
    },
    "coint-johansen-lab": {
      "note": "A 3-variable system truly has rank 1; raise measurement noise or change the lag order and watch the trace test miscount the stationary long-run relations.",
      "params": [
        {
          "name": "sigma",
          "label": "Measurement noise σ",
          "min": 0.1,
          "max": 3,
          "step": 0.1,
          "value": 0.5
        },
        {
          "name": "klag",
          "label": "Lag order (k_ar_diff)",
          "min": 1,
          "max": 4,
          "step": 1,
          "value": 1
        }
      ],
      "template": "import numpy as np\nfrom statsmodels.tsa.vector_ar.vecm import coint_johansen\nimport matplotlib.pyplot as plt\nrng = np.random.default_rng(0)\nn = 300; sig = {{sigma}}; klag = int({{klag}})\nalpha = np.array([-0.4, 0.4, 0.0])          # error-correction loadings\nbeta = np.array([1.0, -1.0, 0.0])           # 1 true cointegrating vector: y1 - y2\ny = np.zeros((n, 3))\neps = rng.normal(0, 1, (n, 3))\nfor t in range(1, n):\n    ec = beta @ y[t-1]                       # long-run disequilibrium\n    y[t] = y[t-1] + alpha*ec + eps[t]        # VECM recursion (y3 = pure random walk)\nobs = y + rng.normal(0, sig, (n, 3))         # measurement noise contaminates dynamics\nj = coint_johansen(obs, det_order=0, k_ar_diff=klag)\ntrace = j.lr1                                # trace statistics\ncrit = j.cvt[:, 1]                           # 95% critical values\nrank = int(np.sum(trace > crit))\nr = np.arange(3); wd = 0.38\nfig, ax = plt.subplots(figsize=(6.4, 3.6))\nax.bar(r - wd/2, trace, wd, color='#da9100', label='trace stat')\nax.bar(r + wd/2, crit, wd, color='#8fa3b0', label='95% crit')\nax.set_xticks(r); ax.set_xticklabels(['r=0', 'r<=1', 'r<=2'])\nax.legend(fontsize=8); ax.set_title(f'Johansen trace -> rank = {rank}  (true rank 1)')\nplt.tight_layout()\nprint(f'sigma={sig:.2f}  lag={klag}  selected rank={rank}  (truth: exactly 1 relation)')\nprint('trace:', np.round(trace, 1), ' 95% crit:', np.round(crit, 1))\n"
    },
    "coint-vecm-lab": {
      "note": "Set the adjustment speed at which y1 error-corrects to the long-run relation, then let statsmodels VECM recover the loading and cointegrating vector — larger speed means the equilibrium error snaps back faster.",
      "params": [
        {
          "name": "alpha",
          "label": "Adjustment speed α",
          "min": 0,
          "max": 0.6,
          "step": 0.02,
          "value": 0.2
        },
        {
          "name": "beta",
          "label": "True cointegrating slope β",
          "min": 0.5,
          "max": 2.5,
          "step": 0.1,
          "value": 1.5
        }
      ],
      "template": "import numpy as np\nfrom statsmodels.tsa.vector_ar.vecm import VECM\nimport matplotlib.pyplot as plt\nrng = np.random.default_rng(0)\nn = 250; alpha = {{alpha}}; beta = {{beta}}\ny1 = np.zeros(n); y2 = np.zeros(n)\nfor t in range(1, n):\n    ec = y1[t-1] - beta*y2[t-1]                      # disequilibrium gap\n    y2[t] = y2[t-1] + rng.normal(0, 1)               # random-walk driver\n    y1[t] = y1[t-1] - alpha*ec + rng.normal(0, 1)    # error-correction pull\ndata = np.column_stack([y1, y2])\nm = VECM(data, k_ar_diff=0, coint_rank=1, deterministic='n').fit()\na_hat = m.alpha.ravel()[0]\nbv = m.beta.ravel(); slope_hat = -(bv[1]/bv[0])       # normalized slope\nec_series = y1 - beta*y2\nfig, ax = plt.subplots(1, 2, figsize=(7.2, 3.4))\nax[0].plot(y1, color='#da9100', label='y1'); ax[0].plot(y2, color='#4f8fba', label='y2')\nax[0].legend(fontsize=8); ax[0].set_title('Levels track a common path')\nax[1].plot(ec_series, color='#c0392b'); ax[1].axhline(0, color='#888', lw=0.8)\nax[1].set_title('Equilibrium error (mean-reverts when alpha>0)')\nplt.tight_layout()\nprint(f'true alpha={alpha:.2f}  estimated loading={a_hat:.3f} (|loading| grows with alpha)')\nprint(f'true beta={beta:.2f}  estimated cointegrating slope={slope_hat:.2f}')\n"
    },
    "coint-state-space-lab": {
      "note": "Run the Kalman recursion on a latent random-walk state — raise the measurement variance to shrink the gain (trust the prior, smooth) or raise the process variance to grow it (chase each release).",
      "params": [
        {
          "name": "R",
          "label": "Measurement variance R",
          "min": 0.05,
          "max": 5,
          "step": 0.05,
          "value": 1
        },
        {
          "name": "Q",
          "label": "Process variance Q",
          "min": 0.01,
          "max": 1,
          "step": 0.01,
          "value": 0.1
        }
      ],
      "template": "import numpy as np, matplotlib.pyplot as plt\nrng = np.random.default_rng(0)\nn = 200; R = {{R}}; Q = {{Q}}\nstate = np.cumsum(rng.normal(0, np.sqrt(Q), n))   # latent random-walk state\nobs = state + rng.normal(0, np.sqrt(R), n)        # noisy measurements\nx_hat = np.zeros(n); x_hat[0] = obs[0]; P = 1.0\ngains = np.zeros(n)\nfor t in range(1, n):\n    x_pred = x_hat[t-1]; P_pred = P + Q            # predict step\n    K = P_pred / (P_pred + R)                      # Kalman gain\n    x_hat[t] = x_pred + K*(obs[t] - x_pred)        # update on innovation\n    P = (1 - K)*P_pred                             # covariance recursion\n    gains[t] = K\nrmse = np.sqrt(np.mean((x_hat - state)**2))\nfig, ax = plt.subplots(figsize=(6.6, 3.6))\nax.plot(obs, '.', color='#c9c6ac', ms=3, label='noisy obs')\nax.plot(state, color='#4f8fba', lw=1.6, label='true state')\nax.plot(x_hat, color='#da9100', lw=1.6, label='Kalman estimate')\nax.legend(fontsize=8); ax.set_title(f'steady-state gain={gains[-1]:.2f}   RMSE={rmse:.2f}')\nplt.tight_layout()\nprint(f'R(measure var)={R:.2f}  Q(process var)={Q:.2f}  steady-state gain={gains[-1]:.3f}')\nprint('High R -> low gain -> trust prior (smooth); high Q -> high gain -> chase the data.')\n"
    },
    "financial-returns-lab": {
      "note": "Raise the daily volatility σ and watch the summed log returns stay exactly equal to total log growth, while the summed simple returns drift away from the true holding-period return.",
      "params": [
        {
          "name": "sigma",
          "label": "Daily volatility σ",
          "min": 0.005,
          "max": 0.06,
          "step": 0.005,
          "value": 0.02
        }
      ],
      "template": "import numpy as np, matplotlib.pyplot as plt\nrng = np.random.default_rng(0)\nn = 252; mu = 0.0004\nr_log = mu + {{sigma}} * rng.normal(0, 1, n)      # daily LOG returns\nprice = 100 * np.exp(np.cumsum(r_log))             # price path\nr_simple = np.exp(r_log) - 1                        # matching SIMPLE returns\nsum_log = r_log.sum()                              # additive aggregation\ntrue_log = np.log(price[-1] / 100)                 # true cumulative log growth\nsum_simple = r_simple.sum()                        # naive additive (biased)\ntrue_hold = price[-1] / 100 - 1                     # true holding-period return\nfig, ax = plt.subplots(1, 2, figsize=(7.6, 3.6))\nax[0].plot(price, color=\"#da9100\", lw=1.5); ax[0].set_title(\"Price path\")\nax[0].set_xlabel(\"day\"); ax[0].set_ylabel(\"P\")\nvals = [sum_log, true_log, sum_simple, true_hold]\nax[1].bar([\"Σ log r\", \"true log\", \"Σ simple r\", \"true simple\"], vals,\n          color=[\"#da9100\", \"#c9c6ac\", \"#da9100\", \"#c9c6ac\"])\nax[1].axhline(0, color=\"k\", lw=.6); ax[1].set_title(\"Aggregating returns\")\nax[1].set_ylabel(\"cumulative return\")\nplt.tight_layout()\nprint(f\"sigma={{sigma}}:  sum(log r)={sum_log:.4f}  ==  true log growth {true_log:.4f}\")\nprint(f\"sum(simple r)={sum_simple:.4f}  vs  true holding return {true_hold:.4f}  (gap widens with variance)\")\n"
    },
    "financial-volatility-lab": {
      "note": "Increase the ARCH news coefficient α: the ACF of the returns stays flat inside the noise bands, but the ACF of squared returns climbs — dependence hiding in the variance.",
      "params": [
        {
          "name": "alpha",
          "label": "ARCH news coefficient α",
          "min": 0.05,
          "max": 0.9,
          "step": 0.05,
          "value": 0.6
        }
      ],
      "template": "import numpy as np, matplotlib.pyplot as plt\nfrom statsmodels.tsa.stattools import acf\nrng = np.random.default_rng(0)\nn = 1600; a = {{alpha}}; omega = 1.0\ns2 = np.zeros(n); eps = np.zeros(n)\ns2[0] = omega / (1 - a) if a < 1 else omega\nfor t in range(1, n):\n    s2[t] = omega + a * eps[t-1]**2            # ARCH(1) conditional variance\n    eps[t] = np.sqrt(s2[t]) * rng.normal()\nr = eps[100:]                                   # discard burn-in\nlags = 20; x = np.arange(1, lags + 1)\nacf_r = acf(r, nlags=lags, fft=True)[1:]\nacf_r2 = acf(r**2, nlags=lags, fft=True)[1:]\nci = 1.96 / np.sqrt(len(r))\nfig, ax = plt.subplots(1, 2, figsize=(7.6, 3.6), sharey=True)\nax[0].bar(x, acf_r, color=\"#c9c6ac\"); ax[0].set_title(\"ACF of returns\")\nax[1].bar(x, acf_r2, color=\"#da9100\"); ax[1].set_title(\"ACF of squared returns\")\nfor p in ax:\n    p.axhline(0, color=\"k\", lw=.6); p.axhline(ci, ls=\"--\", color=\"r\", lw=.6)\n    p.axhline(-ci, ls=\"--\", color=\"r\", lw=.6); p.set_xlabel(\"lag\")\nplt.tight_layout()\nprint(f\"ARCH alpha={{alpha}}:  mean|ACF| returns={np.abs(acf_r).mean():.3f}  (~ noise)\")\nprint(f\"                mean|ACF| squared returns={np.abs(acf_r2).mean():.3f}  (clustering)\")\n"
    },
    "financial-garch-lab": {
      "note": "Push the persistence α+β toward 1: the term structure of the variance forecast decays back to the unconditional level ever more slowly, and the shock half-life explodes.",
      "params": [
        {
          "name": "persist",
          "label": "Persistence α+β",
          "min": 0.1,
          "max": 0.98,
          "step": 0.02,
          "value": 0.9
        }
      ],
      "template": "import numpy as np, matplotlib.pyplot as plt\npersist = {{persist}}; alpha = 0.05\nbeta = persist - alpha                          # split persistence into news + memory\nomega = 0.04\nuncond = omega / (1 - persist)                  # long-run (unconditional) variance\nsigma2_1 = 3.0 * uncond                          # elevated 1-step forecast (post-shock)\nH = 60; h = np.arange(1, H + 1)\nfc = uncond + persist**(h - 1) * (sigma2_1 - uncond)   # GARCH(1,1) forecast\nhalf_life = np.log(0.5) / np.log(persist)\nplt.figure(figsize=(6.8, 3.8))\nplt.plot(h, fc, color=\"#da9100\", lw=2, label=\"variance forecast E[σ²_{t+h}]\")\nplt.axhline(uncond, color=\"#c9c6ac\", ls=\"--\", lw=1.5, label=\"unconditional variance\")\nplt.axvline(half_life, color=\"#b30000\", ls=\":\", lw=1, label=f\"half-life ≈ {half_life:.1f}\")\nplt.xlabel(\"forecast horizon h\"); plt.ylabel(\"variance\")\nplt.title(f\"alpha+beta={persist:.2f}  (alpha={alpha:.2f}, beta={beta:.2f})\")\nplt.legend()\nprint(f\"unconditional variance={uncond:.3f},  1-step forecast={sigma2_1:.3f}\")\nprint(f\"persistence alpha+beta={persist:.2f}  ->  shock half-life = {half_life:.1f} steps\")\n"
    },
    "financial-tail-risk-lab": {
      "note": "Lower the tail probability p or the t degrees of freedom ν: the empirical VaR and ES pull apart and the fat-tailed model dwarfs the normal VaR — the severity a quantile alone hides.",
      "params": [
        {
          "name": "p",
          "label": "Tail probability p",
          "min": 0.01,
          "max": 0.1,
          "step": 0.01,
          "value": 0.05
        },
        {
          "name": "df",
          "label": "t tail heaviness (df ν)",
          "min": 3,
          "max": 30,
          "step": 1,
          "value": 5
        }
      ],
      "template": "import numpy as np, matplotlib.pyplot as plt\nfrom scipy import stats\nrng = np.random.default_rng(0)\nn = 40000; p = {{p}}; df = {{df}}; sig = 0.01\nscale = sig / np.sqrt(df / (df - 2))                    # unit-variance Student-t\nloss_t = -scale * stats.t.rvs(df, size=n, random_state=rng)   # loss = -return\nloss_n = -sig * rng.normal(0, 1, n)\ndef var_es(L):\n    v = np.quantile(L, 1 - p)                           # VaR: loss exceeded w.p. p\n    return v, L[L >= v].mean()                           # ES: mean loss beyond VaR\nvt, et = var_es(loss_t); vn, en = var_es(loss_n)\nplt.figure(figsize=(6.9, 3.9))\nplt.hist(loss_t, bins=140, density=True, color=\"#da9100\", alpha=.6, label=f\"t({df}) losses\")\nplt.axvline(vt, color=\"#b30000\", lw=2, label=f\"VaR={vt:.3f}\")\nplt.axvline(et, color=\"k\", lw=2, ls=\"--\", label=f\"ES={et:.3f}\")\nplt.axvline(vn, color=\"#5a7d9a\", lw=1.5, ls=\":\", label=f\"normal VaR={vn:.3f}\")\nplt.xlim(np.quantile(loss_t, 0.002), np.quantile(loss_t, 0.998))\nplt.xlabel(\"loss\"); plt.title(f\"Tail risk at p={p:.2f}   (ES > VaR)\"); plt.legend()\nprint(f\"Student-t({df}):  VaR={vt:.4f}   ES={et:.4f}\")\nprint(f\"Normal:        VaR={vn:.4f}   ES={en:.4f}   ->  normal understates the tail\")\n"
    },
    "financial-factors-backtests-lab": {
      "note": "Raise the omitted-factor loading b₂ or the factor correlation ρ: the one-factor model reports a spurious positive alpha even though true alpha is zero, while the two-factor fit stays honest.",
      "params": [
        {
          "name": "rho",
          "label": "Factor correlation ρ",
          "min": -0.9,
          "max": 0.9,
          "step": 0.1,
          "value": 0.5
        },
        {
          "name": "b2",
          "label": "Omitted-factor loading b₂",
          "min": 0,
          "max": 1.5,
          "step": 0.1,
          "value": 0.8
        }
      ],
      "template": "import numpy as np, statsmodels.api as sm, matplotlib.pyplot as plt\nrng = np.random.default_rng(0)\nn = 240; rho = {{rho}}; b2 = {{b2}}\nmu_val = 0.006                                                 # omitted factor's risk premium\nmkt = rng.normal(0.0, 0.04, n)                                # market factor (zero-mean innovation)\nval = mu_val + rho * mkt + np.sqrt(max(1 - rho**2, 0.0)) * rng.normal(0, 0.04, n)\nasset = 1.0 * mkt + b2 * val + rng.normal(0, 0.02, n)          # TRUE alpha = 0\nm1 = sm.OLS(asset, sm.add_constant(mkt)).fit()                 # WRONG: omits value\nm2 = sm.OLS(asset, sm.add_constant(np.column_stack([mkt, val]))).fit()  # RIGHT\nplt.figure(figsize=(6.9, 3.8))\nplt.scatter(mkt, asset, s=10, color=\"#da9100\", alpha=.5)\nxs = np.linspace(mkt.min(), mkt.max(), 40)\nplt.plot(xs, m1.params[0] + m1.params[1] * xs, color=\"#c9c6ac\", lw=2, label=\"1-factor fit\")\nplt.axhline(m1.params[0], color=\"#b30000\", ls=\"--\", lw=1, label=f\"apparent alpha={m1.params[0]:.4f}\")\nplt.axhline(0.0, color=\"#2b2b2b\", lw=.8, label=\"true alpha=0\")\nplt.xlabel(\"market factor\"); plt.ylabel(\"asset excess return\")\nplt.title(f\"1-factor alpha={m1.params[0]:.4f}  vs  2-factor alpha={m2.params[0]:.4f}  (true=0)\")\nplt.legend()\nprint(f\"Omitted-factor 1-factor alpha={m1.params[0]:.4f}  (spurious; should be 0),  biased market beta={m1.params[1]:.3f}\")\nprint(f\"Correct 2-factor alpha={m2.params[0]:.4f},  market beta={m2.params[1]:.3f},  value beta={m2.params[2]:.3f}\")\n"
    }
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
      (() => {
        // Runnable, slider-driven live-Python lab (was a static conceptlab SVG).
        const lab = conceptLabs[`${base}-lab`];
        if (!lab) throw new Error(`Missing runnable concept lab for ${base}-lab`);
        return stageMeta("interactive", `${base}-lab`, [primaryId], 6, difficulty, {
          title: `${primary.title} intuition lab`,
          note: lab.note,
          params: lab.params,
          template: lab.template,
        });
      })(),
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
