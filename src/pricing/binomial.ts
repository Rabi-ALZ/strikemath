/**
 * Cox-Ross-Rubinstein binomial tree, for European and American exercise.
 *
 *   dt = T / n
 *   u  = e^(sigma sqrt(dt))          d = 1 / u
 *   p  = (e^((r - q) dt) - d) / (u - d)
 *
 * The tree is priced by backward induction from the terminal payoff. For American exercise the
 * value at each node is the greater of continuing and exercising immediately.
 *
 * Convergence to Black-Scholes is O(1/n) and oscillates, so a coarse tree can land close to the
 * analytic value by luck. Use enough steps that the answer is stable, not just plausible.
 *
 * Source: Cox, J., Ross, S. and Rubinstein, M. (1979), "Option pricing: a simplified approach",
 * *Journal of Financial Economics* 7(3).
 */

import type { OptionInputs, OptionType } from '../utils/types.js';
import {
  InvalidInputError,
  resolveOptionInputs,
  type ResolvedOptionInputs,
} from '../utils/validate.js';

/** Whether the holder may exercise only at expiry, or at any time up to it. */
export type ExerciseStyle = 'european' | 'american';

/** Number of steps used when the caller does not specify one. */
export const DEFAULT_BINOMIAL_STEPS = 200;

/**
 * Largest accepted step count.
 *
 * Backward induction is O(n^2) in node evaluations, so 20 000 steps is already 2e8 of them. A
 * request beyond that is far more likely to be a mistake than an intention, and failing loudly
 * beats appearing to hang.
 */
const MAX_BINOMIAL_STEPS = 20_000;

/** `ln(Number.MAX_VALUE)`, with a little room to spare. Beyond it a node price is `Infinity`. */
const MAX_REPRESENTABLE_LOG_PRICE = 709;

/** {@link OptionInputs} plus the contract side, exercise style and tree resolution. */
export interface BinomialInputs extends OptionInputs {
  readonly optionType: OptionType;
  readonly exerciseStyle: ExerciseStyle;

  /** Steps in the tree. Defaults to {@link DEFAULT_BINOMIAL_STEPS}. */
  readonly steps?: number | undefined;
}

function payoff(optionType: OptionType, spot: number, strike: number): number {
  return optionType === 'call' ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0);
}

/**
 * Value along a single deterministic path, used when the tree degenerates.
 *
 * The tree collapses when `u` and `d` are both 1 — `volatility` is 0, `timeToExpiry` is 0, or
 * `sigma sqrt(dt)` has underflowed. Backward induction cannot be used there, and not because of
 * a division by zero: in a CRR tree the drift is carried by the transition probability, not by
 * the size of the moves, so with `u = d = 1` the underlying never leaves `S` and every terminal
 * node would sit at today's spot instead of at the forward. The tree would return the intrinsic
 * value of an unchanged spot, which is simply the wrong number.
 *
 * With no randomness the path is `S(t) = S e^((r - q) t)`. A European option is then worth the
 * discounted payoff at expiry, and an American option the best discounted payoff available at
 * any exercise date on the same grid the tree would have offered.
 */
function deterministicValue(
  inputs: ResolvedOptionInputs,
  optionType: OptionType,
  exerciseStyle: ExerciseStyle,
  steps: number,
): number {
  const { spot, strike, timeToExpiry, riskFreeRate, dividendYield } = inputs;
  const drift = riskFreeRate - dividendYield;

  const valueAt = (time: number): number =>
    Math.exp(-riskFreeRate * time) * payoff(optionType, spot * Math.exp(drift * time), strike);

  const atExpiry = valueAt(timeToExpiry);
  if (exerciseStyle === 'european') return atExpiry;

  let best = atExpiry;
  const dt = timeToExpiry / steps;
  for (let step = 0; step < steps; step += 1) {
    const value = valueAt(step * dt);
    if (value > best) best = value;
  }
  return best;
}

/**
 * Prices a European or American option on a Cox-Ross-Rubinstein tree.
 *
 * @param inputs - Named option inputs plus `optionType`, `exerciseStyle` and optionally `steps`.
 * @returns The present value of the option.
 * @throws InvalidInputError if an input is out of range, if `steps` is not a positive integer no
 *         greater than 20 000, or if the tree's risk-neutral probability falls outside `[0, 1]`
 *         — which means the up and down moves cannot straddle the forward and the tree admits
 *         arbitrage. More steps usually fixes it.
 *
 * @example
 * ```ts
 * crrPrice({
 *   spot: 100, strike: 100, timeToExpiry: 1, riskFreeRate: 0.05, volatility: 0.25,
 *   optionType: 'put', exerciseStyle: 'american', steps: 500,
 * });
 * ```
 */
