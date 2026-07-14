export const SITE_ORIGIN = "https://anilkaya.org";

const freezeTopic = (topic) => Object.freeze({
  ...topic,
  path: `/lab/${topic.slug}/`,
  modules: Object.freeze(topic.modules.map((module) => Object.freeze(module))),
});

// Search-facing course metadata. Module titles and summaries mirror the
// authored curriculum; contract tests prevent this crawlable outline from
// drifting away from the interactive course.
export const COURSE_TOPICS = Object.freeze([
  freezeTopic({
    id: "ols",
    slug: "ordinary-least-squares",
    number: "01",
    name: "Ordinary Least Squares",
    pageTitle: "Ordinary Least Squares — Econometrics Lab",
    description: "The line of best fit, how it's computed, inference, and the assumptions behind it.",
    image: "/assets/img/og-ols.png",
    level: "Beginner",
    modules: [
      { title: "1 · The line of best fit", summary: "What OLS does, and recovering a known slope from data." },
      { title: "2 · How OLS finds the line", summary: "The normal equations — OLS in one line of linear algebra." },
      { title: "3 · Inference", summary: "Standard errors, t-statistics, confidence intervals — and how they shrink with n." },
      { title: "4 · Assumptions & diagnostics", summary: "Gauss–Markov, heteroskedasticity, and robust standard errors." },
    ],
  }),
  freezeTopic({
    id: "iv2sls",
    slug: "instrumental-variables-2sls",
    number: "02",
    name: "Instrumental Variables & 2SLS",
    pageTitle: "Instrumental Variables & 2SLS — Econometrics Lab",
    description: "When OLS is biased by endogeneity, and how an instrument plus 2SLS rescues it.",
    image: "/assets/img/og-iv2sls.png",
    level: "Intermediate",
    modules: [
      { title: "1 · Why OLS fails", summary: "Endogeneity from omitted variables and simultaneity makes OLS biased and inconsistent." },
      { title: "2 · Instruments", summary: "A valid instrument is relevant (moves x) and excluded (affects y only through x)." },
      { title: "3 · Two-Stage Least Squares", summary: "Project x on the instruments, then regress y on the fitted x to recover a consistent β₁." },
      { title: "4 · Diagnostics", summary: "First-stage F flags weak instruments; over-identification tests probe exclusion." },
    ],
  }),
  freezeTopic({
    id: "did",
    slug: "difference-in-differences",
    number: "03",
    name: "Difference-in-Differences",
    pageTitle: "Difference-in-Differences — Econometrics Lab",
    description: "Treatment effects from before/after × treated/control, parallel trends, event studies.",
    image: "/assets/img/og-did.png",
    level: "Intermediate",
    modules: [
      { title: "1 · The DiD idea", summary: "Why comparing one group's before/after change against a control group's change isolates a causal effect." },
      { title: "2 · The 2×2 estimator", summary: "The DiD estimate is exactly the interaction coefficient in a regression of y on treated, post, and their product." },
      { title: "3 · Parallel trends", summary: "DiD is valid only if the groups would have moved in parallel absent treatment; a pre-trend difference biases the ATT." },
      { title: "4 · Event-study / dynamic DiD", summary: "Estimate a separate effect for each period relative to treatment to test pre-trends and trace the effect's dynamics." },
    ],
  }),
  freezeTopic({
    id: "var",
    slug: "vector-autoregression",
    number: "04",
    name: "Vector Autoregression (VAR)",
    pageTitle: "Vector Autoregression (VAR) — Econometrics Lab",
    description: "Joint dynamics of several series: estimation, impulse responses, Granger causality.",
    image: "/assets/img/og-var.png",
    level: "Advanced",
    modules: [
      { title: "1 · From AR(1) to VAR (joint dynamics)", summary: "How stacking several AR equations into one system lets each variable depend on the lagged values of all the others." },
      { title: "2 · Estimation & lag selection", summary: "How a VAR is fit equation-by-equation with OLS, and how information criteria pick the lag length p." },
      { title: "3 · Impulse-response functions & FEVD", summary: "Tracing how a one-time shock to one variable ripples through the system over time, and how to split forecast uncertainty across shocks." },
      { title: "4 · Granger causality & forecasting", summary: "Testing whether one variable's past helps predict another, and producing and reading multi-step VAR forecasts." },
    ],
  }),
  freezeTopic({
    id: "panel",
    slug: "panel-fixed-random-effects",
    number: "05",
    name: "Panel Data: Fixed & Random Effects",
    pageTitle: "Panel Data: Fixed & Random Effects — Econometrics Lab",
    description: "Unobserved heterogeneity, pooled-OLS bias, the within estimator, FE vs RE.",
    image: "/assets/img/og-panel.png",
    level: "Advanced",
    modules: [
      { title: "1 · Panel data & unobserved heterogeneity", summary: "What panel data is, why repeated observations on the same entities help, and how an unobserved entity effect αᵢ creates correlation that biases naive regression." },
      { title: "2 · Pooled OLS and its bias", summary: "Pooled OLS ignores the panel structure and treats αᵢ as part of the error. We show, in code and with a slider, that this biases β₁ whenever αᵢ correlates with x." },
      { title: "3 · Fixed effects: within transformation & entity dummies", summary: "Fixed effects estimate β₁ from within-entity variation only, sweeping out αᵢ. We do it two equivalent ways — entity dummies and hand-coded demeaning — and confirm both kill the bias." },
      { title: "4 · Random effects & choosing FE vs RE", summary: "Random effects treats αᵢ as random noise uncorrelated with x, gaining efficiency and time-invariant coefficients — but only if that assumption holds. The Hausman idea tells you which to trust." },
    ],
  }),
  freezeTopic({
    id: "logit",
    slug: "logit-probit",
    number: "06",
    name: "Logit & Probit (Binary Outcomes)",
    pageTitle: "Logit & Probit (Binary Outcomes) — Econometrics Lab",
    description: "Binary outcomes: the logistic model, odds ratios, marginal effects, classification.",
    image: "/assets/img/og-logit.png",
    level: "Intermediate",
    modules: [
      { title: "1 · Why a linear model fails for 0/1 outcomes", summary: "When y is 0 or 1, fitting a straight line (the Linear Probability Model) breaks down: it predicts probabilities outside [0,1], has built-in heteroskedasticity, and imposes a constant effect that cannot be globally true." },
      { title: "2 · The logit (and probit) model", summary: "Logit and probit pass a linear index β₀+β₁x through an S-shaped link (the logistic CDF or the standard-normal CDF) to keep probabilities in (0,1). Both are fit by maximum likelihood; their coefficients differ only by a roughly constant scale factor." },
      { title: "3 · Interpreting coefficients: odds ratios & marginal effects", summary: "A raw logit coefficient is a change in log-odds — not very intuitive. Exponentiate it to get an odds ratio (a multiplicative effect on the odds), or compute a marginal effect dP/dx (the change in probability), which is largest near p=0.5 and shrinks at the extremes." },
      { title: "4 · Model fit & classification", summary: "Judge a binary model by likelihood-based fit (pseudo-R², LR test) and by classification: turn predicted probabilities into 0/1 at a threshold, build a confusion matrix, read accuracy, and trace the threshold-free ROC curve and its AUC — all with numpy, no sklearn." },
    ],
  }),
  freezeTopic({
    id: "gmm",
    slug: "generalized-method-of-moments",
    number: "07",
    name: "Generalized Method of Moments (GMM)",
    pageTitle: "Generalized Method of Moments (GMM) — Econometrics Lab",
    description: "Moment conditions as a unifying estimator, IV-GMM, over-identification, efficiency.",
    image: "/assets/img/og-gmm.png",
    level: "Advanced",
    modules: [
      { title: "1 · Moment conditions", summary: "GMM turns 'what we know about the population' into equations the data must satisfy, then minimizes how far the sample violates them." },
      { title: "2 · IV as GMM", summary: "Instrumental variables is GMM with the moment 'instruments are uncorrelated with the error.' We derive the IV/2SLS estimator from that single idea." },
      { title: "3 · Over-identification & the J-test", summary: "Extra instruments give extra moment conditions. They can't all be satisfied at once — and that leftover disagreement becomes a test of whether your instruments are valid." },
      { title: "4 · Efficient (two-step) GMM", summary: "Among all weighting matrices, the inverse of the moment covariance gives the smallest variance. Two-step GMM estimates it from a first pass and re-optimizes." },
    ],
  }),
]);

export const COURSE_BY_ID = Object.freeze(Object.fromEntries(COURSE_TOPICS.map((topic) => [topic.id, topic])));
export const COURSE_BY_SLUG = Object.freeze(Object.fromEntries(COURSE_TOPICS.map((topic) => [topic.slug, topic])));
