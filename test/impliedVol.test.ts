import { fc, test as propertyTest } from '@fast-check/vitest';
import { describe, expect, it } from 'vitest';
import {
  ConvergenceError,
  DEFAULT_PRICE_TOLERANCE,
  MAX_IMPLIED_VOLATILITY,
  impliedVolatility,
} from '../src/volatility/impliedVol.js';
import { bsCall, bsPrice, bsPut } from '../src/pricing/blackScholes.js';
import { vega } from '../src/greeks/analytical.js';
import { InvalidInputError } from '../src/utils/validate.js';

const base = {
  spot: 100,
  strike: 100,
  timeToExpiry: 1,
  riskFreeRate: 0.05,
  dividendYield: 0.01,
} as const;

describe('recovering a known volatility', () => {
  it('inverts the Hull example back to 20%', () => {
    const recovered = impliedVolatility({
      optionPrice: bsCall({
        spot: 42,
        strike: 40,
        timeToExpiry: 0.5,
        riskFreeRate: 0.1,
        volatility: 0.2,
      }),
      spot: 42,
      strike: 40,
      timeToExpiry: 0.5,
      riskFreeRate: 0.1,
      optionType: 'call',
    });

    expect(recovered).toBeCloseTo(0.2, 10);
  });

  it('recovers the volatility across moneyness, maturity and both sides', () => {
    for (const volatility of [0.05, 0.2, 0.75, 2, 4.5]) {
      for (const spot of [60, 95, 100, 105, 180]) {
        for (const timeToExpiry of [1 / 52, 0.5, 3]) {
          for (const optionType of ['call', 'put'] as const) {
            const inputs = { ...base, spot, timeToExpiry, volatility };
            const optionPrice = bsPrice({ ...inputs, optionType });

            // Where vega has collapsed the price carries no information about volatility, and
            // no solver can recover it. That is a property of the contract, not of the solver.
            const slope = vega(inputs);
            if (slope < 1e-8) continue;

            const recovered = impliedVolatility({
              ...base,
              spot,
              timeToExpiry,
              optionPrice,
              optionType,
            });

            // How precisely volatility can be recovered is set by vega, not by the solver: the
            // price is matched to `priceTolerance`, and dSigma = dPrice / vega. A deep
            // out-of-the-money weekly has a vega of ~3e-5, so even an exactly matched price
            // pins sigma only to about 3e-6. Asserting a fixed tolerance here would be
            // asserting something about the contract, not about this implementation.
            const budget = Math.max(1e-9, (10 * DEFAULT_PRICE_TOLERANCE) / slope);
            expect(
              Math.abs(recovered - volatility),
              `sigma ${volatility}, spot ${spot}, T ${timeToExpiry}, ${optionType}, ` +
                `vega ${slope.toExponential(2)}, budget ${budget.toExponential(2)}`,
            ).toBeLessThanOrEqual(budget);

            // The price round trip, which is what the solver actually promises, holds
            // regardless of how flat vega is.
            const reprice = bsPrice({
              ...base,
              spot,
              timeToExpiry,
              volatility: recovered,
              optionType,
            });
            expect(Math.abs(reprice - optionPrice)).toBeLessThan(1e-6);
          }
        }
      }
    }
  });

  it('agrees between a call and a put at the same strike', () => {
    // Put-call parity means both carry the same information about volatility.
    const inputs = { ...base, spot: 115, volatility: 0.32 };
    const fromCall = impliedVolatility({
      ...base,
      spot: 115,
      optionPrice: bsCall(inputs),
      optionType: 'call',
    });
    const fromPut = impliedVolatility({
      ...base,
      spot: 115,
      optionPrice: bsPut(inputs),
      optionType: 'put',
    });

    expect(fromCall).toBeCloseTo(fromPut, 8);
  });
});

describe('price round trip', () => {
  it('reproduces the input price to within 1e-6', () => {
    for (const volatility of [0.01, 0.15, 0.6, 3]) {
      for (const spot of [50, 100, 150]) {
        for (const optionType of ['call', 'put'] as const) {
          const inputs = { ...base, spot, volatility };
          const optionPrice = bsPrice({ ...inputs, optionType });
          const recovered = impliedVolatility({ ...base, spot, optionPrice, optionType });
          const reprice = bsPrice({ ...base, spot, volatility: recovered, optionType });

          expect(Math.abs(reprice - optionPrice)).toBeLessThan(1e-6);
        }
      }
    }
  });
});

