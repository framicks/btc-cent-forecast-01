# Shrunk-Drift Forecaster — btc-cent-forecast-01

A Bitcoin 4-hour-ahead price forecaster for the make.fun bounty
`btc-cent-forecast-01` (program/v1, Node 22, standard library only).
It reads one case at a time — BTC/USDC 1-minute closes for the 72 hours
up to a checkpoint — and writes one number: the predicted close 240
minutes later.

## Strategy

- **Forecast:** persistence plus an empirical-Bayes-shrunk 72h drift:
  `guess = last * exp(shrink * mean_log_return * 240)`, where the
  shrinkage `tau^2 / (tau^2 + SE^2)` uses the standard error of the
  drift estimate from the last 24h of realised volatility (tau = 0.002).
  Calm trending stretches trust the drift more; noisy stretches fall
  back toward persistence. The drift move is capped at ±0.5% as a
  safety rail for extreme windows.
- **Why:** the score is mean absolute error, so the honest median
  forecast is the best play. Raw momentum (short-window drift, AR on
  the last hour) is far worse — 1-minute noise dominates any 4h
  signal. Mean-reversion to a slow EMA looked good on a sliding
  backtest but lost to persistence on the practice cases, so it is
  not used.

## Files

- `main.ts` — the forecaster (entrypoint, Node 22).
- `LICENSE` — MIT.
- `.makefun/owner.json` — the payout wallet.

## Run locally

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

## Dev-practice result (local, kit's 6 practice cases)

- 5 checkable cases (p00–p04, answers recovered from the next case's
  last close): mean absolute error **44,472.6 cents** vs persistence
  **47,054.7 cents** (−5.5%).
- 64-checkpoint sliding backtest over the same week: **42,863 cents**
  vs persistence 42,871 cents (tied).
- House baseline on the full 6-case practice: 44,521.58 cents.
  Estimated 6-case score for this entry: ~41,500–43,200 cents.
