import { describe, expect, it } from 'vitest';
import { normalCdf } from '../src/utils/normal.js';
import reference from './fixtures/normal-reference.json' with { type: 'json' };

/**
 * strikemath deviates from West (2005) in two constants: the branch point between Hart's
 * rational form and the Laplace continued fraction (3 rather than 7.07106781186547) and the
 * depth of that continued fraction (60 levels rather than 5).
 *
 * This file exists so the deviation stays a measured, reproducible claim rather than a note in
 * a document. West's published form is reimplemented here verbatim as a *comparison baseline*.
 * It is not an alternative implementation and there is no way to select it at runtime — the
 * library ships exactly one normal CDF.
 *
 * Both are scored against the same 40-digit ground truth in `fixtures/normal-reference.json`.
 */

const SQRT_2PI = Math.sqrt(2 * Math.PI);

/** West (2005), reproduced exactly as published: Hart's rational form below the branch point. */
function westHartRational(z: number): number {
  const density = Math.exp((-z * z) / 2);
  const numerator =
    ((((((0.0352624965998911 * z + 0.700383064443688) * z + 6.37396220353165) * z +
      33.912866078383) *
      z +
      112.079291497871) *
      z +
      221.213596169931) *
      z +
      220.206867912376) *
    density;
  const denominator =
    ((((((0.0883883476483184 * z + 1.75566716318264) * z + 16.064177579207) * z +
      86.7807322029461) *
      z +
      296.564248779674) *
      z +
      637.333633378831) *
      z +
      793.826512519948) *
      z +
    440.413735824752;
  return numerator / denominator;
}

/** West (2005), reproduced exactly as published: 5-level continued fraction with 0.65 terminator. */
function westContinuedFraction(z: number): number {
  const density = Math.exp((-z * z) / 2);
  let fraction = z + 0.65;
  fraction = z + 4 / fraction;
  fraction = z + 3 / fraction;
  fraction = z + 2 / fraction;
  fraction = z + 1 / fraction;
  return density / fraction / SQRT_2PI;
}

/** N(x) exactly as West publishes it, reflection included. */
function westNormalCdf(x: number): number {
  const z = Math.abs(x);
  const tail = z > 37 ? 0 : z < 7.07106781186547 ? westHartRational(z) : westContinuedFraction(z);
  return x >= 0 ? 1 - tail : tail;
}

function relativeError(actual: number, expected: number): number {
  if (expected === 0) return actual === 0 ? 0 : Number.POSITIVE_INFINITY;
  return Math.abs(actual - expected) / Math.abs(expected);
}

/** Fixture points on the lower tail, where relative accuracy is the meaningful measure. */
const tailPoints = reference.cdf
  .map((entry) => ({ x: Number(entry.x), truth: Number(entry.value) }))
  .filter((entry) => entry.x < 0);

describe('deviation from West (2005)', () => {
  it('reproduces the published algorithm as a baseline, and it satisfies its own claim', () => {
    // West's form is accurate to about 1e-16 in ABSOLUTE terms everywhere. That claim is true,
    // and it is the claim the published constants are tuned for.
    for (const { x, truth } of tailPoints) {
      expect(Math.abs(westNormalCdf(x) - truth), `absolute error at x = ${x}`).toBeLessThan(1e-16);
    }
  });

  it('shipped implementation is at least as accurate as published West at every fixture point', () => {
    for (const { x, truth } of tailPoints) {
      const ours = relativeError(normalCdf(x), truth);
      const theirs = relativeError(westNormalCdf(x), truth);
      expect(
        ours,
        `x = ${x}: ours ${ours.toExponential(2)} vs West ${theirs.toExponential(2)}`,
      ).toBeLessThanOrEqual(Math.max(theirs, 4 * Number.EPSILON));
    }
  });

  it('is more accurate by orders of magnitude where the published form degrades', () => {
    // The published 5-level continued fraction is truncated too early: its relative error grows
    // to ~1e-8 in the tail even though its absolute error stays near 1e-16, because the value
    // itself has become tiny. These are the measured numbers quoted in docs/DECISIONS.md.
    const cases: ReadonlyArray<readonly [string, number]> = [
      ['-5', 1e3],
      ['-7', 1e5],
      ['-8', 1e6],
      ['-10', 1e6],
    ];
    for (const [literal, minimumImprovement] of cases) {
      const entry = reference.cdf.find((candidate) => candidate.x === literal);
      expect(entry, `fixture for x = ${literal} is missing`).toBeDefined();
      const truth = Number(entry?.value);
      const x = Number(literal);
      const ours = relativeError(normalCdf(x), truth);
      const theirs = relativeError(westNormalCdf(x), truth);
      expect(
        theirs / Math.max(ours, Number.EPSILON),
        `x = ${literal}: ours ${ours.toExponential(2)}, West ${theirs.toExponential(2)}`,
      ).toBeGreaterThan(minimumImprovement);
    }
  });

  it('agrees with published West wherever the published form is still relatively accurate', () => {
    // Near the middle of the distribution the two forms are the same code, so they must agree
    // to the last bit. A difference here would mean the branch point moved something it should
    // not have.
    for (let x = -2.9; x <= 2.9; x += 0.1) {
      expect(normalCdf(x)).toBe(westNormalCdf(x));
    }
  });
});
