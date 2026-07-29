/**
 * Shared input and output shapes.
 *
 * Every function in this library takes a named object rather than positional arguments. Options
 * mathematics is full of same-typed neighbours — spot and strike, rate and yield — and swapping
 * two of them positionally produces a plausible but wrong number that no type system would
 * catch. Naming them closes that failure mode at the call site.
 */

/** Which side of the contract a price or Greek refers to. */
export type OptionType = 'call' | 'put';

/**
 * Inputs to the Black-Scholes-Merton model.
 *
 * Rates and volatility are expressed as decimal fractions per year, not percentages: a 5%
 * risk-free rate is `0.05`, and a 20% volatility is `0.2`.
 */
export interface OptionInputs {
  /** Current price of the underlying, `S`. Must be positive. */
  readonly spot: number;

  /** Strike price of the contract, `K`. Must be positive. */
  readonly strike: number;

  /** Time to expiry in years, `T`. Must be non-negative; 0 means the contract expires now. */
  readonly timeToExpiry: number;

  /** Continuously compounded risk-free rate per year, `r`. May be negative. */
  readonly riskFreeRate: number;

  /** Annualised volatility of the underlying, `sigma`. Must be non-negative. */
  readonly volatility: number;

  /** Continuous dividend yield per year, `q`. Defaults to 0. */
  readonly dividendYield?: number | undefined;
}

/**
 * The five analytical Greeks, in raw units.
 *
 * The core of this library never scales a Greek. Scaling is applied only through the explicitly
 * named helpers in `greeks/scaling.ts`, so a value can never be ambiguous about the unit it is
 * already in.
 */
export interface Greeks {
  /** Sensitivity to the underlying, per 1.0 of spot. Dimensionless. */
  readonly delta: number;

  /** Second derivative with respect to the underlying, per 1.0 of spot squared. */
  readonly gamma: number;

  /** Sensitivity to volatility, per 1.00 of volatility — not per percentage point. */
  readonly vega: number;

  /** Time decay per year — not per day. Negative for a typical long option. */
  readonly theta: number;

  /** Sensitivity to the risk-free rate, per 1.00 of rate — not per basis point. */
  readonly rho: number;
}
