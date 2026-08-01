import type { OptionInputs } from './types.js';

/**
 * Thrown when an input cannot produce a meaningful result.
 *
 * Every failure in this library is an explicit error carrying the offending value. Returning
 * `NaN` would let a wrong number travel silently through a position calculation and surface as a
 * risk figure nobody can trace back.
 *
 * The guarantee that follows from this is bounded by the documented input domain, and stating it
 * unqualified was itself a defect. Inside that domain no function returns `NaN` or `Infinity`,
 * and a property test enforces it. Outside, two simultaneous extremes can still produce both —
 * `gamma` is `phi(d1) / (S sigma sqrt(T))`, which is `0/0` once the denominator underflows even
 * though `hasNoDispersion` is false, and theta's `sigma / (2 sqrt(T))` term overflows for a large
 * enough `sigma` at a small enough `T`. Neither is reachable by varying one input at a time. See
 * docs/MATH.md §9.
 */
export class InvalidInputError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidInputError';
  }
}

/** {@link OptionInputs} with every optional field resolved to a concrete number. */
export interface ResolvedOptionInputs {
  readonly spot: number;
  readonly strike: number;
  readonly timeToExpiry: number;
  readonly riskFreeRate: number;
  readonly volatility: number;
  readonly dividendYield: number;
}

/**
 * Replaces `-0` with `0`.
 *
 * `-0` compares unequal to `0` under `Object.is` and under `Map` and `Set` key identity, so it
 * survives into any aggregation across a position and shows up as a difference no arithmetic
 * explains. It appears wherever a leading minus sign meets a term that has underflowed to zero,
 * which in this library happens in the Greeks, in loss series and in parametric risk measures.
 *
 * This lives here, shared, rather than as a guard at each site where the hazard was noticed. It
 * was noticed three times — in `boundaryGreeks`, then in `historicalVar`, then in the analytic
 * Greeks branch and `parametricVar` — and each local fix left the others standing. One function,
 * applied at every numeric exit, is the only version of this that stays fixed.
 */
export function withoutNegativeZero(value: number): number {
  return value === 0 ? 0 : value;
}

/**
 * True when the contract has no dispersion left, so every closed form degenerates.
 *
 * The test is on `sigma sqrt(T)` — the standard deviation of the log price over the life of the
 * contract — and not on `volatility === 0 || timeToExpiry === 0` separately. Those two cover most
 * of it but miss the case where both are positive and their product underflows: at
 * `volatility = 5e-324` with `timeToExpiry = 0.25` the deviation rounds to 0, and `d1` becomes
 * `0 / 0 = NaN`, which then propagates into every price and Greek. Underflow is not a separate
 * case from zero; it is the same case reached by arithmetic rather than by input.
 */
export function hasNoDispersion(inputs: {
  readonly volatility: number;
  readonly timeToExpiry: number;
}): boolean {
  return inputs.volatility * Math.sqrt(inputs.timeToExpiry) === 0;
}

/** Asserts that a value is a finite number, naming it in the error. */
export function assertFinite(name: string, value: number): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new InvalidInputError(`${name} must be a finite number, received ${String(value)}`);
  }
}

/** Asserts that a value is finite and strictly greater than zero. */
export function assertPositive(name: string, value: number): void {
  assertFinite(name, value);
  if (value <= 0) {
    throw new InvalidInputError(`${name} must be greater than 0, received ${value}`);
  }
}

/** Asserts that a value is finite and not negative. */
export function assertNonNegative(name: string, value: number): void {
  assertFinite(name, value);
  if (value < 0) {
    throw new InvalidInputError(`${name} must not be negative, received ${value}`);
  }
}

/**
 * Validates a set of option inputs and resolves the optional dividend yield to 0.
 *
 * The rate is deliberately allowed to be negative — negative policy rates are real, and
 * rejecting them would make the library wrong about the market rather than safe.
 *
 * @throws InvalidInputError if any input is outside its permitted range.
 */
export function resolveOptionInputs(inputs: OptionInputs): ResolvedOptionInputs {
  assertPositive('spot', inputs.spot);
  assertPositive('strike', inputs.strike);
  assertNonNegative('timeToExpiry', inputs.timeToExpiry);
  assertFinite('riskFreeRate', inputs.riskFreeRate);
  assertNonNegative('volatility', inputs.volatility);

  const dividendYield = inputs.dividendYield ?? 0;
  assertFinite('dividendYield', dividendYield);

  return {
    spot: inputs.spot,
    strike: inputs.strike,
    timeToExpiry: inputs.timeToExpiry,
    riskFreeRate: inputs.riskFreeRate,
    volatility: inputs.volatility,
    dividendYield,
  };
}
