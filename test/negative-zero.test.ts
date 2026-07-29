import { describe, expect, it } from 'vitest';
import {
  bsCall,
  bsPrice,
  bsPut,
  callGreeks,
  crrPrice,
  d1d2,
  delta,
  fractionalKelly,
  gamma,
  historicalCvar,
  historicalLossQuantile,
  historicalVar,
  impliedVolatility,
  inverseNormalCdf,
  kellyFraction,
  normalCdf,
  normalPdf,
  optionGreeks,
  parametricCvar,
  parametricVar,
  probabilityAboveUnderQ,
  probabilityBelowUnderQ,
  probabilityItmUnderQ,
  probabilityOfProfitUnderQ,
  putGreeks,
  rho,
  rhoPerPercentagePoint,
  theta,
  thetaPerCalendarDay,
  thetaPerTradingDay,
  vega,
  vegaPerPercentagePoint,
} from '../src/index.js';
import type { OptionInputs } from '../src/index.js';

/**
 * ONE RULE, CHECKED EVERYWHERE: no public function returns `-0`.
 *
 * `-0` compares unequal to `0` under `Object.is` and under `Map`/`Set` key identity, so it
 * survives into any aggregation across a position and surfaces as a difference that no arithmetic
 * explains. It arises wherever a leading minus sign meets a term that has underflowed to zero.
 *
 * This file exists because the hazard was found twice. The first time it was fixed in
 * `boundaryGreeks` alone; the analytic branch of the same file kept returning `-0` for a deep
 * out-of-the-money put, and `historicalVar` kept returning it for a flat return series. Fixing an
 * instance does not fix the class. A single exhaustive sweep does.
 *
 * If a new public function is added, add it here.
 */

/** Collects every numeric field of a value, whatever its shape. */
function numbersIn(label: string, value: unknown): Array<[string, number]> {
  if (typeof value === 'number') return [[label, value]];
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, inner]) => numbersIn(`${label}.${key}`, inner));
  }
  return [];
}

/** Runs a call, collecting its numbers. Calls that throw are the documented failure path. */
function outcomesOf(label: string, call: () => unknown): Array<[string, number]> {
  try {
    return numbersIn(label, call());
  } catch {
    return [];
  }
}

function expectNoNegativeZero(outcomes: Array<[string, number]>): void {
  for (const [label, value] of outcomes) {
    expect(Object.is(value, -0), `${label} returned -0`).toBe(false);
  }
}

/** Inputs chosen to drive terms to underflow, which is where the sign survives. */
const contracts: ReadonlyArray<OptionInputs> = [
  { spot: 100, strike: 100, timeToExpiry: 1, riskFreeRate: 0.05, volatility: 0.2 },
  // Deep out of the money on each side: normalCdf of the far tail underflows to 0.
  { spot: 10_000, strike: 1, timeToExpiry: 1, riskFreeRate: 0.05, volatility: 0.2 },
  { spot: 1, strike: 10_000, timeToExpiry: 1, riskFreeRate: 0.05, volatility: 0.2 },
  { spot: 10_000, strike: 1, timeToExpiry: 10, riskFreeRate: 0.25, volatility: 0.001 },
  { spot: 1, strike: 10_000, timeToExpiry: 1 / 365, riskFreeRate: -0.02, volatility: 0.001 },
  // Every rate and yield at zero, so each term that carries a sign is itself zero.
  { spot: 100, strike: 100, timeToExpiry: 1, riskFreeRate: 0, volatility: 0.2, dividendYield: 0 },
  { spot: 100, strike: 200, timeToExpiry: 1, riskFreeRate: 0, volatility: 0.001 },
  // The boundary: no time left, and no volatility.
  { spot: 100, strike: 100, timeToExpiry: 0, riskFreeRate: 0.05, volatility: 0.2 },
  { spot: 80, strike: 100, timeToExpiry: 0, riskFreeRate: 0.05, volatility: 0.2 },
  { spot: 120, strike: 100, timeToExpiry: 0, riskFreeRate: 0.05, volatility: 0.2 },
  { spot: 100, strike: 100, timeToExpiry: 1, riskFreeRate: 0.05, volatility: 0 },
  { spot: 100, strike: 100, timeToExpiry: 1, riskFreeRate: 0, volatility: 0, dividendYield: 0 },
];

