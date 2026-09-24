import { describe, expect, it } from 'vitest';
import {
  probabilityAboveUnderQ,
  probabilityBelowUnderQ,
  probabilityItmUnderQ,
  breakEvenProbabilityUnderQ,
} from '../src/risk/probability.js';
import { historicalVar, parametricVar } from '../src/risk/var.js';
import { historicalCvar, parametricCvar } from '../src/risk/cvar.js';
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

    // The value at strike 60 is 2.97e-25, where d2 is 10.32 — a complement reports exactly 0.
    expect(probabilityItmUnderQ({ ...deep, strike: 60, optionType: 'put' })).toBeGreaterThan(0);
    expect(probabilityBelowUnderQ({ ...deep, strike: 100, level: 60 })).toBeGreaterThan(0);
  });

  it('puts break-even beyond the strike for a long call', () => {
    const premium = bsCall(base);
    const atStrike = probabilityItmUnderQ({ ...base, optionType: 'call' });
    const atBreakEven = breakEvenProbabilityUnderQ({ ...base, optionType: 'call', premium });

    // Profit requires finishing further out than merely in the money.
    expect(atBreakEven).toBeLessThan(atStrike);
    expect(atBreakEven).toBeGreaterThan(0);
  });

  it('puts break-even below the strike for a long put', () => {
    const premium = bsPut(base);
    const atStrike = probabilityItmUnderQ({ ...base, optionType: 'put' });
    const atBreakEven = breakEvenProbabilityUnderQ({ ...base, optionType: 'put', premium });

    expect(atBreakEven).toBeLessThan(atStrike);
  });

  it('reduces to the in-the-money probability when the premium is zero', () => {
    for (const optionType of ['call', 'put'] as const) {
      expect(breakEvenProbabilityUnderQ({ ...base, optionType, premium: 0 })).toBeCloseTo(
        probabilityItmUnderQ({ ...base, optionType }),
        14,
      );
    }
  });

  it('reports zero profit probability for a put whose break-even is not positive', () => {
    expect(
      breakEvenProbabilityUnderQ({ ...base, strike: 10, optionType: 'put', premium: 20 }),
    ).toBe(0);
  });

  it('rejects malformed inputs', () => {
    expect(() => probabilityAboveUnderQ({ ...base, level: 0 })).toThrow(/level/);
    expect(() => probabilityAboveUnderQ({ ...base, level: -5 })).toThrow(/level/);
    // @ts-expect-error deliberately passing a value the type system forbids
    expect(() => probabilityItmUnderQ({ ...base, optionType: 'binary' })).toThrow(
      InvalidInputError,
    );
    expect(() => breakEvenProbabilityUnderQ({ ...base, optionType: 'call', premium: -1 })).toThrow(
      /premium/,
    );
    expect(() =>
      // @ts-expect-error deliberately passing a value the type system forbids
      breakEvenProbabilityUnderQ({ ...base, optionType: 'digital', premium: 1 }),
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

  it('is never smaller than the VaR across sample sizes and awkward confidence levels', () => {
    // The ordering holds in exact arithmetic, and VaR here interpolates (type 7) while CVaR weights
    // a fractional tail, so it is not true by construction. In floating point CVaR is a sum of up
    // to n rounded terms, so the slack is the recursive-summation bound, n + 2 roundings of the
    // largest loss — not a few ulps, and not absolute: a gap that passes at this sample's scale of
    // 0.1 would fail at 10. Swept over sizes 1 to 150 with a fat-tailed sample and confidence
    // levels that are not round numbers.
    let seed = 12345;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };

    let violations = 0;
    for (let n = 1; n <= 150; n += 1) {
      const sample = Array.from(
        { length: n },
        () => (random() - 0.5) * (random() < 0.1 ? 0.5 : 0.1),
      );

      const slack = (n + 2) * Number.EPSILON * Math.max(...sample.map(Math.abs));

      for (const confidenceLevel of [0.013, 0.333, 0.617, 0.9, 0.95, 0.975, 0.99, 0.9973]) {
        const var_ = historicalVar({ returns: sample, confidenceLevel });
        const cvar = historicalCvar({ returns: sample, confidenceLevel });
        if (cvar < var_ - slack) violations += 1;
      }
    }

    expect(violations).toBe(0);
  });

  it('stays finite and exact at the extremes of the double range', () => {
    // Summing the tail unscaled overflowed to -Infinity on two gains of 1e308. Weighting each loss
    // first fixed that one and still overflowed on three losses of Number.MAX_VALUE, where the
    // weights sum to a hair over 1 — 456 of the sizes from 1 to 1000 did. So every size is checked.
    expect(historicalCvar({ returns: [1e308, 1e308], confidenceLevel: 0.01 })).toBe(-1e308);
    expect(historicalCvar({ returns: [-1e308, -1e308], confidenceLevel: 0.01 })).toBe(1e308);
    for (let n = 1; n <= 1000; n += 1) {
      const worst = Array<number>(n).fill(-Number.MAX_VALUE);
      expect(historicalCvar({ returns: worst, confidenceLevel: 1e-300 })).toBe(Number.MAX_VALUE);
    }

    // Mixed signs at the top of the range are what the scaling is for. Unscaled, MAX + MAX is
    // Infinity before the -MAX is added, and holding the result to the tail's range then reports
    // MAX where the mean is MAX / 3 — a wrong number that the range check makes look plausible.
    const mixed = historicalCvar({
      returns: [-Number.MAX_VALUE, -Number.MAX_VALUE, Number.MAX_VALUE],
      confidenceLevel: 1e-300,
    });
    expect(mixed / (Number.MAX_VALUE / 3)).toBeCloseTo(1, 14);

    // And weighting each loss first divided a subnormal loss by the tail mass, which underflowed:
    // two losses of 5e-324 at a tail mass of 2 came back as 0.
    expect(historicalCvar({ returns: [-5e-324, -5e-324], confidenceLevel: 1e-300 })).toBe(5e-324);
    expect(historicalCvar({ returns: [5e-324, 5e-324, 5e-324, 0], confidenceLevel: 0.25 })).toBe(
      -5e-324,
    );

    // With a tail mass below one observation, `fraction * loss / tailMass` underflowed a subnormal
    // loss to 0. The single weight is `fraction / tailMass`, exactly 1, so the loss comes back as is.
    for (const loss of [5e-324, 1e-310, 1e-300]) {
      expect(historicalCvar({ returns: [-loss], confidenceLevel: 0.9999999999999999 })).toBe(loss);
    }
  });

  it('never reports a loss of negative zero', () => {
    // The losses are [0, 0, -5e-324] and the whole sample is the tail. In units of 5e-324 the sum
    // is -1, and -1/3 of 5e-324 rounds to -0 — so the guard at the exit is what stops it, and
    // removing the guard fails this. An earlier input, [5e-324, 0, 0] at 10%, looked like the
    // same test and could not fail: the +0 terms turned -0 back into +0 before it reached the exit.
    expect(Object.is(historicalCvar({ returns: [5e-324, 0, 0], confidenceLevel: 1e-300 }), 0)).toBe(
      true,
    );
  });

  it('averages the worst losses in the historical case', () => {
    // At 90% on 10 observations the tail is the single worst loss, 0.05.
    expect(historicalCvar({ returns, confidenceLevel: 0.9 })).toBeCloseTo(0.05, 15);
    // At 80% the tail is the worst two: (0.05 + 0.04) / 2.
    expect(historicalCvar({ returns, confidenceLevel: 0.8 })).toBeCloseTo(0.045, 15);
    // At 85% the tail mass is 1.5: the worst loss in full, the next at half weight.
    expect(historicalCvar({ returns, confidenceLevel: 0.85 })).toBeCloseTo(
      (0.05 + 0.5 * 0.04) / 1.5,
      15,
    );
    // And at 87% it is 1.3. The 1.5 above is the one point where rounding the tail mass to the
    // nearest whole number ties, so on its own it could not tell a fractional estimator from a
    // rounding one — which would give 0.05 here.
    expect(historicalCvar({ returns, confidenceLevel: 0.87 })).toBeCloseTo(
      (0.05 + 0.3 * 0.04) / 1.3,
      15,
    );
  });

  it('does not snap a tail mass that is genuinely off a whole number', () => {
    // A tail mass of 1.000001 is a real request, a million times further from 1 than rounding can
    // put it. The worst loss is 0 among gains of 1, so the snapped answer would be exactly 0; the
    // fractional one is minus a millionth.
    const returns = [0, ...Array<number>(9).fill(1)];
    const confidenceLevel = 0.8999999;
    const mass = (1 - confidenceLevel) * returns.length;
    expect(historicalCvar({ returns, confidenceLevel })).toBeCloseTo(-(mass - 1) / mass, 15);
    expect(historicalCvar({ returns, confidenceLevel })).toBeLessThan(-9e-7);

    // And one closer in: 1e-12 off, which is still about 200 times the snapping bound of
    // 2 n eps = 4.4e-15 at n = 10. A threshold of 1e-9, or 1e-6, would swallow it.
    const closer = 0.8999999999999;
    const closerMass = (1 - closer) * returns.length;
    expect(historicalCvar({ returns, confidenceLevel: closer })).toBeCloseTo(
      -(closerMass - 1) / closerMass,
      15,
    );
    expect(historicalCvar({ returns, confidenceLevel: closer })).toBeLessThan(-9e-13);
  });

  // Regression. The tail was `ceil((1 - c) n)`, and `1 - c` is not exact in binary: `1 - 0.95` is
  // 0.050000000000000044, so at n = 20 the product is 1.0000000000000009 and `ceil` averaged the
  // worst two losses. The test above sits at n = 10, c = 0.9, where the product rounds DOWN to
  // 0.9999999999999998 and `ceil` is right by luck — so these are the common sizes where it is not.
  it('averages exactly the worst k losses when (1 - c) n is k, at the sample sizes people use', () => {
    const cases = [
      { n: 20, confidenceLevel: 0.95, k: 1 },
      { n: 40, confidenceLevel: 0.975, k: 1 },
      { n: 100, confidenceLevel: 0.99, k: 1 },
      { n: 500, confidenceLevel: 0.99, k: 5 },
      { n: 1000, confidenceLevel: 0.99, k: 10 },
      { n: 1000, confidenceLevel: 0.975, k: 25 },
    ];

    for (const { n, confidenceLevel, k } of cases) {
      // Losses 1/n, 2/n, ..., 1 in a scrambled order, so the sort is exercised too.
      const scrambled = Array.from({ length: n }, (_, i) => -(((i * 7919) % n) + 1) / n);
      const worstK = Array.from({ length: k }, (_, i) => (n - i) / n);
      const expected = worstK.reduce((total, loss) => total + loss, 0) / k;

      expect(historicalCvar({ returns: scrambled, confidenceLevel })).toBeCloseTo(expected, 14);
    }
  });

  // The same property as a sweep, because six hand-picked sizes are six convenient points. Against
  // the `ceil` estimator this fails at 14 037 of the 79 800 pairs below — so it can see the defect.
  // The tolerance is summation rounding, measured at 21 eps at worst; the ceil defect is at least
  // 1/(2n), eleven orders larger.
  it('averages exactly the worst k losses for every n up to 400 and every k below it', () => {
    let failures = 0;

    for (let n = 2; n <= 400; n += 1) {
      const scrambled = Array.from({ length: n }, (_, i) => -(((i * 7919) % n) + 1) / n);

      for (let k = 1; k < n; k += 1) {
        const expected = (n - (k - 1) / 2) / n; // mean of n/n, (n-1)/n, ..., (n-k+1)/n
        const actual = historicalCvar({ returns: scrambled, confidenceLevel: 1 - k / n });
        if (Math.abs(actual - expected) > 64 * Number.EPSILON) failures += 1;
      }
    }

    expect(failures).toBe(0);
  }, 30_000);

  // The sweep above cannot see the snap to a whole tail mass: its losses are evenly spaced, so a
  // stray weight of 1e-15 on the next loss moves the mean by less than the summation rounding. Here
  // the worst k losses are exactly 0 and every other observation is a gain, so the answer is
  // exactly 0 and any leftover weight on a gain shows. Without the snap this fails at the same
  // 14 037 of 79 800 pairs as the ceil estimator — the excess is still there, only smaller.
  it('puts no weight outside the tail when (1 - c) n is meant as a whole number', () => {
    let failures = 0;

    for (let n = 2; n <= 400; n += 1) {
      for (let k = 1; k < n; k += 1) {
        const returns = [...Array<number>(k).fill(0), ...Array<number>(n - k).fill(1)];
        const actual = historicalCvar({ returns, confidenceLevel: 1 - k / n });
        if (!Object.is(actual, 0)) failures += 1;
      }
    }

    expect(failures).toBe(0);
  }, 30_000);

  it('is continuous in the confidence level, with no jump where the tail gains an observation', () => {
    // Worst loss 0.05, next 0.04. As the tail mass crosses 1, the ceil estimator jumped from 0.05
    // to 0.045. The fractional estimator is Lipschitz in c with constant n |L_(k+1) - CVaR| / m,
    // which is 0.1 here — and only above a tail mass of 1: below it the tail is the single worst
    // loss and does not move. So the step of 1e-9 on that side moves it by 1e-10. It is not bounded
    // by the step in general: on one loss of 1 among 999 zeros at c = 0.999 the constant is 1000.
    const below = historicalCvar({ returns, confidenceLevel: 0.9 + 1e-9 });
    const above = historicalCvar({ returns, confidenceLevel: 0.9 - 1e-9 });
    expect(Math.abs(below - above)).toBeLessThan(1e-9);
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
