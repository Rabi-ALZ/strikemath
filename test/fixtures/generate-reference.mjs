/**
 * Generates `normal-reference.json`: ground-truth values for the standard normal distribution.
 *
 * Everything here is exact rational / fixed-point arithmetic on BigInt. No double-precision
 * value is used anywhere in the computation, so the output is independent of the library it is
 * used to test — and independent of any published table.
 *
 *   phi(x) = exp(-x^2/2) / sqrt(2*pi)
 *   N(x)   = 1/2 + phi(x) * SUM_{n>=0} x^(2n+1) / (2n+1)!!      (convergent for every real x)
 *   Q(x)   = 1 - N(x)
 *
 * pi comes from Machin's formula, so not even that constant is taken on trust.
 *
 * Precision is adaptive. Computing Q(x) for large x subtracts two numbers that agree to
 * roughly x^2 / (2 ln 10) digits, so the working precision is chosen to leave a comfortable
 * margin beyond that cancellation. Getting this wrong is silent: the result still looks like a
 * number, it is just wrong in the digits that matter.
 *
 * Usage: node test/fixtures/generate-reference.mjs
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Working precision in decimal digits for a given |x|.
 *
 * The subtraction `1/2 - phi(x) * S(x)` loses about `x^2 / (2 ln 10)` digits to cancellation,
 * but that is only half the cost: `phi(x)` is itself of order `10^(-x^2 / (2 ln 10))`, so at a
 * fixed-point scale of `10^-P` it carries only `P - x^2 / (2 ln 10)` significant digits to
 * begin with. The two effects compound, and the requirement is `P > x^2 / ln 10` plus margin.
 *
 * Halving that exponent by mistake is silent — the result still looks like a number and is
 * simply wrong in the digits being asserted on. Measured at x = 37 with P = 600: relative
 * error 3.5e-4.
 */
function precisionFor(x) {
  return 200 + Math.ceil((x * x) / Math.LN10) + 120;
}

/**
 * Renders a double as the exact decimal it actually is — every double is a finite decimal,
 * because it is an integer times a power of two.
 *
 * The reference values must be computed at this exact binary value, not at the decimal literal
 * a human wrote. `4.6` is really 4.5999999999999996447..., and evaluating Q there rather than
 * at 4.6 shifts the result by z * dz = 1.6e-15 relative — which would otherwise look like a
 * 1.6e-15 inaccuracy in the library instead of what it is.
 */
function exactDecimalOfDouble(value) {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0);

  const negative = bits >> 63n === 1n;
  const exponentBits = Number((bits >> 52n) & 0x7ffn);
  const mantissaBits = bits & 0xfffffffffffffn;

  const mantissa = exponentBits === 0 ? mantissaBits : mantissaBits | 0x10000000000000n;
  const exponent = exponentBits === 0 ? -1074 : exponentBits - 1075;

  if (mantissa === 0n) return '0';

  let text;
  if (exponent >= 0) {
    text = (mantissa << BigInt(exponent)).toString();
  } else {
    const scaled = (mantissa * 5n ** BigInt(-exponent)).toString().padStart(-exponent + 1, '0');
    const split = scaled.length + exponent;
    text = `${scaled.slice(0, split)}.${scaled.slice(split)}`;
  }
  return negative ? `-${text}` : text;
}

