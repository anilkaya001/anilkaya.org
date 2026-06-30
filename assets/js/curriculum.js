/* =============================================================
   curriculum.js — the course tree.
   TOPIC_META drives the Lab home grid. CURRICULUM[topicId] holds the
   detailed modules → stages. Stage types: read | code | interactive | quiz.
   Interactive `template` uses {{param}} tokens replaced with slider values.
   ============================================================= */

window.TOPIC_META = [
  { id: "ols",    num: "01", title: "Ordinary Least Squares",            level: "Beginner",     blurb: "The line of best fit, how it's computed, inference, and the assumptions behind it.", tags: ["regression", "inference"] },
  { id: "iv2sls", num: "02", title: "Instrumental Variables & 2SLS",     level: "Intermediate", blurb: "When OLS is biased by endogeneity, and how an instrument plus 2SLS rescues it.", tags: ["causal", "endogeneity"] },
  { id: "did",    num: "03", title: "Difference-in-Differences",         level: "Intermediate", blurb: "Treatment effects from before/after × treated/control, parallel trends, event studies.", tags: ["causal", "panel"] },
  { id: "var",    num: "04", title: "Vector Autoregression",             level: "Advanced",     blurb: "Joint dynamics of several series: estimation, impulse responses, Granger causality.", tags: ["time series", "macro"] },
  { id: "panel",  num: "05", title: "Panel: Fixed & Random Effects",     level: "Advanced",     blurb: "Unobserved heterogeneity, pooled-OLS bias, the within estimator, FE vs RE.", tags: ["panel", "causal"] },
  { id: "logit",  num: "06", title: "Logit & Probit",                    level: "Intermediate", blurb: "Binary outcomes: the logistic model, odds ratios, marginal effects, classification.", tags: ["limited-dependent", "MLE"] },
  { id: "gmm",    num: "07", title: "Generalized Method of Moments",     level: "Advanced",     blurb: "Moment conditions as a unifying estimator, IV-GMM, over-identification, efficiency.", tags: ["estimation", "theory"] },
];
// Total stages per topic (so the Lab home can show progress without loading the full curriculum-data.js).
// Base stage counts + the authored questions appended by curriculum-questions.js
// (ols+6, iv2sls+6, did+6, var+6, panel+7, logit+7, gmm+6). On the course page
// the loader recomputes these exactly; here they keep the Lab home progress right.
window.TOPIC_META.forEach((t) => { t.stages = ({ ols: 20, iv2sls: 31, did: 29, var: 30, panel: 30, logit: 32, gmm: 33 })[t.id] || 0; });

