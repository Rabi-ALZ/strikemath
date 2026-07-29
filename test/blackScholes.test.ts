import { describe, expect, it } from 'vitest';
import { bsCall, bsPrice, bsPut, d1d2 } from '../src/pricing/blackScholes.js';
import { InvalidInputError } from '../src/utils/validate.js';
import type { OptionInputs } from '../src/utils/types.js';

const base: OptionInputs = {
  spot: 100,
  strike: 100,
  timeToExpiry: 1,
  riskFreeRate: 0.05,
  volatility: 0.2,
};

describe('d1d2', () => {
  it('satisfies d1 - d2 = sigma * sqrt(T)', () => {
    const { d1, d2 } = d1d2({ ...base, timeToExpiry: 0.75, volatility: 0.35 });
    expect(d1 - d2).toBeCloseTo(0.35 * Math.sqrt(0.75), 15);
  });

  it('is zero-ish at the forward-at-the-money point', () => {
    // With r = q and sigma^2 T / 2 shifting d1 up, d2 sits symmetrically below.
    const { d1, d2 } = d1d2({ ...base, riskFreeRate: 0, dividendYield: 0 });
    expect(d1 + d2).toBeCloseTo(0, 15);
  });

  it('refuses the degenerate cases rather than returning NaN', () => {
    expect(() => d1d2({ ...base, timeToExpiry: 0 })).toThrow(InvalidInputError);
    expect(() => d1d2({ ...base, volatility: 0 })).toThrow(InvalidInputError);
  });
});

describe('bsCall and bsPut at expiry', () => {
  it('collapse to intrinsic value when timeToExpiry is 0', () => {
    expect(bsCall({ ...base, timeToExpiry: 0, spot: 120 })).toBe(20);
    expect(bsCall({ ...base, timeToExpiry: 0, spot: 80 })).toBe(0);
    expect(bsCall({ ...base, timeToExpiry: 0, spot: 100 })).toBe(0);

    expect(bsPut({ ...base, timeToExpiry: 0, spot: 80 })).toBe(20);
    expect(bsPut({ ...base, timeToExpiry: 0, spot: 120 })).toBe(0);
    expect(bsPut({ ...base, timeToExpiry: 0, spot: 100 })).toBe(0);
  });

  it('ignore rate, volatility and yield once there is no time left', () => {
    const atExpiry = { ...base, timeToExpiry: 0, spot: 110 };
    expect(bsCall({ ...atExpiry, riskFreeRate: 0.5, volatility: 3, dividendYield: 0.1 })).toBe(10);
  });
});

describe('bsCall and bsPut with zero volatility', () => {
  it('collapse to discounted forward intrinsic', () => {
    const inputs = { ...base, volatility: 0, timeToExpiry: 2, dividendYield: 0.03 };
    const discountedSpot = 100 * Math.exp(-0.03 * 2);
    const discountedStrike = 100 * Math.exp(-0.05 * 2);

    expect(bsCall(inputs)).toBeCloseTo(Math.max(discountedSpot - discountedStrike, 0), 15);
    expect(bsPut(inputs)).toBeCloseTo(Math.max(discountedStrike - discountedSpot, 0), 15);
  });

  it('are worth nothing when the forward finishes on the wrong side of the strike', () => {
    expect(bsCall({ ...base, volatility: 0, spot: 50 })).toBe(0);
    expect(bsPut({ ...base, volatility: 0, spot: 200 })).toBe(0);
  });

  it('agree with the limit of a vanishing volatility', () => {
    const zero = bsCall({ ...base, volatility: 0, spot: 120 });
    const tiny = bsCall({ ...base, volatility: 1e-8, spot: 120 });
    expect(tiny).toBeCloseTo(zero, 9);
  });
});

describe('put-call parity', () => {
  it('holds as a structural identity, not as an approximation', () => {
    // C - P reduces to S*e^(-qT)*[N(d1) + N(-d1)] - K*e^(-rT)*[N(d2) + N(-d2)], so it holds
    // through the reflection alone. A failure here is the reflection or the input domain,
    // never the accuracy of the normal CDF.
    for (const spot of [50, 90, 100, 110, 250]) {
      for (const dividendYield of [0, 0.02, 0.08]) {
        const inputs = { ...base, spot, dividendYield, timeToExpiry: 1.5 };
        const left = bsCall(inputs) - bsPut(inputs);
        const right = spot * Math.exp(-dividendYield * 1.5) - inputs.strike * Math.exp(-0.05 * 1.5);
        expect(Math.abs(left - right), `spot ${spot}, q ${dividendYield}`).toBeLessThan(1e-12);
      }
    }
  });
});

