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
  resolveOptionInputs,
  type ResolvedOptionInputs,
} from '../utils/validate.js';

/** {@link OptionInputs} plus the side of the contract. */
export interface GreeksInputs extends OptionInputs {
  readonly optionType: OptionType;
}

/**
 * Greeks at the boundary, where `timeToExpiry` or `volatility` is exactly 0.
 *
 * There is no randomness left in either case, so the payoff is a deterministic function of the
 * discounted forward and the Greeks are its derivatives. Gamma and vega are 0: the true limit of
 * gamma is a Dirac delta concentrated at the strike, which has no finite value to report.
 *
 * Exactly at the kink the payoff is not differentiable. Delta is reported as the midpoint of the
 * subgradient — 0.5 for a call, -0.5 for a put — which is the conventional choice and is
 * documented rather than hidden.
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

  // Out of the money every sensitivity is zero. Returning it as a literal rather than as
  // `sign * 0` keeps a put from reporting -0, which compares unequal to 0 under Object.is and
  // would surprise anyone aggregating Greeks across a position.
  if (indicator === 0) {
    return { delta: 0, gamma: 0, vega: 0, theta: 0, rho: 0 };
  }

  return {
    delta: sign * indicator * Math.exp(-dividendYield * timeToExpiry),
    gamma: 0,
    vega: 0,
    theta: sign * indicator * (dividendYield * spotTerm - riskFreeRate * strikeTerm),
    rho: sign * indicator * timeToExpiry * strikeTerm,
  };
}

function computeGreeks(inputs: ResolvedOptionInputs, optionType: OptionType): Greeks {
  if (inputs.timeToExpiry === 0 || inputs.volatility === 0) {
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
 * **At the boundary** — `timeToExpiry` or `volatility` exactly 0 — there is no randomness left,
 * so gamma and vega are 0 and the others are derivatives of the deterministic payoff. Exactly at
 * the strike that payoff has no derivative, and delta is reported as the midpoint of the
 * subgradient: **0.5 for a call, -0.5 for a put**. That is a convention, not a computed value.
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
 * **At the boundary** — `timeToExpiry` or `volatility` exactly 0 — there is no randomness left,
 * so gamma and vega are 0 and the others are derivatives of the deterministic payoff. Exactly at
 * the strike that payoff has no derivative, and delta is reported as the midpoint of the
 * subgradient: **-0.5 for a put, 0.5 for a call**. That is a convention, not a computed value.
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
 * **At the boundary** — `timeToExpiry` or `volatility` exactly 0 — gamma and vega are 0, and
 * exactly at the strike delta is the midpoint of the subgradient: **0.5 for a call, -0.5 for a
 * put**. That is a convention, not a computed value.
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
 * **At the kink.** When `timeToExpiry` or `volatility` is exactly 0 the payoff is piecewise
 * linear, and at `spot === strike` it has no derivative at all — the subgradient there is the
 * whole interval `[0, 1]` for a call and `[-1, 0]` for a put. This returns its **midpoint: 0.5
 * for a call, -0.5 for a put**. It is the conventional choice, and it is a convention rather
 * than a computed value; away from the strike the reported delta is the true one-sided slope,
 * 1 or 0 for a call and -1 or 0 for a put.
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
