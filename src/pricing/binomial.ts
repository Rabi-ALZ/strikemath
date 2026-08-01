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

/**
 * The largest step count whose tree still fits in a double, for a given contract.
 *
 * The highest terminal node is `S u^n = e^(ln S + sigma sqrt(T n))`, so the constraint is
 * `ln S + sigma sqrt(T n) <= ln(MAX_VALUE)`, which solves to
 *
 * ```
 * n <= ((ln(MAX_VALUE) - ln S) / sigma)^2 / T
 * ```
 *
 * This binds only at high volatility, and only for calls. Across the documented domain —
 * `S, K <= 10 000`, `T <= 10` — it stays above the 20 000 step cap for any `sigma` up to about
 * 1.5, so an ordinary contract never meets it. It is real from roughly `sigma = 1.6` upwards.
 *
 * Only ever called from the representability guard, which is reached only when `u != d` — so
 * `volatility` and `timeToExpiry` are both non-zero here and need no special case.
 *
 * @param inputs - Resolved option inputs.
 * @returns The largest usable `steps`, capped at {@link MAX_BINOMIAL_STEPS}. **0 when no step
 *          count works at all**, which happens when the spot on its own already sits at the top
 *          of the double range and no tree can be built around it.
 */
function maxRepresentableSteps(inputs: ResolvedOptionInputs): number {
  const headroom = MAX_REPRESENTABLE_LOG_PRICE - Math.log(inputs.spot);
  if (headroom <= 0) return 0;

  // Not clamped up to 1: a limit of 0 means no tree fits at all, and rounding that up would
  // name a step count that fails exactly like the one the caller just tried.
  const limit = Math.floor(headroom ** 2 / (inputs.volatility ** 2 * inputs.timeToExpiry));
  return Math.min(limit, MAX_BINOMIAL_STEPS);
}

/**
 * The smallest `steps` for which the risk-neutral probability lands inside `[0, 1]`.
 *
 * `p` is inside the interval exactly while `sigma sqrt(dt) > |r - q| dt`, which rearranges to
 * `n > T (|r - q| / sigma)^2`. Raising `steps` therefore always fixes the problem in principle —
 * but not always in practice, because `steps` is capped at {@link MAX_BINOMIAL_STEPS}. The
 * requirement exceeds the cap for `sigma < |r - q| sqrt(T / 20000)`, a region that reaches into
 * the documented domain: at `r - q = 0.25` and `T = 10` it covers every volatility below 0.0056,
 * and the domain starts at 0.001.
 *
 * The caller is told the number either way, so "increase steps" is never advice they cannot act
 * on or check.
 *
 * Only ever called from the `p` guard, which is unreachable at zero drift: with `r = q` the
 * numerator is `1 - d` and the denominator `u - d`, and `1 < u` makes the ratio a proper fraction
 * for any `u > 1`. So there is no zero-drift case to special-case here.
 *
 * @returns The smallest `steps` for which `p` lands inside `[0, 1]`, which may exceed
 *          {@link MAX_BINOMIAL_STEPS}.
 */
function minimumStepsForValidProbability(inputs: ResolvedOptionInputs): number {
  const drift = Math.abs(inputs.riskFreeRate - inputs.dividendYield);
  const bound = Math.max(1, Math.ceil((inputs.timeToExpiry * drift ** 2) / inputs.volatility ** 2));

  // The closed form is exact in real arithmetic and `p` is not computed in real arithmetic, so
  // the bound is a starting point and not an answer. Two rounds of getting this wrong:
  //
  //   `floor(x) + 1` implements `n > x` where the guard accepts `n >= x`, so it overshot by one
  //   on every integral ratio — including all three worked examples in docs/MATH.md 5.1.
  //
  //   `ceil(x)` alone undershoots whenever q > r. On that side the numerator compares
  //   `exp(-a)` against `1 / exp(a)`, which differ by an ulp, so `p` lands at -1.3e-14 rather
  //   than 0 and the guard refuses the very count being advised. At S = K = 100, T = 0.25,
  //   r = 0, q = 0.15, sigma = 0.025 the bound is 9 and the first count that works is 10. With
  //   r > q both sides come from `exp(a)` with the same argument, `p` is exactly 1, and a sweep
  //   of positive drift sees none of it.
  //
  // And it can land one too HIGH, because the ratio itself is rounded: at r = -0.02, q = 0,
  // sigma = 0.001, T = 0.04 it is exactly 16 in real arithmetic and 16.000000000000004 as a
  // double, so `ceil` says 17 while 16 prices perfectly well. The search therefore starts below
  // the bound as well as above it.
  //
  // What the message promises is the smallest count the *guard* accepts, so candidates are tested
  // against the guard's own expression rather than against a closed form. `p` approaches 1/2
  // monotonically as steps rise, so the window only has to cover the rounding; it is bounded
  // rather than open-ended regardless.
  const first = Math.max(1, bound - 2);
  for (let candidate = first; candidate <= bound + 8 && candidate <= MAX_BINOMIAL_STEPS;) {
    if (isProbabilityValid(inputs, candidate)) return candidate;
    candidate += 1;
  }

  return bound;
}

