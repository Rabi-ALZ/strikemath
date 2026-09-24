/**
 * Value at Risk.
 *
 * SIGN CONVENTION: **losses are positive numbers.** A VaR of 0.032 means a loss of 3.2%, not a
 * gain. Returns passed in keep the opposite convention — a return of -0.032 is a 3.2% loss —
 * because that is how return series are universally quoted. The conversion happens once, here.
 *
 * VaR answers one question and no others: what loss is not exceeded with probability `c` over the
 * horizon of the input data. It says nothing about how bad the losses beyond it are; for that use
 * `cvar.ts`. It is also not sub-additive, so the VaR of a portfolio can exceed the sum of the VaRs
 * of its parts.
 *
 * All results are in the units of the input. Returns in give a fraction out; multiply by the
 * position value for a currency amount.
 *
 * **THE HORIZON IS THE PERIOD OF YOUR RETURNS, AND IT IS NEVER STATED IN THE RESULT.** Daily
 * returns give a one-day VaR; monthly returns give a one-month VaR. The number carries no label
 * saying which, so a figure computed from daily data and then reported as "our VaR" is off by
 * whatever scaling the reader assumed. Nothing in this library can detect that, because a series
 * of numbers does not say how far apart they are. Say the horizon wherever the figure is used.
 *
 * Scaling one horizon to another is not a division: under the usual independence assumption VaR
 * scales with the square root of time, so a one-day figure is multiplied by sqrt(10) for ten
 * days. That assumption is itself questionable in stressed markets, which is why no such helper
 * is provided here — it would put a convenient number behind an inconvenient assumption.
 */

import { inverseNormalCdf } from '../utils/normal.js';
import { InvalidInputError, assertFinite, withoutNegativeZero } from '../utils/validate.js';

/** Inputs to {@link historicalVar}. */
export interface HistoricalVarInputs {
  /** Realised periodic returns, where negative means a loss. Must not be empty. */
  readonly returns: readonly number[];

  /** Confidence level, strictly between 0 and 1. Typically 0.95 or 0.99. */
  readonly confidenceLevel: number;
}

/** Inputs to {@link parametricVar}. */
export interface ParametricVarInputs {
  /** Mean periodic return, where negative means a loss. */
  readonly mean: number;

  /** Standard deviation of the periodic return. Must not be negative. */
  readonly standardDeviation: number;

  /** Confidence level, strictly between 0 and 1. */
  readonly confidenceLevel: number;
}

/** Validates a confidence level and returns it. */
export function assertConfidenceLevel(confidenceLevel: number): number {
  assertFinite('confidenceLevel', confidenceLevel);
  if (confidenceLevel <= 0 || confidenceLevel >= 1) {
    throw new InvalidInputError(
      `confidenceLevel must be strictly between 0 and 1, received ${confidenceLevel}`,
    );
  }
  return confidenceLevel;
}

/** Converts a return series into a loss series, validating as it goes. Losses are positive. */
export function toLosses(returns: readonly number[]): number[] {
  if (!Array.isArray(returns) || returns.length === 0) {
    throw new InvalidInputError('returns must be a non-empty array of periodic returns');
  }

  return returns.map((value, index) => {
    assertFinite(`returns[${index}]`, value);
    return withoutNegativeZero(-value);
  });
}

/**
 * Historical (empirical) Value at Risk.
 *
 * The quantile uses linear interpolation between order statistics — the same convention as R's
 * `quantile(type = 7)` and NumPy's default — so a small sample does not snap to whichever
 * observation happens to sit at the index.
 *
 * A sample of `n` observations carries no information beyond its own extremes: at 99% confidence
 * with 50 observations the answer is an extrapolation dressed as a measurement. The function does
 * not refuse small samples, but the caller should know the difference.
 *
 * @returns The loss, as a positive number, not exceeded with probability `confidenceLevel`.
 * @throws InvalidInputError if `returns` is empty, contains a non-finite value, or if
 *         `confidenceLevel` is not strictly between 0 and 1.
 *
 * @example
 * ```ts
 * historicalVar({ returns: [-0.05, 0.01, -0.02, 0.03, -0.01], confidenceLevel: 0.95 });
 * // 0.044 — a 4.4% loss
 * ```
 */
export function historicalVar(inputs: HistoricalVarInputs): number {
  const confidenceLevel = assertConfidenceLevel(inputs.confidenceLevel);
  const losses = toLosses(inputs.returns).sort((a, b) => a - b);

  return withoutNegativeZero(quantile(losses, confidenceLevel));
}

/**
 * Parametric (variance-covariance) Value at Risk, assuming normally distributed returns.
 *
 * `VaR = -mean + sigma * z_c`, with `z_c` the standard normal quantile at `confidenceLevel`.
 *
 * The normality assumption is the whole of the model and it is wrong in the direction that
 * matters: real return series have fatter tails than a normal, so this understates the loss
 * exactly where the number is being relied on. Compare against {@link historicalVar} on the same
 * data before trusting it.
 *
 * @returns The loss, as a positive number, not exceeded with probability `confidenceLevel`.
 *          A negative result means the distribution's drift dominates its dispersion at this
 *          confidence level; it is returned as computed rather than clamped.
 * @throws InvalidInputError if an input is out of range.
 */
export function parametricVar(inputs: ParametricVarInputs): number {
  const confidenceLevel = assertConfidenceLevel(inputs.confidenceLevel);
  assertFinite('mean', inputs.mean);
  assertFinite('standardDeviation', inputs.standardDeviation);

  if (inputs.standardDeviation < 0) {
    throw new InvalidInputError(
      `standardDeviation must not be negative, received ${inputs.standardDeviation}`,
    );
  }

  // At `mean = 0`, `standardDeviation = 0` and a confidence below 0.5 the quantile is negative,
  // so both terms are `-0` and the sum stays `-0`.
  return withoutNegativeZero(
    -inputs.mean + inputs.standardDeviation * inverseNormalCdf(confidenceLevel),
  );
}

/** Linearly interpolated quantile of an ascending sorted sample. */
function quantile(sortedAscending: readonly number[], probability: number): number {
  const n = sortedAscending.length;
  if (n === 1) return sortedAscending[0]!;

  const position = probability * (n - 1);
  const lower = Math.floor(position);
  const upper = Math.min(lower + 1, n - 1);
  const weight = position - lower;

  return sortedAscending[lower]! * (1 - weight) + sortedAscending[upper]! * weight;
}
