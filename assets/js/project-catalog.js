/* Browser-side portfolio catalogue; project code and output never enter D1. */
(() => {
  "use strict";
  const projects = [
    { id: "macro-forecasting-desk", title: "Macro Forecasting Desk", subtitle: "A real-time macro briefing workflow", dataset: "/assets/data/projects/macro-synthetic-v1.csv", courseIds: ["forecast", "var", "coint"], tasks: [
      ["inspect-vintage", "Audit the data vintage", "Confirm frequency, units, date coverage, and the synthetic provenance record."],
      ["transform-series", "Define transformations", "Construct inflation, output growth, and a policy-rate target without look-ahead."],
      ["fit-benchmark", "Fit a benchmark", "Estimate a transparent autoregressive benchmark before adding complexity."],
      ["estimate-system", "Estimate the system", "Compare an information-rich forecast or VAR with the benchmark."],
      ["rolling-evaluation", "Run rolling-origin evaluation", "Use only information available at each origin and report horizon-specific loss."],
      ["publish-brief", "Publish the briefing", "Explain the signal, uncertainty, failure modes, and decision relevance."],
    ], code: `import pandas as pd, numpy as np\nfrom pyodide.http import open_url\nurl = "/assets/data/projects/macro-synthetic-v1.csv"\ndf = pd.read_csv(open_url(url), parse_dates=["date"])\ndf["inflation"] = 1200*np.log(df.cpi_index).diff()\ndf["ip_growth"] = 1200*np.log(df.industrial_production_index).diff()\nprint(df.tail())\nprint(df[["inflation","ip_growth","federal_funds_rate"]].describe().round(3))` },
    { id: "fx-volatility-risk", title: "FX Volatility & Risk", subtitle: "A validated market-risk workflow", dataset: "/assets/data/projects/fx-synthetic-v1.csv", courseIds: ["financial", "forecast"], tasks: [
      ["build-returns", "Build the return series", "Convert USD/EUR levels to consistently oriented log returns."],
      ["diagnose-volatility", "Diagnose volatility clustering", "Inspect return and squared-return dependence before choosing a variance model."],
      ["fit-garch", "Fit conditional volatility", "Estimate a positive, stable GARCH specification and inspect standardized residuals."],
      ["forecast-var", "Forecast Value at Risk", "Declare horizon and tail probability before calculating the loss quantile."],
      ["estimate-es", "Estimate Expected Shortfall", "Measure severity beyond the VaR boundary with adequate tail support."],
      ["backtest-risk", "Backtest the risk model", "Evaluate exception coverage and independence on held-out observations."],
    ], code: `import pandas as pd, numpy as np\nfrom pyodide.http import open_url\nurl = "/assets/data/projects/fx-synthetic-v1.csv"\ndf = pd.read_csv(open_url(url), parse_dates=["date"])\ndf["return"] = np.log(df.usd_per_eur).diff()\nwindow = 60\ndf["volatility"] = df["return"].rolling(window).std()\ndf["var_99"] = -2.326*df["volatility"]\nprint(df.tail(8).round(6))\nprint("1% exceptions:", int((df["return"] < df["var_99"]).sum()))` },
    { id: "factor-pricing-lab", title: "Factor Pricing Lab", subtitle: "An auditable asset-pricing tear sheet", dataset: "/assets/data/projects/factors-synthetic-v1.csv", courseIds: ["financial", "gmm", "ols"], tasks: [
      ["align-excess-returns", "Align excess returns", "Confirm decimal units, dates, and risk-free subtraction."],
      ["estimate-capm", "Estimate CAPM", "Report alpha, market beta, robust uncertainty, and residual diagnostics."],
      ["estimate-three-factor", "Estimate the three-factor model", "Measure how alpha and exposures change when SMB and HML enter."],
      ["rolling-exposures", "Trace rolling exposures", "Check whether betas remain stable through time."],
      ["test-moments", "Test pricing moments", "Express orthogonality conditions and evaluate a transparent GMM criterion."],
      ["publish-tearsheet", "Publish the tear sheet", "Present exposures, alpha, uncertainty, benchmark comparison, and caveats."],
    ], code: `import pandas as pd, numpy as np\nimport statsmodels.api as sm\nfrom pyodide.http import open_url\nurl = "/assets/data/projects/factors-synthetic-v1.csv"\ndf = pd.read_csv(open_url(url), parse_dates=["date"])\nX = sm.add_constant(df[["mkt_rf","smb","hml"]])\nmodel = sm.OLS(df.portfolio_excess, X).fit(cov_type="HC1")\nprint(model.summary())` },
  ].map((project) => Object.freeze({ ...project, tasks: Object.freeze(project.tasks.map((task) => Object.freeze({ id: task[0], title: task[1], detail: task[2] }))) }));
  window.PROJECT_CATALOG = Object.freeze(projects);
  window.PROJECT_BY_ID = Object.freeze(Object.fromEntries(projects.map((project) => [project.id, project])));
})();
