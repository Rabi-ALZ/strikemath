/**
 * Standard normal distribution: density, cumulative distribution and quantile function.
 *
 * The cumulative distribution uses Hart's (1968) rational approximation in the double-precision
 * form given by West (2005). It is deliberately not Abramowitz & Stegun 26.2.17, whose error
 * bound is |eps| < 7.5e-8. For a library that sells itself on correctness that difference is
 * free to take.
 *
 * One documented deviation from West's published constants: the branch point is lowered to 3
 * and the continued fraction deepened to 60 levels, which buys relative — not just absolute —
 * accuracy in the tail. Both variants are verified against 40-digit ground truth in
 * `test/normal.test.ts` and `test/normal.west-comparison.test.ts`; the measurements and the
 * reasoning are in docs/DECISIONS.md. There is no runtime switch between them.
 *
 * A separate and independent point: `normalCdf(-x) = 1 - normalCdf(x)` holds here by
 * construction, because both branches are computed from the same upper-tail routine. Put-call
 * parity depends on that reflection and on nothing else — it is a structural identity, not an
 * accuracy requirement. If a parity test ever fails, the fault is in the reflection or in the
 * input domain, never in how accurate this CDF is.
 *
 * Sources:
 * - Hart, J.F. et al. (1968), *Computer Approximations*, Wiley.
 * - West, G. (2005), "Better approximations to cumulative normal functions", Wilmott Magazine.
 * - Acklam, P.J. (2003), algorithm for the inverse normal cumulative distribution function.
 */

const SQRT_2PI = Math.sqrt(2 * Math.PI);
const INV_SQRT_2PI = 1 / SQRT_2PI;

/**
 * Branch point between Hart's rational approximation and the Laplace continued fraction.
 *
 * West (2005) publishes this at 7.07106781186547 with a 5-level continued fraction above it.
 * That choice is tuned for absolute accuracy, which it achieves — around 1e-16 across the whole
 * line. Its *relative* accuracy in the tail is a different matter: measured against 40-digit
 * ground truth, the published form is off by 2.6e-9 at z = 7 and 8.7e-9 at z = 8.
 *
 * Lowering the branch point to 3 and deepening the continued fraction to 60 levels costs about
 * 60 divisions on a branch that only deep out-of-the-money inputs reach, and buys five to seven
 * orders of magnitude of relative tail accuracy over the published form.
 *
 * Above the branch point the limit is no longer this approximation. It is the rounding of
 * `z * z / 2` in the exponential, which passes through as relative error because
 * `d(exp(-u))/exp(-u) = -du`. The measurements, the envelope and the reason a double-double fix
 * is declined are in docs/MATH.md §3.4, and the figures are deliberately not restated here — an
 * earlier copy of them in this comment drifted out of date and stayed wrong.
 */
const BODY_LIMIT = 3;

/**
 * Depth of the Laplace continued fraction. It converges for every z > 0; 60 levels reach the
 * double-precision floor at the branch point, and converge faster the further out z is.
 */
const CONTINUED_FRACTION_DEPTH = 60;

// Numerator coefficients of Hart's rational approximation, lowest power first.
const HART_P0 = 220.206867912376;
const HART_P1 = 221.213596169931;
const HART_P2 = 112.079291497871;
const HART_P3 = 33.912866078383;
const HART_P4 = 6.37396220353165;
const HART_P5 = 0.700383064443688;
const HART_P6 = 0.0352624965998911;

// Denominator coefficients of Hart's rational approximation, lowest power first.
const HART_Q0 = 440.413735824752;
const HART_Q1 = 793.826512519948;
const HART_Q2 = 637.333633378831;
const HART_Q3 = 296.564248779674;
const HART_Q4 = 86.7807322029461;
const HART_Q5 = 16.064177579207;
const HART_Q6 = 1.75566716318264;
const HART_Q7 = 0.0883883476483184;

/**
 * Upper tail probability `P(Z > z)` for `z >= 0`.
 *
 * Computing the tail directly — rather than as `1 - N(z)` — is what preserves *relative*
 * accuracy far out in the tail, where the probability itself is tiny.
 */
function upperTail(z: number): number {
  // There is deliberately no cutoff here. A cutoff at z = 37 is a common one, on the reasoning
  // that beyond it `1 - Q(z)` is indistinguishable from 1 — which is true, but says nothing
  // about Q itself. Q(37) is 5.7e-300, four orders of magnitude above the smallest normal
  // double, and stays representable to about z = 38.5. Truncating there would throw away
  // roughly nineteen orders of magnitude of exactly the relative tail accuracy this
  // implementation exists to provide.
  //
  // `Math.exp` underflows to 0 on its own at z ~ 38.6, and the continued fraction stays finite
  // for any z including Infinity, so the natural result is already 0 where 0 is correct.
  const density = Math.exp((-z * z) / 2);

  if (z < BODY_LIMIT) {
    const numerator =
      ((((((HART_P6 * z + HART_P5) * z + HART_P4) * z + HART_P3) * z + HART_P2) * z + HART_P1) * z +
        HART_P0) *
      density;
    const denominator =
      ((((((HART_Q7 * z + HART_Q6) * z + HART_Q5) * z + HART_Q4) * z + HART_Q3) * z + HART_Q2) * z +
        HART_Q1) *
        z +
      HART_Q0;
    return numerator / denominator;
  }

  // Laplace continued fraction  Q(z) = phi(z) / (z + 1/(z + 2/(z + 3/(z + ...)))),
  // evaluated from the deepest level upwards, which is the numerically stable direction.
  let fraction = z;
  for (let level = CONTINUED_FRACTION_DEPTH; level >= 1; level -= 1) {
    fraction = z + level / fraction;
  }
  return density / fraction / SQRT_2PI;
}

