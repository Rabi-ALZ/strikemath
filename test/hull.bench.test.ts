/**
 * GOLDEN BENCHMARKS — verified against Hull, *Options, Futures and Other Derivatives*.
 *
 * THESE ASSERTIONS MUST NEVER BE WEAKENED. If one of them fails, the code is wrong, not the
 * test. Do not widen a tolerance, do not change an expected value, do not skip a case.
 *
 * The one exception, and it carries a duty to stop: if after thorough verification you believe
 * a deviation is caused by Hull's own rounding in the printed table, STOP and report it. Do not
 * change the code or the test on your own authority.
 *
 * The whole premise of this library is that its numbers can be trusted. A benchmark quietly
 * relaxed to make a build green destroys exactly the thing the benchmark exists to protect.
 */

import { describe, expect, it } from 'vitest';
import { bsCall, bsPut } from '../src/pricing/blackScholes.js';
import { callGreeks } from '../src/greeks/analytical.js';
import type { OptionInputs } from '../src/utils/types.js';

describe('Hull, Example 13.6 — European option prices', () => {
  const inputs: OptionInputs = {
    spot: 42,
    strike: 40,
    timeToExpiry: 0.5,
    riskFreeRate: 0.1,
    volatility: 0.2,
    dividendYield: 0,
  };

  it('prices the call at 4.7594', () => {
    expect(bsCall(inputs)).toBeCloseTo(4.7594, 4);
  });

  it('prices the put at 0.8086', () => {
    expect(bsPut(inputs)).toBeCloseTo(0.8086, 4);
  });

  it('satisfies put-call parity at the control value 3.95082', () => {
    expect(bsCall(inputs) - bsPut(inputs)).toBeCloseTo(3.95082, 5);
    expect(42 - 40 * Math.exp(-0.1 * 0.5)).toBeCloseTo(3.95082, 5);
  });
});

describe('Hull, Chapter 17 — Greeks of a European call', () => {
  const inputs: OptionInputs = {
    spot: 49,
    strike: 50,
    timeToExpiry: 0.3846,
    riskFreeRate: 0.05,
    volatility: 0.2,
    dividendYield: 0,
  };

  it('has delta 0.5216', () => {
    expect(callGreeks(inputs).delta).toBeCloseTo(0.5216, 4);
  });

  it('has gamma 0.06555', () => {
    expect(callGreeks(inputs).gamma).toBeCloseTo(0.06555, 5);
  });

  it('has vega 12.1052 in raw units, per 1.00 of volatility', () => {
    expect(callGreeks(inputs).vega).toBeCloseTo(12.1052, 4);
  });

  it('has theta -4.3054 in raw units, per year', () => {
    expect(callGreeks(inputs).theta).toBeCloseTo(-4.3054, 4);
  });
});
