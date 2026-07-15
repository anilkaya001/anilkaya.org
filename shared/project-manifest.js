/* Answer-free Worker allowlist for portfolio project state. */
export const PROJECT_BY_ID = Object.freeze({
  "macro-forecasting-desk": Object.freeze({
    id: "macro-forecasting-desk",
    taskIds: Object.freeze(["inspect-vintage", "transform-series", "fit-benchmark", "estimate-system", "rolling-evaluation", "publish-brief"]),
  }),
  "fx-volatility-risk": Object.freeze({
    id: "fx-volatility-risk",
    taskIds: Object.freeze(["build-returns", "diagnose-volatility", "fit-garch", "forecast-var", "estimate-es", "backtest-risk"]),
  }),
  "factor-pricing-lab": Object.freeze({
    id: "factor-pricing-lab",
    taskIds: Object.freeze(["align-excess-returns", "estimate-capm", "estimate-three-factor", "rolling-exposures", "test-moments", "publish-tearsheet"]),
  }),
});
export const PROJECT_IDS = Object.freeze(Object.keys(PROJECT_BY_ID));
