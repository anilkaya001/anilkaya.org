/* =============================================================
   lessons.js — data-driven course content.
   Step types: read | code | interactive | quiz.
   - code:        editable cell, runs real statsmodels.
   - interactive: sliders -> parametrised code re-runs live (DataCamp-style).
                  `code` is a function (params) => python string.
   - quiz:        multiple choice with a hint and an explanation.
   Add a model by appending an object here.
   ============================================================= */

window.LESSONS = [
  {
    id: "ols",
    num: "01",
    title: "OLS — the foundation",
    level: "Beginner",
    blurb: "Fit a regression line by least squares, then move sliders and watch the estimate and its standard error react in real time.",
    tags: ["regression", "inference"],
    steps: [
      { type: "read", html: `
        <h2>Ordinary Least Squares</h2>
        <p>We model an outcome <em>y</em> as a linear function of a regressor
        <em>x</em>:</p>
        <p class="katexish">y = β₀ + β₁·x + ε</p>
        <p>OLS picks β₀, β₁ to minimise the squared residuals. Below we simulate
        data with a known truth (intercept&nbsp;2, slope&nbsp;3) and check that
        statsmodels recovers it.</p>` },
      { type: "code", id: "ols-fit", title: "ols_fit.py", code: `
import numpy as np, statsmodels.api as sm
import matplotlib.pyplot as plt

rng = np.random.default_rng(7)
n = 200
x = rng.normal(0, 1, n)
y = 2.0 + 3.0 * x + rng.normal(0, 1, n)   # truth: intercept 2, slope 3

res = sm.OLS(y, sm.add_constant(x)).fit()
print(res.summary())

plt.figure(figsize=(6, 4))
plt.scatter(x, y, s=14, color="#da9100", alpha=0.55)
xs = np.linspace(x.min(), x.max(), 50)
plt.plot(xs, res.params[0] + res.params[1] * xs, color="#c9c6ac", lw=2, label="OLS fit")
plt.xlabel("x"); plt.ylabel("y"); plt.title("OLS regression line"); plt.legend()
` },
      { type: "read", html: `
        <p><code>x1</code> should land near <strong>3.0</strong> and
        <code>const</code> near <strong>2.0</strong>. Now make it interactive —
        drag the sliders and watch the fit, the estimate, and its standard error
        update live.</p>` },
      { type: "interactive", id: "ols-play", title: "Live: slope, noise & sample size",
        params: [
          { name: "slope", label: "True slope β₁", min: -5, max: 5, step: 0.1, value: 3 },
          { name: "noise", label: "Noise σ", min: 0.1, max: 4, step: 0.1, value: 1 },
          { name: "n", label: "Sample size n", min: 20, max: 1000, step: 10, value: 200 },
        ],
        code: (p) => `
import numpy as np, statsmodels.api as sm, matplotlib.pyplot as plt
rng = np.random.default_rng(0)
n, b1, sd = ${p.n}, ${p.slope}, ${p.noise}
x = rng.normal(0, 1, n)
y = 2.0 + b1 * x + rng.normal(0, sd, n)
res = sm.OLS(y, sm.add_constant(x)).fit()
plt.figure(figsize=(6.2, 3.7))
plt.scatter(x, y, s=12, color="#da9100", alpha=0.5)
xs = np.linspace(x.min(), x.max(), 50)
plt.plot(xs, res.params[0] + res.params[1]*xs, color="#c9c6ac", lw=2)
plt.xlabel("x"); plt.ylabel("y")
plt.title(f"beta1_hat = {res.params[1]:.2f}   (true {b1})    SE = {res.bse[1]:.3f}")
` },
      { type: "quiz", id: "ols-q", prompt: "Holding n fixed, if you double the noise σ, the slope's standard error roughly…",
        choices: ["halves", "is unchanged", "doubles", "quadruples"], answer: 2,
        hint: "The standard error of β̂₁ is proportional to σ.",
        explain: "SE(β̂₁) ∝ σ, so doubling σ doubles the standard error — exactly what the slider shows." },
      { type: "read", html: `<div class="callout"><b>Your turn.</b> Edit and re-run: change <code>true_slope</code> / <code>noise_sd</code> and read the 95% interval.</div>` },
      { type: "code", id: "ols-try", title: "your_turn.py", code: `
import numpy as np, statsmodels.api as sm
rng = np.random.default_rng(1)
n, true_slope, noise_sd = 150, 5.0, 2.0
x = rng.normal(0, 1, n)
y = 1.0 + true_slope * x + rng.normal(0, noise_sd, n)
res = sm.OLS(y, sm.add_constant(x)).fit()
print("Estimated slope:", round(float(res.params[1]), 3))
print("95% CI for slope:", np.round(res.conf_int()[1], 3))
` },
    ],
  },

  {
    id: "iv2sls",
    num: "02",
    title: "Instrumental Variables & 2SLS",
    level: "Intermediate",
    blurb: "Watch endogeneity bias OLS, then slide the instrument strength and confounding to see 2SLS hold the line.",
    tags: ["causal", "endogeneity"],
    steps: [
      { type: "read", html: `
        <h2>The endogeneity problem</h2>
        <p>OLS is only consistent when the regressor is uncorrelated with the error.
        If an unobserved factor <em>u</em> drives both <em>x</em> and <em>y</em>,
        the OLS slope is biased. An <strong>instrument</strong> <em>z</em> — relevant
        for <em>x</em>, excluded from <em>y</em> — lets <strong>2SLS</strong> recover
        a consistent estimate.</p>` },
      { type: "code", id: "iv-fit", title: "iv_2sls.py", code: `
import numpy as np, statsmodels.api as sm
from statsmodels.sandbox.regression.gmm import IV2SLS
import matplotlib.pyplot as plt

rng = np.random.default_rng(3)
n = 2000
z = rng.normal(0, 1, n)
u = rng.normal(0, 1, n)
x = 0.8 * z + 1.0 * u + rng.normal(0, 0.5, n)
y = 1.0 + 1.5 * x + 2.0 * u + rng.normal(0, 1, n)

X, inst = sm.add_constant(x), sm.add_constant(z)
ols = sm.OLS(y, X).fit()
iv  = IV2SLS(y, X, inst).fit()
fs  = sm.OLS(x, inst).fit()
print(f"True beta              = 1.500")
print(f"OLS  beta (biased)     = {ols.params[1]:.3f}")
print(f"2SLS beta (consistent) = {iv.params[1]:.3f}")
print(f"First-stage F on z     = {fs.fvalue:.1f}   (>10 => strong)")
` },
      { type: "read", html: `<p>Now feel it: shrink the instrument toward zero (weak instrument) and crank the confounding up.</p>` },
      { type: "interactive", id: "iv-play", title: "Live: instrument strength & confounding",
        params: [
          { name: "strength", label: "Instrument strength (z → x)", min: 0.02, max: 1.5, step: 0.02, value: 0.8 },
          { name: "confound", label: "Confounding (u → y)", min: 0, max: 4, step: 0.1, value: 2 },
        ],
        code: (p) => `
import numpy as np, statsmodels.api as sm
from statsmodels.sandbox.regression.gmm import IV2SLS
import matplotlib.pyplot as plt
rng = np.random.default_rng(0)
n, s, conf = 1500, ${p.strength}, ${p.confound}
z = rng.normal(0,1,n); u = rng.normal(0,1,n)
x = s*z + u + rng.normal(0,0.5,n)
y = 1.0 + 1.5*x + conf*u + rng.normal(0,1,n)
ols = sm.OLS(y, sm.add_constant(x)).fit()
iv  = IV2SLS(y, sm.add_constant(x), sm.add_constant(z)).fit()
fs  = sm.OLS(x, sm.add_constant(z)).fit()
plt.figure(figsize=(6.2, 3.7))
plt.bar(["True","OLS","2SLS"], [1.5, ols.params[1], iv.params[1]],
        color=["#6f6b57","#da9100","#c9c6ac"])
plt.axhline(1.5, color="#af983f", ls="--", lw=1)
plt.title(f"OLS={ols.params[1]:.2f}   2SLS={iv.params[1]:.2f}   first-stage F={fs.fvalue:.0f}")
plt.ylabel("estimate of beta")
` },
      { type: "quiz", id: "iv-q", prompt: "A valid instrument must be correlated with the endogenous regressor and…",
        choices: ["correlated with the outcome's error", "uncorrelated with the error (excludable)", "a lagged version of y", "binary"], answer: 1,
        hint: "Think about the exclusion restriction.",
        explain: "Relevance + exclusion: the instrument affects y only through x, i.e. it is uncorrelated with the structural error." },
    ],
  },

  {
    id: "did",
    num: "03",
    title: "Difference-in-Differences",
    level: "Intermediate",
    blurb: "Estimate a treatment effect from before/after × treated/control, then slide the true effect and sample size.",
    tags: ["causal", "panel"],
    steps: [
      { type: "read", html: `
        <h2>Difference-in-Differences</h2>
        <p>DiD compares the change over time in a treated group to the change in a
        control group. The effect (ATT) is the <em>treated × post</em> coefficient:</p>
        <p class="katexish">y = β₀ + β₁·treated + β₂·post + β₃·(treated·post) + ε</p>` },
      { type: "code", id: "did-fit", title: "did.py", code: `
import numpy as np, pandas as pd
import statsmodels.formula.api as smf
import matplotlib.pyplot as plt

rng = np.random.default_rng(11)
n = 500
df = pd.DataFrame({
    "treated": np.r_[np.ones(n), np.zeros(n), np.ones(n), np.zeros(n)].astype(int),
    "post":    np.r_[np.zeros(2 * n), np.ones(2 * n)].astype(int),
})
df["y"] = (5.0 + 1.5*df["treated"] + 1.0*df["post"]
           + 2.0*df["treated"]*df["post"] + rng.normal(0, 1, len(df)))
m = smf.ols("y ~ treated * post", data=df).fit()
print(m.summary().tables[1])
print(f"\\nTrue ATT = 2.0;  DiD estimate = {m.params['treated:post']:.3f}")
` },
      { type: "read", html: `<p>The gap between the two lines' slopes is the DiD estimate. Slide the true effect and watch it track.</p>` },
      { type: "interactive", id: "did-play", title: "Live: true effect & sample size",
        params: [
          { name: "att", label: "True ATT", min: -3, max: 5, step: 0.1, value: 2 },
          { name: "n", label: "Units per cell", min: 50, max: 1500, step: 50, value: 400 },
        ],
        code: (p) => `
import numpy as np, pandas as pd, statsmodels.formula.api as smf, matplotlib.pyplot as plt
rng = np.random.default_rng(0)
n, att = ${p.n}, ${p.att}
df = pd.DataFrame({
  "treated": np.r_[np.ones(n), np.zeros(n), np.ones(n), np.zeros(n)].astype(int),
  "post":    np.r_[np.zeros(2*n), np.ones(2*n)].astype(int)})
df["y"] = 5 + 1.0*df.treated + 0.5*df.post + att*df.treated*df.post + rng.normal(0,1,len(df))
m = smf.ols("y ~ treated*post", data=df).fit()
mn = df.groupby(["post","treated"]).y.mean().unstack()
plt.figure(figsize=(6.2,3.7))
plt.plot([0,1],[mn.loc[0,1],mn.loc[1,1]],"-o",color="#da9100",label="Treated")
plt.plot([0,1],[mn.loc[0,0],mn.loc[1,0]],"-o",color="#c9c6ac",label="Control")
plt.xticks([0,1],["Pre","Post"]); plt.legend()
plt.title(f"DiD estimate = {m.params['treated:post']:.2f}   (true {att})")
` },
      { type: "quiz", id: "did-q", prompt: "In y ~ treated*post, the difference-in-differences estimate is the coefficient on…",
        choices: ["treated", "post", "the treated:post interaction", "the intercept"], answer: 2,
        hint: "It is the differential change, not a level.",
        explain: "β₃ on treated:post is the extra change for the treated group beyond the common time trend — the ATT." },
    ],
  },

  {
    id: "var",
    num: "04",
    title: "Vector Autoregression (VAR)",
    level: "Advanced",
    blurb: "Fit a multivariate time-series model, then slide persistence and spillover to reshape the impulse-responses live.",
    tags: ["time series", "macro"],
    steps: [
      { type: "read", html: `
        <h2>Vector Autoregression</h2>
        <p>A VAR lets several series depend on their own and each other's past:</p>
        <p class="katexish">Yₜ = A·Yₜ₋₁ + εₜ</p>
        <p>We simulate a stable VAR(1), fit it, and compute <strong>impulse-response
        functions</strong> — how a one-off shock propagates over time.</p>` },
      { type: "code", id: "var-fit", title: "var_irf.py", code: `
import numpy as np, pandas as pd
from statsmodels.tsa.api import VAR
import matplotlib.pyplot as plt

rng = np.random.default_rng(5)
T = 400
A = np.array([[0.5, 0.1], [0.2, 0.4]])
e = rng.normal(0, 1, (T, 2)); Y = np.zeros((T, 2))
for t in range(1, T):
    Y[t] = A @ Y[t - 1] + e[t]
res = VAR(pd.DataFrame(Y, columns=["output", "inflation"])).fit(maxlags=1)
print(res.summary())
fig = res.irf(12).plot(orth=True); fig.set_size_inches(7, 5)
` },
      { type: "read", html: `<p>Persistence (diagonal) sets how slowly shocks decay; spillover (off-diagonal) couples the series. Try it.</p>` },
      { type: "interactive", id: "var-play", title: "Live: persistence & spillover",
        params: [
          { name: "persist", label: "Persistence (diagonal)", min: 0, max: 0.95, step: 0.05, value: 0.5 },
          { name: "cross", label: "Spillover (off-diagonal)", min: -0.4, max: 0.4, step: 0.05, value: 0.15 },
        ],
        code: (p) => `
import numpy as np, pandas as pd
from statsmodels.tsa.api import VAR
import matplotlib.pyplot as plt
rng = np.random.default_rng(0)
T, a, c = 300, ${p.persist}, ${p.cross}
A = np.array([[a, c], [c, a]])
e = rng.normal(0, 1, (T, 2)); Y = np.zeros((T, 2))
for t in range(1, T):
    Y[t] = A @ Y[t-1] + e[t]
res = VAR(pd.DataFrame(Y, columns=["y1", "y2"])).fit(maxlags=1)
fig = res.irf(12).plot(orth=True); fig.set_size_inches(6.4, 4.4)
` },
      { type: "quiz", id: "var-q", prompt: "An impulse-response function shows…",
        choices: ["contemporaneous correlations", "how a one-off shock propagates over time", "whether a series has a unit root", "seasonal dummies"], answer: 1,
        hint: "It is a dynamic response, traced forward in time.",
        explain: "An IRF traces the effect of a one-standard-deviation shock to one variable on every variable across future periods." },
    ],
  },
];

window.ROADMAP = [
  { title: "Panel: Fixed & Random Effects", blurb: "Within estimator, entity/time effects, Hausman test.", badge: "Soon" },
  { title: "Maximum Likelihood: Logit & Probit", blurb: "Binary outcomes, marginal effects, model fit.", badge: "Soon" },
  { title: "GMM & System Estimation", blurb: "Moment conditions, over-identification, efficient GMM.", badge: "Soon" },
];
