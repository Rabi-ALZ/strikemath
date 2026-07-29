import { describe, expect, it } from 'vitest';
import { crrPrice } from '../src/pricing/binomial.js';
import { bsCall, bsPut } from '../src/pricing/blackScholes.js';
import { InvalidInputError } from '../src/utils/validate.js';
import type { OptionInputs } from '../src/utils/types.js';

const base: OptionInputs = {
  spot: 100,
  strike: 100,
  timeToExpiry: 1,
  riskFreeRate: 0.05,
  volatility: 0.25,
};

describe('convergence to Black-Scholes', () => {
  it('prices European options at the analytic value as the tree is refined', () => {
    for (const inputs of [
      base,
      { ...base, spot: 80 },
      { ...base, spot: 130, dividendYield: 0.03 },
      { ...base, timeToExpiry: 0.25, volatility: 0.6 },
    ]) {
      const call = crrPrice({
        ...inputs,
        optionType: 'call',
        exerciseStyle: 'european',
        steps: 1000,
      });
      const put = crrPrice({
        ...inputs,
        optionType: 'put',
        exerciseStyle: 'european',
        steps: 1000,
      });

      expect(call).toBeCloseTo(bsCall(inputs), 2);
      expect(put).toBeCloseTo(bsPut(inputs), 2);
    }
  });

  it('gets closer as steps increase', () => {
    const analytic = bsCall(base);
    const coarse = Math.abs(
      crrPrice({ ...base, optionType: 'call', exerciseStyle: 'european', steps: 10 }) - analytic,
    );
    const fine = Math.abs(
      crrPrice({ ...base, optionType: 'call', exerciseStyle: 'european', steps: 1000 }) - analytic,
    );

    expect(fine).toBeLessThan(coarse);
    expect(fine).toBeLessThan(1e-2);
  });
});

describe('American exercise', () => {
  it('leaves an American call on a non-dividend-paying underlying worth the European one', () => {
    // The classic result: early exercise of a call is never optimal without dividends, so the
    // early-exercise test in the backward induction must never bind here.
    const inputs = { ...base, dividendYield: 0 };
    const american = crrPrice({
      ...inputs,
      optionType: 'call',
      exerciseStyle: 'american',
      steps: 500,
    });
    const european = crrPrice({
      ...inputs,
      optionType: 'call',
      exerciseStyle: 'european',
      steps: 500,
    });

    expect(american).toBeCloseTo(european, 12);
  });

  it('makes an American put worth at least the European put', () => {
    for (const spot of [60, 80, 100, 120, 150]) {
      const inputs = { ...base, spot };
      const american = crrPrice({
        ...inputs,
        optionType: 'put',
        exerciseStyle: 'american',
        steps: 400,
      });
      const european = crrPrice({
        ...inputs,
        optionType: 'put',
        exerciseStyle: 'european',
        steps: 400,
      });

      expect(american).toBeGreaterThanOrEqual(european - 1e-12);
    }
  });

  it('makes an American put strictly more valuable where early exercise pays', () => {
    // Deep in the money with a high rate: exercising early frees the strike to earn interest.
    const inputs = { ...base, spot: 55, riskFreeRate: 0.15, volatility: 0.2 };
    const american = crrPrice({
      ...inputs,
      optionType: 'put',
      exerciseStyle: 'american',
      steps: 500,
    });
    const european = crrPrice({
      ...inputs,
      optionType: 'put',
      exerciseStyle: 'european',
      steps: 500,
    });

    expect(american).toBeGreaterThan(european + 1e-3);
  });

  it('makes an American call strictly more valuable when the yield is large enough', () => {
    // With a dividend yield above the rate, holding the call forgoes carry and early exercise
    // can be optimal.
    const inputs = { ...base, spot: 140, dividendYield: 0.2, riskFreeRate: 0.02, volatility: 0.15 };
    const american = crrPrice({
      ...inputs,
      optionType: 'call',
      exerciseStyle: 'american',
      steps: 500,
    });
    const european = crrPrice({
      ...inputs,
      optionType: 'call',
      exerciseStyle: 'european',
      steps: 500,
    });

    expect(american).toBeGreaterThan(european + 1e-3);
  });

  it('never prices an American option below its intrinsic value', () => {
    for (const spot of [40, 70, 100, 130, 180]) {
      const inputs = { ...base, spot };
      const call = crrPrice({
        ...inputs,
        optionType: 'call',
        exerciseStyle: 'american',
        steps: 200,
      });
      const put = crrPrice({ ...inputs, optionType: 'put', exerciseStyle: 'american', steps: 200 });

      expect(call).toBeGreaterThanOrEqual(Math.max(spot - 100, 0) - 1e-12);
      expect(put).toBeGreaterThanOrEqual(Math.max(100 - spot, 0) - 1e-12);
    }
  });
});

