# Mathematics

Every formula this library implements, the assumptions behind it, the input domain it is
documented to hold on, and the sources.

> This is an analysis and education tool. Nothing here is investment advice.

---

## 1. Notation

| Symbol   | Meaning                                          | Field           |
| -------- | ------------------------------------------------ | --------------- |
| `S`      | Spot price of the underlying                     | `spot`          |
| `K`      | Strike price                                     | `strike`        |
| `T`      | Time to expiry, in years                         | `timeToExpiry`  |
| `r`      | Continuously compounded risk-free rate, per year | `riskFreeRate`  |
| `sigma`  | Annualised volatility                            | `volatility`    |
| `q`      | Continuous dividend yield, per year              | `dividendYield` |
| `N(x)`   | Standard normal cumulative distribution function | `normalCdf`     |
| `phi(x)` | Standard normal probability density function     | `normalPdf`     |

Rates and volatility are decimal fractions, not percentages: 5% is `0.05`.

---

## 2. The two measures, kept apart

This library deals with two different probability measures and never blurs them.

**Q — the risk-neutral measure.** Under Q the underlying drifts at `r - q`. Every price in this
library is an expectation under Q. `N(d2)` is the Q-probability that a call finishes in the
money.

**P — the real-world measure.** Under P the underlying drifts at whatever its actual expected
return is, which this library does not model and cannot infer from option prices.

**A Q-probability is not a forecast.** `N(d2)` is a price expressed in probability units — the
market's risk-adjusted valuation of a binary payoff, not a prediction of what will happen. The
two coincide only if the market is risk-neutral, which it is not. Functions returning
Q-probabilities say so in their name and in their documentation, and are never presented as
estimates of real-world likelihood.

---

## 3. Standard normal distribution

### 3.1 Density

```
phi(x) = exp(-x^2 / 2) / sqrt(2 pi)
```

### 3.2 Cumulative distribution

Hart's (1968) rational approximation, in the double-precision presentation of West (2005), with
one documented deviation (§3.4).

The implementation computes the **upper tail** `Q(z) = P(Z > z)` for `z >= 0` and derives both
sides from it:

```
N(x) = 1 - Q(x)     for x >= 0
N(x) = Q(-x)        for x <  0
```

Computing the tail directly, rather than as `1 - N(z)`, is what preserves _relative_ accuracy far
out in the tail where the probability itself is tiny.

### 3.3 The reflection is structural

Because both branches come from the same upper-tail routine,

```
N(x) + N(-x) = 1
```

holds to machine precision by construction. This matters more than it looks: put-call parity
depends on this identity and on nothing else (§5.1). **If a parity test fails, the fault is in the
reflection or in the input domain — never in the CDF's accuracy.**

### 3.4 Accuracy, and the deviation from West

Below |z| = 3 the implementation uses Hart's rational form. Above it, a Laplace continued
fraction of 60 levels:

```
Q(z) = phi(z) / (z + 1/(z + 2/(z + 3/(z + ...))))
```

West publishes the branch point at 7.07106781186547 with a 5-level continued fraction. The
deviation buys relative accuracy in the tail; the reasoning and full measurements are in
[DECISIONS.md](./DECISIONS.md).

Measured against 40-digit ground truth:

