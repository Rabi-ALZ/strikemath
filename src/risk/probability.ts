/**
 * Terminal-distribution probabilities under the **risk-neutral measure Q**.
 *
 * READ THIS BEFORE USING ANY FUNCTION HERE.
 *
 * Every probability in this file is computed under Q, the measure in which the underlying drifts
 * at `r - q` and all option prices are expectations. **A Q-probability is not a forecast.** It is
 * a price expressed in probability units — the market's risk-adjusted valuation of a binary
 * payoff. The real-world measure P, under which the underlying drifts at its actual expected
 * return, is a different thing entirely, and this library neither models it nor can infer it from
 * option prices.
 *
 * The two coincide only if market participants are indifferent to risk, which they are not.
 * Equity index puts in particular trade far above their P-probability because investors pay for
 * protection, so `probabilityItmUnderQ` on a put systematically overstates how often it will
 * actually finish in the money.
 *
 * Every function is named `...UnderQ` so that no caller can pass one of these numbers off as a
 * forecast without the name saying otherwise.
 *
 * Under Q, `ln S_T` is normal with mean `ln S + (r - q - sigma^2/2) T` and variance `sigma^2 T`,
 * which gives `Q(S_T > L) = N(d2(L))` where `d2(L)` is the usual `d2` with the strike replaced
 * by the level `L`.
 */

import { normalCdf } from '../utils/normal.js';
import type { OptionInputs, OptionType } from '../utils/types.js';
import {
  InvalidInputError,
  assertNonNegative,
  assertPositive,
  hasNoDispersion,
  resolveOptionInputs,
  type ResolvedOptionInputs,
} from '../utils/validate.js';

/** {@link OptionInputs} plus a price level to compare the terminal price against. */
export interface LevelInputs extends OptionInputs {
  /** The terminal price level `L`. Must be positive. */
  readonly level: number;
}

/** {@link OptionInputs} plus the side of the contract. */
export interface ItmInputs extends OptionInputs {
  readonly optionType: OptionType;
}

/** {@link ItmInputs} plus the premium paid, for a break-even calculation. */
export interface BreakEvenInputs extends ItmInputs {
  /** Premium paid per contract, in the same units as `spot`. Must not be negative. */
  readonly premium: number;
}

/**
 * `d2` with the strike replaced by an arbitrary level.
 *
 * Deliberately computed as `d1 - sigma sqrt(T)`, matching `blackScholes.ts` rather than folding
 * `-sigma^2/2` into the drift directly. The two are algebraically identical and differ by an ulp
 * in floating point; using the same form means `probabilityItmUnderQ` on a call returns bitwise
 * exactly `normalCdf(d1d2(inputs).d2)`, so the two never disagree in their last digit.
 */
function d2ForLevel(inputs: ResolvedOptionInputs, level: number): number {
  const { spot, timeToExpiry, riskFreeRate, volatility, dividendYield } = inputs;

  const deviation = volatility * Math.sqrt(timeToExpiry);
  const drift = (riskFreeRate - dividendYield + (volatility * volatility) / 2) * timeToExpiry;
  const d1 = (Math.log(spot / level) + drift) / deviation;

  return d1 - deviation;
}

/**
 * Q-probability that the terminal price finishes strictly above `level`.
 *
 * When `timeToExpiry` or `volatility` is 0 the terminal price is deterministic at
 * `S e^((r - q) T)`, and the answer is 1 or 0 with no distribution involved.
 *
 * @returns A probability in `[0, 1]` under the risk-neutral measure. **Not a forecast.**
 * @throws InvalidInputError if an input is out of range or `level` is not positive.
 */
export function probabilityAboveUnderQ(inputs: LevelInputs): number {
  const resolved = resolveOptionInputs(inputs);
  assertPositive('level', inputs.level);

  if (isDegenerate(resolved)) {
    return terminalPrice(resolved) > inputs.level ? 1 : 0;
  }

  return normalCdf(d2ForLevel(resolved, inputs.level));
}

/**
 * Q-probability that the terminal price finishes strictly below `level`.
 *
 * Computed as `N(-d2)` rather than as `1 - N(d2)`. The two are equal in exact arithmetic, but the
 * complement destroys the tail: at `d2 = 10.4` the subtraction returns a hard 0 while `N(-d2)` is
 * 1.24e-25, a perfectly representable number that the CDF produces to the relative floor set out
 * in docs/MATH.md 3.4 — around 1e-15 there, not the 1.6e-16 this comment used to claim.
 * Computing the tail directly is the whole reason `normal.ts` is written the way it is,
 * and taking a complement here would have thrown it away.
 *
 * With no randomness left the comparison is strict on both sides, so a terminal price sitting
 * exactly on the level gives 0 both above and below — not 1 for one of them.
 *
 * @returns A probability in `[0, 1]` under the risk-neutral measure. **Not a forecast.**
 */