describe('boundary cases', () => {
  it('returns intrinsic value at expiry', () => {
    const atExpiry = { ...base, timeToExpiry: 0 };
    expect(
      crrPrice({ ...atExpiry, spot: 120, optionType: 'call', exerciseStyle: 'european' }),
    ).toBe(20);
    expect(crrPrice({ ...atExpiry, spot: 80, optionType: 'put', exerciseStyle: 'american' })).toBe(
      20,
    );
    expect(crrPrice({ ...atExpiry, spot: 80, optionType: 'call', exerciseStyle: 'european' })).toBe(
      0,
    );
  });

  it('handles a degenerate tree with zero volatility', () => {
    // u and d both collapse to 1, so the tree has a single deterministic path. The European
    // value must be the discounted forward intrinsic that Black-Scholes gives.
    const inputs = { ...base, volatility: 0, dividendYield: 0.03 };
    const european = crrPrice({
      ...inputs,
      optionType: 'call',
      exerciseStyle: 'european',
      steps: 100,
    });

    expect(european).toBeCloseTo(bsCall(inputs), 10);
  });

  it('lets an American option exercise early on a deterministic path', () => {
    // Zero volatility, yield above the rate: the discounted payoff is falling, so exercising
    // immediately is optimal and the American value is the intrinsic value today.
    const inputs = { ...base, spot: 150, volatility: 0, dividendYield: 0.3, riskFreeRate: 0.01 };
    const american = crrPrice({
      ...inputs,
      optionType: 'call',
      exerciseStyle: 'american',
      steps: 200,
    });

    expect(american).toBeCloseTo(50, 6);
  });
});