/**
 * Probability density function of the standard normal distribution.
 *
 * @param x - Point at which to evaluate the density.
 * @returns `phi(x) = exp(-x^2 / 2) / sqrt(2 * pi)`.
 */
export function normalPdf(x: number): number {
  if (Number.isNaN(x)) {
    throw new RangeError('normalPdf: x must be a number, received NaN');
  }
  return Math.exp((-x * x) / 2) * INV_SQRT_2PI;
}

/**
 * Cumulative distribution function of the standard normal distribution.
 *
 * The reflection `normalCdf(-x) = 1 - normalCdf(x)` holds to machine precision by construction:
 * both branches call the same upper-tail routine.
 *
 * @param x - Point at which to evaluate the distribution.
 * @returns `N(x) = P(Z <= x)` for a standard normal `Z`, in `[0, 1]`.
 */
export function normalCdf(x: number): number {
  if (Number.isNaN(x)) {
    throw new RangeError('normalCdf: x must be a number, received NaN');
  }
  return x >= 0 ? 1 - upperTail(x) : upperTail(-x);
}

// Acklam's coefficients for the central region, |p - 0.5| <= 0.5 - P_LOW.
const ACKLAM_A1 = -39.69683028665376;
const ACKLAM_A2 = 220.9460984245205;
const ACKLAM_A3 = -275.9285104469687;
const ACKLAM_A4 = 138.357751867269;
const ACKLAM_A5 = -30.66479806614716;
const ACKLAM_A6 = 2.506628277459239;

const ACKLAM_B1 = -54.47609879822406;
const ACKLAM_B2 = 161.5858368580409;
const ACKLAM_B3 = -155.6989798598866;
const ACKLAM_B4 = 66.80131188771972;
const ACKLAM_B5 = -13.28068155288572;

// Acklam's coefficients for the two tail regions.
const ACKLAM_C1 = -0.007784894002430293;
const ACKLAM_C2 = -0.3223964580411365;
const ACKLAM_C3 = -2.400758277161838;
const ACKLAM_C4 = -2.549732539343734;
const ACKLAM_C5 = 4.374664141464968;
const ACKLAM_C6 = 2.938163982698783;

const ACKLAM_D1 = 0.007784695709041462;
const ACKLAM_D2 = 0.3224671290700398;
const ACKLAM_D3 = 2.445134137142996;
const ACKLAM_D4 = 3.754408661907416;

/** Boundary between Acklam's tail branches and his central branch. */
const ACKLAM_P_LOW = 0.02425;

/** Acklam's rational approximation, relative error below 1.15e-9 over the whole open interval. */
function acklamQuantile(p: number): number {
  if (p < ACKLAM_P_LOW) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((ACKLAM_C1 * q + ACKLAM_C2) * q + ACKLAM_C3) * q + ACKLAM_C4) * q + ACKLAM_C5) * q +
        ACKLAM_C6) /
      ((((ACKLAM_D1 * q + ACKLAM_D2) * q + ACKLAM_D3) * q + ACKLAM_D4) * q + 1)
    );
  }

  if (p > 1 - ACKLAM_P_LOW) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(
      (((((ACKLAM_C1 * q + ACKLAM_C2) * q + ACKLAM_C3) * q + ACKLAM_C4) * q + ACKLAM_C5) * q +
        ACKLAM_C6) /
      ((((ACKLAM_D1 * q + ACKLAM_D2) * q + ACKLAM_D3) * q + ACKLAM_D4) * q + 1)
    );
  }

  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((ACKLAM_A1 * r + ACKLAM_A2) * r + ACKLAM_A3) * r + ACKLAM_A4) * r + ACKLAM_A5) * r +
      ACKLAM_A6) *
      q) /
    (((((ACKLAM_B1 * r + ACKLAM_B2) * r + ACKLAM_B3) * r + ACKLAM_B4) * r + ACKLAM_B5) * r + 1)
  );
}

/**
 * Quantile function (inverse CDF) of the standard normal distribution.
 *
 * Acklam's rational approximation is polished with a single Halley step against {@link normalCdf}.
 * Halley's method converges cubically, so one step takes the starting relative error of 1.15e-9
 * down to the accuracy of the CDF itself.
 *
 * @param p - Probability in the open interval `(0, 1)`.
 * @returns The `x` for which `normalCdf(x) = p`.
 * @throws RangeError if `p` is not a number strictly between 0 and 1.
 */
export function inverseNormalCdf(p: number): number {
  if (!Number.isFinite(p) || p <= 0 || p >= 1) {
    throw new RangeError(
      `inverseNormalCdf: probability must be strictly between 0 and 1, received ${p}`,
    );
  }

  const x = acklamQuantile(p);

  // Halley refinement. Skipped when exp(x^2 / 2) overflows, which can only happen so far out in
  // the tail that Acklam's own accuracy already dominates the representable resolution.
  const error = normalCdf(x) - p;
  const scaled = error * SQRT_2PI * Math.exp((x * x) / 2);
  if (!Number.isFinite(scaled)) return x;

  return x - scaled / (1 + (x * scaled) / 2);
}
