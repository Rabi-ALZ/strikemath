import { fc, test } from '@fast-check/vitest';
import { describe, expect } from 'vitest';
import { bsCall, bsPut } from '../src/pricing/blackScholes.js';
import { callGreeks, putGreeks } from '../src/greeks/analytical.js';
import type { OptionInputs } from '../src/utils/types.js';

/**
 * THE DOCUMENTED INPUT DOMAIN.
 *
 * The generators below are bounded on purpose, and the same bounds appear in docs/MATH.md. This
 * is not a convenience: put-call parity is asserted at an ABSOLUTE tolerance of 1e-9, while the
 * parity residual scales with S and K. Unbounded generation would produce S = K = 1e12, where
 * the residual is 1.2e-4 and the assertion fails by construction — a domain error, not a
 * mathematics error.
 *
 * Measured residuals: S = K = 1e4 gives 3.6e-12, S = K = 1e6 gives 5.8e-11 (both pass),
 * S = K = 1e12 gives 1.2e-4 and S = K = 1e15 gives 6.3e-2 (both fail).
 *
 * If a property ever fails here, narrow the documented domain and say so — never widen the
 * tolerance.
 */
const DOMAIN = {
  spot: { min: 1, max: 10_000 },
  strike: { min: 1, max: 10_000 },
  timeToExpiry: { min: 1 / 365, max: 10 },
  riskFreeRate: { min: -0.02, max: 0.25 },
  volatility: { min: 0.001, max: 5 },
  dividendYield: { min: 0, max: 0.15 },
} as const;

const bounded = (range: { min: number; max: number }) =>
  fc.double({ min: range.min, max: range.max, noNaN: true, noDefaultInfinity: true });

const optionInputs = fc.record({
  spot: bounded(DOMAIN.spot),
  strike: bounded(DOMAIN.strike),
  timeToExpiry: bounded(DOMAIN.timeToExpiry),
  riskFreeRate: bounded(DOMAIN.riskFreeRate),
  volatility: bounded(DOMAIN.volatility),
  dividendYield: bounded(DOMAIN.dividendYield),
}) satisfies fc.Arbitrary<OptionInputs>;

const runs = { numRuns: 1000 };

describe('put-call parity', () => {
  test.prop([optionInputs], runs)('C - P = S e^(-qT) - K e^(-rT)', (inputs) => {
    const { spot, strike, timeToExpiry, riskFreeRate, dividendYield } = inputs;

    const left = bsCall(inputs) - bsPut(inputs);
    const right =
      spot * Math.exp(-(dividendYield ?? 0) * timeToExpiry) -
      strike * Math.exp(-riskFreeRate * timeToExpiry);

    expect(Math.abs(left - right)).toBeLessThan(1e-9);
  });
});

/**
 * The floor below which an ordering between two prices cannot be observed.
 *
 * A Black-Scholes price is a difference of two terms of order `S` and `K`, so the result carries
 * an absolute rounding of a few ulp of the larger of them. Where the true difference between two
 * prices is smaller than that, the computed comparison can invert. This is a property of binary
 * floating point, not of the model.
 *
 * Measured counterexample, deep in the money with r = 0: S = 28.8, K = 2.5144595332169533,
 * T = 0.04176592831188112, sigma 0.001 vs 1.515616632428247. Evaluating the excess over
 * discounted-forward intrinsic in the cancellation-free form
 * `K e^(-rT) N(-d2) - S e^(-qT) N(-d1)` shows the true increase is 5.6e-16 — while one ulp of
 * the price itself is 5.8e-15, ten times larger. The price is genuinely monotone; the ordering
 * is simply below the resolution at which it can be represented.
 */
function resolutionFloor(spot: number, strike: number): number {
  return 8 * Number.EPSILON * Math.max(spot, strike);
}