describe('validation', () => {
  it('rejects a step count that is not a positive integer', () => {
    for (const steps of [0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        crrPrice({ ...base, optionType: 'call', exerciseStyle: 'european', steps }),
      ).toThrow(/steps/);
    }
  });

  it('rejects an unreasonably large step count rather than hanging', () => {
    expect(() =>
      crrPrice({ ...base, optionType: 'call', exerciseStyle: 'european', steps: 10_000_000 }),
    ).toThrow(/steps/);
  });

  it('rejects an unknown option type or exercise style', () => {
    // @ts-expect-error deliberately passing a value the type system forbids
    expect(() => crrPrice({ ...base, optionType: 'strangle', exerciseStyle: 'european' })).toThrow(
      InvalidInputError,
    );
    // @ts-expect-error deliberately passing a value the type system forbids
    expect(() => crrPrice({ ...base, optionType: 'call', exerciseStyle: 'bermudan' })).toThrow(
      InvalidInputError,
    );
  });

  it('refuses a tree whose terminal nodes overflow rather than returning Infinity', () => {
    // Regression. The highest terminal node is exp(ln S + sigma sqrt(T n)). Past the top of the
    // double range a call payoff there becomes Infinity and backward induction carries it to the
    // root — so the function returned Infinity for inputs inside the documented domain, and did
    // so exactly when the caller raised `steps` to get a better answer.
    const extreme = {
      spot: 100,
      strike: 100,
      timeToExpiry: 1,
      riskFreeRate: 0.05,
      volatility: 5,
      optionType: 'call' as const,
      exerciseStyle: 'european' as const,
    };

    expect(() => crrPrice({ ...extreme, steps: 20_000 })).toThrow(/cannot be represented/);
    expect(() => crrPrice({ ...extreme, timeToExpiry: 10, volatility: 2, steps: 20_000 })).toThrow(
      InvalidInputError,
    );

    // The same contract at a step count the tree can represent still prices, and converges.
    const priced = crrPrice({ ...extreme, steps: 1000 });
    expect(Number.isFinite(priced)).toBe(true);
    expect(priced).toBeCloseTo(bsCall(extreme), 1);
  });

  it('names the largest step count that would fit, and says so when none would', () => {
    // The message has to be actionable: "reduce steps" is useless without a target.
    const extreme = {
      spot: 100,
      strike: 100,
      timeToExpiry: 1,
      riskFreeRate: 0.05,
      volatility: 5,
      optionType: 'call' as const,
      exerciseStyle: 'european' as const,
    };

    expect(() => crrPrice({ ...extreme, steps: 20_000 })).toThrow(/largest step count that fits/);

    // And the number it names must actually work, while one more must not.
    let named = 0;
    try {
      crrPrice({ ...extreme, steps: 20_000 });
    } catch (error) {
      named = Number(/fits is (\d+)/.exec((error as Error).message)?.[1]);
    }
    expect(named).toBeGreaterThan(0);
    expect(Number.isFinite(crrPrice({ ...extreme, steps: named }))).toBe(true);

    // A spot at the very top of the double range admits no tree at all, and the message must say
    // that rather than naming a step count that cannot work either.
    expect(() => crrPrice({ ...extreme, spot: 1e308, strike: 1e308, steps: 100 })).toThrow(
      /No step count works/,
    );

    // Regression. The same must hold when the headroom is positive but too small for even a
    // single step: rounding the limit up to 1 named a step count that failed identically.
    expect(() =>
      crrPrice({ ...extreme, spot: 1e300, strike: 1e300, volatility: 20, steps: 5 }),
    ).toThrow(/No step count works/);
  });

  it('does not refuse a put, whose payoff is finite even when the node overflows', () => {
    // Regression. The guard's reasoning is call-specific: a call payoff at an overflowed node is
    // Infinity - K = Infinity and propagates to the root. A put's is max(K - Infinity, 0) = 0,
    // which is the correct value there, so no Infinity ever enters the tree. Refusing the put
    // rejected a computation that was right, and did it exactly when the caller raised `steps`.
    const contract = {
      spot: 100,
      strike: 100,
      timeToExpiry: 10,
      riskFreeRate: 0.02,
      volatility: 5,
      steps: 3000,
    };

    const european = crrPrice({ ...contract, optionType: 'put', exerciseStyle: 'european' });
    const american = crrPrice({ ...contract, optionType: 'put', exerciseStyle: 'american' });

    expect(Number.isFinite(european)).toBe(true);
    expect(Number.isFinite(american)).toBe(true);

    // And it is not merely finite — it is the right number.
    expect(european).toBeCloseTo(bsPut(contract), 6);
    expect(american).toBeGreaterThanOrEqual(european);

    // The call on the same contract is still refused, because for a call the overflow is real.
    expect(() => crrPrice({ ...contract, optionType: 'call', exerciseStyle: 'european' })).toThrow(
      /cannot be represented/,
    );
  });

  it('rejects a tree whose risk-neutral probability leaves [0, 1]', () => {
    // With a large drift and a small volatility the up and down moves cannot straddle the
    // forward, and the tree admits arbitrage. Returning a number here would be silently wrong.
    expect(() =>
      crrPrice({
        spot: 100,
        strike: 100,
        timeToExpiry: 1,
        riskFreeRate: 0.25,
        volatility: 0.001,
        optionType: 'call',
        exerciseStyle: 'european',
        steps: 5,
      }),
    ).toThrow(/probability/i);
  });

  it('rejects the same invalid inputs as the analytic pricer', () => {
    expect(() =>
      crrPrice({ ...base, spot: -1, optionType: 'call', exerciseStyle: 'european' }),
    ).toThrow(/spot/);
  });
});

describe('numerical hygiene', () => {
  it('never returns NaN or Infinity across the documented domain', () => {
    for (const spot of [1, 100, 10_000]) {
      for (const timeToExpiry of [1 / 365, 1, 10]) {
        for (const volatility of [0.05, 0.5, 5]) {
          for (const exerciseStyle of ['european', 'american'] as const) {
            const price = crrPrice({
              spot,
              strike: 100,
              timeToExpiry,
              riskFreeRate: 0.05,
              volatility,
              optionType: 'put',
              exerciseStyle,
              steps: 50,
            });
            expect(Number.isFinite(price), `spot ${spot}, T ${timeToExpiry}`).toBe(true);
            expect(price).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });
});
