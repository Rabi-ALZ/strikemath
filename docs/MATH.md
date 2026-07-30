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
depends on this identity and on nothing else (§6.1). **If a parity test fails, the fault is in the
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

**There is no tail cutoff.** A cutoff at |z| = 37 is a common one, justified by `1 - Q(z)` being
indistinguishable from 1 beyond it. That is true, and it says nothing about `Q` itself: `Q(37)` is
5.7e-300, four orders of magnitude above the smallest normal double, and `Q` stays representable
to about |z| = 38.5. Truncating at 37 would discard some nineteen orders of magnitude of exactly
the relative tail accuracy this implementation exists to provide. `Math.exp` underflows to 0 on
its own where 0 is the right answer, so nothing needs to be forced.

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

The test for this is on `sigma sqrt(T)`, not on `sigma` and `T` separately. Both can be strictly
positive while their product underflows — `sigma = 5e-324` with `T = 0.25` — and `d1` is then
`0 / 0 = NaN`. Underflow is not a separate case from zero; it is the same case reached by
arithmetic rather than by input.

`d1d2()` throws in both cases rather than returning `Infinity` or `NaN`, so a degenerate input
surfaces as an error at the call site instead of travelling silently into a risk figure.

---

## 5. Cox-Ross-Rubinstein binomial tree

For American exercise, where no closed form exists.

```
dt = T / n
u  = e^(sigma sqrt(dt))            d = 1 / u
p  = (e^((r - q) dt) - d) / (u - d)
```

The tree is priced by backward induction from the terminal payoff. At each node the continuation
value is `e^(-r dt) [ p V_up + (1 - p) V_down ]`; for American exercise the node value is the
greater of that and immediate exercise.

Convergence to Black-Scholes is `O(1/n)` and **oscillates**, so a coarse tree can land close to
the analytic value by luck. Use enough steps that the answer is stable, not merely plausible.

### 5.1 When the tree is not valid

**`p` outside `[0, 1]`.** If the drift is large relative to `sigma sqrt(dt)`, the up and down
moves cannot straddle the forward and the tree admits arbitrage. `crrPrice` throws rather than
returning a number, since the number would be silently wrong. More steps normally resolves it:
`p` stays inside `[0, 1]` while `sigma sqrt(dt) > |r - q| dt`, so shrinking `dt` helps.

**Terminal nodes beyond the double range.** The highest terminal node sits at
`S u^n = e^(ln S + sigma sqrt(T n))`. Past `ln(Number.MAX_VALUE)` it becomes `Infinity`, a call
payoff there becomes `Infinity`, and backward induction carries it to the root. `crrPrice` throws
rather than returning that. The condition is reachable inside the documented domain — `S = K = 100`,
`T = 1`, `sigma = 5`, `n = 20 000` — and it is reached precisely by raising `n` to get a better
answer, so it is checked before any work is done. Reduce `n`, or price a European contract with
`bsPrice`, which has no such limit.

**`u = d = 1`.** The tree collapses when `volatility` is 0, `timeToExpiry` is 0, or
`sigma sqrt(dt)` underflows. Backward induction cannot be used here — and not because of a
division by zero. In a CRR tree the drift is carried by the transition probability, not by the
size of the moves, so with `u = d = 1` the underlying never leaves `S`: every terminal node would
sit at today's spot rather than at the forward, and the tree would return the intrinsic value of
an unchanged spot. That is the wrong number, not merely an imprecise one.

With no randomness the path is deterministic at `S(t) = S e^((r - q) t)`, so the implementation
evaluates it directly: a European option is worth `e^(-rT) payoff(S(T))`, and an American option
the best discounted payoff available at any exercise date on the same grid the tree would have
offered,

```
max over t in {0, dt, 2dt, ..., T} of  e^(-rt) payoff(S(t))
```

---

## 6. Greeks

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

### 6.1 Put-call parity

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

### 6.2 The boundary rule

Where the contract has no dispersion left — `sigma sqrt(T) = 0` — the closed forms divide by
zero and the Greeks have to come from somewhere else. **One rule decides all of them:**

> **Report the limit of the analytic formula approached from inside the domain. Where that limit
> does not exist finitely, report 0.**

Gamma at the kink is the only place the second clause applies.

This was documented for a while as a set of conventions, and that was wrong. Nothing here is
chosen. At the kink `spotTerm = strikeTerm`, which forces `d1 = sigma sqrt(T) / 2`, so `d1 -> 0`,
`N(d1) -> 1/2` and `phi(d1) -> phi(0)`. Every boundary value follows from that.

Measured at the kink, `S = K = 100`, `r = q = 0.04`, `T = 1`, as `sigma` tends to 0:

| Greek   | Limit from inside                                            | Reported          |                     |
| ------- | ------------------------------------------------------------ | ----------------- | ------------------- |
| `delta` | 0.4803947187                                                 | 0.4803947196      | the limit           |
| `vega`  | 38.32995298410409                                            | 38.32995298410414 | the limit           |
| `rho`   | 48.0394700411                                                | 48.0394719576     | the limit           |
| `theta` | → 0, linearly in sigma: −1.76e-2 at 1e-3, −1.76e-11 at 1e-12 | 0                 | the limit           |
| `gamma` | → ∞ as 1/sigma: 3.8e0 at 1e-3, 3.8e9 at 1e-12                | 0                 | **no finite limit** |

