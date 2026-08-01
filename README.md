# strikemath

**Options mathematics for TypeScript — Black-Scholes, Greeks, implied volatility and risk
measures, with zero runtime dependencies and every number verified against published benchmarks.**

```bash
npm install strikemath      # or: pnpm add strikemath / yarn add strikemath
```

```ts
import { bsCall, callGreeks, impliedVolatility, vegaPerPercentagePoint } from 'strikemath';

const contract = {
  spot: 42,
  strike: 40,
  timeToExpiry: 0.5, // years
  riskFreeRate: 0.1, // 10%, not 10
  volatility: 0.2, // 20%
};

bsCall(contract);
// 4.759422392871535

const greeks = callGreeks(contract);
greeks.delta; // 0.779131290942669
greeks.vega; // 8.813415059602853   — per 1.00 of volatility
vegaPerPercentagePoint(greeks.vega); // 0.08813415059602853 — per volatility point

impliedVolatility({ ...contract, optionPrice: 4.7594, optionType: 'call' });
// 0.19999745922096288 — the input price is Hull's, rounded to four decimals
```

Everything takes a **named object**, never positional arguments. Swapping spot and strike
positionally produces a plausible but wrong number that no type system would catch; naming them
makes it impossible.

---

## Correctness

This library exists to be trusted, so here is exactly what has been verified and how.

**Golden benchmarks against Hull, _Options, Futures and Other Derivatives_.** Every deviation is
consistent with the book's own rounding:

| Quantity           | strikemath          | Hull    |
| ------------------ | ------------------- | ------- |
| Example 13.6, call | 4.759422392871535   | 4.7594  |
| Example 13.6, put  | 0.808599372900094   | 0.8086  |
| Chapter 17, delta  | 0.5216016339715761  | 0.5216  |
| Chapter 17, gamma  | 0.06554537725247868 | 0.06555 |
| Chapter 17, vega   | 12.105242754243843  | 12.1052 |
| Chapter 17, theta  | -4.305389964546104  | -4.3054 |

These assertions are never weakened. If one fails, the code is wrong — not the test.

**The normal CDF is checked against exact arithmetic, not against a table.** Reference values are
generated in BigInt fixed-point arithmetic at adaptive precision, with pi computed from Machin's
formula so that not even that constant is taken on trust. The generator cross-checks every value
at two working precisions and refuses to emit one where they disagree. Worst measured relative
error below |z| = 3: **1.6e-14**, rising monotonically into the branch point. Above it the approximation is no longer the limit — the rounding
of `z²/2` inside the exponential is — while the published 5-level form is five to seven orders of
magnitude worse across the same range. An earlier version of this README claimed a better tail
figure; it had been measured at integer and half-integer points, which are exactly the ones where
that rounding vanishes. The correction and the mechanism are in
[`docs/MATH.md`](./docs/MATH.md) §3.4.

**Put-call parity is treated as a structural identity, not a tolerance.** `C - P` reduces to
`S e^(-qT) [N(d1) + N(-d1)] - K e^(-rT) [N(d2) + N(-d2)]`, so it holds through `N(x) + N(-x) = 1`
alone, independently of how accurate `N` is. The reflection is implemented so that identity holds
by construction.

**Property tests** run 1000 cases each over a documented input domain, checking parity,
monotonicity, Greek bounds, no-arbitrage bounds and the absence of any NaN or Infinity.

**Greeks are cross-checked against numerical derivatives of the price**, which is an independent
code path — that catches a dropped term or a sign error in a way no single benchmark can.

**Nothing fails silently.** Every error path throws with a message naming the offending value.
**Inside the documented input domain no function returns `NaN` or `Infinity`** — that is a property
test rather than a promise. Outside it, combinations of two simultaneous extremes can produce
both: `gamma` is `phi(d1) / (S sigma sqrt(T))`, which is `0/0` once the denominator underflows, and
theta's `sigma / (2 sqrt(T))` term overflows for a large enough `sigma` at a small enough `T`. The
domain and the two mechanisms are in [`docs/MATH.md`](./docs/MATH.md) §9.

Read [`docs/MATH.md`](./docs/MATH.md) for every formula, assumption and measured accuracy figure,
and [`docs/DECISIONS.md`](./docs/DECISIONS.md) for why each choice was made — including the one
documented, measured deviation from West's published normal CDF constants.

---

## Greek conventions

**The core always returns raw units.** No exceptions, no settings, no options object.

| Greek   | Unit                       | Note                      |
| ------- | -------------------------- | ------------------------- |
| `delta` | per 1.0 of spot            | dimensionless             |
| `gamma` | per 1.0 of spot squared    |                           |
| `vega`  | per **1.00 of volatility** | ~100x what a screen shows |
| `theta` | per **year**               | ~365x what a screen shows |
| `rho`   | per **1.00 of rate**       | not per basis point       |

Scaling happens only through functions whose names state what they produce:

