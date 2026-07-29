import { describe, expect, it } from 'vitest';
import {
  probabilityAboveUnderQ,
  probabilityBelowUnderQ,
  probabilityItmUnderQ,
  probabilityOfProfitUnderQ,
} from '../src/risk/probability.js';
import { historicalVar, parametricVar } from '../src/risk/var.js';
import { historicalCvar, historicalLossQuantile, parametricCvar } from '../src/risk/cvar.js';
import { fractionalKelly, kellyFraction } from '../src/risk/kelly.js';
import { bsCall, bsPut, d1d2 } from '../src/pricing/blackScholes.js';
import { inverseNormalCdf, normalCdf } from '../src/utils/normal.js';
import { InvalidInputError } from '../src/utils/validate.js';
import type { OptionInputs } from '../src/utils/types.js';

const base: OptionInputs = {
  spot: 100,
  strike: 100,
  timeToExpiry: 1,
  riskFreeRate: 0.05,
  volatility: 0.25,
  dividendYield: 0.01,
};

describe('probabilities under Q', () => {
  it('reproduces N(d2) exactly for a call at the strike', () => {
    // The definition, not an approximation: probabilityItmUnderQ on a call IS N(d2).
    expect(probabilityItmUnderQ({ ...base, optionType: 'call' })).toBe(normalCdf(d1d2(base).d2));
  });

  it('gives a put the complement of the call', () => {
    const call = probabilityItmUnderQ({ ...base, optionType: 'call' });
    const put = probabilityItmUnderQ({ ...base, optionType: 'put' });
    expect(call + put).toBeCloseTo(1, 14);
  });

  it('has above and below sum to one', () => {
    for (const level of [50, 100, 250]) {
      const above = probabilityAboveUnderQ({ ...base, level });
      const below = probabilityBelowUnderQ({ ...base, level });
      expect(above + below).toBeCloseTo(1, 14);
    }
  });

  it('falls monotonically as the level rises', () => {
    let previous = probabilityAboveUnderQ({ ...base, level: 10 });
    for (let level = 20; level <= 400; level += 10) {
      const current = probabilityAboveUnderQ({ ...base, level });
      expect(current).toBeLessThanOrEqual(previous);
      previous = current;
    }
  });

  it('stays inside [0, 1] across the domain', () => {
    for (const spot of [1, 100, 10_000]) {
      for (const volatility of [0.001, 1, 5]) {
        const p = probabilityAboveUnderQ({ ...base, spot, volatility, level: 100 });
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      }
    }
  });

  it('collapses to a certainty when there is no randomness left', () => {
    for (const degenerate of [
      { ...base, timeToExpiry: 0 },
      { ...base, volatility: 0 },
    ]) {
      expect(probabilityAboveUnderQ({ ...degenerate, level: 1 })).toBe(1);
      expect(probabilityAboveUnderQ({ ...degenerate, level: 10_000 })).toBe(0);
      expect(probabilityBelowUnderQ({ ...degenerate, level: 10_000 })).toBe(1);
      expect(probabilityBelowUnderQ({ ...degenerate, level: 1 })).toBe(0);
    }
  });

  it('is zero on both sides when a deterministic price lands exactly on the level', () => {
    // Regression. Computing "below" as `1 - above` turns the strict inequality into a
    // certainty at the boundary: an expiring at-the-money put reported a probability of 1 of
    // finishing in the money while bsPut priced it at 0.
    const atExpiry = { ...base, timeToExpiry: 0, spot: 100, strike: 100 };

    expect(probabilityAboveUnderQ({ ...atExpiry, level: 100 })).toBe(0);
    expect(probabilityBelowUnderQ({ ...atExpiry, level: 100 })).toBe(0);
    expect(probabilityItmUnderQ({ ...atExpiry, optionType: 'put' })).toBe(0);
    expect(probabilityItmUnderQ({ ...atExpiry, optionType: 'call' })).toBe(0);
    expect(bsPut(atExpiry)).toBe(0);

    // Same boundary reached the other way: zero volatility with the forward exactly on strike.
    const forwardOnStrike = { ...base, volatility: 0, riskFreeRate: 0.05, dividendYield: 0.05 };
    expect(probabilityItmUnderQ({ ...forwardOnStrike, optionType: 'put' })).toBe(0);
  });

  it('keeps relative accuracy in the lower tail instead of subtracting from one', () => {
    // Regression. `1 - N(d2)` returns a hard 0 where `N(-d2)` is a perfectly representable
    // number, throwing away the tail accuracy the normal CDF was built to provide.
    const deep = {
      spot: 100,
      timeToExpiry: 0.25,
      riskFreeRate: 0.05,
      volatility: 0.1,
      dividendYield: 0.005,
    };

    for (const strike of [70, 65, 60]) {
      const inputs = { ...deep, strike };
      const expected = normalCdf(-d1d2(inputs).d2);
      const actual = probabilityItmUnderQ({ ...inputs, optionType: 'put' });

      expect(expected).toBeGreaterThan(0);
      expect(actual, `strike ${strike}`).toBe(expected);
    }

    // The value at strike 60 is 1.04e-25 — a complement would have reported exactly 0.
    expect(probabilityItmUnderQ({ ...deep, strike: 60, optionType: 'put' })).toBeGreaterThan(0);
    expect(probabilityBelowUnderQ({ ...deep, strike: 100, level: 60 })).toBeGreaterThan(0);
  });

  it('puts break-even beyond the strike for a long call', () => {
    const premium = bsCall(base);
    const atStrike = probabilityItmUnderQ({ ...base, optionType: 'call' });
    const atBreakEven = probabilityOfProfitUnderQ({ ...base, optionType: 'call', premium });

    // Profit requires finishing further out than merely in the money.
    expect(atBreakEven).toBeLessThan(atStrike);
    expect(atBreakEven).toBeGreaterThan(0);
  });

  it('puts break-even below the strike for a long put', () => {
    const premium = bsPut(base);
    const atStrike = probabilityItmUnderQ({ ...base, optionType: 'put' });
    const atBreakEven = probabilityOfProfitUnderQ({ ...base, optionType: 'put', premium });

    expect(atBreakEven).toBeLessThan(atStrike);
  });

  it('reduces to the in-the-money probability when the premium is zero', () => {
    for (const optionType of ['call', 'put'] as const) {
      expect(probabilityOfProfitUnderQ({ ...base, optionType, premium: 0 })).toBeCloseTo(
        probabilityItmUnderQ({ ...base, optionType }),
        14,
      );
    }
  });

  it('reports zero profit probability for a put whose break-even is not positive', () => {
    expect(probabilityOfProfitUnderQ({ ...base, strike: 10, optionType: 'put', premium: 20 })).toBe(
      0,
    );
  });

  it('rejects malformed inputs', () => {
    expect(() => probabilityAboveUnderQ({ ...base, level: 0 })).toThrow(/level/);
    expect(() => probabilityAboveUnderQ({ ...base, level: -5 })).toThrow(/level/);
    // @ts-expect-error deliberately passing a value the type system forbids
    expect(() => probabilityItmUnderQ({ ...base, optionType: 'binary' })).toThrow(
      InvalidInputError,
    );
    expect(() => probabilityOfProfitUnderQ({ ...base, optionType: 'call', premium: -1 })).toThrow(
      /premium/,
    );
    expect(() =>
      // @ts-expect-error deliberately passing a value the type system forbids
      probabilityOfProfitUnderQ({ ...base, optionType: 'digital', premium: 1 }),
    ).toThrow(InvalidInputError);
  });
});