/** The transition probability the guard will compute, at a hypothetical step count. */
function isProbabilityValid(inputs: ResolvedOptionInputs, steps: number): boolean {
  const dt = inputs.timeToExpiry / steps;
  const up = Math.exp(inputs.volatility * Math.sqrt(dt));
  const down = 1 / up;
  const probabilityUp =
    (Math.exp((inputs.riskFreeRate - inputs.dividendYield) * dt) - down) / (up - down);

  return probabilityUp >= 0 && probabilityUp <= 1;
}

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
 * **A call carries one constraint the analytic pricers do not.** The highest terminal node is
 * `S u^n = e^(ln S + sigma sqrt(T n))`, so `steps` and `volatility` are coupled: the tree only
 * fits in a double while `ln S + sigma sqrt(T n) <= 709`. Across the documented domain this stays
 * above the 20 000 step cap for any volatility up to about 1.5, so an ordinary contract never
 * meets it — but at 160% volatility and above it is real, and it is reached by *raising* `steps`.
 * The error names the largest step count that fits.
 *
 * A **put** is unaffected and is never refused on these grounds: its payoff at an overflowed node
 * is `max(K - Infinity, 0) = 0`, which is the correct value there. See docs/MATH.md §9.1.
 *
 * @param inputs - Named option inputs plus `optionType`, `exerciseStyle` and optionally `steps`.
 * @returns The present value of the option.
 * @throws InvalidInputError if an input is out of range, if `steps` is not a positive integer no
 *         greater than 20 000, if the tree's terminal nodes exceed the double range, or if the
 *         tree's risk-neutral probability falls outside `[0, 1]` — which means the up and down
 *         moves cannot straddle the forward and the tree admits arbitrage. More steps usually
 *         fixes the latter.
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
  // double range it becomes Infinity, and for a CALL the payoff there is Infinity - K = Infinity,
  // which backward induction carries all the way to the root. Refusing is the only honest option:
  // the tree cannot be represented, and no number it produced could be trusted.
  //
  // A PUT is unaffected, and the guard deliberately does not apply to one. Its terminal payoff is
  // max(K - Infinity, 0), which evaluates to 0 — the mathematically correct value at a node that
  // far above the strike. No Infinity ever enters the value array, so nothing propagates. Refusing
  // a put here would reject a tree that computes correctly, and would do it precisely when the
  // caller raised `steps` to get a better answer.
  const largestLogPrice = Math.log(spot) + volatility * Math.sqrt(timeToExpiry * steps);
  if (optionType === 'call' && largestLogPrice > MAX_REPRESENTABLE_LOG_PRICE) {
    const usable = maxRepresentableSteps(inputs);
    const advice =
      usable === 0
        ? 'No step count works: the spot alone already sits at the top of the double range.'
        : `The largest step count that fits is ${usable}.`;

    throw new InvalidInputError(
      `the tree cannot be represented: with volatility ${volatility}, timeToExpiry ` +
        `${timeToExpiry} and ${steps} steps the highest terminal node is e^${largestLogPrice.toFixed(1)}, ` +
        `beyond the largest finite double. ${advice} Alternatively price a European contract ` +
        'with bsPrice, which has no such limit.',
    );
  }

  const probabilityUp = (Math.exp((riskFreeRate - dividendYield) * dt) - down) / (up - down);

  if (!(probabilityUp >= 0 && probabilityUp <= 1)) {
    const needed = minimumStepsForValidProbability(inputs);

    // "Increase steps" is only advice if a legal step count exists. Past the cap it is a dead
    // end, and saying so is the whole point of refusing rather than returning a number.
    //
    // The fallback is qualified deliberately. bsPrice is exact for a European contract and is a
    // lower bound for an American one — at S = 40, K = 100, T = 10, r = 0.25, sigma = 0.001 it
    // returns 0.00 for a put that can be exercised immediately for 60.00. Naming it without the
    // qualification would hand the caller a catastrophically wrong number at exactly the moment
    // they are looking for guidance.
    const advice =
      needed <= MAX_BINOMIAL_STEPS
        ? `Raise steps to at least ${needed}. That is the smallest count admitting a valid ` +
          'probability, which makes it a floor on validity and not a recommendation — the tree ' +
          'is at its coarsest there, so use several times more before trusting the price.'
        : `No legal step count works: ${needed} steps would be needed and the cap is ` +
          `${MAX_BINOMIAL_STEPS}. This happens when sigma < |r - q| sqrt(T / ${MAX_BINOMIAL_STEPS}). ` +
          'For a European contract use bsPrice, which has no such limit. An American contract ' +
          'in this region has no fallback in this library — see docs/MATH.md 5.1.';

    throw new InvalidInputError(
      `the tree's risk-neutral probability is ${probabilityUp}, outside [0, 1]: the up and ` +
        'down moves cannot straddle the forward at this step size, so the tree admits ' +
        `arbitrage. ${advice}`,
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