describe('monotonicity', () => {
  test.prop([optionInputs, bounded(DOMAIN.spot)], runs)(
    'a call is non-decreasing in spot',
    (inputs, otherSpot) => {
      const low = Math.min(inputs.spot, otherSpot);
      const high = Math.max(inputs.spot, otherSpot);
      const floor = resolutionFloor(high, inputs.strike);
      expect(bsCall({ ...inputs, spot: high })).toBeGreaterThanOrEqual(
        bsCall({ ...inputs, spot: low }) - floor,
      );
    },
  );

  test.prop([optionInputs, bounded(DOMAIN.spot)], runs)(
    'a put is non-increasing in spot',
    (inputs, otherSpot) => {
      const low = Math.min(inputs.spot, otherSpot);
      const high = Math.max(inputs.spot, otherSpot);
      const floor = resolutionFloor(high, inputs.strike);
      expect(bsPut({ ...inputs, spot: high })).toBeLessThanOrEqual(
        bsPut({ ...inputs, spot: low }) + floor,
      );
    },
  );

  test.prop([optionInputs, bounded(DOMAIN.volatility)], runs)(
    'both sides are non-decreasing in volatility',
    (inputs, otherVolatility) => {
      const low = Math.min(inputs.volatility, otherVolatility);
      const high = Math.max(inputs.volatility, otherVolatility);
      const floor = resolutionFloor(inputs.spot, inputs.strike);

      expect(bsCall({ ...inputs, volatility: high })).toBeGreaterThanOrEqual(
        bsCall({ ...inputs, volatility: low }) - floor,
      );
      expect(bsPut({ ...inputs, volatility: high })).toBeGreaterThanOrEqual(
        bsPut({ ...inputs, volatility: low }) - floor,
      );
    },
  );

  test.prop([optionInputs, bounded(DOMAIN.volatility)], runs)(
    'is strictly monotone in volatility wherever the difference is representable at all',
    (inputs, otherVolatility) => {
      const low = Math.min(inputs.volatility, otherVolatility);
      const high = Math.max(inputs.volatility, otherVolatility);

      const lowPrice = bsCall({ ...inputs, volatility: low });
      const highPrice = bsCall({ ...inputs, volatility: high });

      // Only assert strictness once the gap clears the resolution floor by an order of
      // magnitude. Inside the floor there is nothing to assert; outside it, monotonicity must
      // hold exactly.
      const floor = resolutionFloor(inputs.spot, inputs.strike);
      if (Math.abs(highPrice - lowPrice) > 10 * floor) {
        expect(highPrice).toBeGreaterThan(lowPrice);
      }
    },
  );
});

describe('Greek bounds', () => {
  test.prop([optionInputs], runs)('delta stays inside its sign convention', (inputs) => {
    const call = callGreeks(inputs).delta;
    const put = putGreeks(inputs).delta;

    expect(call).toBeGreaterThanOrEqual(0);
    expect(call).toBeLessThanOrEqual(1);
    expect(put).toBeGreaterThanOrEqual(-1);
    expect(put).toBeLessThanOrEqual(0);
  });

  test.prop([optionInputs], runs)('gamma and vega are never negative', (inputs) => {
    const greeks = callGreeks(inputs);
    expect(greeks.gamma).toBeGreaterThanOrEqual(0);
    expect(greeks.vega).toBeGreaterThanOrEqual(0);
  });
});

describe('no-arbitrage bounds', () => {
  test.prop([optionInputs], runs)('prices stay inside their static bounds', (inputs) => {
    const { spot, strike, timeToExpiry, riskFreeRate, dividendYield } = inputs;

    const spotTerm = spot * Math.exp(-(dividendYield ?? 0) * timeToExpiry);
    const strikeTerm = strike * Math.exp(-riskFreeRate * timeToExpiry);

    // A tolerance proportional to the magnitudes involved: these are bounds on a difference of
    // two large numbers, so the floor is relative, not absolute.
    const slack = 1e-9 * Math.max(1, spotTerm, strikeTerm);

    const call = bsCall(inputs);
    expect(call).toBeGreaterThanOrEqual(Math.max(spotTerm - strikeTerm, 0) - slack);
    expect(call).toBeLessThanOrEqual(spotTerm + slack);

    const put = bsPut(inputs);
    expect(put).toBeGreaterThanOrEqual(Math.max(strikeTerm - spotTerm, 0) - slack);
    expect(put).toBeLessThanOrEqual(strikeTerm + slack);
  });
});

describe('the Black-Scholes PDE', () => {
  test.prop([optionInputs, fc.constantFrom('call' as const, 'put' as const)], runs)(
    'theta + (1/2) sigma^2 S^2 gamma + (r - q) S delta - r V = 0',
    (inputs, optionType) => {
      // The identity that ties four outputs together, checked over the whole domain rather than
      // at a handful of points. It is also what makes theta's unit machine-enforced: it holds
      // only with theta per year, so a change to per-day breaks it by a factor of 365.
      const greeks = optionType === 'call' ? callGreeks(inputs) : putGreeks(inputs);
      const value = optionType === 'call' ? bsCall(inputs) : bsPut(inputs);
      const dividendYield = inputs.dividendYield ?? 0;

      const terms = [
        greeks.theta,
        0.5 * inputs.volatility ** 2 * inputs.spot ** 2 * greeks.gamma,
        (inputs.riskFreeRate - dividendYield) * inputs.spot * greeks.delta,
        -inputs.riskFreeRate * value,
      ];

      const scale = Math.max(...terms.map(Math.abs), 1);
      const residual = Math.abs(terms.reduce((total, term) => total + term, 0));

      // Worst relative residual measured across the documented domain: 1.0e-14.
      expect(residual / scale).toBeLessThan(1e-12);
    },
  );
});