describe('no-arbitrage bounds', () => {
  it('keep a call between its discounted intrinsic and the discounted spot', () => {
    for (const spot of [1, 60, 100, 140, 10_000]) {
      for (const volatility of [0.01, 0.2, 2]) {
        const inputs = { ...base, spot, volatility, dividendYield: 0.01 };
        const price = bsCall(inputs);
        const discountedSpot = spot * Math.exp(-0.01);
        const lower = Math.max(discountedSpot - 100 * Math.exp(-0.05), 0);
        expect(price).toBeGreaterThanOrEqual(lower - 1e-12);
        expect(price).toBeLessThanOrEqual(discountedSpot + 1e-12);
      }
    }
  });

  it('keep a put between its discounted intrinsic and the discounted strike', () => {
    for (const spot of [1, 60, 100, 140, 10_000]) {
      const inputs = { ...base, spot, dividendYield: 0.01 };
      const price = bsPut(inputs);
      const discountedStrike = 100 * Math.exp(-0.05);
      const lower = Math.max(discountedStrike - spot * Math.exp(-0.01), 0);
      expect(price).toBeGreaterThanOrEqual(lower - 1e-12);
      expect(price).toBeLessThanOrEqual(discountedStrike + 1e-12);
    }
  });
});

describe('monotonicity', () => {
  it('makes calls more valuable as spot rises and puts less valuable', () => {
    let previousCall = bsCall({ ...base, spot: 50 });
    let previousPut = bsPut({ ...base, spot: 50 });
    for (let spot = 51; spot <= 150; spot += 1) {
      const call = bsCall({ ...base, spot });
      const put = bsPut({ ...base, spot });
      expect(call).toBeGreaterThan(previousCall);
      expect(put).toBeLessThan(previousPut);
      previousCall = call;
      previousPut = put;
    }
  });

  it('makes both sides more valuable as volatility rises', () => {
    let previousCall = bsCall({ ...base, volatility: 0.01 });
    let previousPut = bsPut({ ...base, volatility: 0.01 });
    for (let volatility = 0.02; volatility <= 2; volatility += 0.01) {
      const call = bsCall({ ...base, volatility });
      const put = bsPut({ ...base, volatility });
      expect(call).toBeGreaterThan(previousCall);
      expect(put).toBeGreaterThan(previousPut);
      previousCall = call;
      previousPut = put;
    }
  });

  it('makes calls cheaper as the dividend yield rises', () => {
    expect(bsCall({ ...base, dividendYield: 0.05 })).toBeLessThan(
      bsCall({ ...base, dividendYield: 0 }),
    );
  });
});

describe('bsPrice', () => {
  it('dispatches to the same numbers as bsCall and bsPut', () => {
    expect(bsPrice({ ...base, optionType: 'call' })).toBe(bsCall(base));
    expect(bsPrice({ ...base, optionType: 'put' })).toBe(bsPut(base));
  });

  it('rejects an unknown option type', () => {
    // @ts-expect-error deliberately passing a value the type system forbids
    expect(() => bsPrice({ ...base, optionType: 'straddle' })).toThrow(InvalidInputError);
  });
});

describe('input validation', () => {
  it('rejects a non-positive spot or strike', () => {
    expect(() => bsCall({ ...base, spot: 0 })).toThrow(/spot/);
    expect(() => bsCall({ ...base, spot: -1 })).toThrow(/spot/);
    expect(() => bsPut({ ...base, strike: 0 })).toThrow(/strike/);
  });

  it('rejects negative time or volatility', () => {
    expect(() => bsCall({ ...base, timeToExpiry: -1 })).toThrow(/timeToExpiry/);
    expect(() => bsCall({ ...base, volatility: -0.2 })).toThrow(/volatility/);
  });

  it('rejects non-finite inputs', () => {
    expect(() => bsCall({ ...base, spot: Number.NaN })).toThrow(InvalidInputError);
    expect(() => bsCall({ ...base, riskFreeRate: Number.POSITIVE_INFINITY })).toThrow(
      InvalidInputError,
    );
  });

  it('accepts a negative risk-free rate', () => {
    expect(bsCall({ ...base, riskFreeRate: -0.01 })).toBeGreaterThan(0);
  });

  it('treats a missing dividend yield as zero', () => {
    expect(bsCall(base)).toBe(bsCall({ ...base, dividendYield: 0 }));
  });
});

describe('numerical hygiene', () => {
  it('never returns NaN or Infinity across the documented domain', () => {
    for (const spot of [1, 10, 100, 10_000]) {
      for (const timeToExpiry of [1 / 365, 0.5, 10]) {
        for (const volatility of [0.001, 0.5, 5]) {
          for (const riskFreeRate of [-0.02, 0, 0.25]) {
            const inputs = { spot, strike: 100, timeToExpiry, riskFreeRate, volatility };
            expect(Number.isFinite(bsCall(inputs))).toBe(true);
            expect(Number.isFinite(bsPut(inputs))).toBe(true);
          }
        }
      }
    }
  });

  it('stays non-negative for deep out-of-the-money contracts', () => {
    expect(bsCall({ ...base, spot: 1, strike: 10_000 })).toBeGreaterThanOrEqual(0);
    expect(bsPut({ ...base, spot: 10_000, strike: 1 })).toBeGreaterThanOrEqual(0);
  });
});
