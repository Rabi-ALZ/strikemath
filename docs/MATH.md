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

## 2. The measures, kept apart

This library deals with more than one probability measure and never blurs them. Two of them decide
how a number may be read — Q and P — and a third one turns up inside delta.

**Q — the risk-neutral measure.** Under Q the underlying drifts at `r - q`. Every price in this
library is an expectation under Q. `N(d2)` is the Q-probability that a call finishes in the
money.

**P — the real-world measure.** Under P the underlying drifts at whatever its actual expected
return is, which this library does not model and cannot infer from option prices.

**A Q-probability is not a forecast.** `N(d2)` is a price expressed in probability units — the
market's risk-adjusted valuation of a binary payoff, not a prediction of what will happen. The two
measures coincide only where the market price of risk is zero, which in equities it is not.
Functions returning Q-probabilities say so in their name and in their documentation, and are never
presented as estimates of real-world likelihood.

**What this library cannot tell you.** If your question is _how often will this actually finish in
the money_, no function here answers it, and none can. That answer needs a model of the real-world
drift, which means a view on expected returns — this library has none and takes none. Everything
it computes is derived from prices, and prices are expectations under Q.

The gap between the two is not noise, and not small. Equity index puts have historically traded
well above what their realised frequency of finishing in the money would justify, because
investors pay a premium for protection; this is the variance risk premium, and it is one of the
more robust findings in empirical asset pricing.[^vrp] So `probabilityItmUnderQ` on an index put
**systematically overstates** how often it finishes in the money. The direction of the bias
depends on the instrument and the sign of the premium, which is exactly why the library will not
present these numbers as likelihoods.

[^vrp]:
    This is an empirical claim about markets rather than a mathematical one, and it is stated
    here as context, not as something this library verifies. See the literature on the variance risk
    premium — Bakshi & Kapadia (2003), Carr & Wu (2009), Bollerslev, Tauchen & Zhou (2009) — for the
    evidence and its limits.

### 2.1 Delta is not the probability of finishing in the money

`N(d1)` is a probability too, and of the **same event** as `N(d2)` — the option finishing in the
money. What differs is the measure: `N(d1)` is that probability under the one in which the
underlying itself, dividends reinvested, is the numéraire. The price has two legs, and each is
settled in its own unit:

```
C = S e^(-qT) N(d1)   -   K e^(-rT) N(d2)
    receive one share       pay K in cash
      if in the money        if in the money
```

The cash leg is weighted by the probability seen from cash, which is Q. The share leg is weighted
by the probability seen from shares. The two can never coincide, because `d1 - d2 = sigma sqrt(T)`
is strictly positive, so `N(d1) > N(d2)` always. The change of measure has Radon-Nikodym derivative
`S_T / E^Q[S_T]`, which is increasing in `S_T`: the share measure puts more weight on the high
paths, and in the money _is_ the high paths.

**Delta is neither of them.** `delta = e^(-qT) N(d1)`, not `N(d1)`, and the library never presents
either as a probability.

Reading a delta of 0.30 as "a 30% chance of finishing in the money" is a widespread shortcut, and
it is wrong twice: wrong measure, and then wrong again by the dividend discount. Measured:

| Contract                      | `sigma sqrt(T)` | `N(d2)` under Q | `N(d1)` share measure | `delta` | `delta - N(d2)` |
| ----------------------------- | --------------- | --------------- | --------------------- | ------- | --------------- |
| S=42 K=40 T=0.5 σ=0.20 q=0.03 | 0.1414          | 0.69909         | 0.74640               | 0.73529 | **+3.6 pp**     |
| ATM, T=1/12, σ=0.20           | 0.0577          | 0.51151         | 0.53451               | 0.53451 | **+2.3 pp**     |
| ATM, T=2, σ=0.60              | 0.8485          | 0.37071         | 0.69796               | 0.69796 | **+32.7 pp**    |
| ATM, T=5, σ=1.50              | 3.3541          | 0.05289         | 0.95878               | 0.95878 | **+90.6 pp**    |

The three ATM rows are `S = K = 100`, `r = 0.04`, `q = 0`; with `q = 0` the `N(d1)` and `delta`
columns coincide, which is the point of keeping both.