export function crrPrice(inputs: BinomialInputs): number {
  const resolved = resolveOptionInputs(inputs);

  if (inputs.optionType !== 'call' && inputs.optionType !== 'put') {
    throw new InvalidInputError(
      `optionType must be 'call' or 'put', received ${String(inputs.optionType)}`,
    );
  }
  if (inputs.exerciseStyle !== 'european' && inputs.exerciseStyle !== 'american') {
    throw new InvalidInputError(
      `exerciseStyle must be 'european' or 'american', received ${String(inputs.exerciseStyle)}`,
    );
  }

  const steps = inputs.steps ?? DEFAULT_BINOMIAL_STEPS;
  if (!Number.isInteger(steps) || steps < 1 || steps > MAX_BINOMIAL_STEPS) {
    throw new InvalidInputError(
      `steps must be an integer between 1 and ${MAX_BINOMIAL_STEPS}, received ${String(steps)}`,
    );
  }

  return priceTree(resolved, inputs.optionType, inputs.exerciseStyle, steps);
}

function priceTree(
  inputs: ResolvedOptionInputs,
  optionType: OptionType,
  exerciseStyle: ExerciseStyle,
  steps: number,
): number {
  const { spot, strike, timeToExpiry, riskFreeRate, volatility, dividendYield } = inputs;

  const dt = timeToExpiry / steps;
  const up = Math.exp(volatility * Math.sqrt(dt));
  const down = 1 / up;
  const discount = Math.exp(-riskFreeRate * dt);

  if (up === down) {
    return deterministicValue(inputs, optionType, exerciseStyle, steps);
  }

  // The highest terminal node sits at S u^n = exp(ln S + sigma sqrt(T n)). Past the top of the
  // double range it becomes Infinity, a call payoff there becomes Infinity, and backward
  // induction carries it all the way to the root — so the function would return Infinity for
  // inputs well inside the documented domain, and would do so precisely when the caller raised
  // `steps` to get a better answer. Refusing is the only honest option: the tree cannot be
  // represented, and no number it produced could be trusted.
  const largestLogPrice = Math.log(spot) + volatility * Math.sqrt(timeToExpiry * steps);
  if (largestLogPrice > MAX_REPRESENTABLE_LOG_PRICE) {
    throw new InvalidInputError(
      `the tree cannot be represented: with volatility ${volatility}, timeToExpiry ` +
        `${timeToExpiry} and ${steps} steps the highest terminal node is e^${largestLogPrice.toFixed(1)}, ` +
        'beyond the largest finite double. Reduce steps, or price a European contract with ' +
        'bsPrice, which has no such limit.',
    );
  }

  const probabilityUp = (Math.exp((riskFreeRate - dividendYield) * dt) - down) / (up - down);

  if (!(probabilityUp >= 0 && probabilityUp <= 1)) {
    throw new InvalidInputError(
      `the tree's risk-neutral probability is ${probabilityUp}, outside [0, 1]: the up and ` +
        'down moves cannot straddle the forward at this step size, so the tree admits ' +
        'arbitrage. Increase steps, or use the analytic pricer.',
    );
  }

  // Terminal payoffs. Index j counts up moves, so the node price is S * u^(2j - steps).
  const values = new Float64Array(steps + 1);
  for (let j = 0; j <= steps; j += 1) {
    values[j] = payoff(optionType, spot * Math.pow(up, 2 * j - steps), strike);
  }

  const probabilityDown = 1 - probabilityUp;
  const american = exerciseStyle === 'american';

  for (let step = steps - 1; step >= 0; step -= 1) {
    for (let j = 0; j <= step; j += 1) {
      // Reading j and j + 1 and writing j in place is safe: the write only lands on entries this
      // sweep has already consumed.
      const continuation =
        discount * (probabilityUp * values[j + 1]! + probabilityDown * values[j]!);

      values[j] = american
        ? Math.max(continuation, payoff(optionType, spot * Math.pow(up, 2 * j - step), strike))
        : continuation;
    }
  }

  return values[0]!;
}
