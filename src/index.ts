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