```ts
import {
  vegaPerPercentagePoint,
  thetaPerCalendarDay,
  thetaPerTradingDay,
  rhoPerPercentagePoint,
} from 'strikemath';

vegaPerPercentagePoint(12.1052); // 0.121052
thetaPerCalendarDay(-4.3054); // -0.011795...
thetaPerTradingDay(-4.3054); // -0.017085... (252 days by default)
```

The reason is that a scaled number is indistinguishable from an unscaled one. `theta = -4.31`
could be per year or per day, and with a runtime setting the answer would depend on a
configuration value the reader of the calling code cannot see. `thetaPerCalendarDay(theta)` cannot
be misread.

---

## What is in it

### The distribution, verified against exact arithmetic

```ts
normalPdf(x);
normalCdf(x);
inverseNormalCdf(p);
```

The standard normal, checked against 40-digit BigInt ground truth rather than against a published
table, with no tail cutoff — `normalCdf(-37)` returns 5.7e-300, not 0. Accuracy figures and the
floor on relative tail accuracy are in [`docs/MATH.md`](./docs/MATH.md) §3.4.

If you take one thing from this library, take this one. It is a concrete, checkable promise, where
"correct options mathematics" is a claim everyone makes.

### Pricing

```ts
bsCall(inputs);
bsPut(inputs);
bsPrice({ ...inputs, optionType });
crrPrice({ ...inputs, optionType, exerciseStyle, steps }); // European and American
```

### Greeks — individually, or all five at once

Two access patterns, not redundancy. Ask for one number when you want one; ask for the bundle when
you want all five without recomputing `d1` five times.

```ts
delta({ ...inputs, optionType });
gamma(inputs);
vega(inputs);
theta({ ...inputs, optionType });
rho({ ...inputs, optionType });

callGreeks(inputs);
putGreeks(inputs);
optionGreeks({ ...inputs, optionType });
```

Unit conversion, and the only place scaling ever happens:

```ts
vegaPerPercentagePoint(v);
thetaPerCalendarDay(t);
thetaPerTradingDay(t);
rhoPerPercentagePoint(r);
```

### Implied volatility

```ts
impliedVolatility({ ...inputs, optionPrice, optionType });
```

### Risk

```ts
probabilityItmUnderQ({ ...inputs, optionType });
breakEvenProbabilityUnderQ({ ...inputs, optionType, premium });
probabilityAboveUnderQ({ ...inputs, level });
probabilityBelowUnderQ({ ...inputs, level });

historicalVar({ returns, confidenceLevel });
parametricVar({ mean, standardDeviation, confidenceLevel });
historicalCvar({ returns, confidenceLevel });
parametricCvar({ mean, standardDeviation, confidenceLevel });

kellyFraction({ winProbability, winPayoff });
fractionalKelly(fullKelly, 0.5);
```

Named exports only — no default export. ESM and CJS builds, with TypeScript declarations.

**On VaR and CVaR:** the horizon is the period of the returns you pass in, and the result does not
carry it. Daily returns give a one-day figure. Say which wherever you report it.

Runnable examples are in [`examples/`](./examples).

---

## Risk-neutral probabilities are not forecasts

Every probability function is named `...UnderQ`, and that suffix is doing real work.

`N(d2)` is the probability the option finishes in the money **under the risk-neutral measure Q** —
which is to say, it is a price expressed in probability units. It is what the market charges for a
payoff of 1 if the option expires in the money. It is not a prediction of how often that will
happen.

The two coincide only if market participants are indifferent to risk, which they are not. Equity
index puts trade far above their real-world probability because investors pay for protection, so
`probabilityItmUnderQ` on a put systematically overstates how often it finishes in the money.

**This is why there is no `probabilityOfProfit`.** Other tools ship a function by that name, often
abbreviated POP. What it computes is what `breakEvenProbabilityUnderQ` computes here — a
risk-neutral probability of finishing beyond break-even — and the two numbers agree. The name does
not, because "probability of profit" makes a promise the number cannot keep, and a name has to
survive being read in an autocomplete list, a UI label or a screenshot, where any qualifier in the
documentation has long since fallen away.

If what you want is how often a trade will actually make money, this library cannot tell you, and
neither can any tool that only sees prices. That answer needs a view on expected returns.

---

## Disclaimer

**strikemath is an analysis and education tool. It is not investment advice, and it does not
produce investment advice.**

The models it implements — Black-Scholes-Merton, Cox-Ross-Rubinstein, normal-distribution VaR —
rest on assumptions that markets do not satisfy: constant volatility, frictionless trading,
lognormal returns, no jumps. Real return distributions have fatter tails than the normal, which
means every risk number here understates the tail precisely where it is being relied on.

Options can lose their entire value. Use this library to understand a position, not to justify
one.

---

## Requirements

Node 18 or later. TypeScript users get full types; JavaScript users get the same functions.

**Zero runtime dependencies**, and that is a design constraint rather than a coincidence.

## Licence

MIT. See [LICENSE](./LICENSE).
