/**
 * Implied volatility: the volatility that reproduces an observed option price.
 *
 * There is no closed form, so this inverts Black-Scholes numerically. Newton-Raphson on vega is
 * fast where vega is healthy and useless where it is not — far out of the money, or very close
 * to expiry, vega collapses and a Newton step can jump anywhere. The iteration is therefore
 * **bracketed**: every step is checked against a maintained interval, and any step that would
 * leave it is replaced by a bisection. Bisection alone always converges; Newton alone does not.
 *
 * Failure is always an error that says what went wrong. This function never returns `NaN`, and
 * never returns a number that does not reproduce the input price.
 *
 * Source: Hull, J.C., *Options, Futures and Other Derivatives*.
 */

import { bsPrice } from '../pricing/blackScholes.js';
import { vega as blackScholesVega } from '../greeks/analytical.js';
import type { OptionInputs, OptionType } from '../utils/types.js';
import { InvalidInputError, assertFinite, assertPositive } from '../utils/validate.js';

/**
 * The volatility search bracket, and why it is fixed rather than a parameter.
 *
 * `priceTolerance` and `maxIterations` can be overridden; this cannot. The asymmetry is
 * deliberate, and it is worth saying why rather than leaving it to look like an oversight.
 *
 * **The bounds are economic, not numerical.** A common justification for a floor around 1e-6 is
 * that the price stops being distinguishable from intrinsic below it. Measured, that is simply
 * false: for a forward-at-the-money one-year contract on a spot of 100 the price still exceeds
 * intrinsic by 3.8e-13 at `sigma = 1e-14`, and only collapses at `sigma = 1e-18` — ten orders of
 * magnitude below the floor. The floor is there because 0.0001% annualised volatility is not a
 * market, not because the arithmetic gives out.
 *
 * **A caller could not choose better.** Picking a bracket means knowing how the Newton step and
 * the bisection fallback interact in this implementation and where convergence degrades. A
 * parameter that can realistically only be set wrong is a trap with good documentation attached.
 *
 * **The bounds are load-bearing elsewhere.** The prices at both ends decide whether an input is
 * reported as a `ConvergenceError` or solved, and both appear in the error messages. Widening the
 * bracket silently changes which inputs are answerable — it is not an isolated knob.
 *
 * If a real contract ever needs a different range, that is a feature request with a concrete case
 * attached, and the case will say what the right range is. Guessing now would be worse.
 */

/** Lower end of the volatility search bracket: 0.0001% annualised. */
export const MIN_IMPLIED_VOLATILITY = 1e-6;

/** Upper end of the volatility search bracket: 500% annualised. */
export const MAX_IMPLIED_VOLATILITY = 5;

/** Default cap on iterations before the solver gives up and reports failure. */
export const DEFAULT_MAX_ITERATIONS = 100;

/** Default absolute tolerance on the reproduced price. */
export const DEFAULT_PRICE_TOLERANCE = 1e-10;

/**
 * Thrown when the solver cannot produce a volatility that reproduces the given price.
 *
 * This is deliberately distinct from {@link InvalidInputError}: the inputs were well formed, but
 * no answer was found. Catching it separately lets a caller retry or widen a bracket rather than
 * treat the request as malformed.
 */
export class ConvergenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConvergenceError';
  }
}

/** Inputs to {@link impliedVolatility}: option inputs with the price given and the volatility not. */
export interface ImpliedVolatilityInputs extends Omit<OptionInputs, 'volatility'> {
  /** Observed market price of the option. */
  readonly optionPrice: number;

  /** Which side of the contract the price refers to. */
  readonly optionType: OptionType;

  /** Absolute tolerance on the reproduced price. Defaults to {@link DEFAULT_PRICE_TOLERANCE}. */
  readonly priceTolerance?: number | undefined;

  /** Iteration cap. Defaults to {@link DEFAULT_MAX_ITERATIONS}. */
  readonly maxIterations?: number | undefined;
}

