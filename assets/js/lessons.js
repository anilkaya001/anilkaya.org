/* =============================================================
   lessons.js — data-driven course content.
   Each lesson is rendered by lab-ui.js. Code steps execute for real
   via Pyodide + statsmodels. Add a model by appending an object here.
   ============================================================= */

window.LESSONS = [
  {
    id: "ols",
    num: "01",
    title: "OLS — the foundation",
    level: "Beginner",
    blurb: "Fit a regression line by ordinary least squares and read a real statsmodels summary.",
    tags: ["regression", "inference"],
    steps: [
      { type: "read", html: `
        <h2>Ordinary Least Squares</h2>
        <p>Almost every method in this lab is built on OLS. We model an outcome
        <em>y</em> as a linear function of a regressor <em>x</em>:</p>
        <p class="katexish">y = β₀ + β₁·x + ε</p>
        <p>OLS chooses β₀, β₁ to minimise the sum of squared residuals. Below we
        <strong>simulate data with a known truth</strong> (intercept 2, slope 3),
        estimate it, and check that statsmodels recovers those numbers.</p>` },
      { type: "code", id: "ols-fit", title: "ols_fit.py", code: `
import numpy as np, statsmodels.api as sm
import matplotlib.pyplot as plt

rng = np.random.default_rng(7)
n = 200
x = rng.normal(0, 1, n)
y = 2.0 + 3.0 * x + rng.normal(0, 1, n)   # truth: intercept 2, slope 3

X = sm.add_constant(x)
res = sm.OLS(y, X).fit()
print(res.summary())

plt.figure(figsize=(6, 4))
plt.scatter(x, y, s=14, color="#da9100", alpha=0.55)
xs = np.linspace(x.min(), x.max(), 50)
plt.plot(xs, res.params[0] + res.params[1] * xs, color="#c9c6ac", lw=2, label="OLS fit")
plt.xlabel("x"); plt.ylabel("y")
plt.title("OLS regression line"); plt.legend()
` },
      { type: "read", html: `
        <p>In the summary, <code>coef</code> for <code>x1</code> should land near
        <strong>3.0</strong> and <code>const</code> near <strong>2.0</strong>. The
        <code>std err</code>, <code>t</code>, <code>P&gt;|t|</code> and the 95%
        interval are exact statsmodels inference — the same output you'd get from
        a desktop install.</p>
        <div class="callout"><b>Your turn.</b> Change <code>true_slope</code> and
        <code>noise_sd</code> below and re-run. More noise widens the confidence
        interval — see it happen.</div>` },
      { type: "code", id: "ols-try", title: "your_turn.py", code: `
import numpy as np, statsmodels.api as sm
rng = np.random.default_rng(1)
n = 150
true_slope = 5.0       # try other values
noise_sd   = 2.0       # more noise -> wider standard errors
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
    blurb: "When a regressor is endogenous, OLS is biased. See how an instrument and two-stage least squares fix it.",
    tags: ["causal", "endogeneity"],
    steps: [
      { type: "read", html: `
        <h2>The endogeneity problem</h2>
        <p>OLS is only consistent if the regressor is uncorrelated with the error.
        When an unobserved factor <em>u</em> drives <strong>both</strong> <em>x</em>
        and <em>y</em>, that fails and the OLS slope is biased.</p>
        <p>An <strong>instrument</strong> <em>z</em> rescues us if it (1) shifts
        <em>x</em> (relevance) and (2) affects <em>y</em> only through <em>x</em>
        (exclusion). <strong>Two-Stage Least Squares</strong> uses the part of
        <em>x</em> explained by <em>z</em> to get a consistent estimate.</p>` },
      { type: "code", id: "iv-fit", title: "iv_2sls.py", code: `
import numpy as np, statsmodels.api as sm
from statsmodels.sandbox.regression.gmm import IV2SLS
import matplotlib.pyplot as plt

rng = np.random.default_rng(3)
n = 2000
z = rng.normal(0, 1, n)                        # instrument
u = rng.normal(0, 1, n)                         # unobserved confounder
x = 0.8 * z + 1.0 * u + rng.normal(0, 0.5, n)   # endogenous regressor
beta = 1.5
y = 1.0 + beta * x + 2.0 * u + rng.normal(0, 1, n)   # u also drives y

X, inst = sm.add_constant(x), sm.add_constant(z)
ols = sm.OLS(y, X).fit()
iv  = IV2SLS(y, X, inst).fit()
fs  = sm.OLS(x, inst).fit()                      # first stage: x on z

print(f"True beta              = {beta:.3f}")
print(f"OLS  beta (biased)     = {ols.params[1]:.3f}")
print(f"2SLS beta (consistent) = {iv.params[1]:.3f}")
print(f"First-stage F on z     = {fs.fvalue:.1f}   (>10 => strong instrument)")

plt.figure(figsize=(5, 3.6))
plt.bar(["True", "OLS", "2SLS"], [beta, ols.params[1], iv.params[1]],
        color=["#6f6b57", "#da9100", "#c9c6ac"])
plt.axhline(beta, color="#af983f", ls="--", lw=1)
plt.ylabel("estimate of β"); plt.title("Endogeneity bias vs. IV")
` },
      { type: "read", html: `
        <p>OLS is pulled well above the true <strong>1.5</strong>; 2SLS sits right
        on it. The first-stage <em>F</em> is far above 10, so <em>z</em> is a
        strong instrument.</p>
        <div class="callout"><b>Your turn.</b> Shrink <code>strength</code> toward
        0 to create a <b>weak instrument</b> and watch 2SLS become unstable while
        the first-stage F collapses.</div>` },
      { type: "code", id: "iv-try", title: "weak_instrument.py", code: `
import numpy as np, statsmodels.api as sm
from statsmodels.sandbox.regression.gmm import IV2SLS
rng = np.random.default_rng(8)
n = 2000
strength = 0.1     # shrink toward 0 for a WEAK instrument
z = rng.normal(0, 1, n); u = rng.normal(0, 1, n)
x = strength * z + u + rng.normal(0, 0.5, n)
y = 1.0 + 1.5 * x + 2.0 * u + rng.normal(0, 1, n)
iv = IV2SLS(y, sm.add_constant(x), sm.add_constant(z)).fit()
fs = sm.OLS(x, sm.add_constant(z)).fit()
print("2SLS beta:", round(float(iv.params[1]), 3), " | first-stage F:", round(float(fs.fvalue), 1))
` },
    ],
  },

  {
    id: "did",
    num: "03",
    title: "Difference-in-Differences",
    level: "Intermediate",
    blurb: "Estimate a treatment effect from before/after, treated/control data using an interaction term.",
    tags: ["causal", "panel"],
    steps: [
      { type: "read", html: `
        <h2>Difference-in-Differences</h2>
        <p>DiD compares the change over time in a <strong>treated</strong> group to
        the change in a <strong>control</strong> group. The treatment effect (ATT)
        is the coefficient on the <em>treated × post</em> interaction:</p>
        <p class="katexish">y = β₀ + β₁·treated + β₂·post + β₃·(treated·post) + ε</p>
        <p>We simulate a 2×2 design with a true effect of 2.0 and recover β₃.</p>` },
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
att = 2.0
df["y"] = (5.0 + 1.5 * df["treated"] + 1.0 * df["post"]
           + att * df["treated"] * df["post"] + rng.normal(0, 1, len(df)))

m = smf.ols("y ~ treated * post", data=df).fit()
print(m.summary().tables[1])
print(f"\\nTrue ATT = {att};  DiD estimate (treated:post) = {m.params['treated:post']:.3f}")

means = df.groupby(["post", "treated"])["y"].mean().unstack()
plt.figure(figsize=(5.5, 4))
plt.plot([0, 1], [means.loc[0, 1], means.loc[1, 1]], "-o", color="#da9100", label="Treated")
plt.plot([0, 1], [means.loc[0, 0], means.loc[1, 0]], "-o", color="#c9c6ac", label="Control")
plt.xticks([0, 1], ["Pre", "Post"]); plt.ylabel("mean y")
plt.title("Difference-in-Differences"); plt.legend()
` },
      { type: "read", html: `
        <p>The gap between the two lines' slopes <em>is</em> the DiD estimate. The
        identifying assumption is <strong>parallel trends</strong>: absent
        treatment, both groups would have moved in parallel.</p>
        <div class="callout"><b>Your turn.</b> Set <code>true_att</code> to any
        value and confirm the estimate tracks it.</div>` },
      { type: "code", id: "did-try", title: "your_turn.py", code: `
import numpy as np, pandas as pd, statsmodels.formula.api as smf
rng = np.random.default_rng(4)
n = 800
df = pd.DataFrame({
    "treated": np.r_[np.ones(n), np.zeros(n), np.ones(n), np.zeros(n)].astype(int),
    "post":    np.r_[np.zeros(2 * n), np.ones(2 * n)].astype(int)})
true_att = 3.5      # change me
df["y"] = (5 + 1.0 * df["treated"] + 0.5 * df["post"]
           + true_att * df["treated"] * df["post"] + rng.normal(0, 1, len(df)))
m = smf.ols("y ~ treated * post", data=df).fit()
print("DiD estimate:", round(float(m.params["treated:post"]), 3), " (true:", true_att, ")")
` },
    ],
  },

  {
    id: "var",
    num: "04",
    title: "Vector Autoregression (VAR)",
    level: "Advanced",
    blurb: "Model several time series jointly and trace impulse-response functions.",
    tags: ["time series", "macro"],
    steps: [
      { type: "read", html: `
        <h2>Vector Autoregression</h2>
        <p>A VAR lets several series depend on their own and each other's past.
        For two series it's:</p>
        <p class="katexish">Yₜ = A·Yₜ₋₁ + εₜ</p>
        <p>We simulate a stable VAR(1), fit it, then compute
        <strong>impulse-response functions</strong> — how a one-off shock to one
        variable propagates through the system over time.</p>` },
      { type: "code", id: "var-fit", title: "var_irf.py", code: `
import numpy as np, pandas as pd
from statsmodels.tsa.api import VAR
import matplotlib.pyplot as plt

rng = np.random.default_rng(5)
T = 400
A = np.array([[0.5, 0.1],
              [0.2, 0.4]])
e = rng.normal(0, 1, (T, 2))
Y = np.zeros((T, 2))
for t in range(1, T):
    Y[t] = A @ Y[t - 1] + e[t]
data = pd.DataFrame(Y, columns=["output", "inflation"])

res = VAR(data).fit(maxlags=1)
print(res.summary())

irf = res.irf(12)
fig = irf.plot(orth=True)
fig.set_size_inches(7, 5)
` },
      { type: "read", html: `
        <p>Each panel is one variable's response to a one-standard-deviation shock
        in another. Because our system is stable, every response decays back to
        zero.</p>
        <div class="callout"><b>Your turn.</b> Forecast the next 10 periods from a
        freshly-simulated VAR.</div>` },
      { type: "code", id: "var-try", title: "forecast.py", code: `
import numpy as np, pandas as pd
from statsmodels.tsa.api import VAR
rng = np.random.default_rng(9)
T = 300
A = np.array([[0.6, 0.0], [0.3, 0.3]])
e = rng.normal(0, 1, (T, 2)); Y = np.zeros((T, 2))
for t in range(1, T):
    Y[t] = A @ Y[t - 1] + e[t]
res = VAR(pd.DataFrame(Y, columns=["x1", "x2"])).fit(maxlags=1)
fc = res.forecast(Y[-1:], steps=10)
print("10-step forecast:\\n", np.round(fc, 3))
` },
    ],
  },
];

/* Models on the roadmap (locked cards on the Lab home). */
window.ROADMAP = [
  { title: "Panel: Fixed & Random Effects", blurb: "Within estimator, entity/time effects, Hausman test.", badge: "Soon" },
  { title: "Maximum Likelihood: Logit & Probit", blurb: "Binary outcomes, marginal effects, model fit.", badge: "Soon" },
  { title: "GMM & System Estimation", blurb: "Moment conditions, over-identification, efficient GMM.", badge: "Soon" },
];
