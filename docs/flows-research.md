# Flows 2.0 NVDA price response

The research page reads a local JSON snapshot of observed Unusual Whales data. It does not send the file to the site or to the vendor. The public repository contains the browser model and its source. It contains no captured market rows. Rebuild the browser model after editing the tape or model module with `node scripts/build-flows-research-bundle.mjs` after installing the test dependencies.

## Snapshot contract

All timestamps use ISO 8601 with an offset, or Unix milliseconds. Close prices are in USD, stock volume is in shares, and implied volatility is a decimal annualized volatility.

| Field | Requirements |
| --- | --- |
| `schemaVersion`, `source`, `symbol` | `1`, `Unusual Whales`, `NVDA` |
| `asOf`, `sessionEndsAt` | Research cutoff and verified exchange session close. A price replay can omit the close. |
| `captureMode`, `capturedAt` | `point-in-time` for a capture with actual local receipt times, `historical-export` for an observation-only replay, or `historical-reconstruction` for retrospective tape with event and quote chronology and the independently retained download timestamp. |
| `bars` | Rows with `time`, `close`, and `volume`. Use the time the bar completed. A price-only replay may leave volume absent and set `priceBasis` to `spot-marks`. |
| `contracts` | Rows with `id` in OCC format, `strike`, `expiresAt`, `type` (`call` or `put`), `iv`, `openInterest`, `multiplier`, `quoteAt`, and `openInterestAsOf`. This version accepts standard NVDA equity contracts with a 100-share multiplier. |
| `trades` | Raw trade rows with `id`, `option_chain_id` or `option_symbol`, `executed_at`, collector `received_at`, `price`, `size`, `nbbo_bid`, `nbbo_ask`, and any condition codes, tags, cancels and corrections present. |
| `tapeSummary` | Optional replay receipt with `counts`, reconciled `byContract` pairs and `archiveSha256`. Created from the same raw adapter and used when the research file should omit print-level data. |
| `litQuoteSummary` | Optional same-cutoff descriptive lit sample with `asOf`, `prints`, `bidShares` and `askShares` as medians of displayed shares at trade. |
| `quoteMode` | `timestamped` requires separately verified pre-trade bid and ask timestamps. `vendor-at-trade` allows the provider’s reported trade-time NBBO and tracks that evidence separately. |
| `coverage` | `chainComplete` and `tapeComplete` describe independently checked coverage for the selected series and window. |
| `rate`, `dividendYield` | Optional continuously compounded decimals. If absent, the research scenario uses zero. |

Missing or stale required fields withhold the risk map. Recorded underlying observations still render. Historical reconstruction bounds exchange events and attached quotes at the chart cutoff while retaining the later actual receipt time. It cannot establish what a collector knew at that earlier time and is excluded from point-in-time backtesting. Coverage applies to the declared window and contract strip.

## Computation

Fresh, valid quote locations contribute signed contracts to an exponentially weighted option-flow feature. The adapter preserves receipt chronology, uses a 120-minute window and 55-minute exponential time constant, and counts quarantined records. It keeps near-midpoint and ambiguous events out of directional flow. Quote-side is a trade-classification feature. Dealer inventory is a scenario variable.

For each option, signed dealer inventory is a signed fraction of open interest less the modeled passive-dealer share of signed option flow. Finite spot shocks reprice delta under a European pricing approximation. The volatility rule uses a bounded median pairwise IV slope by expiry across the retained strike observations. A stock hedge buys or sells the resulting delta difference times the contract multiplier. The shown response divides the original shock plus bounded dollar price impact by the original shock. A 1.15 response means a 15% bigger move conditional on the modeled shock. The relative impact coefficient is a sensitivity based on median completed underlying volume, directional top-of-book size where a lit sample is available, and participation assumptions. It has no fitted causal interpretation.

The volatility ratio compares paired simulated five-minute log returns with common innovations and with and without this hedge channel. Observed intraday returns set the scale. Seven parameter sets vary position, participation, volatility skew and liquidity response. Displayed percentile bands summarize sensitivity across those settings. Contiguous price bands need at least 60% agreement among parameter settings. They are evaluated conditional on starting at each price. The line profiles show all modeled price nodes. Colored zones appear only where the magnitude and agreement thresholds hold. The model estimates neither reach probabilities nor calibrated directional continuation.

## Production validation

Build a time-ordered archive with true receive clocks, quote vintages, timestamped prior OI, cancellable trade IDs, complex-order flags, and a calibrated American-option pricer. Model time-of-day volatility and estimate stock impact from signed lit order-flow imbalance and depth. Use realized log-return variance and pathwise continuation/reversal after first touch as separate held-out targets. Compare against a price-only seasonal HAR baseline, simple OI gamma, and independently tested flow-only features. Use QLIKE for variance, Brier and reliability curves for first-touch outcomes, purged session splits, and day-block intervals. Publish calibrated forecasts only after incremental out-of-sample evidence and applicable written display rights.

Sources include the [Unusual Whales API documentation](https://api.unusualwhales.com/docs), [API terms](https://unusualwhales.com/api-terms-of-service), [Gamma Fragility](https://www.abarbon.com/papers/gamma-fragility), [Corsi’s HAR-RV](https://doi.org/10.1093/jjfinec/nbp001), and [The Price Impact of Order Book Events](https://doi.org/10.1093/jjfinec/nbt003).
