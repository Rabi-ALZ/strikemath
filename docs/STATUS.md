# Status

Updated at the end of each session.

## 2026-07-30 — Phase 0 complete, API frozen, not published

The library is built, verified, its public surface is frozen, and nothing is published. Work stops
here deliberately: the binding constraint is no longer correctness.

### Verification

- `pnpm test` — **175 tests across 12 files**
- `pnpm test:coverage` — **100%** of statements, branches, functions and lines
- `pnpm typecheck`, `pnpm lint`, `pnpm build` — clean; ESM, CJS, `.d.ts`, `.d.cts`
- `pnpm examples`, `pnpm examples:smoke` — every example runs, the built package works
- Runtime dependencies: none, confirmed programmatically

Externally anchored so no module rests on self-consistency: the normal distribution against
40-digit BigInt arithmetic; prices and Greeks against Hull; the European tree against a closed-form
binomial sum; American exercise against Merton's perpetual put; implied volatility against an exact
closed-form inverse at the forward and against a bisection-only solver. The Black-Scholes PDE ties
theta, gamma, delta and the price into one identity, worst relative residual 1.0e-14.

### The public surface, frozen

38 exports in eight groups: distribution 3, pricing 4, Greeks 8, scaling 4, volatility 1, risk 10,
errors 2, constants 6. Named object parameters everywhere, without exception. Named exports only.

Cut during the freeze, and the reasoning is in DECISIONS.md: `d1d2` (its throw was
indistinguishable from an input error at the call site) and `historicalLossQuantile` (duplicated
`historicalVar` with the library's only positional signature). `probabilityOfProfitUnderQ` was
renamed to `breakEvenProbabilityUnderQ` before publication, while it cost nothing.

### What three rounds of review found

Round one, against a suite already green at 146 assertions: five defects. Round two, run against
those fixes because they had never been reviewed: four more, two of them created by the round-one
fixes. Regression testing surfaced a fifth. A later critique pass found the boundary values had
been documented as conventions when they are limits.

Coverage stood at 98.65% when the first five were found, and every one of them was in a covered
line. It measures execution, not correctness.

### The named risk

**The most recent fixes are themselves unreviewed** — vega at the kink, the call-only tree guard,
`hasNoDispersion`, and the two API cuts. One review pass was budgeted after the round-two fixes
and it was spent. This is a known and accepted risk, not an oversight. A fresh session should run
`quant-verifier` against them before anything is published.

### Before the button can be pressed

All reversible, none urgent, all decisions rather than chores:

- `author` and `repository` in package.json are placeholders
- version is `0.0.0`; `0.1.0` is the intended first publication
- no GitHub organisation, no CI run, and therefore correctly no badge
- `quant-verifier` is defined in `.claude/agents/` but was only ever run through a
  general-purpose agent; it registers from the next session

### Not a chore, and not delegable

Read `docs/MATH.md` and `README.md` in full. Not to find errors — two review rounds and 175 tests
have addressed those — but to be able to defend every convention to a quant who asks why. That was
the stated criterion for publication, and it is the one thing nobody else can do.
