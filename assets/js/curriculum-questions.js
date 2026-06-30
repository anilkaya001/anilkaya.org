/* =============================================================
   curriculum-questions.js — AUTHORED, VERIFIED assessment items.
   Appended non-destructively to each topic's modules after
   curriculum.js + curriculum-data.js load. Generated; edit the
   authoring workflow, not this file by hand.
   ============================================================= */
(function () {
  "use strict";
  var C = window.CURRICULUM; if (!C) return;
  var ITEMS = {
  "ols": [
    {
      "moduleIndex": 0,
      "type": "truefalse",
      "title": "Does a great fit prove the cause?",
      "prompt": "You just fit the line and read off the summary. Claim: <b>a regression with R² = 0.92 has clearly captured the causal effect</b> of the regressor on <em>y</em>.",
      "answer": false,
      "hint": "R² measures in-sample fit. Does fit say anything about whether x is correlated with the error?",
      "explain": "This is the <b>high-R²-is-causal trap</b>. R² is only the fraction of <em>in-sample</em> variance the line reproduces — it says nothing about bias, omitted variables, or causation. A confounded regression (ability omitted from wage~schooling) can sit at R²≈0.9, while a perfectly unbiased causal estimate can have R²≈0.1. Boundary: R² and t-stats describe <em>fit and noise</em>; a causal claim needs E[ε|x]=0, which no in-sample statistic can certify. Whenever a defence of <em>causality</em> cites R² or a t-stat, suspect this error.",
      "points": 10
    },
    {
      "moduleIndex": 1,
      "type": "quiz",
      "title": "Is β̂ unbiased for the causal return?",
      "prompt": "You just computed β̂ = (XᵀX)⁻¹Xᵀy. For wage on schooling it returns β̂ = 0.08 with R² = 0.31 and t = 9.2. This β̂ is unbiased for the <em>causal</em> return to schooling…",
      "choices": [
        "…yes, because t = 9.2 is highly significant",
        "…yes, because R² = 0.31 shows the model fits well",
        "…only if schooling is uncorrelated with the error (e.g. unobserved ability)",
        "…only if the errors are homoskedastic"
      ],
      "answer": 2,
      "why": [
        "A big t-stat is about sampling noise, not bias — the formula (XᵀX)⁻¹Xᵀy is exact regardless of significance.",
        "Fit ≠ identification — this is the omitted-variable trap; R² can be high while β̂ is badly confounded.",
        "",
        "Homoskedasticity affects only the standard errors, not whether β̂ is unbiased."
      ],
      "hint": "The normal equations always return a number. Unbiasedness is a separate condition: E[ε|x]=0.",
      "explain": "This is the <b>fit-vs-identification trap</b>. The formula β̂ = (XᵀX)⁻¹Xᵀy mechanically produces an estimate no matter what — unbiasedness for the causal effect needs E[ε|x]=0. Unobserved ability lives in ε and correlates with schooling, so β̂ is biased upward regardless of t or R². Boundary: t and R² certify nothing about exogeneity — that gap is exactly why instrumental variables exist.",
      "points": 15
    },
    {
      "moduleIndex": 2,
      "type": "numeric",
      "title": "What does 'explained' mean?",
      "prompt": "The inference summary reports R² = 0.36. What percent of the <em>in-sample</em> variance in y does the model account for? Enter a number, no % sign.",
      "answer": 36,
      "tol": 0.5,
      "unit": "%",
      "hint": "R² is already a fraction of variance — just convert 0.36 to a percent.",
      "explain": "36%. This defuses the word <b>'explained'</b>: R² literally equals the fraction of <em>sample</em> variance reproduced in this sample — 'explained' here is statistical bookkeeping, not a causal claim. The tempting move is to hear 'explains 36% of y' as 'causes 36% of y'; that fails because R² is silent about bias. Boundary: 36% explained is fully compatible with a biased slope, and 99% is compatible with a hopelessly confounded one.",
      "points": 20
    },
    {
      "moduleIndex": 2,
      "type": "numeric",
      "title": "How much data to halve the SE?",
      "prompt": "You saw SE shrink like 1⁄√n. Starting from a sample of n = 250, by what factor must you multiply n to <b>halve</b> the slope's standard error? Enter the factor (a plain number).",
      "answer": 4,
      "tol": 0.1,
      "hint": "SE ∝ 1⁄√n, so halving SE means doubling √n. What does that do to n itself?",
      "explain": "This catches the <b>linear-precision trap</b> — assuming twice the data halves the SE. Because SE ∝ 1⁄√n, halving the SE requires doubling √n, which means multiplying n by 2² = 4. So n goes 250 → 1000. Boundary: the √n law makes precision expensive — each further halving of the SE costs another 4× in data, which is why huge samples buy ever less extra certainty.",
      "points": 20
    },
    {
      "moduleIndex": 3,
      "type": "truefalse",
      "title": "Does heteroskedasticity bias the coefficients?",
      "prompt": "You just saw the residuals fan out with x. Claim: <b>heteroskedasticity biases the OLS coefficients</b>, so you must drop the affected observations.",
      "answer": false,
      "hint": "Heteroskedasticity changes the error's variance, not its mean. Which OLS property depends on the mean of the error?",
      "explain": "This is the <b>heteroskedasticity-biases-coefficients trap</b>. Heteroskedasticity is about the <em>variance</em> of the error, not its mean — so unbiasedness (which needs E[ε|x]=0) is untouched; β̂ stays unbiased and only the default standard errors are wrong. The tempting fix — deleting data — throws away valid information and introduces selection bias. Boundary: the right fix is robust (HC1) standard errors, which correct the inference while leaving the unbiased coefficients in place.",
      "points": 10
    },
    {
      "moduleIndex": 3,
      "type": "multi",
      "title": "What does heteroskedasticity actually break?",
      "prompt": "Residuals fan out with x. <b>Select all that apply:</b> which statements about OLS under heteroskedasticity are TRUE?",
      "choices": [
        "The coefficient estimates β̂ remain unbiased",
        "The default (classical) standard errors are wrong",
        "Robust (HC1) standard errors fix the inference",
        "The coefficient estimates β̂ become biased",
        "You should delete the high-variance observations to fix it"
      ],
      "answers": [
        0,
        1,
        2
      ],
      "hint": "Separate what changes (the variance of the error, hence the SEs) from what doesn't (the mean of the error, hence unbiasedness).",
      "explain": "This re-plants the <b>heteroskedasticity-biases-coefficients trap</b> as a set. TRUE: β̂ stays unbiased (it needs E[ε|x]=0, untouched by non-constant variance), the classical SEs are wrong, and robust HC1 SEs repair the inference. FALSE distractors: 'β̂ becomes biased' is the central misconception — variance is not bias; and 'delete the high-variance observations' discards valid data and induces selection bias. Boundary: heteroskedasticity costs you efficiency and correct SEs, never unbiasedness.",
      "points": 20
    }
  ],
  "iv2sls": [
    {
      "moduleIndex": 1,
      "type": "truefalse",
      "title": "Significant first stage ⇒ good instrument?",
      "prompt": "You just saw that <b>relevance</b> is the one IV condition you can check in the data via the first stage. Claim: <em>once the first-stage coefficient on z is statistically significant (t &gt; 1.96), the instrument is strong enough to trust 2SLS.</em>",
      "answer": false,
      "hint": "Significance answers a different question (is the coefficient distinguishable from zero?) than strength (does z move x enough to divide by safely?).",
      "explain": "This is the <b>significance≠strength trap</b>, the classic weak-instrument error. A first-stage t can clear 1.96 while the instrument is still weak: in 2SLS, strength is graded by the first-stage <b>F</b> on the excluded instruments (rule of thumb F ≳ 10), not by whether the coefficient beats zero. A barely-significant, low-F instrument biases 2SLS back <em>toward OLS</em> and wrecks the standard errors. Boundary: significance is necessary-ish but never sufficient — only a large first-stage F certifies strength.",
      "points": 10
    },
    {
      "moduleIndex": 1,
      "type": "multi",
      "title": "What makes an instrument valid?",
      "prompt": "Z is a candidate instrument for an endogenous x. <b>Select all that apply</b>: which conditions MUST hold for Z to be a valid instrument?",
      "choices": [
        "Relevance: Z is correlated with x (Cov(z,x) ≠ 0)",
        "Exclusion: Z affects y only through x",
        "Exogeneity: Z is uncorrelated with the structural error ε",
        "Z has a statistically significant first-stage coefficient",
        "Z is normally distributed"
      ],
      "answers": [
        0,
        1,
        2
      ],
      "hint": "Two of these are the actual requirements you saw split into 'checkable' vs 'must be argued'; the others are properties students wrongly bolt on.",
      "explain": "This bundles the <b>validity conditions</b>: relevance + exclusion + exogeneity. The strong distractor is 'significant first-stage coefficient' — that is the significance≠strength trap; significance is neither necessary nor sufficient, and a significant first stage can still be a weak (low-F) instrument. Normality of Z is never required — IV/2SLS makes no distributional assumption on the instrument. Boundary: relevance is the only one you can <em>test</em> from data; exclusion and exogeneity are arguments you must defend, not p-values you can read off.",
      "points": 20
    },
    {
      "moduleIndex": 2,
      "type": "fillblank",
      "title": "The clean slice of x",
      "lead": "2SLS runs in two moves: regress x on the instruments, keep the predictions, then run the structural equation on those.",
      "prompt": "In 2SLS the second stage regresses y not on the raw endogenous x, but on the ___ values x̂ that the first stage predicts from the instruments.",
      "accept": [
        "fitted",
        "fitted values",
        "predicted",
        "predicted values",
        "projected",
        "first-stage fitted",
        "first stage fitted"
      ],
      "hint": "It's the part of x that z explains — the clean, exogenous slice, written x̂.",
      "explain": "The blank is <b>fitted</b> (predicted) values, x̂. The misconception this defuses is 'plug the instrument z straight into the second stage' — you regress y on x̂, not on z and not on the first-stage residuals. x̂ keeps only the variation in x that z explains, stripping out the confounded part. Boundary: with one instrument and one endogenous regressor this two-stage fit numerically equals the simple IV ratio Cov(z,y)/Cov(z,x); with extra instruments it does not, which is the over-identified case.",
      "points": 15
    },
    {
      "moduleIndex": 2,
      "type": "truefalse",
      "title": "Hand-rolled second-stage SEs",
      "prompt": "Claim: running the second stage by hand with <code>sm.OLS(y, x̂)</code> gives both the right 2SLS coefficient <b>and</b> the right standard errors.",
      "answer": false,
      "hint": "The point estimate matches; think about what x̂ being estimated (not observed) does to the uncertainty.",
      "explain": "This is the <b>manual-2SLS-is-fine trap</b>. The hand-rolled coefficient is correct, but the standard errors are <em>wrong</em>: <code>sm.OLS(y, x̂)</code> treats x̂ as if it were observed data, ignoring that x̂ was itself estimated in the first stage, so it understates the true sampling variability. Use a dedicated <code>IV2SLS</code> estimator, which corrects the SEs. Boundary: the bias is only in the inference (SEs, t-stats, CIs) — the β̂ from the manual route is identical, so the fix is the SE formula, not the point estimate.",
      "points": 10
    },
    {
      "moduleIndex": 3,
      "type": "numeric",
      "title": "First-stage F vs the rule of thumb",
      "prompt": "The first stage regresses x on the excluded instrument; the F-statistic on that instrument is <b>6.4</b>. Using the Staiger–Stock rule of thumb (F ≈ 10), how far above or below the threshold are you? Enter a <b>signed</b> number (e.g. −3.6).",
      "answer": -3.6,
      "tol": 0.1,
      "hint": "Subtract the threshold from your F: 6.4 − 10.",
      "explain": "6.4 − 10 = <b>−3.6</b>, i.e. 3.6 <em>below</em> the rule-of-thumb 10 — a weak instrument. This is the <b>significance≠strength trap</b> again in numbers: that same first stage could have a significant t-stat, yet an F of 6.4 means 2SLS is biased toward OLS with distorted standard errors. 'Significant' and 'strong' are different claims; only the F speaks to strength. Boundary: F ≳ 10 is a rough threshold, not a bright line — values just above it are reassuring, low single digits are a clear red flag regardless of how clean the exclusion story is.",
      "points": 20
    },
    {
      "moduleIndex": 3,
      "type": "quiz",
      "title": "What a passed over-ID test proves",
      "prompt": "Your over-identified model has 3 instruments for 1 endogenous regressor. The Sargan/Hansen <b>J</b> test returns a <em>large</em> p-value (you fail to reject). What can you correctly conclude?",
      "choices": [
        "The exclusion restriction is now proven — all 3 instruments are valid",
        "The result is consistent with valid instruments, but exclusion remains an untested assumption",
        "At least one instrument violates exclusion",
        "The instruments are strong (high first-stage F)"
      ],
      "answer": 1,
      "why": [
        "The over-ID test can only reject; a non-rejection never proves validity.",
        "",
        "That is what a SMALL p-value (rejection) would suggest, not a large one.",
        "The J test checks exclusion/over-ID agreement, not strength — strength is the first-stage F."
      ],
      "hint": "The J test can only ever reject validity; ask what failing to reject does and doesn't establish.",
      "explain": "This is the <b>passed-test-proves-exogeneity trap</b>. The over-ID (Sargan/Hansen J) test can only <em>reject</em> validity: a large p-value is consistent with valid instruments but proves nothing — the test has low power and must assume at least one instrument is valid to anchor on. Exclusion/exogeneity stays an argument you defend, not a result you read off. The strength distractor confuses two diagnostics: weakness is the first-stage F, validity is the J test. Boundary: the J test is also <em>silent</em> when the model is just-identified (one instrument, one regressor) — there are no spare instruments to disagree, so there is nothing to test.",
      "points": 15
    }
  ],
  "did": [
    {
      "moduleIndex": 0,
      "type": "fillblank",
      "title": "The control group is a what?",
      "prompt": "In DiD, the control group's before-to-after change is used as an estimate of the treated group's ___ change — what would have happened to the treated units absent treatment.",
      "lead": "You just saw that subtracting the control group's change strips out common trends and shocks, leaving the causal effect.",
      "accept": [
        "counterfactual",
        "counter-factual",
        "counter factual"
      ],
      "hint": "It is the change the treated group *would* have had with no policy — a word starting with 'counter'.",
      "explain": "The 'control is just another treated group' slip. The control group is a <em>counterfactual</em> machine: its change estimates the trend/shocks the treated group would also have felt, so subtracting it nets those out and leaves the treatment effect. The tempting reading — that the control is simply a second observation of the effect — fails because the control is never treated; its only job is to reveal the common trend. This holds <b>only if</b> that common trend really is shared (parallel trends); if the groups' trends diverge, the control is the wrong counterfactual.",
      "points": 15
    },
    {
      "moduleIndex": 1,
      "type": "truefalse",
      "title": "Equal pre-treatment levels?",
      "prompt": "DiD requires the treated and control groups to have <b>equal outcome levels</b> before treatment.",
      "answer": false,
      "hint": "Which coefficient in y ~ treated*post absorbs a fixed before-period gap between the groups?",
      "explain": "The levels-vs-trends confusion. DiD <em>allows</em> any baseline level gap — that gap is exactly what β₁ (the 'treated' coefficient) absorbs, which is why the module called it a fixed level difference, not an effect. The tempting belief — that the groups must start equal — confuses a constant level gap (harmless, differenced away) with a difference in <b>trends</b> (fatal). Boundary: different starting <em>levels</em> are fine; differently-sloped <em>trends</em> break identification. Pivot word: levels (ok) vs trends (not ok).",
      "points": 10
    },
    {
      "moduleIndex": 2,
      "type": "truefalse",
      "title": "Big post gap, diverging pre-trends",
      "prompt": "If the treated and control groups had <b>different pre-treatment trends</b>, the DiD estimate is still unbiased as long as the post-period gap is large.",
      "answer": false,
      "hint": "What does the module say the estimate equals when there is a differential trend δ per period?",
      "explain": "The parallel-trends-is-everything trap. Identification rests entirely on parallel counterfactual trends; diverging pre-trends are direct evidence that assumption fails, and the module showed the estimate becomes ATT̂ ≈ true ATT + (differential trend over the window). A large post gap is no defense — the seductive belief that a big effect 'swamps' the bias fails because the trend difference is baked <em>into</em> that gap and DiD cannot separate the two. Boundary: only when pre-trends are parallel does the control's change equal the treated counterfactual and β₃ recover the true ATT.",
      "points": 10
    },
    {
      "moduleIndex": 2,
      "type": "numeric",
      "title": "DiD from a 2×2 table",
      "prompt": "A 2×2 DiD: the treated group's mean goes 40 → 62, the control group's mean goes 38 → 45. Enter the DiD estimate (treated change minus control change), in points.",
      "answer": 15,
      "tol": 0.5,
      "unit": " pts",
      "hint": "First find each group's change, then subtract: (62−40) − (45−38).",
      "explain": "The 'forget the counterfactual trend' trap. (62−40) − (45−38) = 22 − 7 = <b>15</b>. The control's change of 7 is the common shock the treated group would also have felt, so subtracting it nets out the trend. The seductive wrong answer is 22 — the raw treated change — which credits the policy with the entire before/after move and ignores that part of it was just the shared trend. Boundary: 22 would be the right answer only if the control's change were 0, i.e. nothing happened to anyone absent treatment.",
      "points": 20
    },
    {
      "moduleIndex": 3,
      "type": "quiz",
      "title": "Reading a significant lead",
      "prompt": "Your event-study plot shows a pre-treatment (lead) coefficient that is large and statistically significant, well away from zero. What does this tell you?",
      "choices": [
        "It is reassuring — a significant pre-period coefficient confirms the design is working",
        "It is a warning — a nonzero lead signals a pre-trend that undercuts parallel trends",
        "It measures how quickly the treatment effect fades after treatment",
        "It sets the reference period, so it should be large by construction"
      ],
      "answer": 1,
      "why": [
        "Backwards: leads should hug zero. A significant lead is evidence AGAINST parallel trends, not for the design.",
        "",
        "Leads are before treatment, where the effect is zero by definition — they cannot measure post-treatment dynamics.",
        "The reference period is the one normalized to 0 with no error bar; it is not the lead you are reading."
      ],
      "hint": "Where the effect must be zero, a coefficient far from zero is bad news, not good.",
      "explain": "The 'significant pre-trend is reassuring' trap. Leads sit <em>before</em> treatment, where the true effect is zero, so they should hug zero; a large significant lead is evidence the groups were already diverging — a pre-trend that invalidates the design. The tempting belief flips the logic of a falsification test: you <em>want</em> to fail to reject here, not to find significance. Boundary: flat (near-zero) leads are <b>necessary but not sufficient</b> — failing to reject a pre-trend makes parallelism plausible, it never proves the untestable post-period counterfactual.",
      "points": 15
    },
    {
      "moduleIndex": 3,
      "type": "multi",
      "title": "What the event-study plot tells you",
      "prompt": "Select all that apply. Which statements about an event-study (dynamic DiD) plot are TRUE?",
      "choices": [
        "Pre-treatment (lead) coefficients should be near zero if parallel trends holds",
        "The reference period's coefficient is exactly 0 by construction, with no confidence interval",
        "Post-treatment (lag) coefficients trace how the effect turns on and evolves over time",
        "Flat pre-period leads prove the parallel-trends assumption holds in the post period",
        "A statistically significant lead coefficient is reassuring evidence for the design"
      ],
      "answers": [
        0,
        1,
        2
      ],
      "hint": "Two of the five are classic traps: one over-claims what flat leads prove, one misreads what a significant lead means.",
      "explain": "The 'flat leads = proven parallelism' over-claim. True: leads near zero are the visual test of parallel trends; the reference period is mechanically 0 with no error bar; lags trace the dynamic effect. False trap 1 — flat pre-period leads are <b>necessary but not sufficient</b>: parallel trends in the post period is untestable, since the treated counterfactual is never observed, so leads make it plausible, not proven. False trap 2 — a <em>significant</em> lead is the opposite of reassuring; it signals a pre-trend. Boundary: the event-study only ever offers indirect, pre-period evidence — it can falsify the design but never certify the post-period counterfactual.",
      "points": 20
    }
  ],
  "var": [
    {
      "moduleIndex": 3,
      "type": "truefalse",
      "title": "Does Granger causality mean causation?",
      "prompt": "You just ran the block F-test and found that <b>X Granger-causes Y</b> (p = 0.001). Claim: this proves that <em>X causes Y</em> — intervening on X would move Y.",
      "answer": false,
      "hint": "Read the name literally as a forecasting statement, not a philosophical one.",
      "explain": "<b>The Granger-is-causation trap.</b> Granger causality only says past X improves the <em>forecast</em> of Y beyond Y's own past — it is predictive precedence, not structural cause. A common driver or anticipation (X is a leading indicator) yields Granger causality with no causal link from X to Y. <em>Boundary:</em> a structural causal claim needs an identifying assumption you impose (e.g. a Cholesky ordering); no in-sample F-test can supply it.",
      "points": 10
    },
    {
      "moduleIndex": 2,
      "type": "quiz",
      "title": "Significant VAR coefficient: what does it prove?",
      "prompt": "In your fitted reduced-form VAR, the lagged-X coefficient in the Y equation is large and highly significant, and the orthogonalized IRF of Y to an X shock is clearly non-zero. The <em>safest</em> reading is:",
      "choices": [
        "X structurally causes Y — the significant coefficient settles it",
        "Past X carries predictive information about Y; calling it a structural effect needs an imposed identification (the ordering)",
        "Reordering the Cholesky variables would leave the impact responses unchanged",
        "The IRF is structural automatically because it came from orth_irfs"
      ],
      "answer": 1,
      "why": [
        "Significance is reduced-form predictive content, not proof of a structural mechanism.",
        "",
        "Reordering changes which variable can hit the other contemporaneously, so impact responses do change.",
        "orth_irfs imposes an ordering you chose; that choice IS the identifying assumption, it is not automatic."
      ],
      "hint": "A reduced-form VAR is silent about structure until you impose an assumption.",
      "explain": "<b>The reduced-form-significance-is-structural trap.</b> A significant lag coefficient (or a non-zero orthogonalized IRF) is predictive precedence — exactly Granger content — not a verified structural effect. The orthogonalized IRF only looks structural because you supplied a Cholesky <em>ordering</em>; reorder the variables and the impact responses move. <em>Boundary:</em> the structural reading is valid only when the ordering's contemporaneous-causal assumption is itself defensible, which the data cannot confirm.",
      "points": 15
    },
    {
      "moduleIndex": 2,
      "type": "truefalse",
      "title": "Are IRFs structural for free?",
      "prompt": "Claim: you can read <b>structural</b> impulse responses straight off a reduced-form VAR with <em>no identifying assumption</em> — orth_irfs just returns them.",
      "answer": false,
      "hint": "What did you have to choose before the Cholesky factor was even defined?",
      "explain": "<b>The IRFs-are-structural-for-free trap.</b> Orthogonalized IRFs require a Cholesky factor of Σ, and that factor depends on a variable <em>ordering you impose</em>: the earlier variable may hit the later one contemporaneously but not vice versa. Reorder the columns and the impact responses change — so the structure came from your assumption, not the data. <em>Boundary:</em> the reduced-form VAR alone pins down forecasts and correlations; turning those into structural shocks always needs an extra identifying restriction (ordering, sign restrictions, or external instruments).",
      "points": 10
    },
    {
      "moduleIndex": 3,
      "type": "multi",
      "title": "What's true about a reduced-form VAR?",
      "prompt": "Select all that apply. Which statements about a <b>reduced-form VAR</b> are TRUE?",
      "choices": [
        "Granger causality means predictive precedence, not structural causation",
        "Cholesky-orthogonalized impulse responses depend on the variable ordering you impose",
        "Estimating in non-stationary levels can read spurious dynamics as real",
        "A statistically significant lag coefficient proves X structurally causes Y",
        "Adding more lags is always the safer choice"
      ],
      "answers": [
        0,
        1,
        2
      ],
      "hint": "Two of these are the headline VAR traps — a significant coefficient is predictive, and more lags is not free.",
      "explain": "<b>Two traps are bundled here.</b> TRUE: Granger = predictive precedence; orthogonalized IRFs hinge on the ordering you impose; a level VAR on unit-root series can manufacture spurious dynamics (difference or use a VECM if cointegrated). FALSE: a significant coefficient is reduced-form prediction, never structural proof — the <em>structural-from-significance</em> trap; and 'more lags is always safer' burns degrees of freedom (a k-variable VAR(p) has k·(k·p+1) parameters) and overfits. <em>Boundary:</em> more lags only helps when residual autocorrelation says you genuinely under-fit; otherwise an information criterion like BIC trims it back.",
      "points": 20
    },
    {
      "moduleIndex": 1,
      "type": "fillblank",
      "title": "Which criterion picks the fewest lags?",
      "prompt": "Among AIC, BIC, and HQIC, the criterion with the harshest penalty (∝ log n · #params) — so it selects the fewest lags and is consistent for the true order — is ___.",
      "lead": "select_order printed AIC, BIC, and HQIC side by side; you must name the one that penalizes extra parameters hardest.",
      "accept": [
        "bic",
        "sc",
        "schwarz",
        "schwarz criterion",
        "schwarz information criterion",
        "bayesian information criterion"
      ],
      "hint": "Its penalty grows with log n, so it punishes extra parameters harder than AIC as the sample grows.",
      "explain": "<b>The all-criteria-agree assumption.</b> BIC (a.k.a. SC / Schwarz) carries the heaviest penalty (∝ log n per parameter), so it selects fewer lags and is consistent for the true lag order. AIC and FPE use a lighter, fixed penalty and tend to pick more lags — better for pure forecasting, not for recovering the true order. <em>Boundary:</em> when the goal is forecasting rather than identifying the true p, the richer AIC model can legitimately win, so the criteria need not, and often do not, agree.",
      "points": 15
    },
    {
      "moduleIndex": 0,
      "type": "numeric",
      "title": "Does the spillover die out?",
      "prompt": "A shock δ = 1 hits y1 at time 0 in a stable VAR(1) with coefficient matrix A. The horizon-2 response of the system is A²·δ. If A = [[0.5, 0.4],[0.0, 0.5]], enter the horizon-2 response of <b>y1</b> (first component of A²·δ, where δ = (1, 0)′), to two decimals.",
      "answer": 0.25,
      "tol": 0.02,
      "hint": "δ = (1,0)′, so you only need the (1,1) entry of A². For this upper-triangular A that is just 0.5².",
      "explain": "<b>The 'spillover never fades' trap.</b> The horizon-h response is Aʰ·δ; here A²·δ has first component (0.5² + 0.4·0) = 0.25, down from 0.5 at horizon 1 and heading to 0. Because A is stable (both eigenvalues 0.5, modulus < 1), shocks are <em>transitory</em> and decay geometrically. <em>Boundary:</em> if any eigenvalue of A had modulus ≥ 1 the series would be non-stationary and the response would not die out — stability, not the size of the raw entries, is what guarantees decay.",
      "points": 20
    }
  ],
  "panel": [
    {
      "moduleIndex": 0,
      "type": "fillblank",
      "title": "Name the hidden entity effect",
      "prompt": "The time-invariant, entity-specific term αᵢ that you cannot observe — a firm's culture, a person's innate ability — is called the unobserved ___ effect, and it is what biases naive regression when it moves with x.",
      "lead": "You just saw each entity sit at its own height αᵢ, a fixed trait carried in every one of its observations.",
      "accept": [
        "heterogeneity",
        "unobserved heterogeneity",
        "individual heterogeneity",
        "entity heterogeneity"
      ],
      "hint": "It is the word for entities differing in fixed, unmeasured ways — not 'error', not 'noise'.",
      "explain": "The αᵢ-is-just-noise trap. αᵢ is unobserved <b>heterogeneity</b>: a fixed entity trait, not random scatter. The tempting belief that it is ordinary error fails because error averages to zero and is uncorrelated with x, whereas αᵢ is a persistent level that can correlate with x — that correlation, not its mere presence, is what biases a naive regression. Boundary: if Cov(x, αᵢ)=0 the heterogeneity is harmless to consistency (RE territory); only correlated heterogeneity demands the within transform.",
      "points": 15
    },
    {
      "moduleIndex": 1,
      "type": "fillblank",
      "title": "Pooled OLS: inefficient, or worse?",
      "prompt": "When the entity effect αᵢ is correlated with the regressor, pooled OLS is not merely inefficient — its slope estimate β̂₁ is ___ and inconsistent.",
      "lead": "You watched the pooled line tilt too steeply because high-x entities also sit at high αᵢ.",
      "accept": [
        "biased"
      ],
      "hint": "Inconsistency is the large-sample word; what is the finite-sample word for an estimate that is centered off-target?",
      "explain": "The 'pooled OLS is just inefficient' trap. Correlated αᵢ is textbook omitted-variable bias, so β̂₁ is <b>biased</b> AND inconsistent — wrong in finite samples and still wrong as n→∞. The tempting belief that pooling only costs precision fails because the omitted αᵢ sits in the error and shares variation with x, tilting the slope. Boundary: if αᵢ were uncorrelated with x, pooled OLS would be merely inefficient (not biased) — efficiency loss only, which is exactly the RE case.",
      "points": 15
    },
    {
      "moduleIndex": 2,
      "type": "fillblank",
      "title": "Name the transformation",
      "prompt": "The estimator that removes time-invariant unit confounders by subtracting each entity's own time-mean from every observation is the ___ (fixed-effects) estimator.",
      "lead": "You just derived (yᵢₜ − ȳᵢ) = β₁·(xᵢₜ − x̄ᵢ) + (εᵢₜ − ε̄ᵢ): demeaning made αᵢ − αᵢ = 0 vanish.",
      "accept": [
        "within",
        "within estimator",
        "within transformation",
        "within-transformation",
        "fixed effects",
        "fixed-effects",
        "fe",
        "demeaning"
      ],
      "hint": "It uses only the variation of x around each entity's own mean — its mirror image, the 'between' estimator, uses cross-entity means.",
      "explain": "The within-vs-between mix-up. The <b>within</b> estimator demeans each entity, sweeping out everything constant per entity — including αᵢ — and so identifies β₁ from within-entity variation alone. The tempting confusion with the BETWEEN estimator fails because between uses only cross-entity means, the very channel αᵢ contaminates, so it cannot purge the heterogeneity. Boundary: within buys consistency but discards all between-entity (time-invariant) information, so any regressor constant within an entity is wiped out and unidentified.",
      "points": 15
    },
    {
      "moduleIndex": 2,
      "type": "truefalse",
      "title": "Can FE price a fixed trait?",
      "prompt": "Because fixed effects is the consistent estimator under correlated αᵢ, it can also recover the coefficient on a <em>time-invariant</em> regressor such as a person's gender.",
      "answer": false,
      "hint": "The within transform subtracts each entity's mean — what happens to a variable that never changes within an entity?",
      "explain": "The 'FE estimates everything' trap. FE is consistent under correlated αᵢ, but the within demeaning that buys that consistency also subtracts off any variable constant within an entity — a time-invariant regressor becomes all zeros and drops out, so its coefficient is <b>unidentified</b>. The tempting belief fails on this exact margin: consistency for x is bought by discarding between-entity information, and a time-invariant trait lives entirely in that discarded between part. Boundary: to price a time-invariant regressor you need RE (or pooled OLS), which retains between-entity variation — at the cost of assuming Cov(x, αᵢ)=0.",
      "points": 10
    },
    {
      "moduleIndex": 2,
      "type": "truefalse",
      "title": "Smaller SEs, so use RE?",
      "prompt": "You just confirmed fixed effects sweeps αᵢ away and stays consistent under correlated αᵢ. Even so, since random effects yields smaller standard errors, RE is the better estimator to report here.",
      "answer": false,
      "hint": "RE's smaller standard errors are only meaningful if RE is centered on the truth — is it, when αᵢ correlates with x?",
      "explain": "The efficiency-over-consistency trap, the central FE-vs-RE error. Under correlated αᵢ, RE is <b>inconsistent</b>, so its smaller standard errors describe a tight interval around the wrong value — consistency must come before efficiency. The seductive 'smaller SEs win' rule fails because precision is only a virtue once the estimator is centered on the truth, and demeaning is what guarantees that here. Boundary: RE's efficiency genuinely wins when Cov(x, αᵢ)=0 (Hausman fails to reject), where both estimators are consistent and RE is simply tighter.",
      "points": 10
    },
    {
      "moduleIndex": 3,
      "type": "quiz",
      "title": "Hausman rejects RE — now what?",
      "prompt": "Your panel has plausibly Cov(x, αᵢ) ≠ 0, and the Hausman test returns a <b>large</b> statistic (p = 0.002), so β̂_FE and β̂_RE disagree sharply. Which estimator should you report for β₁?",
      "choices": [
        "Random effects, because it is more efficient (smaller standard errors)",
        "Random effects, because the Hausman test confirms its assumption holds",
        "Fixed effects, because it stays consistent whether or not αᵢ correlates with x",
        "Pooled OLS, because it uses all the variation in the data"
      ],
      "answer": 2,
      "why": [
        "The efficiency-over-consistency trap: smaller SEs around a biased center are worthless.",
        "Backwards — a large Hausman statistic REJECTS RE's assumption, it does not confirm it.",
        "",
        "Pooled OLS is the most biased here; using more variation includes the contaminated between-entity part."
      ],
      "hint": "A large Hausman statistic means the two estimators disagree — which one is the one that survives correlated αᵢ?",
      "explain": "The efficiency-over-consistency trap, the central FE-vs-RE error. A large Hausman statistic rejects RE's Cov(x, αᵢ)=0 assumption, so RE is inconsistent here and you report <b>fixed effects</b>, which demeans αᵢ away regardless of correlation. The seductive belief 'RE has smaller standard errors, so prefer it' fails because efficiency is worthless around a biased center — a tight interval on the wrong number. Boundary: RE's efficiency is real and decisive ONLY when Hausman fails to reject (small statistic), i.e. when αᵢ truly is uncorrelated with x.",
      "points": 15
    },
    {
      "moduleIndex": 3,
      "type": "truefalse",
      "title": "RE by default?",
      "prompt": "Random effects is more efficient than fixed effects, so you should prefer random effects by default.",
      "answer": false,
      "hint": "Efficiency is a property RE only has WHEN one assumption holds — what is that assumption, and is it usually safe in economics?",
      "explain": "The efficiency-over-consistency trap. RE is more efficient, but only IF Cov(x, αᵢ)=0; when αᵢ correlates with x — the usual reason you reached for panel data — RE is <b>inconsistent</b>, and consistency must come before efficiency. The tempting 'smaller SEs win' rule fails because a precise estimate centered on the wrong value is worse than an imprecise unbiased one; the Hausman test adjudicates exactly this. Boundary: 'default to RE' is sound only after Hausman fails to reject, or when you specifically need a time-invariant coefficient FE cannot deliver.",
      "points": 10
    }
  ],
  "logit": [
    {
      "moduleIndex": 0,
      "type": "truefalse",
      "title": "Does a straight line have a constant effect?",
      "prompt": "You just saw the Linear Probability Model fit a straight line to a 0/1 outcome. Claim: <b>because the line is straight, a one-unit rise in x changes P(y=1) by the same amount whether you start at p=0.05 or at p=0.95.</b>",
      "answer": true,
      "hint": "A straight line has one slope everywhere — that is the whole point of the module. Is that constant effect realistic near the 0 and 1 boundaries?",
      "explain": "This is the constant-marginal-effect flaw of the LPM. The claim is literally TRUE of the straight line — its slope is the same everywhere — and that is exactly why the LPM is wrong for probabilities: near p=0.95 there is almost no room left to move, so a real effect must shrink at the extremes. The fix is an S-curve (logit/probit) whose slope flattens in the tails. Boundary: a constant effect is only defensible over a narrow middle range where the fitted probabilities stay far from 0 and 1.",
      "points": 10
    },
    {
      "moduleIndex": 1,
      "type": "truefalse",
      "title": "Is the coefficient a probability change?",
      "prompt": "You just fit the logit and read β̂₁ off the summary, with log[p/(1−p)] = β₀ + β₁x. Claim: <b>β̂₁ is the change in the probability P(y=1) for a one-unit rise in x.</b>",
      "answer": false,
      "hint": "Look at what the link makes linear. β multiplies x on the log-odds scale, not on the probability scale.",
      "explain": "This is the coefficient-is-a-marginal-effect trap, the central logit error. β is a constant change in the <b>log-odds</b>, not the probability: log[p/(1−p)] = β₀+β₁x is what's linear in x. The effect on the probability is β·p(1−p) — non-linear, largest near p=0.5 and tiny in the tails — so it has no single value. Boundary: only on the log-odds scale is the effect a constant β; on the probability scale you must compute an (average) marginal effect.",
      "points": 10
    },
    {
      "moduleIndex": 1,
      "type": "fillblank",
      "title": "What does the logit make linear?",
      "prompt": "The logit's special trick: it makes the <b>___</b> a linear function β₀+β₁x of the regressors.",
      "lead": "The logistic link is chosen precisely because one transformation of the probability comes out linear in x — name that quantity.",
      "accept": [
        "log-odds",
        "log odds",
        "logodds",
        "logit",
        "the logit",
        "log-odds ratio",
        "log odds ratio",
        "logit of p",
        "ln(p/(1-p))",
        "log(p/(1-p))",
        "log of the odds"
      ],
      "hint": "It is the natural log of p/(1−p). Two words, hyphenated — or the one-word name of the link itself.",
      "explain": "The logit (log-odds) is what comes out linear: log[p/(1−p)] = β₀+β₁x. Students often answer 'probability' or 'odds', but neither is linear in x — only the log of the odds is, which is exactly why β adds to the log-odds and not to p. Boundary: exponentiate once and you get the odds (multiplied by e^β); the probability itself is the non-linear S-curve and is never linear in x.",
      "points": 15
    },
    {
      "moduleIndex": 2,
      "type": "numeric",
      "title": "Turn the coefficient into an odds ratio",
      "prompt": "A logit gives a coefficient of 0.69 on <em>treated</em>. The odds ratio is exp(β). Enter exp(0.69) to two decimals (a plain number, no units).",
      "answer": 2,
      "tol": 0.03,
      "hint": "exp(0.69) is just under 2. This multiplies the ODDS — it is not a change in probability.",
      "explain": "exp(0.69) = 1.99 ≈ 2.00 — treatment roughly DOUBLES the odds. This is the odds-ratio reading of a logit coefficient, and it is constant across x. It is NOT a doubling of the probability and NOT the marginal effect on P(y=1): odds and probability move together only when p is small. Boundary: the odds ratio e^β is the one effect measure that does stay constant; the probability effect β·p(1−p) does not.",
      "unit": "× odds",
      "points": 20
    },
    {
      "moduleIndex": 2,
      "type": "numeric",
      "title": "The marginal effect at p = 0.5",
      "prompt": "A logit gives β=0.8 on a binary treatment. At a baseline probability p=0.5, the marginal effect on P(y=1) is β·p(1−p). Enter it to two decimals (a probability change, e.g. 0.20).",
      "answer": 0.2,
      "tol": 0.01,
      "hint": "Plug in: 0.8 × 0.5 × (1−0.5). The answer is a quarter of β here, not β itself.",
      "explain": "This is the coefficient-is-a-marginal-effect trap in numbers: the marginal effect is β·p(1−p) = 0.8·0.25 = 0.20, NOT the coefficient 0.8. And it shrinks toward the tails — at p=0.9 it is only 0.8·0.09 = 0.072. That p-dependence is exactly why you cannot read a logit coefficient as a single, constant change in probability. Boundary: p(1−p) peaks at 0.25 (p=0.5), so β/4 is the largest the marginal effect can ever be; everywhere else it is smaller.",
      "points": 20
    },
    {
      "moduleIndex": 2,
      "type": "multi",
      "title": "Reading a logit coefficient — select all",
      "prompt": "A logit reports β=0.69 on <em>treated</em>. <b>Select all that apply</b> — which statements are correct readings of this coefficient?",
      "choices": [
        "It adds 0.69 to the log-odds of y=1 for a one-unit change in treated",
        "The odds of y=1 are multiplied by about 2 (e^0.69 ≈ 2)",
        "It raises the probability P(y=1) by 0.69",
        "It is the marginal effect dP/dx, the same at every value of x",
        "The effect on probability depends on the baseline p, peaking near p=0.5"
      ],
      "answers": [
        0,
        1,
        4
      ],
      "hint": "Two correct statements live on the log-odds/odds scale; one more is about how the probability effect varies. The two probability-as-constant statements are the trap.",
      "explain": "Correct readings: β adds to the <b>log-odds</b> (0), the odds are multiplied by e^β ≈ 2 (1), and the probability effect varies with the baseline p, peaking near p=0.5 (4). The two distractors are the coefficient-is-a-marginal-effect trap: β is NOT a 0.69 jump in probability (2) and NOT a constant dP/dx (3) — the probability effect is β·p(1−p), which changes along the S-curve. Boundary: only the log-odds increment and the odds ratio e^β are constant; any probability statement must name the p at which it is evaluated.",
      "points": 20
    },
    {
      "moduleIndex": 3,
      "type": "truefalse",
      "title": "Does 95% accuracy mean a good model?",
      "prompt": "A dataset is 95% zeros. You just saw that always predicting 0 scores 95% accuracy. Claim: <b>that 95% accuracy shows the classifier is performing well.</b>",
      "answer": false,
      "hint": "How many actual positives does the all-zeros rule catch? Think about the true-positive rate and the AUC, not raw accuracy.",
      "explain": "This is the accuracy-under-imbalance trap. A model that predicts 0 for everyone catches ZERO positives yet still scores 95% — accuracy just echoes the base rate when classes are imbalanced. Judge such a model by threshold-free, ranking measures: the true-positive rate and the ROC AUC (0.5 = no better than chance here). Boundary: accuracy is informative only when the classes are roughly balanced and the costs of the two error types are similar; otherwise lean on AUC, precision/recall, or a cost-weighted threshold.",
      "points": 10
    }
  ],
  "gmm": [
    {
      "moduleIndex": 0,
      "type": "fillblank",
      "title": "Counting the surplus",
      "prompt": "When you write down <b>more</b> moment conditions than parameters (m &gt; k), the model is said to be ___.",
      "lead": "You just saw a model with 5 moment conditions for 2 parameters — there are more equations than unknowns.",
      "accept": [
        "over-identified",
        "overidentified",
        "over identified",
        "over-id",
        "overid",
        "over- identified"
      ],
      "hint": "It's the opposite of 'just-identified' (m = k). The prefix means you have a surplus.",
      "explain": "<b>The 'extra moments are wasted' instinct, named:</b> a model with m &gt; k is <b>over-identified</b>, and those surplus moments are not wasted — they give you a testable restriction (the J-test) and, if valid, extra efficiency. The tempting belief is that you should always reduce to m = k so every moment binds exactly; that throws away the over-identifying information. <b>Boundary:</b> exactly m = k is <em>just-identified</em> (moments hit zero exactly, W is irrelevant); m &lt; k is <em>under-identified</em> and not estimable.",
      "points": 15
    },
    {
      "moduleIndex": 0,
      "type": "numeric",
      "title": "How many over-identifying restrictions?",
      "prompt": "A GMM model has m = 5 moment conditions and k = 2 parameters. How many over-identifying restrictions does it have? (enter a whole number)",
      "answer": 3,
      "tol": 0.5,
      "hint": "Over-identifying restrictions = surplus moments = m − k.",
      "explain": "<b>The 'restrictions = number of moments' trap:</b> the count of over-identifying restrictions is m − k = 5 − 2 = <b>3</b>, not 5. The tempting answer 5 counts <em>all</em> moments; but k of them are 'spent' pinning down the k parameters, leaving only m − k as independent checks. <b>Boundary:</b> when m = k the count is 0 — a just-identified model has nothing left over to test, which is exactly why no J-test exists there.",
      "points": 20
    },
    {
      "moduleIndex": 1,
      "type": "fillblank",
      "title": "Just-identified GMM has another name",
      "prompt": "A just-identified GMM estimator (one moment per parameter, m = k) is numerically identical to the classic ___ estimator.",
      "lead": "You just solved Z′(y − Xβ̂) = 0 exactly and recovered β̂ = (Z′X)⁻¹Z′y — a name you already know.",
      "accept": [
        "iv",
        "instrumental variables",
        "instrumental variable",
        "instrumental-variables",
        "2sls",
        "two-stage least squares",
        "two stage least squares",
        "2-sls",
        "two-stage-least-squares"
      ],
      "hint": "It's the estimator from the previous unit that fixes endogeneity with an exogenous z.",
      "explain": "<b>The 'GMM is a brand-new method' trap:</b> just-identified GMM = <b>IV</b> (and 2SLS in the linear case). The seductive belief is that GMM's machinery — the weight matrix W — always does something; but when m = k the moments hit zero exactly, so W cancels out and you get plain IV. <b>Boundary:</b> W only matters, and GMM only improves on IV, when you are <em>over</em>-identified (m &gt; k) with extra <em>valid</em> moments. This is also why OLS and IV are GMM special cases, not rival methods.",
      "points": 15
    },
    {
      "moduleIndex": 2,
      "type": "truefalse",
      "title": "Does passing the J-test prove validity?",
      "prompt": "Your Hansen J-test returns a large p-value (you fail to reject). This <b>proves</b> your moment conditions are all valid.",
      "answer": false,
      "hint": "Think about what a non-rejection can and cannot establish — and what the test must assume to even run.",
      "explain": "<b>The J-test-proves-validity trap.</b> Failing to reject is <em>necessary but not sufficient</em>: the test has low power against small violations, it must <em>assume at least one valid moment</em> to anchor the comparison, and adding weak instruments dilutes it toward non-rejection. So a high p-value is weak evidence, never proof, of exogeneity. <b>Correct rule:</b> the J-test checks <em>mutual consistency</em> of the moments, not their joint truth. <b>Boundary:</b> a <em>rejection</em> (small p) is informative — it tells you at least one moment is invalid — but a non-rejection leaves you exactly where you started: arguing exclusion/exogeneity on theory, not on the test.",
      "points": 10
    },
    {
      "moduleIndex": 2,
      "type": "multi",
      "title": "What over-identification actually buys",
      "prompt": "Select all that apply. Which statements about an <b>over-identified</b> GMM model (m &gt; k, all reasoning about valid vs invalid moments) are TRUE?",
      "choices": [
        "Over-identification is what makes the J / Hansen test possible at all",
        "Extra moment conditions improve efficiency — but only if they are valid",
        "A rejected J-test signals that at least one moment condition is invalid",
        "Just-identified GMM (m = k) coincides with the IV estimator",
        "Adding more moment conditions always reduces finite-sample bias"
      ],
      "answers": [
        0,
        1,
        2,
        3
      ],
      "hint": "Four of these are textbook-true. The false one is the 'more is always better' slogan — think about what instrument proliferation does in finite samples.",
      "explain": "<b>The 'more moments always reduce bias' trap is the lone false choice.</b> Over-ID is what enables the J-test; extra <em>valid</em> moments buy efficiency; a rejected J flags an invalid moment (rethink or drop it, don't pile on more); and just-identified GMM = IV. The slogan that fails: <b>instrument proliferation worsens finite-sample bias</b> (the estimator drifts toward OLS) and weakens the J-test's power. <b>Boundary:</b> the efficiency gain holds <em>asymptotically</em> and <em>only for valid</em> moments; in finite samples each extra instrument also adds noise, so quantity is not free.",
      "points": 20
    },
    {
      "moduleIndex": 3,
      "type": "truefalse",
      "title": "Is more instruments always better?",
      "prompt": "In efficient two-step GMM, <b>adding more instruments always improves</b> the estimator, because more moment conditions can only add information.",
      "answer": false,
      "hint": "The interactive showed SEs shrinking as you added VALID instruments — but what was special about every instrument in that demo?",
      "explain": "<b>The more-instruments-is-always-better trap, re-planted from the J-test.</b> Adding instruments only helps when they are <em>valid and relevant</em>; piling on weak or many instruments inflates <b>finite-sample bias</b> (the two-step estimator drifts toward the biased OLS estimate) and makes the estimated weight matrix Ŝ noisy and the J-test under-sized. The seductive 'more information can't hurt' reasoning is an <em>asymptotic, all-valid</em> statement. <b>Boundary:</b> the efficiency module's slider tightened SEs precisely because <em>every</em> instrument there was valid; in practice the marginal instrument is the one whose validity you're least sure of, so it can do net harm.",
      "points": 10
    }
  ]
};
  Object.keys(ITEMS).forEach(function (id) {
    var t = C[id]; if (!t || !t.modules) return;
    ITEMS[id].forEach(function (it) {
      var mi = (it.moduleIndex != null && t.modules[it.moduleIndex]) ? it.moduleIndex : t.modules.length - 1;
      var stage = {}; for (var k in it) if (k !== "moduleIndex") stage[k] = it[k];
      t.modules[mi].stages.push(stage);
    });
  });
  if (window.TOPIC_META) window.TOPIC_META.forEach(function (m) {
    var t = C[m.id]; if (t && t.modules) m.stages = t.modules.reduce(function (n, mod) { return n + mod.stages.length; }, 0);
  });
})();