describe('no public function returns -0', () => {
  it('holds for the distribution functions', () => {
    const outcomes: Array<[string, number]> = [];
    for (const x of [0, -0, 1e-320, -1e-320, 1, -1, 8, -8, 37, -37, 40, -40]) {
      outcomes.push(...outcomesOf(`normalPdf(${x})`, () => normalPdf(x)));
      outcomes.push(...outcomesOf(`normalCdf(${x})`, () => normalCdf(x)));
    }
    for (const p of [1e-300, 0.001, 0.5, 0.999, 1 - 1e-15]) {
      outcomes.push(...outcomesOf(`inverseNormalCdf(${p})`, () => inverseNormalCdf(p)));
    }
    expectNoNegativeZero(outcomes);
  });

  it('holds for pricing, Greeks and scaling', () => {
    const outcomes: Array<[string, number]> = [];

    for (const inputs of contracts) {
      const tag = `S=${inputs.spot} K=${inputs.strike} T=${inputs.timeToExpiry} sigma=${inputs.volatility}`;

      outcomes.push(...outcomesOf(`bsCall ${tag}`, () => bsCall(inputs)));
      outcomes.push(...outcomesOf(`bsPut ${tag}`, () => bsPut(inputs)));
      outcomes.push(...outcomesOf(`d1d2 ${tag}`, () => d1d2(inputs)));

      for (const optionType of ['call', 'put'] as const) {
        outcomes.push(
          ...outcomesOf(`bsPrice ${optionType} ${tag}`, () => bsPrice({ ...inputs, optionType })),
        );
        outcomes.push(
          ...outcomesOf(`optionGreeks ${optionType} ${tag}`, () =>
            optionGreeks({ ...inputs, optionType }),
          ),
        );
        outcomes.push(
          ...outcomesOf(`delta ${optionType} ${tag}`, () => delta({ ...inputs, optionType })),
        );
        outcomes.push(
          ...outcomesOf(`theta ${optionType} ${tag}`, () => theta({ ...inputs, optionType })),
        );
        outcomes.push(
          ...outcomesOf(`rho ${optionType} ${tag}`, () => rho({ ...inputs, optionType })),
        );

        for (const exerciseStyle of ['european', 'american'] as const) {
          outcomes.push(
            ...outcomesOf(`crrPrice ${optionType} ${exerciseStyle} ${tag}`, () =>
              crrPrice({ ...inputs, optionType, exerciseStyle, steps: 50 }),
            ),
          );
        }
      }

      outcomes.push(...outcomesOf(`callGreeks ${tag}`, () => callGreeks(inputs)));
      outcomes.push(...outcomesOf(`putGreeks ${tag}`, () => putGreeks(inputs)));
      outcomes.push(...outcomesOf(`gamma ${tag}`, () => gamma(inputs)));
      outcomes.push(...outcomesOf(`vega ${tag}`, () => vega(inputs)));

      // The scaling helpers are pure divisions, so they can only produce -0 by being handed one.
      // Feeding them the core's own output is the pipeline that matters.
      for (const source of [callGreeks, putGreeks]) {
        let greeks;
        try {
          greeks = source(inputs);
        } catch {
          continue;
        }
        outcomes.push(
          ...outcomesOf(`vegaPerPercentagePoint ${tag}`, () => vegaPerPercentagePoint(greeks.vega)),
        );
        outcomes.push(
          ...outcomesOf(`thetaPerCalendarDay ${tag}`, () => thetaPerCalendarDay(greeks.theta)),
        );
        outcomes.push(
          ...outcomesOf(`thetaPerTradingDay ${tag}`, () => thetaPerTradingDay(greeks.theta)),
        );
        outcomes.push(
          ...outcomesOf(`rhoPerPercentagePoint ${tag}`, () => rhoPerPercentagePoint(greeks.rho)),
        );
      }
    }

    expect(outcomes.length).toBeGreaterThan(200);
    expectNoNegativeZero(outcomes);
  });

  it('holds for implied volatility', () => {
    const outcomes: Array<[string, number]> = [];
    for (const inputs of contracts) {
      if (inputs.timeToExpiry === 0) continue;
      for (const optionType of ['call', 'put'] as const) {
        const price = bsPrice({ ...inputs, optionType });
        outcomes.push(
          ...outcomesOf(`impliedVolatility ${optionType}`, () =>
            impliedVolatility({ ...inputs, optionPrice: price, optionType }),
          ),
        );
      }
    }
    expectNoNegativeZero(outcomes);
  });

  it('holds for the risk module', () => {
    const outcomes: Array<[string, number]> = [];

    for (const inputs of contracts) {
      for (const optionType of ['call', 'put'] as const) {
        outcomes.push(
          ...outcomesOf('probabilityItmUnderQ', () =>
            probabilityItmUnderQ({ ...inputs, optionType }),
          ),
        );
        outcomes.push(
          ...outcomesOf('probabilityOfProfitUnderQ', () =>
            probabilityOfProfitUnderQ({ ...inputs, optionType, premium: 0 }),
          ),
        );
      }
      for (const level of [1, 100, 10_000]) {
        outcomes.push(
          ...outcomesOf('probabilityAboveUnderQ', () =>
            probabilityAboveUnderQ({ ...inputs, level }),
          ),
        );
        outcomes.push(
          ...outcomesOf('probabilityBelowUnderQ', () =>
            probabilityBelowUnderQ({ ...inputs, level }),
          ),
        );
      }
    }

    // Flat and all-positive return series are where a negated zero appears.
    const series: ReadonlyArray<readonly number[]> = [
      [0, 0, 0],
      [0, 0, 0.01],
      [0.01, 0.02, 0.03],
      [0, -0, 0.01, -0.01],
      [-0.05, 0.02, -0.03, 0.01, 0],
    ];
    for (const returns of series) {
      for (const confidenceLevel of [0.5, 0.9, 0.95, 0.99]) {
        outcomes.push(
          ...outcomesOf('historicalVar', () => historicalVar({ returns, confidenceLevel })),
        );
        outcomes.push(
          ...outcomesOf('historicalCvar', () => historicalCvar({ returns, confidenceLevel })),
        );
        outcomes.push(
          ...outcomesOf('historicalLossQuantile', () =>
            historicalLossQuantile(returns, confidenceLevel),
          ),
        );
      }
    }

    for (const mean of [0, -0, 0.001, -0.001]) {
      for (const standardDeviation of [0, 0.02]) {
        for (const confidenceLevel of [0.5, 0.95]) {
          const args = { mean, standardDeviation, confidenceLevel };
          outcomes.push(...outcomesOf('parametricVar', () => parametricVar(args)));
          outcomes.push(...outcomesOf('parametricCvar', () => parametricCvar(args)));
        }
      }
    }

    for (const winProbability of [0.5, 0.6, 0.4]) {
      const full = kellyFraction({ winProbability, winPayoff: 1 });
      outcomes.push(...outcomesOf('kellyFraction', () => full));
      outcomes.push(...outcomesOf('fractionalKelly', () => fractionalKelly(full, 0.5)));
    }

    expectNoNegativeZero(outcomes);
  });

  it('catches a -0 when one is present, so the sweep is not vacuous', () => {
    // Guards the guard: if `numbersIn` or `expectNoNegativeZero` stopped working, every test
    // above would pass silently.
    const outcomes = numbersIn('deliberate', { a: -0, b: 1 });
    expect(outcomes).toContainEqual(['deliberate.a', -0]);
    expect(() => expectNoNegativeZero(outcomes)).toThrow();
  });
});
