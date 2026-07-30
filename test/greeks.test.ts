import { describe, expect, it } from 'vitest';
import {
  callGreeks,
  delta,
  gamma,
  optionGreeks,
  putGreeks,
  rho,
  theta,
  vega,
} from '../src/greeks/analytical.js';
import { bsCall, bsPut } from '../src/pricing/blackScholes.js';
import { thetaPerCalendarDay } from '../src/greeks/scaling.js';
import { normalPdf } from '../src/utils/normal.js';
import { InvalidInputError } from '../src/utils/validate.js';
import type { OptionInputs } from '../src/utils/types.js';

const base: OptionInputs = {
  spot: 100,
  strike: 100,
  timeToExpiry: 1,
  riskFreeRate: 0.05,
  volatility: 0.2,
  dividendYield: 0.02,
};

/** Central difference of a one-argument function. */
function centralDifference(f: (x: number) => number, x: number, h: number): number {
  return (f(x + h) - f(x - h)) / (2 * h);
}

function expectRelative(actual: number, expected: number, tolerance: number, label: string): void {
  const error = Math.abs(actual - expected) / Math.abs(expected);
  expect(
    error,
    `${label}: ${actual} vs ${expected}, relative ${error.toExponential(2)}`,
  ).toBeLessThan(tolerance);
}

describe('analytical Greeks against numerical derivatives of the price', () => {
  // The closed forms and the price function are independent code paths. Agreement between them
  // catches a dropped term or a sign error in a way no single-value benchmark can.
  const cases: ReadonlyArray<OptionInputs> = [
    base,
    { ...base, spot: 80 },
    { ...base, spot: 130 },
    { ...base, timeToExpiry: 0.08, volatility: 0.6 },
    { ...base, timeToExpiry: 5, volatility: 0.15, riskFreeRate: -0.01 },
    { ...base, dividendYield: 0 },
  ];

  it('reproduces delta', () => {
    for (const inputs of cases) {
      expectRelative(
        callGreeks(inputs).delta,
        centralDifference((spot) => bsCall({ ...inputs, spot }), inputs.spot, 1e-4),
        1e-6,
        `call delta at spot ${inputs.spot}`,
      );
      expectRelative(
        putGreeks(inputs).delta,
        centralDifference((spot) => bsPut({ ...inputs, spot }), inputs.spot, 1e-4),
        1e-6,
        `put delta at spot ${inputs.spot}`,
      );
    }
  });

  it('reproduces gamma', () => {
    for (const inputs of cases) {
      const h = 0.01;
      const second =
        (bsCall({ ...inputs, spot: inputs.spot + h }) -
          2 * bsCall(inputs) +
          bsCall({ ...inputs, spot: inputs.spot - h })) /
        (h * h);
      expectRelative(callGreeks(inputs).gamma, second, 1e-5, `gamma at spot ${inputs.spot}`);
    }
  });

  it('reproduces vega', () => {
    for (const inputs of cases) {
      expectRelative(
        callGreeks(inputs).vega,
        centralDifference(
          (volatility) => bsCall({ ...inputs, volatility }),
          inputs.volatility,
          1e-5,
        ),
        1e-6,
        `vega at volatility ${inputs.volatility}`,
      );
    }
  });

  it('reproduces theta, which is the negative of the derivative in time to expiry', () => {
    for (const inputs of cases) {
      const numerical = -centralDifference(
        (timeToExpiry) => bsCall({ ...inputs, timeToExpiry }),
        inputs.timeToExpiry,
        1e-6,
      );
      expectRelative(
        callGreeks(inputs).theta,
        numerical,
        1e-5,
        `theta at T ${inputs.timeToExpiry}`,
      );
    }
  });

  it('reproduces rho', () => {
    for (const inputs of cases) {
      expectRelative(
        callGreeks(inputs).rho,
        centralDifference(
          (riskFreeRate) => bsCall({ ...inputs, riskFreeRate }),
          inputs.riskFreeRate,
          1e-6,
        ),
        1e-6,
        `call rho at r ${inputs.riskFreeRate}`,
      );
      expectRelative(
        putGreeks(inputs).rho,
        centralDifference(
          (riskFreeRate) => bsPut({ ...inputs, riskFreeRate }),
          inputs.riskFreeRate,
          1e-6,
        ),
        1e-6,
        `put rho at r ${inputs.riskFreeRate}`,
      );
    }
  });
});

