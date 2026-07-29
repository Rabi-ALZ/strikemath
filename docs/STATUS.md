# Status

Updated at the end of each session.

## 2026-07-29 — Phase 0 complete, after two rounds of adversarial review

The library is built, verified and committed. Nothing is published yet.

### What exists

| Area                | File                           | Exports                                                         |
| ------------------- | ------------------------------ | --------------------------------------------------------------- |
| Normal distribution | `src/utils/normal.ts`          | `normalPdf`, `normalCdf`, `inverseNormalCdf`                    |
| Shared types        | `src/utils/types.ts`           | `OptionInputs`, `OptionType`, `Greeks`                          |
| Validation          | `src/utils/validate.ts`        | `InvalidInputError`, input resolution                           |
| Pricing             | `src/pricing/blackScholes.ts`  | `bsCall`, `bsPut`, `bsPrice`, `d1d2`                            |
| Pricing             | `src/pricing/binomial.ts`      | `crrPrice`, European and American                               |
| Greeks              | `src/greeks/analytical.ts`     | `callGreeks`, `putGreeks`, `optionGreeks`, individual accessors |
| Scaling             | `src/greeks/scaling.ts`        | the four named unit conversions                                 |
| Volatility          | `src/volatility/impliedVol.ts` | `impliedVolatility`, `ConvergenceError`                         |
| Risk                | `src/risk/probability.ts`      | the four `...UnderQ` probabilities                              |
| Risk                | `src/risk/var.ts`, `cvar.ts`   | historical and parametric VaR and CVaR                          |
| Risk                | `src/risk/kelly.ts`            | `kellyFraction`, `fractionalKelly`                              |
| Public API          | `src/index.ts`                 | named exports only, no default export                           |

Documentation: `README.md`, `docs/MATH.md`, `docs/DECISIONS.md`, `docs/ROADMAP.md`, this file.
Examples: four TypeScript examples plus a smoke test against the built package.

### Verification

- `pnpm test` — **172 tests across 12 files**, all passing
- `pnpm test:coverage` — **100%** of statements, branches, functions and lines
- `pnpm typecheck`, `pnpm lint` — clean
- `pnpm build` — clean; `dist/` has ESM, CJS, `.d.ts` and `.d.cts`
- `pnpm examples` and `pnpm examples:smoke` — every example runs, and the built package works
- Runtime dependencies: none, confirmed programmatically

Hull, Example 13.6: call 4.759422392871535 against a printed 4.7594; put 0.808599372900094
against 0.8086. Hull, chapter 17: delta 0.5216016339715761, gamma 0.06554537725247868,
vega 12.105242754243843, theta -4.305389964546104. Every deviation is consistent with the book's
own rounding.

Externally anchored, so that no module rests on self-consistency alone: the normal distribution
against 40-digit BigInt arithmetic; prices and Greeks against Hull; the European tree against a
closed-form binomial sum; American exercise against Merton's perpetual put; implied volatility
against an exact closed-form inverse at the forward and against a bisection-only solver. The three
new derivations were independently re-derived and checked to 60 digits during review.

### What two rounds of adversarial review found

Round one, against a suite already green at 146 assertions: **five defects**. Round two, run
against those fixes because they had never themselves been reviewed: **four more**, two of them
created by the round-one fixes. Writing the regression tests surfaced a fifth. All ten are fixed
and each carries a regression test.

The pattern is the point. A fix carries the same blind spot as the code it repairs. Coverage stood
at 98.65% when the first five were found and every one of them was in a covered line — it measures
execution, not correctness. The full write-up is in `docs/DECISIONS.md`.

### Deliberately not done

- **No npm publication.** Phase 1.
- **No CI badge.** `ci.yml` is written but has never run; a badge without a pipeline behind it
  undermines exactly the credibility it signals. Add it after the first green run on GitHub.
- **No web UI, database or payments.** Out of scope for phase 0 by design.

### Open items for the next session

- `package.json` carries `strikemath` as `author` and `github.com/strikemath/strikemath` as
  `repository`. Both are placeholders until the GitHub organisation exists.
- TypeScript is pinned to 6.0.3 because `typescript-eslint` does not yet support 7.x. The trigger
  to revisit is recorded in `docs/DECISIONS.md`.
- The `quant-verifier` subagent is defined in `.claude/agents/quant-verifier.md` but was written
  during this session, so it is registered from the next session onward. It was run for this
  session through a general-purpose agent following the same instructions.
- Read `docs/MATH.md` yourself before publishing. The conventions are the one thing that cannot be
  delegated.
