/**
 * Analytical Greeks for European options under Black-Scholes-Merton.
 *
 * EVERY VALUE RETURNED HERE IS IN RAW UNITS:
 *
 *   delta  per 1.0 of spot          gamma  per 1.0 of spot squared
 *   vega   per 1.00 of volatility   theta  per year
 *   rho    per 1.00 of rate
 *
 * `vega` is therefore roughly 100x the number a trading screen shows, and `theta` roughly 365x.
 * That is deliberate. Runtime-configurable units make a returned number ambiguous about what it
 * means — the answer depends on a setting somewhere up the call stack. Convert explicitly with
 * the helpers in `./scaling.js`, whose names say what they produce:
 * `vegaPerPercentagePoint`, `thetaPerCalendarDay`, `thetaPerTradingDay`, `rhoPerPercentagePoint`.
 *
 * Formulas (with continuous dividend yield q):
 *
 *   delta_call =  e^(-qT) N(d1)              delta_put = -e^(-qT) N(-d1)
 *   gamma      =  e^(-qT) phi(d1) / (S sigma sqrt(T))
 *   vega       =  S e^(-qT) phi(d1) sqrt(T)
 *   theta_call = -S e^(-qT) phi(d1) sigma / (2 sqrt(T)) + q S e^(-qT) N(d1) - r K e^(-rT) N(d2)
 *   theta_put  = -S e^(-qT) phi(d1) sigma / (2 sqrt(T)) - q S e^(-qT) N(-d1) + r K e^(-rT) N(-d2)
 *   rho_call   =  K T e^(-rT) N(d2)          rho_put   = -K T e^(-rT) N(-d2)
 *
 * Source: Hull, J.C., *Options, Futures and Other Derivatives*, chapter 17.
 */

import { d1d2 } from '../pricing/blackScholes.js';
import { normalCdf, normalPdf } from '../utils/normal.js';
import type { Greeks, OptionInputs, OptionType } from '../utils/types.js';
import {
  InvalidInputError,
  hasNoDispersion,
  resolveOptionInputs,
  withoutNegativeZero,
  type ResolvedOptionInputs,
} from '../utils/validate.js';

/** {@link OptionInputs} plus the side of the contract. */
export interface GreeksInputs extends OptionInputs {
  readonly optionType: OptionType;
}

/**
 * Greeks at the boundary, where the contract has no dispersion left.
 *
 * ONE RULE GOVERNS EVERY VALUE HERE:
 *
 *   **Report the limit of the analytic formula approached from inside the domain. Where that
 *   limit does not exist finitely, report 0 — and gamma at the kink is the only place that
 *   happens.**
 *
 * None of these are conventions. They were documented as conventions for a while, and that was
 * simply wrong: measuring the analytic branch as it approaches the boundary shows it converging
 * on exactly the values below. At the kink `spotTerm = strikeTerm` forces `d1 = sigma sqrt(T) / 2`,
 * which tends to 0, so `N(d1) -> 0.5` and `phi(d1) -> phi(0)`.
 *
 * Measured at the kink, S = K = 100, r = q = 0.04, T = 1, as sigma tends to 0:
 *
 * | Greek | limit from inside | reported |
 * |-------|-------------------|----------|
 * | delta | 0.4803947187      | 0.4803947196 |
 * | vega  | 38.32995298410409 | 38.32995298410414 |
 * | rho   | 48.0394700411     | 48.0394719576 |
 * | theta | -> 0, linearly in sigma (-1.76e-2 at 1e-3, -1.76e-11 at 1e-12) | 0 |
 * | gamma | -> infinity as 1/sigma (3.8e0 at 1e-3, 3.8e9 at 1e-12) | 0 — the exception |
 *
 * The rule is what makes this predictable: any Greek added later has its boundary behaviour
 * already determined. See docs/MATH.md §6.2.
 */
