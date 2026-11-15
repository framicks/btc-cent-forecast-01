// btc-cent-forecast-01: Bitcoin's price 4 hours ahead, from the last 72h of
// 1-minute closes (Node 22, standard library only).
//
// Forecast: persistence plus an empirical-Bayes-shrunk 72h drift.
//   guess = last * exp(shrink * mean_log_return * 240)
// where mean_log_return is the mean 1-minute log return over the whole
// case (up to 4,320 closes) and shrink = tau^2 / (tau^2 + SE^2) with SE the
// standard error of the 240-minute drift estimate from the last 24h of
// realised 1-minute volatility. In calm trending stretches the drift is
// trusted more; in noisy stretches the forecast falls back toward
// persistence. The score is mean absolute error, so the honest median
// forecast is the best play: no directional bet beyond the shrunk drift.
//
// Why this shape (measured on the kit's practice, 6 cases p00..p05):
//   * persistence (the house baseline) scores 44,521.58 cents on the
//     practice; raw momentum (short-window drift, AR on the last hour)
//     is far worse — 1-minute noise dominates any 4h signal, and
//     unshrunk drift over-fits the practice week's downtrend.
//   * a 72h drift with fixed shrinkage 0.5 beats persistence on the
//     practice's 5 checkable cases (44,728 vs 47,055 cents) and is
//     essentially tied on a 64-checkpoint sliding backtest over the
//     same week (43,061 vs 42,871 cents).
//   * the adaptive version (tau = 0.002) keeps both: 44,473 cents on
//     the 5 checkable practice cases (-5.5% vs persistence) and
//     42,863 cents on the sliding backtest (-0.0% vs persistence).
//   * mean-reversion to a slow EMA looked good on the sliding
//     backtest but lost to persistence on the practice cases, so it
//     is not used: it bets against the trend that the practice week
//     actually had.
//
// It runs offline, with no network, under the case's time cap: everything
// it knows is in the case's prices. Deterministic: same input, same bytes.
//
// I/O (as the kit's starter): read every <id>.in in the input directory
// (the grader runs one case at a time, with only that case's file there),
// canonical JSON {"schema":"makefun/btc-cent-case/v1","competition",
// "case","at","horizon_minutes","markets":[{"id","name","start","prices"}]},
// where `prices` holds one close a minute in US dollars per whole BTC;
// write <id>.out to the output directory:
// {"forecasts":[{"case":"<the case's id>","price":<number>}]}, exactly one
// row naming the case and no other key, its price a finite number greater
// than 0 and less than 10,000,000, at most 1 MiB.
//
// Outside the grader's container, MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR
// stand in for /input and /output:
//   mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The smallest positive price on the grid: one unit of its 5 decimals. */
const MIN_PRICE = 0.00001;
/** The largest grid price below the scorer's exclusive 10,000,000-dollar cap. */
const MAX_PRICE = 9_999_999.99999;

/** Prior SD of the true 240-minute log drift (0.2%): the shrinkage scale. */
const TAU = 0.002;
/** Minutes of recent history used for the realised-volatility estimate. */
const VOL_WINDOW_MIN = 1440;
/** Safety rail: the drift move is never more than 0.5% either way. On the
 *  practice the move is 0.05-0.09%, so the cap never binds there; it only
 *  stops a wild forecast if the final window's 72h drift is extreme. */
const DRIFT_CAP = 0.005;

interface CaseMarket {
  id: string;
  prices: number[];
}

interface Case {
  markets: CaseMarket[];
}

/** x kept on the grid's 5 decimals and inside the scorer's (0, 10,000,000). */
const price5 = (x: number): number => Math.round(Math.min(MAX_PRICE, Math.max(MIN_PRICE, x)) * 1e5) / 1e5;

/** The shrunk-drift forecast of one market: its last close, moved by the
 *  72h drift estimate shrunk toward zero by its own standard error. */
function forecast(m: CaseMarket): number {
  if (!Array.isArray(m.prices) || m.prices.length === 0) throw new Error(`market ${m.id} has no prices`);
  const prices = m.prices;
  const last = prices[prices.length - 1] as number;
  if (typeof last !== 'number' || !Number.isFinite(last)) throw new Error(`market ${m.id}'s last price is not a finite number`);
  if (prices.length < 2) return price5(last);

  // 1-minute log returns.
  const rets: number[] = new Array<number>(prices.length - 1);
  for (let i = 0; i < prices.length - 1; i++) {
    const p0 = prices[i] as number;
    const p1 = prices[i + 1] as number;
    if (!(p0 > 0) || !(p1 > 0) || !Number.isFinite(p0) || !Number.isFinite(p1)) {
      throw new Error(`market ${m.id} has a non-positive or non-finite price at index ${i}`);
    }
    rets[i] = Math.log(p1 / p0);
  }

  // Mean log return over the whole case (up to 72h): the drift estimate.
  let sum = 0;
  for (const r of rets) sum += r;
  const meanRet = sum / rets.length;

  // Standard error of the 240-minute drift estimate, from the last 24h of
  // realised 1-minute volatility: SE = sd(rets) / sqrt(n) * 240.
  const volN = Math.min(VOL_WINDOW_MIN, rets.length);
  const recent = rets.slice(rets.length - volN);
  let rsum = 0;
  for (const r of recent) rsum += r;
  const rmean = rsum / recent.length;
  let sq = 0;
  for (const r of recent) {
    const d = r - rmean;
    sq += d * d;
  }
  const sd = Math.sqrt(sq / recent.length);
  const se = (sd / Math.sqrt(rets.length)) * 240;

  // Empirical-Bayes shrinkage: trust the drift only as far as its own
  // standard error allows; a noisy estimate shrinks toward persistence.
  // The cap is a safety rail for an extreme final window, never binding
  // on the practice (moves there are 0.05-0.09%).
  const shrink = (TAU * TAU) / (TAU * TAU + se * se);
  const drift240 = Math.max(-DRIFT_CAP, Math.min(DRIFT_CAP, shrink * meanRet * 240));
  return price5(last * Math.exp(drift240));
}

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  if (!Array.isArray(c.markets) || c.markets.length !== 1) throw new Error(`${file} does not hold exactly one market`);
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ forecasts: [{ case: id, price: forecast(c.markets[0] as CaseMarket) }] })}\n`);
}
