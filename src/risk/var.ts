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
 */

import { inverseNormalCdf } from '../utils/normal.js';
import { InvalidInputError, assertFinite } from '../utils/validate.js';

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
    // `-0` for a flat period: it compares unequal to 0 under Object.is and would surface in any
    // aggregation across positions. Same hazard as the one guarded in boundaryGreeks.
    return value === 0 ? 0 : -value;
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

  return quantile(losses, confidenceLevel);
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

  return -inputs.mean + inputs.standardDeviation * inverseNormalCdf(confidenceLevel);
}

/**
 * Linearly interpolated quantile of an ascending sorted sample.
 *
 * Shared with `cvar.ts`. Exported for that reason, not as part of the public surface.
 */
export function quantile(sortedAscending: readonly number[], probability: number): number {
  const n = sortedAscending.length;
  if (n === 1) return sortedAscending[0]!;

  const position = probability * (n - 1);
  const lower = Math.floor(position);
  const upper = Math.min(lower + 1, n - 1);
  const weight = position - lower;

  return sortedAscending[lower]! * (1 - weight) + sortedAscending[upper]! * weight;
}