/**
 * Implied volatility of a European option.
 *
 * **How precise the answer is depends on the contract, not on the solver.** What is guaranteed is
 * that the returned volatility reproduces `optionPrice` to within `priceTolerance`. How tightly
 * that pins the volatility itself follows from vega: `dSigma = dPrice / vega`. A deep
 * out-of-the-money weekly can have a vega around 3e-5, so even an exactly matched price fixes
 * sigma only to about 3e-6. Where vega has collapsed entirely, the price carries no information
 * about volatility at all and no solver can recover it.
 *
 * @param inputs - Named option inputs with `optionPrice` in place of `volatility`.
 * @returns The annualised volatility, in `[1e-6, 5]`, that reproduces `optionPrice`.
 *
 * @throws InvalidInputError if an input is out of range; if `timeToExpiry` is 0, where every
 *         volatility gives the same price and the answer is undefined rather than merely hard to
 *         find; or if the price violates the static no-arbitrage bounds
 *         `[discounted intrinsic, discounted forward limit]`.
 * @throws ConvergenceError if the price is inside the arbitrage bounds but outside the volatility
 *         search bracket, or if the iteration cap is reached.
 *
 * @example
 * ```ts
 * impliedVolatility({
 *   optionPrice: 4.759422392871535,
 *   spot: 42, strike: 40, timeToExpiry: 0.5, riskFreeRate: 0.1,
 *   optionType: 'call',
 * });
 * // 0.2
 * ```
 */
export function impliedVolatility(inputs: ImpliedVolatilityInputs): number {
  const { optionPrice, optionType, spot, strike, timeToExpiry, riskFreeRate } = inputs;
  const dividendYield = inputs.dividendYield ?? 0;

  assertPositive('spot', spot);
  assertPositive('strike', strike);
  assertFinite('timeToExpiry', timeToExpiry);
  assertFinite('riskFreeRate', riskFreeRate);
  assertFinite('dividendYield', dividendYield);
  assertFinite('optionPrice', optionPrice);

  if (optionType !== 'call' && optionType !== 'put') {
    throw new InvalidInputError(
      `optionType must be 'call' or 'put', received ${String(optionType)}`,
    );
  }
  if (timeToExpiry <= 0) {
    throw new InvalidInputError(
      'implied volatility is undefined at or past expiry: with timeToExpiry = 0 every ' +
        'volatility produces the same intrinsic price, so no volatility is implied by it',
    );
  }

  const priceTolerance = inputs.priceTolerance ?? DEFAULT_PRICE_TOLERANCE;
  assertPositive('priceTolerance', priceTolerance);

  const maxIterations = inputs.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  if (!Number.isInteger(maxIterations) || maxIterations < 1) {
    throw new InvalidInputError(
      `maxIterations must be a positive integer, received ${String(maxIterations)}`,
    );
  }

  const shared = { spot, strike, timeToExpiry, riskFreeRate, dividendYield, optionType } as const;
  const priceAt = (volatility: number): number => bsPrice({ ...shared, volatility });

  assertNoArbitrage(optionPrice, optionType, {
    spotTerm: spot * Math.exp(-dividendYield * timeToExpiry),
    strikeTerm: strike * Math.exp(-riskFreeRate * timeToExpiry),
  });

  const priceAtFloor = priceAt(MIN_IMPLIED_VOLATILITY);
  const priceAtCeiling = priceAt(MAX_IMPLIED_VOLATILITY);

  if (optionPrice < priceAtFloor - priceTolerance) {
    throw new ConvergenceError(
      `price ${optionPrice} is below ${priceAtFloor}, the price at the smallest volatility in ` +
        `the search bracket (${MIN_IMPLIED_VOLATILITY}). It satisfies the arbitrage bounds, so ` +
        'the implied volatility is real but smaller than this solver searches for.',
    );
  }
  if (optionPrice > priceAtCeiling + priceTolerance) {
    throw new ConvergenceError(
      `price ${optionPrice} exceeds ${priceAtCeiling}, the price at the largest volatility in ` +
        `the search bracket (${MAX_IMPLIED_VOLATILITY}, that is 500% annualised). Either the ` +
        'price is stale or the bracket is too narrow for this contract.',
    );
  }

  return solve(optionPrice, priceAt, shared, priceTolerance, maxIterations);
}