And approaching the other kink, `S = K`, `r = q = 0`, from `T > 0`, delta converges on 0.5 rather
than being placed there: 0.5039893563146316 at `T = 1e-2`, 0.5000039894228039 at `T = 1e-8`,
0.5000000398942281 at `T = 1e-12`.

**Why state it as a rule rather than as five values.** A rule is predictive. Vanna, charm, volga
and speed all have their boundary behaviour already decided by it, and so does anything else added
later — take the limit, and report 0 only if it diverges. Five separately recorded conventions
would have decided nothing, and would have left the next author to guess.

The rule also has teeth as a test: the boundary branch and the analytic branch must agree in the
limit, which means a defect in either shows up as a discontinuity in the library's own output.
That is exactly how vega was found to be wrong — it returned 39.894 at `sigma = 5e-324` and 0 at
`sigma = 0`.

### 6.3 The Black-Scholes PDE, as a check on all four at once

The price and its Greeks satisfy

```
theta + (1/2) sigma^2 S^2 gamma + (r - q) S delta - r V = 0
```

This is the strongest structural identity in the library, because it ties `theta`, `gamma`,
`delta` and the price into a single equation — a defect in any one of them breaks it, and it is
not satisfiable by four values that are individually plausible.

It is also what settles the unit convention, and settles it mechanically rather than by
assertion. **Theta per year is the unit in which this identity holds without a conversion
factor.** Measured residual across the documented domain: worst **1.0e-14** relative. With theta
expressed per day instead, the same residual is **5.08**, **4.55** and **1.10** at three ordinary
contracts — the identity simply fails. The convention is therefore enforced by
`test/greeks.test.ts`, not merely promised here: anyone changing theta's unit breaks the PDE test
by a factor of 365.

---

## 7. Implied volatility

The volatility that reproduces an observed price. There is no closed form, so it is found
numerically by inverting the pricer.

### 7.1 Safeguarded Newton-Raphson

Newton's method on vega converges quadratically where vega is healthy and diverges where it is
not — far out of the money or close to expiry, vega collapses and a Newton step can land
anywhere. The solver therefore maintains a bracket, initially `[1e-6, 5]`, and **any Newton step
that would leave it is replaced by a bisection**. Bisection alone always converges; Newton alone
does not.

The bracket update is sound because the price is monotonically increasing in volatility, so the
sign of the price error says unambiguously which side of the root the current guess is on.

The initial guess is Brenner-Subrahmanyam, `sigma ~ sqrt(2 pi / T) * price / S`, which is exact
for an at-the-money forward.

### 7.2 What is guaranteed, and what is not

**Guaranteed:** the returned volatility reproduces the input price to within `priceTolerance`,
default 1e-10. Failure is always an exception — `InvalidInputError` for a malformed input or an
arbitrage-violating price, `ConvergenceError` for a price inside the arbitrage bounds but outside
the search bracket, or for exhausting the iteration cap. The function never returns `NaN`.

**Not guaranteed:** that the volatility itself is precise. That follows from vega, not from the
solver:

```
dSigma = dPrice / vega
```

A deep out-of-the-money weekly can have a vega around 3e-5, so even an exactly matched price pins
sigma only to about 3e-6. Where vega has collapsed entirely the price carries no information
about volatility at all, and no solver can recover it.

### 7.3 Arbitrage bounds

Checked before any iteration, because a price outside them has no implied volatility at all:

| Side | Lower bound                     | Upper bound |
| ---- | ------------------------------- | ----------- |
| Call | `max(S e^(-qT) - K e^(-rT), 0)` | `S e^(-qT)` |
| Put  | `max(K e^(-rT) - S e^(-qT), 0)` | `K e^(-rT)` |

The lower bound is the limit as volatility goes to 0, the upper bound the limit as it goes to
infinity.

---

## 8. Risk measures

### 8.1 Sign convention

**Losses are positive numbers.** A VaR of 0.032 is a 3.2% loss. Return series passed in keep the
opposite convention — a return of -0.032 is a 3.2% loss — because that is how returns are
universally quoted. The conversion happens once, at the boundary.

Results are in the units of the input: returns in, fractions out. Multiply by the position value
for a currency amount.

### 8.2 Value at Risk

Historical VaR is the empirical quantile of the loss series, with linear interpolation between
order statistics — the convention of R's `quantile(type = 7)` and NumPy's default.

Parametric VaR assumes normality:

```
VaR_c = -mu + sigma z_c        where z_c = N^-1(c)
```

The normality assumption is wrong in the direction that matters: real return series have fatter
tails than a normal, so parametric VaR understates the loss exactly where the number is relied
on. VaR is also **not sub-additive** — a portfolio's VaR can exceed the sum of its parts'.

### 8.3 Conditional Value at Risk