function makeMath(digits) {
  const P = BigInt(digits);
  const SCALE = 10n ** P;

  const mul = (a, b) => (a * b) / SCALE;
  const div = (a, b) => (a * SCALE) / b;

  function isqrt(n) {
    if (n < 2n) return n;
    let x = 1n << (BigInt(n.toString(2).length) / 2n + 1n);
    for (;;) {
      const y = (x + n / x) >> 1n;
      if (y >= x) return x;
      x = y;
    }
  }

  function arctanInv(n) {
    const nn = BigInt(n) * BigInt(n);
    let power = SCALE / BigInt(n);
    let sum = power;
    let k = 1n;
    for (;;) {
      power = power / nn;
      if (power === 0n) break;
      const term = power / (2n * k + 1n);
      if (term === 0n) break;
      sum += k % 2n === 1n ? -term : term;
      k += 1n;
    }
    return sum;
  }

  const PI = 16n * arctanInv(5) - 4n * arctanInv(239);
  const SQRT_2PI = isqrt(2n * PI * SCALE);

  /** exp(x) for fixed-point x >= 0. Every term is positive, so nothing cancels. */
  function exp(x) {
    let term = SCALE;
    let sum = SCALE;
    for (let n = 1n; ; n += 1n) {
      term = (term * x) / SCALE / n;
      if (term === 0n) break;
      sum += term;
    }
    return sum;
  }

  /** Parses an exact decimal literal such as "1.96" into fixed point without rounding. */
  function fix(literal) {
    const text = String(literal);
    const negative = text.startsWith('-');
    const [whole, frac = ''] = (negative ? text.slice(1) : text).split('.');
    const padded = (frac + '0'.repeat(digits)).slice(0, digits);
    const value = BigInt(whole) * SCALE + BigInt(padded);
    return negative ? -value : value;
  }

  const phi = (x) => div(SCALE, mul(exp(mul(x, x) / 2n), SQRT_2PI));

  /** SUM_{n>=0} x^(2n+1) / (2n+1)!! */
  function oddSeries(x) {
    const x2 = mul(x, x);
    let term = x;
    let sum = x;
    for (let n = 0n; ; n += 1n) {
      term = mul(term, x2) / (2n * n + 3n);
      if (term === 0n) break;
      sum += term;
    }
    return sum;
  }

  const cdf = (x) => SCALE / 2n + mul(phi(x), oddSeries(x));

  /** Renders fixed point as scientific notation with `significant` correctly rounded digits. */
  function toScientific(v, significant = 40) {
    if (v === 0n) return '0';
    const negative = v < 0n;
    const a = negative ? -v : v;
    const s = a.toString();
    let exponent = s.length - 1 - digits;

    let head = BigInt(s.slice(0, significant).padEnd(significant, '0'));
    if (s.length > significant && s.charCodeAt(significant) - 48 >= 5) {
      head += 1n;
      if (head.toString().length > significant) {
        head /= 10n;
        exponent += 1;
      }
    }

    const text = head.toString();
    return `${negative ? '-' : ''}${text[0]}.${text.slice(1)}e${exponent}`;
  }

  return { SCALE, fix, phi, cdf, div, mul, toScientific };
}

/**
 * Computes a value at two different working precisions and returns it only if the digits agree.
 *
 * Insufficient precision fails silently here — the answer still looks like a number. Agreement
 * between an independent, higher-precision run is the cheapest guard against shipping a
 * reference value that is wrong in exactly the digits the tests assert on.
 */
function stable(label, compute, digits) {
  const low = compute(makeMath(digits));
  const high = compute(makeMath(digits + 150));
  if (low !== high) {
    throw new Error(
      `precision check failed for ${label}: ${digits} digits gives ${low}, ` +
        `${digits + 150} digits gives ${high}`,
    );
  }
  return low;
}

/** phi(x), evaluated at the exact double nearest `literal`. */
function referencePdf(literal) {
  const exact = exactDecimalOfDouble(Number(literal));
  const digits = precisionFor(Math.abs(Number(literal)));
  return stable(`phi(${literal})`, (m) => m.toScientific(m.phi(m.fix(exact))), digits);
}

/**
 * N(x), evaluated at the exact double nearest `literal`. Negative x lands on the small side of
 * the distribution, which is where relative accuracy is the meaningful measure.
 */
function referenceCdf(literal) {
  const exact = exactDecimalOfDouble(Number(literal));
  const digits = precisionFor(Math.abs(Number(literal)));
  return stable(`N(${literal})`, (m) => m.toScientific(m.cdf(m.fix(exact))), digits);
}

/** The p-quantile, by Newton's method carried out entirely in fixed point. */
function referenceQuantile(literal, seed) {
  const exact = exactDecimalOfDouble(Number(literal));
  return stable(
    `z(${literal})`,
    (m) => {
      const p = m.fix(exact);
      let x = m.fix(seed);
      for (let i = 0; i < 10; i += 1) {
        x = x - m.div(m.cdf(x) - p, m.phi(x));
      }
      return m.toScientific(x);
    },
    precisionFor(9),
  );
}

const PDF_POINTS = ['0', '0.5', '1', '1.96', '2.5', '3', '5', '8', '10'];