function boundaryGreeks(inputs: ResolvedOptionInputs, optionType: OptionType): Greeks {
  const { timeToExpiry, riskFreeRate, dividendYield } = inputs;

  const spotTerm = inputs.spot * Math.exp(-dividendYield * timeToExpiry);
  const strikeTerm = inputs.strike * Math.exp(-riskFreeRate * timeToExpiry);

  const edge = spotTerm - strikeTerm;
  const sign = optionType === 'call' ? 1 : -1;
  const signedEdge = sign * edge;

  // 1 in the money, 0 out of it, 0.5 exactly at the kink.
  const indicator = signedEdge === 0 ? 0.5 : signedEdge > 0 ? 1 : 0;

  // Vega is NOT zero at the kink, and this is where the Dirac argument for gamma does not carry
  // over. Gamma genuinely diverges there. Vega does not: approaching from sigma > 0 at the
  // forward-at-the-money point, d1 = sigma sqrt(T) / 2 tends to 0, so
  //
  //   vega -> S e^(-qT) sqrt(T) phi(0)
  //
  // which is finite and large — 39.894 for S = K = 100, r = q = 0, T = 1. Reporting 0 there put
  // a jump discontinuity into the library's own output: the analytic branch returns 39.894 at
  // sigma = 5e-324 and the boundary branch returned 0 at sigma = 0.
  //
  // Away from the kink vega really is 0: the value approaches intrinsic exponentially fast in
  // 1/sigma^2. And with no time left it is 0 either way, which sqrt(0) delivers on its own.
  const vega = indicator === 0.5 ? spotTerm * Math.sqrt(timeToExpiry) * normalPdf(0) : 0;

  return {
    delta: sign * indicator * Math.exp(-dividendYield * timeToExpiry),
    gamma: 0,
    vega,
    theta: sign * indicator * (dividendYield * spotTerm - riskFreeRate * strikeTerm),
    rho: sign * indicator * timeToExpiry * strikeTerm,
  };
}

/**
 * Strips `-0` from every field, on every path.
 *
 * A put reaches `-0` in two separate ways: out of the money at the boundary, where the sign
 * multiplies a zero indicator, and deep out of the money in the analytic branch, where
 * `normalCdf(-d1)` underflows and the leading minus sign survives. The first fix covered only
 * the boundary branch — which is why this is now one choke point rather than a guard at each
 * site where the hazard happened to be noticed. See {@link withoutNegativeZero}.
 */
function computeGreeks(inputs: ResolvedOptionInputs, optionType: OptionType): Greeks {
  const greeks = rawGreeks(inputs, optionType);

  return {
    delta: withoutNegativeZero(greeks.delta),
    gamma: withoutNegativeZero(greeks.gamma),
    vega: withoutNegativeZero(greeks.vega),
    theta: withoutNegativeZero(greeks.theta),
    rho: withoutNegativeZero(greeks.rho),
  };
}

function rawGreeks(inputs: ResolvedOptionInputs, optionType: OptionType): Greeks {
  if (hasNoDispersion(inputs)) {
    return boundaryGreeks(inputs, optionType);
  }

  const { spot, timeToExpiry, riskFreeRate, volatility, dividendYield } = inputs;
  const { d1, d2 } = d1d2(inputs);

  const sqrtTime = Math.sqrt(timeToExpiry);
  const spotTerm = spot * Math.exp(-dividendYield * timeToExpiry);
  const strikeTerm = inputs.strike * Math.exp(-riskFreeRate * timeToExpiry);
  const densityAtD1 = normalPdf(d1);

  // Shared between the two sides: the payoff is symmetric in its second-order behaviour.
  const gamma =
    (Math.exp(-dividendYield * timeToExpiry) * densityAtD1) / (spot * volatility * sqrtTime);
  const vega = spotTerm * densityAtD1 * sqrtTime;
  const decay = -(spotTerm * densityAtD1 * volatility) / (2 * sqrtTime);

  if (optionType === 'call') {
    return {
      delta: Math.exp(-dividendYield * timeToExpiry) * normalCdf(d1),
      gamma,
      vega,
      theta:
        decay +
        dividendYield * spotTerm * normalCdf(d1) -
        riskFreeRate * strikeTerm * normalCdf(d2),
      rho: timeToExpiry * strikeTerm * normalCdf(d2),
    };
  }

  return {
    delta: -Math.exp(-dividendYield * timeToExpiry) * normalCdf(-d1),
    gamma,
    vega,
    theta:
      decay -
      dividendYield * spotTerm * normalCdf(-d1) +
      riskFreeRate * strikeTerm * normalCdf(-d2),
    rho: -timeToExpiry * strikeTerm * normalCdf(-d2),
  };
}

/**
 * All five Greeks of a European call, in raw units.
 *
 * **At the boundary** — where `sigma sqrt(T)` is 0 — every value is the limit of the analytic
 * formula approached from inside the domain, not a convention. At the kink that makes delta
 * **0.5 for a call and -0.5 for a put**, and vega finite and large rather than 0. Gamma is the
 * single exception: its limit diverges, so 0 is reported. See docs/MATH.md §6.2.
 *
 * @param inputs - Named option inputs. `dividendYield` defaults to 0.
 * @returns delta per 1.0 spot, gamma per 1.0 spot squared, vega per 1.00 volatility,
 *          theta per year, rho per 1.00 rate.
 * @throws InvalidInputError if any input is outside its permitted range.
 */
