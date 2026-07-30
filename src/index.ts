/**
 * strikemath — dependency-free options mathematics for TypeScript.
 *
 * Named exports only, no default export: a default export cannot be tree-shaken and gives every
 * importer a different name for the same thing.
 *
 * Two conventions run through the whole surface and are worth reading before the first call:
 *
 * 1. Every function takes a named object, never positional arguments. Swapping spot and strike
 *    positionally produces a plausible but wrong number; naming them makes that impossible.
 * 2. Greeks come back in raw units — vega per 1.00 of volatility, theta per year, rho per 1.00
 *    of rate. Convert with the explicitly named helpers, never with a setting.
 *
 * This library is an analysis and education tool. It is not investment advice.
 */

// ---------------------------------------------------------------------------- shared types

export type { Greeks, OptionInputs, OptionType } from './utils/types.js';

// ---------------------------------------------------------------------------- errors

export { InvalidInputError } from './utils/validate.js';

// ---------------------------------------------------------------------------- distribution

export { inverseNormalCdf, normalCdf, normalPdf } from './utils/normal.js';

// ---------------------------------------------------------------------------- pricing

export { bsCall, bsPrice, bsPut, d1d2 } from './pricing/blackScholes.js';
export type { BlackScholesD1D2, BlackScholesPriceInputs } from './pricing/blackScholes.js';

export { crrPrice, DEFAULT_BINOMIAL_STEPS } from './pricing/binomial.js';
export type { BinomialInputs, ExerciseStyle } from './pricing/binomial.js';

// ---------------------------------------------------------------------------- volatility

export {
  ConvergenceError,
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_PRICE_TOLERANCE,
  MAX_IMPLIED_VOLATILITY,
  MIN_IMPLIED_VOLATILITY,
  impliedVolatility,
} from './volatility/impliedVol.js';
export type { ImpliedVolatilityInputs } from './volatility/impliedVol.js';

// ---------------------------------------------------------------------------- greeks

export {
  callGreeks,
  delta,
  gamma,
  optionGreeks,
  putGreeks,
  rho,
  theta,
  vega,
} from './greeks/analytical.js';
export type { GreeksInputs } from './greeks/analytical.js';

export {
  DEFAULT_TRADING_DAYS_PER_YEAR,
  rhoPerPercentagePoint,
  thetaPerCalendarDay,
  thetaPerTradingDay,
  vegaPerPercentagePoint,
} from './greeks/scaling.js';

// ---------------------------------------------------------------------------- risk
//
// Every probability here is under the risk-neutral measure Q and is named accordingly. A
// Q-probability is a price expressed in probability units, not a forecast. See docs/MATH.md §2.

export {
  probabilityAboveUnderQ,
  probabilityBelowUnderQ,
  probabilityItmUnderQ,
  breakEvenProbabilityUnderQ,
} from './risk/probability.js';
export type { ItmInputs, LevelInputs, BreakEvenInputs } from './risk/probability.js';

export { historicalVar, parametricVar } from './risk/var.js';
export type { HistoricalVarInputs, ParametricVarInputs } from './risk/var.js';

export { historicalCvar, historicalLossQuantile, parametricCvar } from './risk/cvar.js';
export type { HistoricalCvarInputs, ParametricCvarInputs } from './risk/cvar.js';

export { fractionalKelly, kellyFraction } from './risk/kelly.js';
export type { KellyInputs } from './risk/kelly.js';