describe('structural relationships', () => {
  it('keeps call and put delta separated by exactly the dividend discount factor', () => {
    for (const spot of [60, 100, 175]) {
      const inputs = { ...base, spot };
      const difference = callGreeks(inputs).delta - putGreeks(inputs).delta;
      expect(difference).toBeCloseTo(Math.exp(-0.02 * inputs.timeToExpiry), 14);
    }
  });

  it('satisfies the Black-Scholes PDE, which ties four outputs into one equation', () => {
    // theta + (1/2) sigma^2 S^2 gamma + (r - q) S delta - r V = 0
    //
    // The strongest structural check in the library: it constrains theta, gamma, delta and the
    // price simultaneously, and is not satisfiable by four values that are individually
    // plausible. Worst relative residual measured across the whole documented domain: 1.0e-14.
    for (const inputs of [
      base,
      {
        ...base,
        spot: 42,
        strike: 40,
        timeToExpiry: 0.5,
        riskFreeRate: 0.1,
        volatility: 0.2,
        dividendYield: 0,
      },
      {
        ...base,
        spot: 130,
        strike: 90,
        timeToExpiry: 3,
        riskFreeRate: -0.01,
        volatility: 0.8,
        dividendYield: 0.07,
      },
      { ...base, spot: 10_000, strike: 1, timeToExpiry: 10, volatility: 5 },
      { ...base, spot: 1, strike: 10_000, timeToExpiry: 1 / 365, volatility: 0.001 },
    ]) {
      for (const optionType of ['call', 'put'] as const) {
        const greeks = optionType === 'call' ? callGreeks(inputs) : putGreeks(inputs);
        const value = optionType === 'call' ? bsCall(inputs) : bsPut(inputs);
        const yield_ = inputs.dividendYield ?? 0;

        const terms = [
          greeks.theta,
          0.5 * inputs.volatility ** 2 * inputs.spot ** 2 * greeks.gamma,
          (inputs.riskFreeRate - yield_) * inputs.spot * greeks.delta,
          -inputs.riskFreeRate * value,
        ];

        // The terms span many orders of magnitude across the domain, so the residual is judged
        // against the largest of them rather than against an absolute floor.
        const scale = Math.max(...terms.map(Math.abs), 1);
        const residual = Math.abs(terms.reduce((total, term) => total + term, 0));

        expect(
          residual / scale,
          `${optionType} at S=${inputs.spot} K=${inputs.strike} T=${inputs.timeToExpiry}: ` +
            `residual ${residual.toExponential(2)} against scale ${scale.toExponential(2)}`,
        ).toBeLessThan(1e-12);
      }
    }
  });

  it('would fail the PDE if theta were scaled to a per-day unit', () => {
    // The point of the test above is not only that the Greeks are right. It is that the unit
    // convention is machine-enforced: theta per year is the unit in which the identity holds
    // without a conversion factor, and anything else breaks it by a factor of 365.
    const greeks = callGreeks(base);
    const value = bsCall(base);
    const yield_ = base.dividendYield ?? 0;

    const rest =
      0.5 * base.volatility ** 2 * base.spot ** 2 * greeks.gamma +
      (base.riskFreeRate - yield_) * base.spot * greeks.delta -
      base.riskFreeRate * value;

    expect(Math.abs(greeks.theta + rest)).toBeLessThan(1e-10);
    expect(Math.abs(thetaPerCalendarDay(greeks.theta) + rest)).toBeGreaterThan(1);
  });

  it('gives a call and a put identical gamma and vega', () => {
    for (const spot of [60, 100, 175]) {
      const inputs = { ...base, spot };
      expect(callGreeks(inputs).gamma).toBe(putGreeks(inputs).gamma);
      expect(callGreeks(inputs).vega).toBe(putGreeks(inputs).vega);
    }
  });

  it('respects the sign and bound conventions', () => {
    for (const spot of [1, 40, 100, 260, 10_000]) {
      const inputs = { ...base, spot };
      const call = callGreeks(inputs);
      const put = putGreeks(inputs);

      expect(call.delta).toBeGreaterThanOrEqual(0);
      expect(call.delta).toBeLessThanOrEqual(1);
      expect(put.delta).toBeGreaterThanOrEqual(-1);
      expect(put.delta).toBeLessThanOrEqual(0);
      expect(call.gamma).toBeGreaterThanOrEqual(0);
      expect(call.vega).toBeGreaterThanOrEqual(0);
      expect(call.rho).toBeGreaterThanOrEqual(0);
      expect(put.rho).toBeLessThanOrEqual(0);
    }
  });
});

