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
 * CVaR is at least as large as VaR at the same confidence level. For the historical pair that holds
 * in exact arithmetic; in floating point it holds to within the rounding of a sum of up to `n`
 * terms, which grows with the size of the tail rather than staying at a few ulps.
 *
 * **The horizon is the period of your returns**, exactly as in `var.ts`, and is not carried in the
 * result. Daily returns give a one-day figure.
 */

import { normalPdf, inverseNormalCdf } from '../utils/normal.js';
import { InvalidInputError, assertFinite, withoutNegativeZero } from '../utils/validate.js';
import { assertConfidenceLevel, toLosses } from './var.js';
import type { HistoricalVarInputs, ParametricVarInputs } from './var.js';

/** Inputs to {@link historicalCvar}. Identical to the historical VaR inputs. */
export type HistoricalCvarInputs = HistoricalVarInputs;

/** Inputs to {@link parametricCvar}. Identical to the parametric VaR inputs. */
export type ParametricCvarInputs = ParametricVarInputs;

/**
 * Historical (empirical) Conditional Value at Risk.
 *
 * The mean of the worst `(1 - c) n` losses, where that tail mass need not be a whole number: the
 * losses inside it count in full, and the one straddling its edge counts by the fraction that
 * lies inside (Acerbi and Tasche, 2002). When `(1 - c) n` is an integer `k` this is exactly the
 * mean of the worst `k`.
 *
 * It replaced the mean of the worst `ceil((1 - c) n)` losses, which rounds the tail mass up to a
 * whole count and inherits the representation error of `c`: `1 - 0.95` is 0.050000000000000044,
 * so at `n = 20` the product is 1.0000000000000009 and `ceil` averaged the worst two where the
 * worst one was meant — likewise 11 for 10 at 99% on 1000 observations.
 *
 * The fractional form alone does not remove that error, it shrinks it: the excess becomes a small
 * weight on the next loss, and a small weight on a large gain still moves a result near zero by an
 * unbounded relative amount. So a tail mass within `2 n eps` of a whole number is taken to be that
 * number. The bound is how precisely `(1 - c) n` is known at all — `c` is a double within half an
 * ulp of what the caller wrote, and `n` magnifies that; the worst error measured is `0.75 n eps`.
 * What it costs: the handful of doubles nearest a confidence level that makes the tail whole are
 * treated as that level — at `n = 20`, 0.95 and the seven doubles around it. A confidence level written with six or
 * fewer decimals is never snapped for `n` up to a million, since it sits at least 1e-6 from a whole
 * tail mass and the bound there is 4.4e-10. See docs/DECISIONS.md, 2026-09-24.
 *
 * Defined for any non-empty sample, but at 99% confidence on 50 observations the tail mass is half
 * an observation, and the answer is the single worst loss — an anecdote rather than an estimate.
 *
 * @returns The mean loss, as a positive number, conditional on exceeding the VaR threshold.
 * @throws InvalidInputError if `returns` is empty, contains a non-finite value, or if
 *         `confidenceLevel` is not strictly between 0 and 1.
 */
export function historicalCvar(inputs: HistoricalCvarInputs): number {
  const confidenceLevel = assertConfidenceLevel(inputs.confidenceLevel);
  const worstFirst = toLosses(inputs.returns).sort((a, b) => b - a);

  // Strictly positive, since the confidence level is below 1, and at most n since it is above 0 —
  // so whenever there is a fraction, the loss at index `whole` exists. Never snapped down to 0.
  const n = worstFirst.length;
  const rawMass = (1 - confidenceLevel) * n;
  const nearest = Math.round(rawMass);
  const tailMass =
    nearest >= 1 && Math.abs(rawMass - nearest) <= 2 * n * Number.EPSILON ? nearest : rawMass;
  const whole = Math.floor(tailMass);
  const fraction = tailMass - whole;

  // The tail is the first `inTail` losses, worst first, so its range is its two ends.
  const inTail = fraction > 0 ? whole + 1 : whole;
  const highest = worstFirst[0]!;
  const lowest = worstFirst[inTail - 1]!;
  const largest = Math.max(Math.abs(highest), Math.abs(lowest));
  if (largest === 0) return 0;

  // Summed in units of a power of two near the largest loss, so every term is at most 2 in size:
  // no partial sum can overflow, and a subnormal loss becomes an ordinary number instead of
  // underflowing. Dividing by a power of two is exact, so the scaling itself costs nothing. Summed
  // unscaled, three losses of Number.MAX_VALUE overflowed to Infinity; weighted term by term,
  // two losses of 5e-324 at a tail mass of 2 underflowed to 0.
  const exponent = Math.min(Math.max(Math.floor(Math.log2(largest)), -1074), 1023);
  const scale = 2 ** exponent;

  let total = 0;
  for (let index = 0; index < whole; index += 1) total += worstFirst[index]! / scale;
  if (fraction > 0) total += fraction * (worstFirst[whole]! / scale);

  // A weighted mean lies between the smallest and largest value it averages. Rounding can push the
  // computed one an ulp past either end, and past the top of the double range that ulp is Infinity,
  // so the result is held to the range it cannot mathematically leave.
  const result = Math.min(Math.max((total / tailMass) * scale, lowest), highest);

  return withoutNegativeZero(result);
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
  return withoutNegativeZero(
    -inputs.mean + (inputs.standardDeviation * normalPdf(z)) / (1 - confidenceLevel),
  );
}
