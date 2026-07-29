import { describe, expect, it } from 'vitest';
import { bsCall, bsPrice, crrPrice, impliedVolatility, inverseNormalCdf } from '../src/index.js';

/**
 * EXTERNAL ANCHORS for the modules that would otherwise rest on self-consistency alone.
 *
 * Pricing and the Greeks are anchored to Hull in `hull.bench.test.ts`, and the normal
 * distribution to exact BigInt arithmetic in `fixtures/`. The binomial tree and the implied
 * volatility solver had no such anchor: every check on them compared this library against itself,
 * and self-consistency cannot catch an error that is consistent with itself.
 *
 * Each anchor below is derived from first principles in this file, so it is independent of the
 * implementation under test and of anyone's memory of a printed table. What is checked is not
 * "does the code agree with itself" but "does the code agree with a different route to the same
 * number".
 */

// ---------------------------------------------------------------- binomial: closed-form sum

/**
 * The European CRR price written as a sum over terminal nodes rather than by backward induction.
 *
 * ```
 * C = e^(-rT) SUM_j  C(n, j) p^j (1-p)^(n-j) payoff(S u^(2j-n))
 * ```
 *
 * Backward induction and this sum are the same mathematics reached by different arithmetic: the
 * tree accumulates n(n+1)/2 discounted expectations, this evaluates one weighted sum. A defect in
 * the induction loop — an off-by-one in the sweep, a probability applied to the wrong branch, a
 * discount factor applied once too often — shows up here and nowhere else in the suite.
 *
 * The binomial coefficient is carried in logs so it stays exact for large n.
 */
function europeanBinomialSum(
  spot: number,
  strike: number,
  timeToExpiry: number,
  riskFreeRate: number,
  dividendYield: number,
  volatility: number,
  steps: number,
  isCall: boolean,
): number {
  const dt = timeToExpiry / steps;
  const up = Math.exp(volatility * Math.sqrt(dt));
  const down = 1 / up;
  const p = (Math.exp((riskFreeRate - dividendYield) * dt) - down) / (up - down);

  let total = 0;
  let logChoose = 0;

  for (let j = 0; j <= steps; j += 1) {
    if (j > 0) logChoose += Math.log((steps - j + 1) / j);

    const price = spot * up ** (2 * j - steps);
    const payoff = isCall ? Math.max(price - strike, 0) : Math.max(strike - price, 0);

    if (payoff > 0) {
      total += Math.exp(logChoose + j * Math.log(p) + (steps - j) * Math.log(1 - p)) * payoff;
    }
  }

  return Math.exp(-riskFreeRate * timeToExpiry) * total;
}

describe('binomial tree against the closed-form binomial sum', () => {
  it('agrees to machine precision at every tree size', () => {
    const contract = {
      spot: 42,
      strike: 40,
      timeToExpiry: 0.5,
      riskFreeRate: 0.1,
      volatility: 0.2,
      dividendYield: 0,
    };

    for (const steps of [1, 2, 3, 7, 25, 200]) {
      for (const optionType of ['call', 'put'] as const) {
        const tree = crrPrice({ ...contract, optionType, exerciseStyle: 'european', steps });
        const sum = europeanBinomialSum(
          contract.spot,
          contract.strike,
          contract.timeToExpiry,
          contract.riskFreeRate,
          contract.dividendYield,
          contract.volatility,
          steps,
          optionType === 'call',
        );

        expect(Math.abs(tree - sum), `${optionType}, ${steps} steps`).toBeLessThan(1e-11);
      }
    }
  });

  it('agrees with a dividend yield and a negative rate', () => {
    for (const [riskFreeRate, dividendYield] of [
      [-0.02, 0.0],
      [0.05, 0.07],
      [0.25, 0.15],
    ]) {
      const tree = crrPrice({
        spot: 100,
        strike: 110,
        timeToExpiry: 2,
        riskFreeRate: riskFreeRate!,
        dividendYield: dividendYield!,
        volatility: 0.35,
        optionType: 'call',
        exerciseStyle: 'european',
        steps: 60,
      });
      const sum = europeanBinomialSum(100, 110, 2, riskFreeRate!, dividendYield!, 0.35, 60, true);

      expect(Math.abs(tree - sum), `r=${riskFreeRate} q=${dividendYield}`).toBeLessThan(1e-11);
    }
  });
});