export function probabilityBelowUnderQ(inputs: LevelInputs): number {
  const resolved = resolveOptionInputs(inputs);
  assertPositive('level', inputs.level);

  if (isDegenerate(resolved)) {
    return terminalPrice(resolved) < inputs.level ? 1 : 0;
  }

  return normalCdf(-d2ForLevel(resolved, inputs.level));
}

/** True when there is no randomness left and the terminal price is a single point. */
function isDegenerate(inputs: ResolvedOptionInputs): boolean {
  return hasNoDispersion(inputs);
}

/** The deterministic terminal price, used only when {@link isDegenerate} holds. */
function terminalPrice(inputs: ResolvedOptionInputs): number {
  return inputs.spot * Math.exp((inputs.riskFreeRate - inputs.dividendYield) * inputs.timeToExpiry);
}

/**
 * Q-probability that the option finishes in the money — `N(d2)` for a call, `N(-d2)` for a put.
 *
 * This is the single number most often mistaken for a forecast. It is not one: it is what the
 * market charges for a payoff that is 1 if the option expires in the money and 0 otherwise. See
 * the note at the top of this file.
 *
 * @returns A probability in `[0, 1]` under the risk-neutral measure. **Not a forecast.**
 * @throws InvalidInputError if an input is out of range or `optionType` is not recognised.
 */
export function probabilityItmUnderQ(inputs: ItmInputs): number {
  if (inputs.optionType !== 'call' && inputs.optionType !== 'put') {
    throw new InvalidInputError(
      `optionType must be 'call' or 'put', received ${String(inputs.optionType)}`,
    );
  }

  return inputs.optionType === 'call'
    ? probabilityAboveUnderQ({ ...inputs, level: inputs.strike })
    : probabilityBelowUnderQ({ ...inputs, level: inputs.strike });
}

/**
 * Q-probability that a **long** option position finishes beyond its break-even price.
 *
 * **On the name.** Other tools call this "probability of profit", often abbreviated POP. This
 * library deliberately does not, because that phrase makes a promise the number cannot keep. What
 * is computed is a risk-neutral probability: a price expressed in probability units. It is not an
 * estimate of how often the trade will make money, and the gap between the two is systematic
 * rather than noisy — see docs/MATH.md §2. A name has to survive being read out of context, in an
 * autocomplete list, in a UI label, in a screenshot. "Break-even" describes what is measured;
 * "profit" describes what the reader hopes it means.
 *
 * The premium is carried forward to expiry at the risk-free rate, so break-even is
 * `K + premium e^(rT)` for a call and `K - premium e^(rT)` for a put. That convention treats the
 * premium as financed, which is the internally consistent choice in a model where everything else
 * is discounted; a screen that simply adds the premium to the strike will report a slightly
 * different number.
 *
 * For a **short** position, take the other side of the same level directly:
 * {@link probabilityBelowUnderQ} at `K + premium e^(rT)` for a short call,
 * {@link probabilityAboveUnderQ} at `K - premium e^(rT)` for a short put.
 *
 * **Do not compute it as `1 -` this value.** The complement fails in two separate ways that the
 * direct call does not. At expiry with the terminal price sitting exactly on break-even, both
 * sides are 0 — neither position is beyond it — so `1 -` reports the short as certain. And deep
 * in the money the complement collapses to a hard 0 where the true probability is small but
 * perfectly representable: 6.97e-21 at `S = 130, K = 100, T = 0.02, r = 0.05, sigma = 0.2,
 * premium = 0.01` — the rate matters, since at `r = 0` the same contract gives 9.72e-21 — which
 * `normalCdf` delivers and `1 - x` discards in full. This is
 * the same defect that was removed from the library itself in review; it must not be reintroduced
 * in the caller's code by this documentation.
 *
 * A put whose break-even falls at or below zero cannot be profitable at expiry, and the result is
 * 0 rather than an error.
 *
 * @returns A probability in `[0, 1]` under the risk-neutral measure. **Not a forecast**, and in
 *          particular not the probability that the trade makes money in the real world.
 * @throws InvalidInputError if an input is out of range or `premium` is negative.
 */
export function breakEvenProbabilityUnderQ(inputs: BreakEvenInputs): number {
  assertNonNegative('premium', inputs.premium);

  if (inputs.optionType !== 'call' && inputs.optionType !== 'put') {
    throw new InvalidInputError(
      `optionType must be 'call' or 'put', received ${String(inputs.optionType)}`,
    );
  }

  const carriedPremium = inputs.premium * Math.exp(inputs.riskFreeRate * inputs.timeToExpiry);

  if (inputs.optionType === 'call') {
    return probabilityAboveUnderQ({ ...inputs, level: inputs.strike + carriedPremium });
  }

  const breakEven = inputs.strike - carriedPremium;
  if (breakEven <= 0) return 0;

  return probabilityBelowUnderQ({ ...inputs, level: breakEven });
}