describe('the boundary rule', () => {
  test.prop([optionInputs, fc.constantFrom('call' as const, 'put' as const)], runs)(
    'the boundary branch is the limit of the analytic branch',
    (inputs, optionType) => {
      // The rule in docs/MATH.md 6.2, enforced rather than promised: every boundary value must be
      // what the analytic branch converges on, with gamma the sole exception because its limit
      // diverges. A defect in either branch surfaces here as a discontinuity in the library's own
      // output — which is exactly how vega was caught returning 0 where the limit is 39.894.
      const probe = 1e-8;

      // The probe only reveals the limit if it can tell which side of the kink the contract is
      // on. That needs |ln(spotTerm / strikeTerm)| to dominate sigma sqrt(T): inside that band
      // the analytic branch is still reporting the kink value while the boundary branch has
      // already resolved the strict inequality, and the two legitimately differ. A strike one ulp
      // above the spot is out of the money, its limit is 0, and no probe this coarse can see it.
      const spotTerm = inputs.spot * Math.exp(-(inputs.dividendYield ?? 0) * inputs.timeToExpiry);
      const strikeTerm = inputs.strike * Math.exp(-inputs.riskFreeRate * inputs.timeToExpiry);
      const moneyness = Math.abs(Math.log(spotTerm / strikeTerm));
      fc.pre(moneyness === 0 || moneyness > 100 * probe * Math.sqrt(inputs.timeToExpiry));

      const atBoundary = { ...inputs, volatility: 0 };
      const justInside = { ...inputs, volatility: probe };

      const boundary = optionType === 'call' ? callGreeks(atBoundary) : putGreeks(atBoundary);
      const inside = optionType === 'call' ? callGreeks(justInside) : putGreeks(justInside);

      // Each Greek has its own natural magnitude, and the probe is still a finite distance from
      // the limit — theta, for instance, converges linearly in sigma, so at S = K = 1 its value
      // there is around 1e-8 while the limit is 0. Judging every Greek against one absolute floor
      // would either hide a real discontinuity in delta or flag that convergence in theta. The
      // floor is therefore the Greek's own scale.
      //
      // The probe is 1e-8 and not smaller because the sequence turns around below that: at the
      // kink, d1 divides a cancellation residual of order 1e-16 by sigma sqrt(T), so the analytic
      // branch moves away from the limit as sigma shrinks past roughly 1e-8. A probe at 1e-12
      // would be measuring that divergence rather than the convergence. See docs/MATH.md 6.2.
      const naturalScale = {
        delta: 1,
        vega: inputs.spot * Math.sqrt(inputs.timeToExpiry),
        theta: Math.max(inputs.spot, inputs.strike),
        rho: inputs.strike * inputs.timeToExpiry,
      } as const;

      for (const greek of ['delta', 'vega', 'theta', 'rho'] as const) {
        const budget =
          1e-3 * Math.max(Math.abs(inside[greek]), Math.abs(boundary[greek])) +
          1e-6 * naturalScale[greek];

        expect(
          Math.abs(boundary[greek] - inside[greek]),
          `${greek}: boundary ${boundary[greek]}, limit ${inside[greek]}, budget ${budget.toExponential(2)}`,
        ).toBeLessThanOrEqual(budget);
      }
    },
  );
});

describe('numerical hygiene', () => {
  test.prop([optionInputs], runs)(
    'no price or Greek is NaN or Infinity anywhere in the domain',
    (inputs) => {
      expect(Number.isFinite(bsCall(inputs))).toBe(true);
      expect(Number.isFinite(bsPut(inputs))).toBe(true);

      for (const greeks of [callGreeks(inputs), putGreeks(inputs)]) {
        for (const [name, value] of Object.entries(greeks)) {
          expect(Number.isFinite(value), `${name} = ${value}`).toBe(true);
        }
      }
    },
  );
});