The error is not a rounding detail and it is not bounded by anything the reader can see. It widens
with `sigma sqrt(T)` and tends to a full 100 points in the limit, because `d1 -> +infinity` while
`d2 -> -infinity`. Row three is not exotic: a two-year at-the-money call on a name at 60%
volatility has a delta of 0.70 and a Q-probability of finishing in the money of 0.37.

At `q = 0` the two rightmost columns coincide and `delta = N(d1)` exactly — and the number is still
a probability under the wrong measure. Delta is `dC/dS`, a hedge ratio. That it happens to equal a
discount factor times a probability is a result inside the lognormal model, not a statement of what
it is.

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

Measured against 40-digit ground truth, on a **dense** sweep rather than at the fixture points —
the distinction turns out to matter, and why is the next subsection:

| Region                          | Worst relative error                                 |
| ------------------------------- | ---------------------------------------------------- |
| \|z\| < 3 (Hart's branch)       | 1.6e-14, rising into the branch point                |
| \|z\| >= 3 (continued fraction) | see the floor below — the algorithm is not the limit |

Absolute error is around 1e-16 or better everywhere. For pricing this is the number that matters,
since `N` always enters multiplied by `S` or `K`.

**The cost, measured rather than asserted.** The deeper continued fraction is not free. On this
machine, per call: 19.2 ns against West's 17.0 ns inside Hart's branch (1.13x), and **157 ns
against 19.9 ns on the tail branch — 7.9x**. That is still 6.4 million calls per second, and a
whole `bsCall` near the money costs 72 ns, so the CDF is nowhere near being a bottleneck. But
"the cost is nil" would be untrue, and a figure a reader can reproduce is worth more than a
reassurance.

#### The relative-accuracy floor in the tail, and why it is not the continued fraction

Above the branch point the limit on relative accuracy is not the approximation at all. It is
`Math.exp(-z*z/2)`. Since

```
d(exp(-u)) / exp(-u) = -du
```

any rounding in the **argument** `u = z^2/2` passes straight through as relative error in the
result. Rounding `u` to a double costs up to `(z^2/2) * eps`, and that is what is measured:

| Region   | Worst \|du\|, measured | Envelope `(z^2/2) eps` |
| -------- | ---------------------- | ---------------------- |
| [3, 5)   | 8.9e-16                | 2.8e-15                |
| [5, 8)   | 1.8e-15                | 7.1e-15                |
| [8, 12)  | 7.1e-15                | 1.6e-14                |
| [12, 20) | 1.4e-14                | 4.4e-14                |
| [20, 30) | 2.8e-14                | 1.0e-13                |
| [30, 38) | 5.7e-14                | 1.6e-13                |

The mechanism predicts the error rather than merely fitting it. Where `u` is exactly
representable the relative error drops back to ~1e-16; where it is not, the error tracks `|du|`
digit for digit:

| z    | `u = z^2/2` | `u` exact? | \|du\|  | measured relative error |
| ---- | ----------- | ---------- | ------- | ----------------------- |
| 10   | 50          | yes        | 0       | 1.1e-16                 |
| 11.5 | 66.125      | yes        | 0       | 1.2e-16                 |
| 11.6 | 67.28       | **no**     | 5.3e-15 | **5.2e-15**             |
| 11.8 | 69.62       | **no**     | 3.8e-15 | **3.7e-15**             |
| 20   | 200         | yes        | 0       | 2.7e-16                 |

**This document previously claimed 2.4e-16 here, and that figure was a measurement artefact.** It
was taken at the reference fixture points, which are integers and half-integers — exactly the `z`
for which `z^2/2` is exactly representable, and therefore exactly the measure-zero set on which
this error vanishes. Convenient test points are systematically optimistic, because "easy to write
down" correlates with "exactly representable".

None of this touches the deviation from West, which is what the numbers are there to justify:
West as published is ~1e-9 across this whole range, so the deviation still buys five to seven
orders of magnitude. It is the stated figure that was wrong, not the choice.

**A fix exists and is deliberately not taken.** Computing `z^2/2` in double-double arithmetic and
splitting the exponential accordingly would restore ~1e-16 relative accuracy throughout. It is not
implemented because it would improve nothing that matters: the **absolute** error is unchanged,
and absolute error is what pricing consumes, since `N` always enters multiplied by `S` or `K`.
Recorded here as a known, declined alternative — the same standing as log space in §9.1 — so that
a future reader can see it was considered rather than missed.

**There is no tail cutoff.** A cutoff at |z| = 37 is a common one, justified by `1 - Q(z)` being
indistinguishable from 1 beyond it. That is true, and it says nothing about `Q` itself: `Q(37)` is
5.7e-300, eight orders of magnitude above the smallest normal double, and `Q` stays representable
to about |z| = 38.5. Truncating at 37 would discard some twenty-four orders of magnitude of exactly
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
returning a number, since the number would be silently wrong.

`p` stays inside `[0, 1]` while `sigma sqrt(dt) > |r - q| dt`, which rearranges to a step count:

```
n > T (|r - q| / sigma)^2
```

so shrinking `dt` always fixes it in principle. **In practice it sometimes cannot, because `steps`
is capped at 20 000**, and the requirement above exceeds that cap whenever

```
sigma < |r - q| sqrt(T / 20 000)
```

This region reaches into the documented domain, which starts at `sigma = 0.001`. Measured, by
bisecting on the volatility at which a 20 000-step tree starts to be accepted — the boundary is
confirmed to within 1%, rejected at 0.99 times the predicted value and accepted at 1.01 times:

| `r - q` | `T` | Steps needed | Unusable below   |
| ------- | --- | ------------ | ---------------- |
| 0.25    | 1   | 62 500       | `sigma` = 0.0018 |
| 0.25    | 10  | 625 000      | `sigma` = 0.0056 |
| 0.05    | 10  | 25 000       | `sigma` = 0.0011 |

**A low-volatility contract with a large drift therefore has no valid tree at any legal step
count**, and this is stated rather than left to be discovered: the error message names the step
count that would be needed and says plainly when it is past the cap.

The fallback is `bsPrice` and it is qualified, because the unqualified form is dangerous. For a
European contract `bsPrice` is exact. For an **American** contract it is only a lower bound, and in
this region a very poor one: at `S = 40`, `K = 100`, `T = 10`, `r = 0.25`, `sigma = 0.001` the
European put is worth 0.00 while immediate exercise is worth 60.00. An American contract inside
this region has no fallback in this library — the same honest gap as the one recorded in §9.1, and
recorded here for the same reason.

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

Measured at the kink, `S = K = 100`, `r = q = 0.04`, `T = 1`. The last row is what the
boundary branch returns; the rows above it are the analytic branch converging on it.

| `sigma` | `delta`                | `vega`             | `rho`              | `theta`    | `gamma`  |
| ------- | ---------------------- | ------------------ | ------------------ | ---------- | -------- |
| 1e-3    | 0.4805863693330966     | 38.32994819286     | 48.02030698192     | -1.763e-2  | 3.833e+0 |
| 1e-6    | 0.4803949112259266     | 38.32995298410     | 48.03945279264     | -1.763e-5  | 3.833e+3 |
| 1e-9    | 0.4803947197678113     | 38.32995298410     | 48.03947193845     | -1.763e-8  | 3.833e+6 |
| 1e-12   | 0.4803947195763532     | 38.32995298410     | 48.03947195760     | -1.763e-11 | 3.833e+9 |
| **0**   | **0.4803947195761616** | **38.32995298410** | **48.03947195762** | **0**      | **0**    |

Read the columns downwards. `delta`, `vega` and `rho` converge on the value the boundary branch
reports. `gamma` is the exception: it grows as `1/sigma` without bound, so there is no finite
value to report and 0 is what the boundary returns instead. `theta` appears to converge on 0 here,
and on this contract it does — but that is a property of this contract and not of theta, which the
next subsection takes up.

A single probe would not have shown this. At `sigma = 1e-9` delta reads 0.4803947197678113, which
differs from the reported 0.4803947195761616 in the tenth digit — not because the library is wrong
there, but because the probe is still a finite distance from the limit. Convergence is the claim,
and only a sequence demonstrates it.

The same holds approaching the other kink, `S = K`, `r = q = 0`, from `T > 0`: delta converges on
0.5 rather than being placed there — 0.5039893563146316 at `T = 1e-2`, 0.5000039894228039 at
`T = 1e-8`, 0.5000000398942281 at `T = 1e-12`.

#### Theta at the kink is `(q - r) spotTerm / 2`, and 0 only when `r = q`

At the kink `spotTerm = strikeTerm`, so as `sigma -> 0` the first term of theta,
`-S e^(-qT) phi(d1) sigma / (2 sqrt(T))`, decays linearly in `sigma` while the other two converge
on `N(0) = 1/2`:

```
theta -> q spotTerm / 2 - r strikeTerm / 2 = (q - r) spotTerm / 2
```

Measured at the kink, `S = 100`, `T = 1`, with `K` chosen so that `spotTerm = strikeTerm` to the
bit:

| `r`  | `q`  | `K`          | `theta` at `sigma = 1e-3` | `theta` at `sigma = 0` | `(q - r) spotTerm / 2` |
| ---- | ---- | ------------ | ------------------------- | ---------------------- | ---------------------- |
| 0.04 | 0.04 | 100          | -1.763e-2                 | 0                      | 0                      |
| 0.05 | 0.01 | 104.08107742 | -1.9987                   | **-1.9801**            | -1.9801                |
| 0.01 | 0.08 | 93.23938199  | +3.2142                   | **+3.2309**            | +3.2309                |

With `r != q`, theta does not decay with `sigma` at all. Only its first term does, and the value
that term decays towards is not 0. The table further up reads as though 0 were theta's limit
because `r = q` there makes the two surviving terms cancel — one degeneracy hiding inside another.

#### Reproducing this, and where the sequence turns around

The demonstration above is a recipe, and the recipe has a floor. Below roughly `sigma = 1e-8` the
analytic branch stops approaching the limit and begins moving away from it — on every contract
except, as it happens, the one in the table.

At the kink,

```
d1 = [ ln(S/K) + (r - q) T + sigma^2 T / 2 ] / (sigma sqrt(T))
```

and the bracket is exactly zero in exact arithmetic, because `spotTerm = strikeTerm` is the same
statement as `ln(S/K) = -(r - q) T`. In floating point it is not zero but a cancellation residual
of order 1e-16 — and that residual is then divided by `sigma sqrt(T)`. The error in `d1` therefore
grows as `1/sigma` and eventually swamps the convergence it was meant to demonstrate.

Measured, distance from the boundary value:

| `sigma` | `r = q = 0.04` | `r = 0.05, q = 0.01`             |
| ------- | -------------- | -------------------------------- |
| 1e-6    | 1.92e-7        | 1.97e-7                          |
| 1e-8    | 1.92e-9        | **5.48e-10** — closest approach  |
| 1e-10   | 1.92e-11       | 1.37e-7                          |
| 1e-12   | 1.92e-13       | 1.37e-5                          |
| 1e-14   | 1.94e-15       | **1.37e-3** — worse than at 1e-3 |

The contract in the first table is the one case where this cannot happen: with `S = K` and
`r = q`, both `ln(S/K)` and `(r - q) T` are bitwise zero, so there is no residual to amplify. It
was not chosen for that reason, which is precisely the problem — it concealed the floor while
appearing to demonstrate the rule.

**So probe down to about `sigma = 1e-8` and stop.** If you go further and watch the sequence
diverge, you are seeing the conditioning of `d1`, not a defect in the boundary value: the boundary
branch still sits within 5.5e-10 of the analytic branch's closest approach. This is worth knowing
before you run the check on a contract of your own and conclude the library is wrong.

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

The reason is dimensional, and the identity makes it mechanical rather than a matter of taste:
`sigma` is annualised, `r` is per annum and `T` is in years, so every term above carries the unit
_value per year_. Theta has to as well, or the equation does not balance.

**Measured** on a dense grid of 36 000 contracts across the documented domain, deliberately at
awkward values rather than round ones: worst **relative** residual **1.3e-15**.

With theta expressed per day instead, the identity does not degrade — it fails by essentially the
whole of theta. The identity says the other three terms sum to `-theta`, so substituting
`theta / 365` leaves an **absolute** residual of

```
| theta / 365 - theta |  =  0.9973 |theta|
```

which is 4.29 at Hull's chapter 17 contract, 4.55 at example 13.6, and whatever `|theta|` happens
to be on any other. Stating it as a fraction of theta rather than as three contract-specific
numbers is the point: it is checkable on the contract in front of you.

The convention is therefore enforced by `test/greeks.test.ts`, not merely promised here — one test
asserts the identity holds, and a second asserts that the per-day version breaks it.

**What this identity does not cover.** It constrains `theta`, `gamma`, `delta` and the price.
`vega` and `rho` do not appear in it and get no support from it; their units rest on the
convention in §6 and on the named scaling helpers, not on a structural check.

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

### 7.3 The search bracket is fixed, and why

`priceTolerance` and `maxIterations` are parameters. The bracket `[1e-6, 5]` is not, and the
asymmetry is deliberate.

**The bounds are economic, not numerical.** It would be tidy to say the floor sits where the price
stops differing from intrinsic. Measured, that is false by ten orders of magnitude: for a
forward-at-the-money one-year contract on a spot of 100, the price exceeds intrinsic by 3.99e-5 at
`sigma = 1e-6`, by 3.91e-13 at `sigma = 1e-14`, and only becomes indistinguishable at
`sigma = 1e-17`. The floor is where volatility stops being a market quantity — 0.0001% annualised
— not where the arithmetic gives out. The ceiling is the same judgement at the other end: 500%
annualised is past any traded market.

**A caller could not choose better.** Selecting a bracket requires knowing how the Newton step and
the bisection fallback interact here, and where convergence degrades. A parameter that can
realistically only be set wrong is a trap with documentation attached.

**The bounds are load-bearing.** The prices at both ends decide whether an input is reported as a
`ConvergenceError` or solved, and both appear in the error text. Widening the bracket silently
changes which inputs are answerable.

If a real contract needs a different range, that is a feature request with a case attached — and
the case will say what the range should be. The same reasoning as log space in §9.1.

### 7.4 Arbitrage bounds

Checked before any iteration, because a price outside them has no implied volatility at all:

| Side | Lower bound                     | Upper bound |
| ---- | ------------------------------- | ----------- |
| Call | `max(S e^(-qT) - K e^(-rT), 0)` | `S e^(-qT)` |
| Put  | `max(K e^(-rT) - S e^(-qT), 0)` | `K e^(-rT)` |

The lower bound is the limit as volatility goes to 0, the upper bound the limit as it goes to
infinity.

---

## 8. Risk measures

### 8.1 Sign convention, and the horizon

**The horizon is the period of your returns, and the result does not carry it.** Daily returns
give a one-day VaR; monthly returns give a one-month VaR. A series of numbers does not say how far
apart they are, so nothing in this library can detect a mismatch, and a figure computed from daily
data and reported as "our VaR" is wrong by whatever scaling the reader assumed. State the horizon
wherever the figure appears.

Converting between horizons is not division, and it is not a clean square root either. Under
independence,

```
VaR_t = -mu t + sigma sqrt(t) z_c
```

so the **drift term scales linearly while the dispersion term scales with the square root**. The
familiar "multiply by sqrt(10) for ten days" is therefore exact only where `mu = 0`, and nowhere
else. Measured at 99% confidence, a one-day figure scaled by sqrt(10) against the correct ten-day
figure:

| Annual drift | Annual sigma | sqrt(10) rule | Correct ten-day | Error      |
| ------------ | ------------ | ------------- | --------------- | ---------- |
| 0%           | 20%          | 0.092684      | 0.092684        | 0.00%      |
| 8%           | 20%          | 0.091680      | 0.089509        | **+2.43%** |
| 15%          | 20%          | 0.090802      | 0.086732        | **+4.69%** |
| -10%         | 30%          | 0.140281      | 0.142994        | **-1.90%** |

On top of which the independence assumption is itself least reliable in exactly the stressed
markets where the number is being consulted. No helper is provided, deliberately: it would put a
convenient number behind two inconvenient assumptions rather than one.

#### Why there is no `horizon` parameter, when there is a `thetaPerCalendarDay`

This is the obvious objection, since the library closes precisely this class of hazard elsewhere:
theta's unit is not a runtime setting but a named function, on the argument that a scaled number
is indistinguishable from an unscaled one (§6, and DECISIONS 2026-07-29).

The difference is ownership. **A unit can be enforced in the type system only where the library
owns the fact.** The library computes theta, so it knows theta's unit exactly, and
`thetaPerCalendarDay` is a verifiable transformation of something it produced itself. It never
sees the sampling interval of a return series. A `horizon` field would be an unverifiable claim by
the caller, echoed back with the library's authority attached — the library would appear to know
something it cannot check, which is worse than saying plainly that it does not know.

So the horizon is documented rather than typed, and that is the honest form of the same principle,
not an exception to it.

#### Sign convention

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
tolerance of 1e-9, while the parity residual scales with `S` and `K`.

Measured as the **worst residual over the documented ranges** of `T`, `r`, `sigma` and `q` at each
scale. A single contract proves nothing here: at `S = K = 1e15` the median residual over those
ranges is exactly 0 while the worst is 2.5e-1, so a lone probe can report either that the bound is
unnecessary or that it is violated by a quarter.

| `S = K`   | Worst residual |                  |
| --------- | -------------- | ---------------- |
| 1e4       | 2.0e-12        | passes           |
| 1e6       | 2.3e-10        | passes           |
| **4.7e6** | **9.3e-10**    | **the crossing** |
| 1e9       | 2.4e-7         | fails            |
| 1e12      | 2.4e-4         | fails            |

The documented ceiling of 1e4 therefore carries **2.7 decades of margin** before the assertion
becomes unsatisfiable. The bound is load-bearing, and it is not tight.

Without the bound, generation reaches `S = K = 1e12` and the assertion fails by construction —
which would be a domain error, not a mathematics error. If a property ever fails inside the
domain, the correct response is to narrow the documented domain and say so, never to widen the
tolerance.

Inputs outside this domain are not rejected — the functions still validate and compute — but
**every** guarantee above is claimed only inside it, and that includes the guarantee of a finite
answer, not merely the accuracy figures.

### 9.0 Outside the domain: what actually breaks, and why one parameter at a time never finds it

Inside the domain the library returns no `NaN` and no `Infinity`, and that is a property test
rather than a promise. Outside, two mechanisms produce both. Each needs **two** extremes at once:

| Output  | Mechanism                                                                       | Example                          | Result        |
| ------- | ------------------------------------------------------------------------------- | -------------------------------- | ------------- |
| `gamma` | `e^(-qT) phi(d1) / (S sigma sqrt(T))`, numerator and denominator both underflow | `S=1e-320, sigma=1e-320, T=1`    | **NaN**       |
| `gamma` | the same denominator underflows on its own                                      | `S=1e-320, sigma=1e-8, T=1e-320` | **Infinity**  |
| `theta` | `-S e^(-qT) phi(d1) sigma / (2 sqrt(T))` overflows                              | `S=1, sigma=1e150, T=1e-320`     | **-Infinity** |

`gamma` is affected for spots up to about 1e-8. `theta` is affected at **any** spot, up to
`Number.MAX_VALUE`, because it is `sigma` and `T` that drive it and the spot is only a factor.

**Neither is reachable by varying one input at a time.** `S = 1e-320` on its own is fine.
`sigma = 1e-320` on its own is fine. Together they are `NaN`. Varying one parameter while holding
the others at sensible values is the natural way to probe a boundary, and it is systematically
blind to exactly this: every individual limit looks safe, because individually it is safe.

**No fix is applied, deliberately.** `gamma -> infinity` as `S -> 0` is the true limit, and
validating it away would replace a mathematically correct answer with an error. Rejecting these
inputs would also break the stated design that out-of-domain inputs are computed rather than
refused. What was wrong was the claim, not the arithmetic — the README asserted no `NaN`
unconditionally while the property test that backed it drew only from this domain.

### 9.1 An extra constraint on `crrPrice`

The domain above governs the analytic functions. The binomial tree carries one more constraint,
because its highest terminal node is `S u^n = e^(ln S + sigma sqrt(T n))`. The tree fits in a
double only while that exponent stays inside the range of a double.

**Three constants appear below and they are not the same number.** They are named here once so
nothing later reads as a contradiction:

|                               | Value            | What it is                                                        |
| ----------------------------- | ---------------- | ----------------------------------------------------------------- |
| `ln(Number.MAX_VALUE)`        | 709.782712893384 | the true ceiling; beyond it a double is `Infinity`                |
| `MAX_REPRESENTABLE_LOG_PRICE` | **709**          | what the code tests against, a deliberate 0.78 of margin          |
| headroom                      | `709 - ln S`     | what is left for `sigma sqrt(T n)` once the spot is accounted for |

The margin costs a sliver of the representable range — a call whose top node lands between
`e^709` and `e^709.78` is refused although it would have been finite — and buys not having to
reason about the last ulp of the exponent. Everything below uses 709.

The constraint is therefore

```
ln S + sigma sqrt(T n) <= 709
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

How narrow is worth stating precisely rather than waving at. The constraint binds when
`sigma sqrt(T n)` exceeds the headroom `709 - ln S`, which for `S = 100` is 704.4. So at
`sigma = 2` — 200% volatility, which single names do reach in a
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