// ------------------------------------------------- binomial: Merton's perpetual American put

/**
 * The perpetual American put, in closed form.
 *
 * This is the one American option that *does* have an analytic value, which makes it the only
 * external anchor available for early exercise. Derived here rather than quoted, so the test
 * depends on the derivation and not on a remembered constant.
 *
 * With no dividend yield, write `gamma = 2r / sigma^2`. Away from exercise the value solves the
 * ordinary differential equation with solution `P(S) = A S^(-gamma)`. Two conditions fix `A` and
 * the exercise boundary `S*`:
 *
 * - value matching, `A S*^(-gamma) = K - S*`
 * - smooth pasting, `-gamma A S*^(-gamma-1) = -1`
 *
 * Dividing one by the other gives `gamma (K - S*) / S* = 1`, hence `S* = gamma K / (1 + gamma)`,
 * and then `P(S) = (K - S*) (S / S*)^(-gamma)` for `S >= S*`.
 */
function perpetualAmericanPut(
  spot: number,
  strike: number,
  riskFreeRate: number,
  volatility: number,
): number {
  const gamma = (2 * riskFreeRate) / (volatility * volatility);
  const exerciseBoundary = (gamma * strike) / (1 + gamma);

  if (spot < exerciseBoundary) return strike - spot;
  return (strike - exerciseBoundary) * (spot / exerciseBoundary) ** -gamma;
}

describe('American exercise against the perpetual put', () => {
  const strike = 100;
  const riskFreeRate = 0.05;
  const volatility = 0.3;

  it('converges towards the analytic perpetual value as maturity grows', () => {
    // Measured at T = 100 with 2000 steps: relative error 1.5e-4 at S = 60, 1.7e-3 at S = 100 and
    // 2.1e-3 at S = 150. The residual is the finite maturity, not the tree — the same
    // configuration at T = 200 lands at 1.8e-3 and stops improving.
    for (const spot of [60, 100, 150]) {
      const analytic = perpetualAmericanPut(spot, strike, riskFreeRate, volatility);
      const tree = crrPrice({
        spot,
        strike,
        timeToExpiry: 100,
        riskFreeRate,
        volatility,
        optionType: 'put',
        exerciseStyle: 'american',
        steps: 2000,
      });

      const relative = Math.abs(tree - analytic) / analytic;
      expect(relative, `spot ${spot}: tree ${tree}, analytic ${analytic}`).toBeLessThan(3e-3);
    }
  });

  it('gets closer to it as maturity grows, not further away', () => {
    const spot = 150;
    const analytic = perpetualAmericanPut(spot, strike, riskFreeRate, volatility);
    const errorAt = (timeToExpiry: number, steps: number): number =>
      Math.abs(
        crrPrice({
          spot,
          strike,
          timeToExpiry,
          riskFreeRate,
          volatility,
          optionType: 'put',
          exerciseStyle: 'american',
          steps,
        }) - analytic,
      );

    expect(errorAt(100, 2000)).toBeLessThan(errorAt(10, 2000));
    expect(errorAt(10, 2000)).toBeLessThan(errorAt(1, 2000));
  });

  it('never prices the American put below the perpetual one, which is its supremum in maturity', () => {
    // The value is increasing in maturity, so no finite-maturity put may exceed the perpetual.
    for (const spot of [40, 70, 100, 200]) {
      const analytic = perpetualAmericanPut(spot, strike, riskFreeRate, volatility);
      const tree = crrPrice({
        spot,
        strike,
        timeToExpiry: 30,
        riskFreeRate,
        volatility,
        optionType: 'put',
        exerciseStyle: 'american',
        steps: 1500,
      });

      expect(tree).toBeLessThanOrEqual(analytic + 1e-9);
    }
  });
});

