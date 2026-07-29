/**
 * Black-Scholes-Merton pricing for European options with a continuous dividend yield.
 *
 *   d1 = [ ln(S/K) + (r - q + sigma^2/2) T ] / (sigma sqrt(T))
 *   d2 = d1 - sigma sqrt(T)
 *   C  = S e^(-qT) N(d1) - K e^(-rT) N(d2)
 *   P  = K e^(-rT) N(-d2) - S e^(-qT) N(-d1)
 *
 * Both boundary cases are handled explicitly rather than left to the limit:
 * `T = 0` gives intrinsic value, `sigma = 0` gives discounted forward intrinsic. Reaching them
 * through the general formula would divide by zero and return NaN.
 *
 * Source: Hull, J.C., *Options, Futures and Other Derivatives*.
 */

import { normalCdf } from '../utils/normal.js';
import type { OptionInputs, OptionType } from '../utils/types.js';
import {
  InvalidInputError,
  resolveOptionInputs,
  type ResolvedOptionInputs,
} from '../utils/validate.js';

/** The two standardised moneyness terms of the Black-Scholes formula. */
export interface BlackScholesD1D2 {
  /** `d1`, whose `N(d1)` is the delta of a call on a dividend-adjusted basis. */
  readonly d1: number;

  /** `d2`, whose `N(d2)` is the risk-neutral probability of finishing in the money. */
  readonly d2: number;
}

/** {@link OptionInputs} plus the side of the contract to price. */
export interface BlackScholesPriceInputs extends OptionInputs {
  readonly optionType: OptionType;
}

function computeD1D2(inputs: ResolvedOptionInputs): BlackScholesD1D2 {
  const { spot, strike, timeToExpiry, riskFreeRate, volatility, dividendYield } = inputs;

  if (timeToExpiry === 0 || volatility === 0) {
    throw new InvalidInputError(
      'd1 and d2 are undefined when timeToExpiry or volatility is 0; the pricing functions ' +
        'handle those cases explicitly as intrinsic and discounted forward intrinsic value',
    );
  }

  // Standard deviation of the log price change over the life of the contract.
  const deviation = volatility * Math.sqrt(timeToExpiry);
  const drift = (riskFreeRate - dividendYield + (volatility * volatility) / 2) * timeToExpiry;

  const d1 = (Math.log(spot / strike) + drift) / deviation;
  return { d1, d2: d1 - deviation };
}

/**
 * The `d1` and `d2` terms of the Black-Scholes formula.
 *
 * @param inputs - Named option inputs.
 * @returns Both moneyness terms.
 * @throws InvalidInputError if an input is out of range, or if `timeToExpiry` or `volatility`
 *         is 0 — where `d1` and `d2` are genuinely undefined rather than merely large.
 */
export function d1d2(inputs: OptionInputs): BlackScholesD1D2 {
  return computeD1D2(resolveOptionInputs(inputs));
}

/** Present value of the underlying net of the dividend yield, `S e^(-qT)`. */
function discountedSpot(inputs: ResolvedOptionInputs): number {
  return inputs.spot * Math.exp(-inputs.dividendYield * inputs.timeToExpiry);
}

/** Present value of the strike, `K e^(-rT)`. */
function discountedStrike(inputs: ResolvedOptionInputs): number {
  return inputs.strike * Math.exp(-inputs.riskFreeRate * inputs.timeToExpiry);
}

function callPrice(inputs: ResolvedOptionInputs): number {
  if (inputs.timeToExpiry === 0) {
    return Math.max(inputs.spot - inputs.strike, 0);
  }

  const spotTerm = discountedSpot(inputs);
  const strikeTerm = discountedStrike(inputs);

  if (inputs.volatility === 0) {
    return Math.max(spotTerm - strikeTerm, 0);
  }

  const { d1, d2 } = computeD1D2(inputs);
  return spotTerm * normalCdf(d1) - strikeTerm * normalCdf(d2);
}

function putPrice(inputs: ResolvedOptionInputs): number {
  if (inputs.timeToExpiry === 0) {
    return Math.max(inputs.strike - inputs.spot, 0);
  }

  const spotTerm = discountedSpot(inputs);
  const strikeTerm = discountedStrike(inputs);

  if (inputs.volatility === 0) {
    return Math.max(strikeTerm - spotTerm, 0);
  }

  const { d1, d2 } = computeD1D2(inputs);
  return strikeTerm * normalCdf(-d2) - spotTerm * normalCdf(-d1);
}

/**
 * Price of a European call option.
 *
 * @param inputs - Named option inputs. `dividendYield` defaults to 0.
 * @returns The present value of the call, in the same currency as `spot` and `strike`.
 * @throws InvalidInputError if any input is outside its permitted range.
 *
 * @example
 * ```ts
 * bsCall({ spot: 42, strike: 40, timeToExpiry: 0.5, riskFreeRate: 0.1, volatility: 0.2 });
 * // 4.759422392871542
 * ```
 */
export function bsCall(inputs: OptionInputs): number {
  return callPrice(resolveOptionInputs(inputs));
}

/**
 * Price of a European put option.
 *
 * @param inputs - Named option inputs. `dividendYield` defaults to 0.
 * @returns The present value of the put, in the same currency as `spot` and `strike`.
 * @throws InvalidInputError if any input is outside its permitted range.
 */
export function bsPut(inputs: OptionInputs): number {
  return putPrice(resolveOptionInputs(inputs));
}

/**
 * Price of a European option on either side of the contract.
 *
 * @param inputs - Named option inputs plus `optionType`.
 * @returns The present value of the option.
 * @throws InvalidInputError if any input is outside its permitted range, or if `optionType` is
 *         neither `'call'` nor `'put'`.
 */
export function bsPrice(inputs: BlackScholesPriceInputs): number {
  const resolved = resolveOptionInputs(inputs);

  if (inputs.optionType === 'call') return callPrice(resolved);
  if (inputs.optionType === 'put') return putPrice(resolved);

  throw new InvalidInputError(
    `optionType must be 'call' or 'put', received ${String(inputs.optionType)}`,
  );
}