The average loss given that the loss exceeds VaR. Unlike VaR it is sub-additive, which is why it
is the coherent measure of the two.

```
CVaR_c = -mu + sigma phi(z_c) / (1 - c)
```

The historical estimator averages the worst `ceil((1 - c) n)` losses. At 99% on 50 observations
that is an average over a single point — defined, but an anecdote rather than an estimate.

`CVaR >= VaR` always holds at the same confidence level.

### 8.4 Kelly criterion

The stake fraction maximising expected log wealth:

```
f* = p / lossFraction - (1 - p) / winPayoff
```

which reduces to the classic `f* = (b p - (1 - p)) / b` when the whole stake is lost on a loss.

Full Kelly is optimal only when the probability and payoffs are known exactly, the bet repeats
indefinitely, outcomes are independent and the stake is infinitely divisible. Estimated edges
break it fast: **overestimating the edge by a factor of two turns the growth-optimal bet into one
with zero expected log growth.** Even with correct inputs the drawdowns are severe — the
probability of halving the bankroll at some point under full Kelly is around 50%. Half or quarter
Kelly gives up little growth for a large reduction in variance.

A negative `f*` means negative expected value at those inputs. It is returned as computed rather
than clamped to 0, so the size of the disadvantage stays visible.

---

## 9. The documented input domain

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

### 9.1 An extra constraint on `crrPrice`

The domain above governs the analytic functions. The binomial tree carries one more constraint,
because its highest terminal node is `S u^n = e^(ln S + sigma sqrt(T n))`. The tree fits in a
double only while

```
ln S + sigma sqrt(T n) <= ln(Number.MAX_VALUE) ~ 709.78
```

which couples `steps` to volatility:

```
n <= ((709 - ln S) / sigma)^2 / T
```

Across the documented domain — `S, K <= 10 000`, `T <= 10` — this stays above the 20 000 step cap
for any `sigma` up to about **1.5**, so an ordinary contract never meets it. Measured, by
bisecting on the largest step count the implementation accepts:

| `S`    | `T` | `sigma` | Largest usable `steps`          |
| ------ | --- | ------- | ------------------------------- |
| 100    | 1   | 0.3     | 20 000 (the cap, not the limit) |
| 10 000 | 10  | 1.5     | 20 000 (the cap, not the limit) |
| 10 000 | 10  | 1.6     | 19 129                          |
| 100    | 1   | 5       | 19 846                          |
| 10 000 | 10  | 5       | 1 958                           |

**The constraint applies to calls only.** A call payoff at an overflowed node is
`Infinity - K = Infinity`, which backward induction carries to the root. A put payoff there is
`max(K - Infinity, 0) = 0`, which is the correct value at a node that far above the strike, so no
`Infinity` ever enters the tree and the put prices correctly at any step count. `crrPrice` checks
this before doing any work, and only for a call — refusing a put would reject a computation that
is right. It throws `InvalidInputError` naming the largest step count that fits, and does not
silently reduce `steps`, because that would answer a different question than the one asked.

Two properties of this limit are worth stating plainly. It is reached by **raising** `steps` —
the same contract prices correctly at a coarser tree — and it applies only to the tree: `bsPrice`
has no such limit and prices those European contracts without difficulty.

**A real alternative exists, and it was deprioritised rather than ruled out.** Carrying node
prices in log space, or pruning the branches whose probability is negligible, would lift the
constraint entirely. Neither is implemented, and the reason is priority, not impossibility: each
would need its own verification against the values the current tree already produces, and the
binding region is narrow.

How narrow is worth stating precisely rather than waving at. The constraint needs
`sigma sqrt(T n) > 704`, so at `sigma = 2` — 200% volatility, which single names do reach in a
crisis — and `T = 1` it never binds inside the 20 000 step cap. At `sigma = 2` and `T = 10` it
binds from about 12 400 steps. So the region is exotic but not empty, and the honest summary is
that a long-dated American call at extreme volatility currently has no fallback: European
contracts have `bsPrice`, American ones do not. If that becomes a real request, log space is the
fix and this paragraph is the ticket.

### 9.2 The resolution floor

A price is a difference of two terms of order `S` and `K`, so it carries an absolute rounding of
a few ulp of the larger. Where the true difference between two prices falls below that, the
computed ordering between them can invert. Monotonicity is therefore asserted against a floor of
`8 eps max(S, K)`; the measurement behind that choice is in [DECISIONS.md](./DECISIONS.md).

---

## 10. Sources

- Hull, J.C., _Options, Futures and Other Derivatives_. Example 13.6 and chapter 17 are the
  golden benchmarks in `test/hull.bench.test.ts`.
- Hart, J.F. et al. (1968), _Computer Approximations_, Wiley.
- West, G. (2005), "Better approximations to cumulative normal functions", _Wilmott Magazine_.
- Acklam, P.J. (2003), algorithm for the inverse normal cumulative distribution function.
- Cox, J., Ross, S. and Rubinstein, M. (1979), "Option pricing: a simplified approach",
  _Journal of Financial Economics_ — for the binomial tree, once implemented.