| Region                          | Worst relative error |
| ------------------------------- | -------------------- |
| \|z\| < 3 (Hart's branch)       | 1.2e-14              |
| \|z\| >= 3 (continued fraction) | 2.4e-16              |

Absolute error is around 1e-16 or better everywhere. For pricing this is the number that matters,
since `N` always enters multiplied by `S` or `K`.

Beyond |z| = 37 the tail is smaller than the smallest positive double relative to 1, and the only
representable answer is exactly 0.

### 3.5 Quantile function

Acklam's (2003) rational approximation, whose relative error is below 1.15e-9, polished with a
single Halley step against `normalCdf`:

```
e = N(x) - p
u = e sqrt(2 pi) exp(x^2 / 2)
x <- x - u / (1 + x u / 2)
```

Halley's method converges cubically, so one step takes the starting error down to the accuracy of
the CDF itself. The step is skipped where `exp(x^2 / 2)` overflows, which can only happen so far
out in the tail that Acklam's own accuracy already dominates the representable resolution.

Round-tripping `x -> p -> x` is limited by how finely `p` can be represented, not by the quantile
function: `dx/dp = 1/phi(x)`, so one ulp of `p` moves `x` by `eps / phi(x)`. At `x = 6` that is
already 1.8e-8. This is a property of binary floating point, not of the implementation.

---

## 4. Black-Scholes-Merton

### 4.1 Assumptions

The model assumes a lognormal underlying with constant volatility, a constant risk-free rate, a
continuous dividend yield, frictionless trading with no transaction costs or taxes, no
arbitrage, and European exercise. Real markets satisfy none of these exactly. The model is a
quoting convention and a risk-mapping tool, not a description of reality.

### 4.2 Moneyness terms

```
d1 = [ ln(S/K) + (r - q + sigma^2 / 2) T ] / (sigma sqrt(T))
d2 = d1 - sigma sqrt(T)
```

### 4.3 Prices

```
C = S e^(-qT) N(d1) - K e^(-rT) N(d2)
P = K e^(-rT) N(-d2) - S e^(-qT) N(-d1)
```

### 4.4 Boundary cases, handled explicitly

`d1` and `d2` are undefined when `T = 0` or `sigma = 0` — the general formula divides by zero and
returns NaN. Both cases are therefore handled before that point:

| Case        | Call                            | Put                             |
| ----------- | ------------------------------- | ------------------------------- |
| `T = 0`     | `max(S - K, 0)`                 | `max(K - S, 0)`                 |
| `sigma = 0` | `max(S e^(-qT) - K e^(-rT), 0)` | `max(K e^(-rT) - S e^(-qT), 0)` |

With `sigma = 0` the forward is deterministic at `F = S e^((r-q)T)`, and the price is
`e^(-rT) max(F - K, 0)`, which is the expression above.

`d1d2()` throws in both cases rather than returning `Infinity` or `NaN`, so a degenerate input
surfaces as an error at the call site instead of travelling silently into a risk figure.

---

## 5. Greeks

All values are returned in **raw units**. See [DECISIONS.md](./DECISIONS.md) for why, and
`greeks/scaling.ts` for the named conversions.

| Greek   | Unit          | Formula (call)                                                                   | Formula (put)                                                                      |
| ------- | ------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `delta` | per 1.0 spot  | `e^(-qT) N(d1)`                                                                  | `-e^(-qT) N(-d1)`                                                                  |
| `gamma` | per 1.0 spot² | `e^(-qT) phi(d1) / (S sigma sqrt(T))`                                            | identical                                                                          |
| `vega`  | per 1.00 vol  | `S e^(-qT) phi(d1) sqrt(T)`                                                      | identical                                                                          |
| `theta` | per year      | `-S e^(-qT) phi(d1) sigma / (2 sqrt(T)) + q S e^(-qT) N(d1) - r K e^(-rT) N(d2)` | `-S e^(-qT) phi(d1) sigma / (2 sqrt(T)) - q S e^(-qT) N(-d1) + r K e^(-rT) N(-d2)` |
| `rho`   | per 1.00 rate | `K T e^(-rT) N(d2)`                                                              | `-K T e^(-rT) N(-d2)`                                                              |

Conversions: `vegaPerPercentagePoint` divides by 100, `thetaPerCalendarDay` by 365,
`thetaPerTradingDay` by 252 unless told otherwise, `rhoPerPercentagePoint` by 100.

Boundary behaviour at `T = 0` or `sigma = 0`, including the subgradient convention at the kink,
is recorded in [DECISIONS.md](./DECISIONS.md).

### 5.1 Put-call parity

```
C - P = S e^(-qT) - K e^(-rT)
```

This is an identity, not an approximation. Substituting the two price formulas gives

```
C - P = S e^(-qT) [N(d1) + N(-d1)] - K e^(-rT) [N(d2) + N(-d2)]
```

which collapses through `N(x) + N(-x) = 1` alone — independently of how accurate `N` is. This is
why §3.3 matters and why a parity failure never points at the CDF.

---

## 6. The documented input domain

Property tests generate inputs from this domain, and the guarantees below are stated on it:

| Input    | Range               |
| -------- | ------------------- |
| `S`, `K` | `[1, 10 000]`       |
| `T`      | `[1/365, 10]` years |
| `r`      | `[-0.02, 0.25]`     |
| `sigma`  | `[0.001, 5]`        |
| `q`      | `[0, 0.15]`         |

**This bound is load-bearing, not a convenience.** Put-call parity is asserted at an _absolute_
tolerance of 1e-9, while the parity residual scales with `S` and `K`. Measured residuals:

| `S = K` | Residual |        |
| ------- | -------- | ------ |
| 1e4     | 3.6e-12  | passes |
| 1e6     | 5.8e-11  | passes |
| 1e12    | 1.2e-4   | fails  |
| 1e15    | 6.3e-2   | fails  |

Without the bound, generation reaches `S = K = 1e12` and the assertion fails by construction —
which would be a domain error, not a mathematics error. If a property ever fails inside the
domain, the correct response is to narrow the documented domain and say so, never to widen the
tolerance.

Inputs outside this domain are not rejected — the functions still validate and compute — but the
accuracy statements above are only claimed inside it.

### 6.1 The resolution floor

A price is a difference of two terms of order `S` and `K`, so it carries an absolute rounding of
a few ulp of the larger. Where the true difference between two prices falls below that, the
computed ordering between them can invert. Monotonicity is therefore asserted against a floor of
`8 eps max(S, K)`; the measurement behind that choice is in [DECISIONS.md](./DECISIONS.md).

---

## 7. Sources

- Hull, J.C., _Options, Futures and Other Derivatives_. Example 13.6 and chapter 17 are the
  golden benchmarks in `test/hull.bench.test.ts`.
- Hart, J.F. et al. (1968), _Computer Approximations_, Wiley.
- West, G. (2005), "Better approximations to cumulative normal functions", _Wilmott Magazine_.
- Acklam, P.J. (2003), algorithm for the inverse normal cumulative distribution function.
- Cox, J., Ross, S. and Rubinstein, M. (1979), "Option pricing: a simplified approach",
  _Journal of Financial Economics_ — for the binomial tree, once implemented.