export function callGreeks(inputs: OptionInputs): Greeks {
  return computeGreeks(resolveOptionInputs(inputs), 'call');
}

/**
 * All five Greeks of a European put, in raw units.
 *
 * **At the boundary** — where `sigma sqrt(T)` is 0 — every value is the limit of the analytic
 * formula approached from inside the domain, not a convention. At the kink that makes delta
 * **0.5 for a call and -0.5 for a put**, and vega finite and large rather than 0. Gamma is the
 * single exception: its limit diverges, so 0 is reported. See docs/MATH.md §6.2.
 *
 * @param inputs - Named option inputs. `dividendYield` defaults to 0.
 * @returns delta per 1.0 spot, gamma per 1.0 spot squared, vega per 1.00 volatility,
 *          theta per year, rho per 1.00 rate.
 * @throws InvalidInputError if any input is outside its permitted range.
 */
export function putGreeks(inputs: OptionInputs): Greeks {
  return computeGreeks(resolveOptionInputs(inputs), 'put');
}

/**
 * All five Greeks of a European option on either side, in raw units.
 *
 * **At the boundary** — where `sigma sqrt(T)` is 0 — every value is the limit of the analytic
 * formula approached from inside the domain, not a convention. At the kink that makes delta
 * **0.5 for a call and -0.5 for a put**, and vega finite and large rather than 0. Gamma is the
 * single exception: its limit diverges, so 0 is reported. See docs/MATH.md §6.2.
 *
 * @param inputs - Named option inputs plus `optionType`.
 * @throws InvalidInputError if any input is out of range or `optionType` is not recognised.
 */
export function optionGreeks(inputs: GreeksInputs): Greeks {
  if (inputs.optionType !== 'call' && inputs.optionType !== 'put') {
    throw new InvalidInputError(
      `optionType must be 'call' or 'put', received ${String(inputs.optionType)}`,
    );
  }
  return computeGreeks(resolveOptionInputs(inputs), inputs.optionType);
}

/**
 * Delta: sensitivity of the option price to the underlying, per 1.0 of spot.
 *
 * Bounded by `[0, 1]` for a call and `[-1, 0]` for a put.
 *
 * **At the kink.** With no dispersion left the payoff is piecewise linear, and at
 * `spotTerm === strikeTerm` it has no derivative — the subgradient is the whole interval `[0, 1]`
 * for a call and `[-1, 0]` for a put. The reported **0.5 and -0.5 are not a choice from within
 * that interval**: they are the limit of the analytic delta approached from inside the domain.
 * At the kink `d1 = sigma sqrt(T) / 2` tends to 0, so `N(d1)` tends to 0.5. Measured at
 * S = K = 100, r = q = 0, approaching from `T > 0`: 0.5039893563146316 at T = 1e-2,
 * 0.5000039894228039 at T = 1e-8, 0.5 at T = 0.
 *
 * Away from the strike the reported delta is the true one-sided slope, 1 or 0 for a call and
 * -1 or 0 for a put. See docs/MATH.md §6.2.
 */
export function delta(inputs: GreeksInputs): number {
  return optionGreeks(inputs).delta;
}

/**
 * Gamma: second derivative with respect to the underlying, per 1.0 of spot squared.
 *
 * Identical for a call and a put on the same contract, which is why this takes no `optionType`.
 * Never negative.
 */
export function gamma(inputs: OptionInputs): number {
  return callGreeks(inputs).gamma;
}

/**
 * Vega: sensitivity to volatility, **per 1.00 of volatility** — not per percentage point.
 *
 * Identical for a call and a put on the same contract, which is why this takes no `optionType`.
 * Divide by 100, via {@link vegaPerPercentagePoint}, for the per-point number a screen shows.
 * Never negative.
 */
export function vega(inputs: OptionInputs): number {
  return callGreeks(inputs).vega;
}

/**
 * Theta: time decay **per year** — not per day.
 *
 * Negative for a typical long option. Use `thetaPerCalendarDay` or `thetaPerTradingDay` to
 * convert; which of the two is appropriate is a modelling choice this library will not make
 * silently.
 */
export function theta(inputs: GreeksInputs): number {
  return optionGreeks(inputs).theta;
}

/**
 * Rho: sensitivity to the risk-free rate, **per 1.00 of rate** — not per basis point.
 */
export function rho(inputs: GreeksInputs): number {
  return optionGreeks(inputs).rho;
}