const CDF_POINTS = [
  '0',
  '0.5',
  '1',
  '1.5',
  '1.96',
  '2',
  '2.5',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '10',
  '-0.5',
  '-1',
  '-1.5',
  '-1.96',
  '-2',
  '-2.5',
  '-3',
  '-3.5',
  '-4',
  '-4.6',
  '-5',
  '-5.5',
  '-6',
  '-6.5',
  '-7',
  '-7.07106781186547',
  '-7.5',
  '-8',
  '-9',
  '-10',
  '-12',
  '-15',
  '-20',
  '-25',
  '-30',
  '-36',
  // Past the z = 37 mark that a truncating implementation would report as 0. Q(-37) is 5.7e-300,
  // eight orders of magnitude above the smallest normal double.
  '-37',
  // Points chosen to exercise the relative-accuracy floor in the tail.
  //
  // Relative accuracy above the branch point is limited by the rounding of u = z^2/2 inside
  // exp(-u), since d(exp(-u))/exp(-u) = -du. Most of the values above are integers, half-integers
  // or round decimals — what a person writes down — and for those u is usually exact, so the
  // floor vanishes. Measuring only there reported a floor of 2.4e-16 where the true figure is
  // 5.2e-15. See docs/MATH.md §3.4 and the DECISIONS entries of 2026-08-01.
  //
  // Each of these five is verified — in exact arithmetic, not by eye — to have |du| large enough
  // that the floor it implies exceeds the 1e-15 tolerance the other tail points are held to. Two
  // earlier attempts at this list did not meet that bar, and both failed by being chosen because
  // they looked awkward rather than measured: 6.75 is 27/4, so u = 22.78125 is exact in binary and
  // |du| is 0 — a member of the very set the point was meant to avoid — while 4.36 and 4.87 gave
  // |du| of 1.5e-16 and 7.5e-16, small enough that both would have passed the strict tolerance
  // unchanged.
  //
  // Note that "u is exact" is not the same test as "the point demonstrates the floor". Among the
  // values above, -4.6 and -7.07106781186547 also have inexact u, but with |du| of 7.1e-17 and
  // 3.1e-16 they clear 1e-15 comfortably and belong with the strict group.
  '-4.28',
  '-6.83',
  '-11.6',
  '-13.3',
  '-14.7',
];

const QUANTILE_POINTS = [
  ['0.0001', '-3.7'],
  ['0.001', '-3.09'],
  ['0.01', '-2.32'],
  ['0.025', '-1.95'],
  ['0.05', '-1.64'],
  ['0.1', '-1.28'],
  ['0.25', '-0.67'],
  ['0.5', '0'],
  ['0.75', '0.67'],
  ['0.9', '1.28'],
  ['0.95', '1.64'],
  ['0.975', '1.95'],
  ['0.99', '2.32'],
  ['0.999', '3.09'],
  ['0.9999', '3.7'],
];

const fixture = {
  $comment:
    'Ground truth for the standard normal distribution, computed in exact BigInt fixed-point ' +
    'arithmetic at adaptive precision. Regenerate with: node test/fixtures/generate-reference.mjs. ' +
    'These values are reference data, not expectations tuned to an implementation — never edit ' +
    'them to make a test pass.',
  evaluatedAt:
    'Each value is computed at the exact IEEE-754 double nearest the printed x (or p), not at ' +
    'the decimal literal, so a test may compare against it without a tolerance for the gap ' +
    'between the two.',
  method: 'N(x) = 1/2 + phi(x) * sum_{n>=0} x^(2n+1)/(2n+1)!!, pi from Machin arctan series',
  significantDigits: 40,
  pdf: PDF_POINTS.map((x) => ({ x, value: referencePdf(x) })),
  cdf: CDF_POINTS.map((x) => ({ x, value: referenceCdf(x) })),
  quantile: QUANTILE_POINTS.map(([p, seed]) => ({ p, value: referenceQuantile(p, seed) })),
};

const target = join(dirname(fileURLToPath(import.meta.url)), 'normal-reference.json');
writeFileSync(target, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`wrote ${target}`);
console.log(
  `  ${fixture.pdf.length} pdf, ${fixture.cdf.length} cdf, ${fixture.quantile.length} quantile points`,
);
