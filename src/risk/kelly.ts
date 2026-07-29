/**
 * Kelly criterion: the stake fraction that maximises the expected logarithm of wealth.
 *
 * READ THIS BEFORE SIZING ANYTHING.
 *
 * The Kelly fraction is optimal only under assumptions that rarely hold: that the probability and
 * the payoffs are known exactly, that the bet is repeated indefinitely, that outcomes are
 * independent, and that the stake is infinitely divisible. Real edges are estimated, and Kelly is
 * unforgiving about that — **overestimating your edge by a factor of two turns the growth-optimal
 * bet into one with zero expected log growth.**
 *
 * Full Kelly is also violent even when the inputs are right. Its expected drawdown is severe: the
 * probability of at some point halving your bankroll under full Kelly is around 50%. Practitioners
 * commonly bet a half or a quarter of it, which gives up little growth for a large reduction in
 * variance — that is what {@link fractionalKelly} is for.
 *
 * This is an analysis tool. It is not a recommendation to bet anything.
 */

import { InvalidInputError, assertFinite, assertPositive } from '../utils/validate.js';

/** Inputs to {@link kellyFraction}. */
export interface KellyInputs {
  /** Probability of the winning outcome, strictly between 0 and 1. */
  readonly winProbability: number;

  /** Net amount won per unit staked, on a win. Must be positive. */
  readonly winPayoff: number;

  /**
   * Fraction of the stake lost on a loss. Defaults to 1, the whole stake.
   *
   * Set below 1 for a bet that does not lose everything — a spread with a defined maximum loss,
   * for example. Must be positive and no greater than 1.
   */
  readonly lossFraction?: number | undefined;
}

/**
 * The Kelly stake, as a fraction of bankroll.
 *
 * With the default `lossFraction` of 1 this is the classic `f* = (b p - (1 - p)) / b`, where `b`
 * is `winPayoff`. With a partial loss it generalises to
 *
 * ```
 * f* = p / lossFraction - (1 - p) / winPayoff
 * ```
 *
 * @returns The growth-optimal fraction of bankroll to stake. **A negative result means the bet
 *          has negative expected value at these inputs** — the arithmetic says to take the other
 *          side, which is usually not available and always means: do not take this one. The value
 *          is returned as computed rather than clamped to 0, so the size of the disadvantage
 *          stays visible.
 * @throws InvalidInputError if an input is out of range.
 *
 * @example
 * ```ts
 * kellyFraction({ winProbability: 0.6, winPayoff: 1 }); // 0.2 — stake 20% of bankroll
 * ```
 */
export function kellyFraction(inputs: KellyInputs): number {
  assertFinite('winProbability', inputs.winProbability);
  if (inputs.winProbability <= 0 || inputs.winProbability >= 1) {
    throw new InvalidInputError(
      `winProbability must be strictly between 0 and 1, received ${inputs.winProbability}`,
    );
  }

  assertPositive('winPayoff', inputs.winPayoff);

  const lossFraction = inputs.lossFraction ?? 1;
  assertPositive('lossFraction', lossFraction);
  if (lossFraction > 1) {
    throw new InvalidInputError(`lossFraction must not exceed 1, received ${lossFraction}`);
  }

  return inputs.winProbability / lossFraction - (1 - inputs.winProbability) / inputs.winPayoff;
}

/**
 * A fixed fraction of the Kelly stake.
 *
 * Half Kelly gives up a quarter of the growth rate for roughly half the volatility, and is far
 * more robust to an overestimated edge. Given how rarely an edge is known to better than a factor
 * of two, this is normally the number to use.
 *
 * @param fullKelly - The output of {@link kellyFraction}.
 * @param fraction - The multiplier, typically 0.5 or 0.25. Must be in `(0, 1]`.
 * @returns `fullKelly * fraction`.
 * @throws InvalidInputError if `fraction` is outside `(0, 1]`.
 *
 * @example
 * ```ts
 * fractionalKelly(kellyFraction({ winProbability: 0.6, winPayoff: 1 }), 0.5); // 0.1
 * ```
 */
export function fractionalKelly(fullKelly: number, fraction: number): number {
  assertFinite('fullKelly', fullKelly);
  assertPositive('fraction', fraction);
  if (fraction > 1) {
    throw new InvalidInputError(
      `fraction must not exceed 1 — betting more than full Kelly reduces expected growth and ` +
        `increases risk at the same time. Received ${fraction}`,
    );
  }

  return fullKelly * fraction;
}