describe('boundary cases', () => {
  it('reports the payoff slope once there is no time left', () => {
    const atExpiry = { ...base, timeToExpiry: 0 };

    expect(callGreeks({ ...atExpiry, spot: 120 }).delta).toBe(1);
    expect(callGreeks({ ...atExpiry, spot: 80 }).delta).toBe(0);
    expect(putGreeks({ ...atExpiry, spot: 80 }).delta).toBe(-1);
    expect(putGreeks({ ...atExpiry, spot: 120 }).delta).toBe(0);

    // Exactly at the kink the payoff has no derivative, and 0.5 is not a choice from within
    // the subgradient: it is the limit of the analytic delta approached from inside the domain,
    // where d1 = sigma sqrt(T) / 2 tends to 0. See the boundary rule in docs/MATH.md 6.2.
    expect(callGreeks({ ...atExpiry, spot: 100 }).delta).toBe(0.5);
    expect(putGreeks({ ...atExpiry, spot: 100 }).delta).toBe(-0.5);
  });

  it('reports zero gamma and vega at the boundary, away from the kink', () => {
    for (const inputs of [
      { ...base, timeToExpiry: 0 },
      { ...base, volatility: 0 },
    ]) {
      expect(callGreeks(inputs).gamma).toBe(0);
      expect(callGreeks(inputs).vega).toBe(0);
    }
  });

  it('reports the finite one-sided vega at the kink, where gamma diverges but vega does not', () => {
    // Regression. Gamma's limit at the kink is a Dirac delta and is reported as 0. Vega is a
    // different matter and the same reasoning does not carry over: approaching from sigma > 0 at
    // the forward-at-the-money point, d1 = sigma sqrt(T) / 2 tends to 0, so vega tends to
    // S e^(-qT) sqrt(T) phi(0) — finite and large. Reporting 0 put a jump discontinuity into the
    // library's own output.
    for (const [spot, riskFreeRate, timeToExpiry] of [
      [100, 0, 1],
      [100, 0.05, 1],
      [100, 0.05, 4],
      [50, -0.02, 0.25],
    ] as const) {
      // r = q puts the forward exactly on the strike, which is where the kink is.
      const atKink = {
        spot,
        strike: spot,
        timeToExpiry,
        riskFreeRate,
        dividendYield: riskFreeRate,
        volatility: 0,
      };

      const expected =
        spot * Math.exp(-riskFreeRate * timeToExpiry) * Math.sqrt(timeToExpiry) * normalPdf(0);

      expect(
        callGreeks(atKink).vega,
        `spot ${spot}, r ${riskFreeRate}, T ${timeToExpiry}`,
      ).toBeCloseTo(expected, 10);
      expect(putGreeks(atKink).vega).toBeCloseTo(expected, 10);

      // And it is continuous: the analytic branch at the smallest representable volatility must
      // agree with the boundary branch at exactly zero.
      const justAbove = callGreeks({ ...atKink, volatility: Number.MIN_VALUE });
      expect(justAbove.vega).toBeCloseTo(callGreeks(atKink).vega, 10);
    }
  });

  it('still reports zero vega at the boundary when the forward is not on the strike', () => {
    // Away from the kink the value approaches intrinsic exponentially fast in 1/sigma^2, so 0 is
    // the right answer and the fix above must not have widened.
    for (const strike of [80, 130]) {
      const offKink = { ...base, strike, volatility: 0 };
      expect(callGreeks(offKink).vega).toBe(0);
      expect(putGreeks(offKink).vega).toBe(0);
    }
  });

  it('approaches the boundary values continuously from inside the domain', () => {
    const deep = { ...base, spot: 140, dividendYield: 0 };
    expect(callGreeks({ ...deep, timeToExpiry: 1e-8 }).delta).toBeCloseTo(1, 6);
    expect(callGreeks({ ...deep, volatility: 1e-8 }).delta).toBeCloseTo(1, 6);
    expect(callGreeks({ ...deep, timeToExpiry: 1e-8 }).gamma).toBeCloseTo(0, 6);
  });

  it('never returns NaN or Infinity at the boundary', () => {
    for (const inputs of [
      { ...base, timeToExpiry: 0 },
      { ...base, volatility: 0 },
      { ...base, timeToExpiry: 0, spot: 100, strike: 100 },
    ]) {
      for (const value of Object.values(callGreeks(inputs))) {
        expect(Number.isFinite(value)).toBe(true);
      }
      for (const value of Object.values(putGreeks(inputs))) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });
});

describe('the individual accessors', () => {
  it('return the same numbers as the bundle', () => {
    expect(delta({ ...base, optionType: 'call' })).toBe(callGreeks(base).delta);
    expect(delta({ ...base, optionType: 'put' })).toBe(putGreeks(base).delta);
    expect(gamma(base)).toBe(callGreeks(base).gamma);
    expect(vega(base)).toBe(callGreeks(base).vega);
    expect(theta({ ...base, optionType: 'put' })).toBe(putGreeks(base).theta);
    expect(rho({ ...base, optionType: 'call' })).toBe(callGreeks(base).rho);
  });

  it('reject an unknown option type', () => {
    // @ts-expect-error deliberately passing a value the type system forbids
    expect(() => optionGreeks({ ...base, optionType: 'butterfly' })).toThrow(InvalidInputError);
  });

  it('reject invalid inputs the same way pricing does', () => {
    expect(() => callGreeks({ ...base, spot: -1 })).toThrow(/spot/);
    expect(() => putGreeks({ ...base, volatility: Number.NaN })).toThrow(InvalidInputError);
  });
});
