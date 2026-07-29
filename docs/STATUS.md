# Status

Updated at the end of each session.

## 2026-07-29 — Phase 0 complete

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

- `pnpm test` — **151 tests across 10 files**, all passing
- `pnpm typecheck`, `pnpm lint` — clean
- `pnpm build` — clean; `dist/` has ESM, CJS, `.d.ts` and `.d.cts`
- `pnpm examples` and `pnpm examples:smoke` — every example runs, and the built package works
- Runtime dependencies: none, confirmed programmatically

Hull, Example 13.6: call 4.759422392871535 against a printed 4.7594; put 0.808599372900094
against 0.8086. Hull, chapter 17: delta 0.5216016339715761, gamma 0.06554537725247868,
vega 12.105242754243843, theta -4.305389964546104. Every deviation is consistent with the book's
own rounding.

Reference values for the normal distribution are generated in exact BigInt arithmetic rather than
transcribed, and the generator cross-checks each value at two working precisions before emitting
it.

### What the adversarial review found

`quant-verifier` was run against `/src` after the suite was already green at 146 assertions. It
found **five real defects**, all now fixed with regression tests: a binomial tree returning
`Infinity` for inputs inside the documented domain, an expiring at-the-money put reported as
certain to finish in the money, a tail probability computed as a complement and collapsing to 0, a
normal-CDF cutoff discarding nineteen orders of magnitude of representable tail, and a `-0`
escaping from `historicalVar`.

Four of the five sat at a boundary the tests exercised only from one side. The full write-up is in
`docs/DECISIONS.md`.

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