describe('arbitrage and bracket boundaries', () => {
  it('rejects a price below discounted intrinsic', () => {
    const intrinsic = 100 * Math.exp(-0.01) - 80 * Math.exp(-0.05);
    expect(() =>
      impliedVolatility({ ...base, strike: 80, optionPrice: intrinsic - 1, optionType: 'call' }),
    ).toThrow(InvalidInputError);
  });

  it('rejects a price above the no-arbitrage upper bound', () => {
    // A call can never be worth more than the dividend-discounted spot.
    expect(() => impliedVolatility({ ...base, optionPrice: 100, optionType: 'call' })).toThrow(
      /upper bound/,
    );

    // Nor a put more than the discounted strike.
    expect(() => impliedVolatility({ ...base, optionPrice: 100, optionType: 'put' })).toThrow(
      /upper bound/,
    );
  });

  it('reports a price above the bracket as a convergence failure, not as arbitrage', () => {
    // Inside the static bounds but above the price at 500% volatility: the input is legitimate,
    // the solver simply does not search that far.
    const ceiling = bsCall({ ...base, volatility: MAX_IMPLIED_VOLATILITY });
    const upperBound = 100 * Math.exp(-0.01);
    const between = (ceiling + upperBound) / 2;

    expect(between).toBeGreaterThan(ceiling);
    expect(between).toBeLessThan(upperBound);
    expect(() => impliedVolatility({ ...base, optionPrice: between, optionType: 'call' })).toThrow(
      ConvergenceError,
    );
  });

  it('reports a price below the bracket floor as a convergence failure, not as arbitrage', () => {
    // At the forward the discounted intrinsic is 0, but the price at the bracket's smallest
    // volatility is not — it is about 4e-5. A price between the two violates no arbitrage bound;
    // the implied volatility is real, just smaller than this solver searches for. That is a
    // ConvergenceError, and the message has to say which of the two it is.
    const timeToExpiry = 1;
    const riskFreeRate = 0.05;
    const dividendYield = 0.01;
    const spot = 100;
    const strike = spot * Math.exp((riskFreeRate - dividendYield) * timeToExpiry);

    const atFloor = bsCall({
      spot,
      strike,
      timeToExpiry,
      riskFreeRate,
      dividendYield,
      volatility: 1e-6,
    });
    expect(atFloor).toBeGreaterThan(1e-8);

    expect(() =>
      impliedVolatility({
        spot,
        strike,
        timeToExpiry,
        riskFreeRate,
        dividendYield,
        optionPrice: atFloor / 1000,
        optionType: 'call',
      }),
    ).toThrow(ConvergenceError);
  });

  it('returns the collapsed bracket rather than failing when the tolerance is unreachable', () => {
    // A tolerance below the resolution of a double can never be met. The bracket still narrows to
    // adjacent representable volatilities, and that midpoint is the best answer that exists — so
    // it is returned, not thrown away.
    const optionPrice = bsCall({ ...base, volatility: 0.37 });
    const recovered = impliedVolatility({
      ...base,
      optionPrice,
      optionType: 'call',
      priceTolerance: 1e-300,
      maxIterations: 200,
    });

    expect(recovered).toBeCloseTo(0.37, 12);
    expect(Number.isFinite(recovered)).toBe(true);
  });

  it('solves at the very edges of the bracket', () => {
    const atCeiling = bsCall({ ...base, volatility: MAX_IMPLIED_VOLATILITY });
    expect(impliedVolatility({ ...base, optionPrice: atCeiling, optionType: 'call' })).toBeCloseTo(
      MAX_IMPLIED_VOLATILITY,
      6,
    );
  });

  it('never returns NaN when it fails', () => {
    // Every failure path is an exception. This asserts the absence of the alternative.
    for (const optionPrice of [-1, 0, 1e9]) {
      let outcome: number | Error;
      try {
        outcome = impliedVolatility({ ...base, optionPrice, optionType: 'call' });
      } catch (error) {
        outcome = error as Error;
      }
      if (typeof outcome === 'number') {
        expect(Number.isNaN(outcome)).toBe(false);
      } else {
        expect(outcome).toBeInstanceOf(Error);
      }
    }
  });
});

