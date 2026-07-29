/**
 * Conditional Value at Risk, also called Expected Shortfall.
 *
 * SIGN CONVENTION: **losses are positive numbers**, matching `var.ts`. Returns passed in keep the
 * opposite convention: a return of -0.032 is a 3.2% loss.
 *
 * CVaR answers the question VaR cannot: given that the loss exceeds the VaR threshold, how large
 * is it on average. Unlike VaR it is sub-additive, so a portfolio's CVaR never exceeds the sum of
 * its parts' — which is why it is the coherent risk measure of the two, and why regulators moved
 * to it.
 *
 * CVaR is always at least as large as VaR at the same confidence level.
 */

import { normalPdf, inverseNormalCdf } from '../utils/normal.js';
import { InvalidInputError, assertFinite } from '../utils/validate.js';
import { assertConfidenceLevel, quantile, toLosses } from './var.js';
import type { HistoricalVarInputs, ParametricVarInputs } from './var.js';

/** Inputs to {@link historicalCvar}. Identical to the historical VaR inputs. */
export type HistoricalCvarInputs = HistoricalVarInputs;

/** Inputs to {@link parametricCvar}. Identical to the parametric VaR inputs. */
export type ParametricCvarInputs = ParametricVarInputs;

/**
 * Historical (empirical) Conditional Value at Risk.
 *
 * Computed as the mean of the worst `ceil((1 - c) * n)` losses, which is the standard empirical
 * estimator. At least one observation always enters the average, so the result is defined for
 * any non-empty sample — but at 99% confidence on 50 observations that average is over a single
 * point, and it is an anecdote rather than an estimate.
 *
 * @returns The mean loss, as a positive number, conditional on exceeding the VaR threshold.
 * @throws InvalidInputError if `returns` is empty, contains a non-finite value, or if
 *         `confidenceLevel` is not strictly between 0 and 1.
 */
export function historicalCvar(inputs: HistoricalCvarInputs): number {
  const confidenceLevel = assertConfidenceLevel(inputs.confidenceLevel);
  const losses = toLosses(inputs.returns).sort((a, b) => a - b);

  const tailCount = Math.max(1, Math.ceil((1 - confidenceLevel) * losses.length));
  const tail = losses.slice(losses.length - tailCount);

  return tail.reduce((total, loss) => total + loss, 0) / tail.length;
}

/**
 * Parametric Conditional Value at Risk, assuming normally distributed returns.
 *
 * `CVaR = -mean + sigma * phi(z_c) / (1 - c)`, with `z_c` the standard normal quantile at
 * `confidenceLevel`.
 *
 * The normality assumption understates the tail, and it understates it more here than in
 * {@link parametricVar}: this number *is* the tail average, so a distribution with fatter tails
 * than a normal breaks it exactly where it is being used.
 *
 * @returns The mean loss, as a positive number, conditional on exceeding the VaR threshold.
 * @throws InvalidInputError if an input is out of range.
 */
export function parametricCvar(inputs: ParametricCvarInputs): number {
  const confidenceLevel = assertConfidenceLevel(inputs.confidenceLevel);
  assertFinite('mean', inputs.mean);
  assertFinite('standardDeviation', inputs.standardDeviation);

  if (inputs.standardDeviation < 0) {
    throw new InvalidInputError(
      `standardDeviation must not be negative, received ${inputs.standardDeviation}`,
    );
  }

  const z = inverseNormalCdf(confidenceLevel);
  return -inputs.mean + (inputs.standardDeviation * normalPdf(z)) / (1 - confidenceLevel);
}

/**
 * The empirical quantile used by the historical estimators, exposed so a caller can reproduce the
 * VaR threshold that {@link historicalCvar} averages beyond.
 */
export function historicalLossQuantile(
  returns: readonly number[],
  confidenceLevel: number,
): number {
  const level = assertConfidenceLevel(confidenceLevel);
  return quantile(
    toLosses(returns).sort((a, b) => a - b),
    level,
  );
}
