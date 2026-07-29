import type { OptionInputs } from './types.js';

/**
 * Thrown when an input cannot produce a meaningful result.
 *
 * Every failure in this library is an explicit error carrying the offending value. Returning
 * `NaN` would let a wrong number travel silently through a position calculation and surface as a
 * risk figure nobody can trace back.
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