describe('validation', () => {
  it('refuses to imply a volatility at expiry', () => {
    expect(() =>
      impliedVolatility({ ...base, timeToExpiry: 0, optionPrice: 5, optionType: 'call' }),
    ).toThrow(/undefined at or past expiry/);
  });

  it('rejects malformed inputs', () => {
    expect(() =>
      impliedVolatility({ ...base, spot: -1, optionPrice: 5, optionType: 'call' }),
    ).toThrow(/spot/);
    expect(() =>
      impliedVolatility({ ...base, optionPrice: Number.NaN, optionType: 'call' }),
    ).toThrow(/optionPrice/);
    // @ts-expect-error deliberately passing a value the type system forbids
    expect(() => impliedVolatility({ ...base, optionPrice: 5, optionType: 'digital' })).toThrow(
      InvalidInputError,
    );
    expect(() =>
      impliedVolatility({ ...base, optionPrice: 5, optionType: 'call', maxIterations: 0 }),
    ).toThrow(/maxIterations/);
  });

  it('reports non-convergence rather than returning a wrong number', () => {
    // One iteration cannot reach a tolerance of 1e-12 from the initial guess.
    expect(() =>
      impliedVolatility({
        ...base,
        optionPrice: bsCall({ ...base, volatility: 0.42 }),
        optionType: 'call',
        maxIterations: 1,
        priceTolerance: 1e-12,
      }),
    ).toThrow(ConvergenceError);
  });

  it('never returns a volatility that misses priceTolerance, even when the bracket collapses', () => {
    // The module's guarantee is that a returned volatility reproduces the input price to within
    // priceTolerance, and that failure is always an exception. Below roughly one ulp of the price
    // that tolerance is unreachable at any iteration count, because dSigma = dPrice / vega and the
    // bracket bottoms out at the resolution of a double.
    //
    // The early return on bracket collapse used to hand back the midpoint without checking. At
    // S = K = 10 000 with a tolerance of 1e-14, 32 of these 40 targets returned silently outside
    // tolerance, the worst by 205x. This asserts the guarantee itself rather than one case: every
    // returned value is inside tolerance, and every failure is a ConvergenceError.
    const contract = { spot: 10_000, strike: 10_000, timeToExpiry: 1, riskFreeRate: 0.05 };
    const priceTolerance = 1e-14;
    const view = new DataView(new ArrayBuffer(8));

    let optionPrice = bsCall({ ...contract, volatility: 0.3 });
    let refused = 0;

    for (let step = 0; step < 40; step += 1) {
      try {
        const volatility = impliedVolatility({
          ...contract,
          optionPrice,
          optionType: 'call',
          priceTolerance,
        });
        const residual = Math.abs(bsCall({ ...contract, volatility }) - optionPrice);

        expect(residual, `sigma ${volatility} at price ${optionPrice}`).toBeLessThanOrEqual(
          priceTolerance,
        );
      } catch (error) {
        expect(error, `at price ${optionPrice}`).toBeInstanceOf(ConvergenceError);
        expect((error as Error).message).toMatch(/resolution of a double|did not converge/);
        refused += 1;
      }

      view.setFloat64(0, optionPrice);
      view.setBigUint64(0, view.getBigUint64(0) + 1n);
      optionPrice = view.getFloat64(0);
    }

    // And the refusals are real, not a vacuous pass: this tolerance is genuinely unreachable here.
    expect(refused).toBeGreaterThan(0);
  });
});

describe('property: the solver inverts the pricer over the documented domain', () => {
  const inputs = fc.record({
    spot: fc.double({ min: 1, max: 10_000, noNaN: true, noDefaultInfinity: true }),
    strike: fc.double({ min: 1, max: 10_000, noNaN: true, noDefaultInfinity: true }),
    timeToExpiry: fc.double({ min: 1 / 365, max: 10, noNaN: true, noDefaultInfinity: true }),
    riskFreeRate: fc.double({ min: -0.02, max: 0.25, noNaN: true, noDefaultInfinity: true }),
    volatility: fc.double({ min: 0.001, max: 5, noNaN: true, noDefaultInfinity: true }),
    dividendYield: fc.double({ min: 0, max: 0.15, noNaN: true, noDefaultInfinity: true }),
  });

  propertyTest.prop([inputs, fc.constantFrom('call' as const, 'put' as const)], { numRuns: 1000 })(
    'price -> implied volatility -> price returns the original price',
    (draw, optionType) => {
      // Skip draws where the price carries no information about volatility: vega below this and
      // the inversion is ill-posed for any solver, not just this one.
      fc.pre(vega(draw) > 1e-8 * Math.max(1, draw.spot));

      const optionPrice = bsPrice({ ...draw, optionType });
      const { volatility: _ignored, ...withoutVolatility } = draw;

      const recovered = impliedVolatility({ ...withoutVolatility, optionPrice, optionType });
      const reprice = bsPrice({ ...draw, volatility: recovered, optionType });

      expect(Math.abs(reprice - optionPrice)).toBeLessThan(1e-6 * Math.max(1, optionPrice));
      expect(recovered).toBeGreaterThan(0);
      expect(Number.isFinite(recovered)).toBe(true);
    },
  );
});