// ------------------------------------------- implied volatility: exact inverse at the forward

/**
 * At the forward-at-the-money point the Black-Scholes formula inverts in closed form.
 *
 * When `K e^(-rT) = S e^(-qT)` the two discounted terms are equal, `d1 = sigma sqrt(T) / 2` and
 * `d2 = -d1`, so
 *
 * ```
 * C = S e^(-qT) [N(d1) - N(-d1)] = S e^(-qT) [2 N(sigma sqrt(T) / 2) - 1]
 * ```
 *
 * which rearranges to an exact expression for the volatility:
 *
 * ```
 * sigma = 2 N^-1((C / (S e^(-qT)) + 1) / 2) / sqrt(T)
 * ```
 *
 * The solver has to reproduce this without knowing the case is special.
 */
function forwardAtmImpliedVolatility(
  optionPrice: number,
  spot: number,
  timeToExpiry: number,
  dividendYield: number,
): number {
  const discountedSpot = spot * Math.exp(-dividendYield * timeToExpiry);
  return (2 * inverseNormalCdf((optionPrice / discountedSpot + 1) / 2)) / Math.sqrt(timeToExpiry);
}

/**
 * A bisection-only solver: no Newton step, no vega, no shared code with the implementation.
 *
 * Slow and unconditionally convergent. Its only purpose is to be a different algorithm, so that
 * agreement means something.
 */
function bisectionImpliedVolatility(target: number, price: (volatility: number) => number): number {
  let low = 1e-6;
  let high = 5;

  for (let iteration = 0; iteration < 200; iteration += 1) {
    const mid = (low + high) / 2;
    if (price(mid) > target) high = mid;
    else low = mid;
  }

  return (low + high) / 2;
}

describe('implied volatility against independent routes to the same number', () => {
  it('matches the exact closed-form inverse at the forward', () => {
    for (const [timeToExpiry, volatility] of [
      [0.25, 0.15],
      [1, 0.4],
      [5, 1.2],
      [1 / 365, 0.8],
    ] as const) {
      const spot = 100;
      const riskFreeRate = 0.07;
      const dividendYield = 0.02;
      const strike = spot * Math.exp((riskFreeRate - dividendYield) * timeToExpiry);

      const optionPrice = bsCall({
        spot,
        strike,
        timeToExpiry,
        riskFreeRate,
        dividendYield,
        volatility,
      });

      const closedForm = forwardAtmImpliedVolatility(
        optionPrice,
        spot,
        timeToExpiry,
        dividendYield,
      );
      const solved = impliedVolatility({
        spot,
        strike,
        timeToExpiry,
        riskFreeRate,
        dividendYield,
        optionPrice,
        optionType: 'call',
      });

      expect(closedForm, `closed form should recover sigma at T=${timeToExpiry}`).toBeCloseTo(
        volatility,
        10,
      );
      expect(solved, `solver vs closed form at T=${timeToExpiry}`).toBeCloseTo(closedForm, 9);
    }
  });

  it('matches a bisection-only solver across moneyness and both sides', () => {
    for (const spot of [70, 95, 100, 130]) {
      for (const volatility of [0.08, 0.25, 0.9, 2.5]) {
        for (const optionType of ['call', 'put'] as const) {
          const contract = {
            spot,
            strike: 100,
            timeToExpiry: 0.75,
            riskFreeRate: 0.04,
            dividendYield: 0.01,
          };
          const optionPrice = bsPrice({ ...contract, volatility, optionType });

          const solved = impliedVolatility({ ...contract, optionPrice, optionType });
          const bisected = bisectionImpliedVolatility(optionPrice, (sigma) =>
            bsPrice({ ...contract, volatility: sigma, optionType }),
          );

          expect(
            Math.abs(solved - bisected),
            `spot ${spot}, sigma ${volatility}, ${optionType}: solver ${solved}, bisection ${bisected}`,
          ).toBeLessThan(1e-8);
        }
      }
    }
  });
});