window.CURRICULUM = {
  ols: {
    id: "ols",
    title: "Ordinary Least Squares",
    modules: [
      {
        id: "ols-line",
        title: "1 · The line of best fit",
        summary: "What OLS does, and recovering a known slope from data.",
        stages: [
          { type: "read", title: "Modelling y with a line", html: `
            <h2>The line of best fit</h2>
            <p>Econometrics starts here. We model an outcome <em>y</em> as a straight-line
            function of a regressor <em>x</em>, plus an error <em>ε</em> for everything we
            didn't measure:</p>
            <p class="katexish">y = β₀ + β₁·x + ε</p>
            <p>β₀ is the intercept and β₁ is the slope — the effect on <em>y</em> of a
            one-unit change in <em>x</em>. <strong>Ordinary Least Squares (OLS)</strong>
            chooses the β's that make the line as close to the points as possible.</p>
            <div class="callout"><b>Key idea.</b> OLS minimises the sum of <em>squared</em>
            vertical gaps between the points and the line: Σ(yᵢ − ŷᵢ)².</div>` },
          { type: "code", title: "Estimate it", note: "We simulate data with a true intercept of 2 and slope of 3, then check that statsmodels recovers them.", code: `
import numpy as np, statsmodels.api as sm
import matplotlib.pyplot as plt

rng = np.random.default_rng(0)
n = 200
x = rng.normal(0, 1, n)
y = 2 + 3 * x + rng.normal(0, 1, n)        # truth: β0=2, β1=3

res = sm.OLS(y, sm.add_constant(x)).fit()
print(res.summary())

plt.figure(figsize=(6, 3.7))
plt.scatter(x, y, s=12, color="#da9100", alpha=0.5)
xs = np.linspace(x.min(), x.max(), 50)
plt.plot(xs, res.params[0] + res.params[1] * xs, color="#c9c6ac", lw=2)
plt.xlabel("x"); plt.ylabel("y")
plt.title(f"intercept={res.params[0]:.2f}, slope={res.params[1]:.2f}")
` },
          { type: "interactive", title: "Feel the fit", note: "Drag the sliders. Watch the line, the estimated slope, and its standard error react in real time — more noise means a fuzzier, less certain estimate.",
            params: [
              { name: "slope", label: "True slope β₁", min: -5, max: 5, step: 0.1, value: 3 },
              { name: "noise", label: "Noise σ", min: 0.1, max: 4, step: 0.1, value: 1 },
            ],
            template: `
import numpy as np, statsmodels.api as sm, matplotlib.pyplot as plt
rng = np.random.default_rng(0); n = 200
x = rng.normal(0, 1, n)
y = 2 + {{slope}} * x + rng.normal(0, {{noise}}, n)
res = sm.OLS(y, sm.add_constant(x)).fit()
plt.figure(figsize=(6, 3.7))
plt.scatter(x, y, s=12, color="#da9100", alpha=0.5)
xs = np.linspace(x.min(), x.max(), 50)
plt.plot(xs, res.params[0] + res.params[1]*xs, color="#c9c6ac", lw=2)
plt.title(f"beta1_hat = {res.params[1]:.2f}   SE = {res.bse[1]:.3f}")
` },
          { type: "quiz", title: "Check", prompt: "Holding n fixed, doubling the noise σ does what to the slope's standard error?",
            choices: ["halves it", "leaves it unchanged", "roughly doubles it", "quadruples it"], answer: 2,
            hint: "The standard error of β̂₁ is proportional to σ.", explain: "SE(β̂₁) ∝ σ, so doubling σ roughly doubles the standard error — the slider shows exactly this." },
        ],
      },
      {
        id: "ols-math",
        title: "2 · How OLS finds the line",
        summary: "The normal equations — OLS in one line of linear algebra.",
        stages: [
          { type: "read", title: "The normal equations", html: `
            <h2>Where the estimate comes from</h2>
            <p>Stack the data into a matrix <em>X</em> (a column of 1s for the intercept, then
            <em>x</em>) and a vector <em>y</em>. Minimising the squared residuals has a famous
            closed-form solution, the <strong>normal equations</strong>:</p>
            <p class="katexish">β̂ = (XᵀX)⁻¹ Xᵀy</p>
            <p>That single formula <em>is</em> OLS. statsmodels computes it (more carefully, via
            a stable decomposition), but the result is identical.</p>` },
          { type: "code", title: "Compute β̂ by hand vs statsmodels", note: "Solve the normal equations with NumPy and confirm it matches sm.OLS exactly.", code: `
import numpy as np, statsmodels.api as sm
rng = np.random.default_rng(0); n = 100
x = rng.normal(0, 1, n)
y = 1 + 2 * x + rng.normal(0, 1, n)
X = sm.add_constant(x)

beta_manual = np.linalg.solve(X.T @ X, X.T @ y)   # (X'X)^{-1} X'y
beta_sm = sm.OLS(y, X).fit().params

print("normal equations :", beta_manual.round(4))
print("statsmodels      :", beta_sm.round(4))
` },
          { type: "quiz", title: "Check", prompt: "In β̂ = (XᵀX)⁻¹Xᵀy, what does the column of 1s in X provide?",
            choices: ["the slope", "the intercept", "the residuals", "the standard errors"], answer: 1,
            hint: "Think about what a constant regressor estimates.", explain: "The constant (column of 1s) lets the model estimate the intercept β₀." },
        ],
      },
      {
        id: "ols-inference",
        title: "3 · Inference",
        summary: "Standard errors, t-statistics, confidence intervals — and how they shrink with n.",
        stages: [
          { type: "read", title: "From estimate to uncertainty", html: `
            <h2>How sure are we?</h2>
            <p>An estimate β̂₁ is useless without a sense of its uncertainty. The
            <strong>standard error</strong> measures that; the <strong>t-statistic</strong>
            (β̂ ⁄ SE) tests whether the true coefficient is zero; the <strong>95% confidence
            interval</strong> is roughly β̂ ± 2·SE.</p>
            <div class="callout"><b>Key idea.</b> Precision improves with the square root of the
            sample size: SE shrinks like 1⁄√n. Four times the data ⇒ half the standard error.</div>` },
          { type: "code", title: "Read the inference", note: "The summary's coef / std err / t / P>|t| / [0.025 0.975] columns are exact statsmodels inference.", code: `
import numpy as np, statsmodels.api as sm
rng = np.random.default_rng(0); n = 120
x = rng.normal(0, 1, n)
y = 1 + 2 * x + rng.normal(0, 1.5, n)
res = sm.OLS(y, sm.add_constant(x)).fit()
print(res.summary().tables[1])
print("\\nslope:", round(float(res.params[1]), 3),
      "| SE:", round(float(res.bse[1]), 3),
      "| 95% CI:", np.round(res.conf_int()[1], 3))
` },
          { type: "interactive", title: "More data, more certainty", note: "Increase n and watch the 95% interval for the slope tighten around the truth (2.0).",
            params: [
              { name: "n", label: "Sample size n", min: 20, max: 2000, step: 20, value: 100 },
              { name: "noise", label: "Noise σ", min: 0.3, max: 3, step: 0.1, value: 1.5 },
            ],
            template: `
import numpy as np, statsmodels.api as sm, matplotlib.pyplot as plt
rng = np.random.default_rng(0); n = {{n}}; sd = {{noise}}
x = rng.normal(0, 1, n)
y = 1 + 2 * x + rng.normal(0, sd, n)
res = sm.OLS(y, sm.add_constant(x)).fit()
lo, hi = res.conf_int()[1]
b = res.params[1]
plt.figure(figsize=(6, 3.7))
plt.errorbar([0], [b], yerr=[[b - lo], [hi - b]], fmt="o", color="#da9100", capsize=8, lw=2)
plt.axhline(2, color="#af983f", ls="--", lw=1)
plt.ylim(0, 4); plt.xlim(-1, 1); plt.xticks([])
plt.ylabel("beta1 estimate  ±95% CI")
plt.title(f"n={n}   SE={res.bse[1]:.3f}")
` },
          { type: "quiz", title: "Check", prompt: "To halve a coefficient's standard error, you should multiply the sample size by about…",
            choices: ["2", "4", "the same", "10"], answer: 1, hint: "SE ∝ 1⁄√n.", explain: "Because SE shrinks like 1⁄√n, you need 4× the data to halve it." },
        ],
      },
      {
        id: "ols-assumptions",
        title: "4 · Assumptions & diagnostics",
        summary: "Gauss–Markov, heteroskedasticity, and robust standard errors.",
        stages: [
          { type: "read", title: "When is OLS trustworthy?", html: `
            <h2>The fine print</h2>
            <p>OLS is unbiased when the error is mean-zero and uncorrelated with <em>x</em>.
            It is the <em>most efficient</em> linear unbiased estimator (Gauss–Markov) when the
            errors also have <strong>constant variance</strong> (homoskedasticity) and are
            uncorrelated.</p>
            <p>Real data often violate constant variance — the spread of <em>y</em> grows with
            <em>x</em> (<strong>heteroskedasticity</strong>). OLS estimates stay unbiased, but the
            <em>standard errors</em> are wrong. The fix is <strong>robust (HC) standard errors</strong>.</p>` },
          { type: "code", title: "Spot heteroskedasticity, then fix the SEs", note: "Residuals that fan out signal heteroskedasticity; HC1 robust SEs correct the inference.", code: `
import numpy as np, statsmodels.api as sm
import matplotlib.pyplot as plt

rng = np.random.default_rng(0); n = 300
x = rng.uniform(0, 3, n)
y = 1 + 2 * x + rng.normal(0, 0.4 + 0.9 * x, n)   # variance grows with x

res = sm.OLS(y, sm.add_constant(x)).fit()
res_robust = res.get_robustcov_results(cov_type="HC1")
print("classical SE:", np.round(res.bse, 3))
print("robust  SE :", np.round(res_robust.bse, 3))

plt.figure(figsize=(6, 3.7))
plt.scatter(x, res.resid, s=12, color="#da9100", alpha=0.5)
plt.axhline(0, color="#c9c6ac", lw=1)
plt.xlabel("x"); plt.ylabel("residual")
plt.title("Residuals fan out → heteroskedasticity")
` },
          { type: "quiz", title: "Check", prompt: "Under heteroskedasticity, ordinary OLS gives you…",
            choices: ["biased coefficients and wrong SEs", "unbiased coefficients but wrong SEs", "everything correct", "biased coefficients but correct SEs"], answer: 1,
            hint: "Heteroskedasticity is about the variance of the error, not its mean.", explain: "Coefficients remain unbiased; only the standard errors are wrong — use robust (HC) SEs." },
        ],
      },
    ],
  },
};