describe('Value at Risk', () => {
  const returns = [-0.05, 0.02, -0.03, 0.01, -0.01, 0.04, -0.02, 0.03, 0.0, -0.04];

  it('reports losses as positive numbers', () => {
    const var95 = historicalVar({ returns, confidenceLevel: 0.95 });
    expect(var95).toBeGreaterThan(0);
  });

  it('matches a hand-computed empirical quantile', () => {
    // Losses ascending: -0.04 -0.03 -0.02 -0.01 0 0.01 0.02 0.03 0.04 0.05
    // Linear interpolation at 0.95 of 9 intervals -> position 8.55 -> 0.04 + 0.55*(0.05-0.04)
    expect(historicalVar({ returns, confidenceLevel: 0.95 })).toBeCloseTo(0.0455, 12);
  });

  it('rises with the confidence level', () => {
    let previous = historicalVar({ returns, confidenceLevel: 0.5 });
    for (const confidenceLevel of [0.6, 0.7, 0.8, 0.9, 0.95, 0.99]) {
      const current = historicalVar({ returns, confidenceLevel });
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });

  it('matches the closed form for the parametric case', () => {
    // z(0.95) = 1.6448536269514726; VaR = -mean + sigma * z
    expect(
      parametricVar({ mean: 0.001, standardDeviation: 0.02, confidenceLevel: 0.95 }),
    ).toBeCloseTo(-0.001 + 0.02 * 1.6448536269514726, 15);
  });

  it('is exactly the negative mean when there is no dispersion', () => {
    expect(parametricVar({ mean: 0.01, standardDeviation: 0, confidenceLevel: 0.99 })).toBeCloseTo(
      -0.01,
      15,
    );
  });

  it('agrees between the two methods on a large normal sample', () => {
    // A deterministic, evenly spaced normal sample: the empirical quantile of a normal sample
    // must land on the parametric one.
    const n = 20_001;
    const sample: number[] = [];
    for (let i = 1; i < n; i += 1) {
      // Inverse-transform an even grid of probabilities, giving an exact normal order statistic.
      sample.push(0.001 + 0.02 * inverseNormalCdf(i / n));
    }

    const historical = historicalVar({ returns: sample, confidenceLevel: 0.95 });
    const parametric = parametricVar({
      mean: 0.001,
      standardDeviation: 0.02,
      confidenceLevel: 0.95,
    });

    expect(historical).toBeCloseTo(parametric, 4);
  });

  it('handles a single observation, where there is no interval to interpolate across', () => {
    // One observation is the whole distribution as far as the empirical estimator knows.
    for (const confidenceLevel of [0.01, 0.5, 0.99]) {
      expect(historicalVar({ returns: [-0.04], confidenceLevel })).toBeCloseTo(0.04, 15);
      expect(historicalCvar({ returns: [-0.04], confidenceLevel })).toBeCloseTo(0.04, 15);
    }
    expect(historicalVar({ returns: [0.02], confidenceLevel: 0.95 })).toBeCloseTo(-0.02, 15);
  });

  it('never reports a loss of negative zero', () => {
    // Regression. Negating a flat return produced -0, which compares unequal to 0 under
    // Object.is and would survive into any aggregation across positions.
    expect(Object.is(historicalVar({ returns: [0, 0, 0], confidenceLevel: 0.95 }), 0)).toBe(true);
    // Interpolating between two flat periods must not reconstruct the negative zero either.
    expect(Object.is(historicalVar({ returns: [0, 0, 0.01], confidenceLevel: 0.95 }), 0)).toBe(
      true,
    );
  });

  it('rejects malformed inputs', () => {
    expect(() => historicalVar({ returns: [], confidenceLevel: 0.95 })).toThrow(/returns/);
    expect(() => historicalVar({ returns: [Number.NaN], confidenceLevel: 0.95 })).toThrow(
      /returns\[0\]/,
    );
    expect(() => historicalVar({ returns, confidenceLevel: 0 })).toThrow(/confidenceLevel/);
    expect(() => historicalVar({ returns, confidenceLevel: 1 })).toThrow(/confidenceLevel/);
    expect(() => parametricVar({ mean: 0, standardDeviation: -1, confidenceLevel: 0.95 })).toThrow(
      /standardDeviation/,
    );
  });
});

describe('Conditional Value at Risk', () => {
  const returns = [-0.05, 0.02, -0.03, 0.01, -0.01, 0.04, -0.02, 0.03, 0.0, -0.04];

  it('is never smaller than the VaR at the same confidence level', () => {
    for (const confidenceLevel of [0.5, 0.75, 0.9, 0.95, 0.99]) {
      const var_ = historicalVar({ returns, confidenceLevel });
      const cvar = historicalCvar({ returns, confidenceLevel });
      expect(cvar).toBeGreaterThanOrEqual(var_ - 1e-12);
    }

    for (const confidenceLevel of [0.5, 0.9, 0.99]) {
      const inputs = { mean: 0.001, standardDeviation: 0.02, confidenceLevel };
      expect(parametricCvar(inputs)).toBeGreaterThan(parametricVar(inputs));
    }
  });

  it('averages the worst losses in the historical case', () => {
    // At 90% on 10 observations the tail is the single worst loss, 0.05.
    expect(historicalCvar({ returns, confidenceLevel: 0.9 })).toBeCloseTo(0.05, 15);
    // At 80% the tail is the worst two: (0.05 + 0.04) / 2.
    expect(historicalCvar({ returns, confidenceLevel: 0.8 })).toBeCloseTo(0.045, 15);
  });

  it('matches the closed form for the parametric case', () => {
    const mean = 0.001;
    const standardDeviation = 0.02;
    const confidenceLevel = 0.975;
    const z = 1.9599639845400543;
    const density = Math.exp((-z * z) / 2) / Math.sqrt(2 * Math.PI);

    expect(parametricCvar({ mean, standardDeviation, confidenceLevel })).toBeCloseTo(
      -mean + (standardDeviation * density) / (1 - confidenceLevel),
      14,
    );
  });

  it('exposes the loss quantile it averages beyond', () => {
    expect(historicalLossQuantile(returns, 0.95)).toBeCloseTo(
      historicalVar({ returns, confidenceLevel: 0.95 }),
      15,
    );
  });

  it('rejects malformed inputs', () => {
    expect(() => historicalCvar({ returns: [], confidenceLevel: 0.95 })).toThrow(/returns/);
    expect(() => parametricCvar({ mean: 0, standardDeviation: -1, confidenceLevel: 0.95 })).toThrow(
      /standardDeviation/,
    );
  });
});

describe('Kelly', () => {
  it('matches the classic formula on an even-money bet', () => {
    // f* = (b p - q) / b with b = 1, p = 0.6 -> 0.2
    expect(kellyFraction({ winProbability: 0.6, winPayoff: 1 })).toBeCloseTo(0.2, 15);
  });

  it('matches the classic formula at 2:1 odds', () => {
    // b = 2, p = 0.4 -> (2*0.4 - 0.6) / 2 = 0.1
    expect(kellyFraction({ winProbability: 0.4, winPayoff: 2 })).toBeCloseTo(0.1, 15);
  });

  it('is zero at a fair bet', () => {
    expect(kellyFraction({ winProbability: 0.5, winPayoff: 1 })).toBeCloseTo(0, 15);
  });

  it('goes negative when the edge is negative, rather than clamping', () => {
    // The size of the disadvantage stays visible instead of being hidden behind a 0.
    expect(kellyFraction({ winProbability: 0.4, winPayoff: 1 })).toBeLessThan(0);
  });

  it('handles a bet that does not lose the whole stake', () => {
    // p / lossFraction - (1 - p) / winPayoff, with p = 0.5, loss 0.5, win 1 -> 1 - 0.5 = 0.5
    expect(kellyFraction({ winProbability: 0.5, winPayoff: 1, lossFraction: 0.5 })).toBeCloseTo(
      0.5,
      15,
    );
  });

  it('scales linearly for fractional Kelly', () => {
    const full = kellyFraction({ winProbability: 0.6, winPayoff: 1 });
    expect(fractionalKelly(full, 0.5)).toBeCloseTo(full / 2, 15);
    expect(fractionalKelly(full, 0.25)).toBeCloseTo(full / 4, 15);
    expect(fractionalKelly(full, 1)).toBe(full);
  });

  it('refuses to size above full Kelly', () => {
    expect(() => fractionalKelly(0.2, 1.5)).toThrow(/must not exceed 1/);
    expect(() => fractionalKelly(0.2, 0)).toThrow(/fraction/);
  });

  it('rejects malformed inputs', () => {
    expect(() => kellyFraction({ winProbability: 0, winPayoff: 1 })).toThrow(/winProbability/);
    expect(() => kellyFraction({ winProbability: 1, winPayoff: 1 })).toThrow(/winProbability/);
    expect(() => kellyFraction({ winProbability: 0.5, winPayoff: 0 })).toThrow(/winPayoff/);
    expect(() => kellyFraction({ winProbability: 0.5, winPayoff: 1, lossFraction: 1.5 })).toThrow(
      /lossFraction/,
    );
  });
});