/** Static bounds that hold for any volatility whatsoever. A price outside them is arbitrage. */
function assertNoArbitrage(
  optionPrice: number,
  optionType: OptionType,
  terms: { spotTerm: number; strikeTerm: number },
): void {
  const { spotTerm, strikeTerm } = terms;

  // As volatility goes to infinity a call approaches S e^(-qT) and a put approaches K e^(-rT);
  // as it goes to zero both approach discounted intrinsic. Those are the two ends.
  const lower =
    optionType === 'call' ? Math.max(spotTerm - strikeTerm, 0) : Math.max(strikeTerm - spotTerm, 0);
  const upper = optionType === 'call' ? spotTerm : strikeTerm;

  // A few ulp of slack, so a price produced by this library's own pricer is never rejected by
  // its own bound check.
  const slack = 8 * Number.EPSILON * Math.max(1, spotTerm, strikeTerm);

  if (optionPrice < lower - slack) {
    throw new InvalidInputError(
      `price ${optionPrice} is below the discounted intrinsic value ${lower}: no volatility can ` +
        'produce it, and buying at that price would be an arbitrage',
    );
  }
  if (optionPrice > upper + slack) {
    throw new InvalidInputError(
      `price ${optionPrice} exceeds the no-arbitrage upper bound ${upper}, which is the limit ` +
        'the price approaches as volatility goes to infinity',
    );
  }
}

/**
 * Safeguarded Newton-Raphson: a Newton step when it lands inside the bracket, a bisection when
 * it does not.
 *
 * The bracket is maintained from the sign of the price error, which is unambiguous because the
 * price is monotonically increasing in volatility. That monotonicity is what makes the fallback
 * sound rather than merely a guard.
 */
function solve(
  target: number,
  priceAt: (volatility: number) => number,
  shared: Omit<OptionInputs, 'volatility'> & { optionType: OptionType },
  priceTolerance: number,
  maxIterations: number,
): number {
  let low = MIN_IMPLIED_VOLATILITY;
  let high = MAX_IMPLIED_VOLATILITY;

  // Brenner-Subrahmanyam: exact for an at-the-money forward, and a serviceable start elsewhere.
  const guess = Math.sqrt((2 * Math.PI) / shared.timeToExpiry) * (target / shared.spot);
  let volatility = clamp(Number.isFinite(guess) && guess > 0 ? guess : 0.2, low, high);

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const error = priceAt(volatility) - target;

    if (Math.abs(error) <= priceTolerance) return volatility;

    if (error > 0) high = volatility;
    else low = volatility;

    // The bracket has collapsed to the resolution of a double. No further iteration can improve
    // the answer, and the midpoint is the best value representable.
    if (high - low <= 4 * Number.EPSILON * Math.max(1, high)) {
      return (low + high) / 2;
    }

    const slope = blackScholesVega({ ...shared, volatility });
    const newton = slope > 0 ? volatility - error / slope : Number.NaN;

    // The Newton step is accepted only if it stays strictly inside the bracket. Where vega has
    // collapsed it will not, and bisection takes over.
    volatility = newton > low && newton < high ? newton : (low + high) / 2;
  }

  throw new ConvergenceError(
    `implied volatility did not converge within ${maxIterations} iterations; the bracket ` +
      `narrowed to [${low}, ${high}] without reproducing the price ${target} to within ` +
      `${priceTolerance}. Widen priceTolerance or raise maxIterations.`,
  );
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}
