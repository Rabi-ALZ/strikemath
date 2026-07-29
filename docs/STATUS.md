# Status

Updated at the end of each session.

## 2026-07-29 — Phase 0, checkpoint after step 5

The mathematical core is complete and green. Work is paused here for review before the binomial
tree, implied volatility and the risk module are built.

### Built

| Area | Files | State |
|---|---|---|
| Normal distribution | `src/utils/normal.ts` | `normalPdf`, `normalCdf`, `inverseNormalCdf` |
| Shared types | `src/utils/types.ts` | `OptionInputs`, `OptionType`, `Greeks` |
| Validation | `src/utils/validate.ts` | `InvalidInputError`, input resolution |
| Pricing | `src/pricing/blackScholes.ts` | `bsCall`, `bsPut`, `bsPrice`, `d1d2` |
| Greeks | `src/greeks/analytical.ts` | `callGreeks`, `putGreeks`, `optionGreeks`, individual accessors |
| Scaling | `src/greeks/scaling.ts` | the four named unit conversions |
| Public API | `src/index.ts` | named exports only, no default export |

### Verification

- `pnpm test` — 86 tests across 7 files, all passing
- `pnpm typecheck`, `pnpm lint` — clean
- `pnpm build` — clean; `dist/` contains ESM, CJS and `.d.ts`
- Runtime dependencies: none, confirmed programmatically

Hull, Example 13.6: call 4.759422392871535 against a printed 4.7594; put 0.808599372900094
against 0.8086. Hull, chapter 17: delta 0.5216016339715761, gamma 0.06554537725247868,
vega 12.105242754243843, theta -4.305389964546104 — every deviation consistent with the book's
own rounding to four or five decimals.

Reference values for the normal distribution are generated in exact BigInt arithmetic
(`test/fixtures/generate-reference.mjs`) rather than transcribed, and the generator cross-checks
every value at two working precisions before emitting it.

### Not built yet

Steps 6 to 8 of the phase: `pricing/binomial.ts`, `volatility/impliedVol.ts` and the `risk/`
module. README, `docs/ROADMAP.md`, `examples/` and the `quant-verifier` subagent also remain, as
does the session-stop hook, which is deliberately added last so it cannot block a session while
the suite is intentionally red during test-first work.

### Open items

- `package.json` carries `strikemath` as `author` and `github.com/strikemath/strikemath` as
  `repository`; both are placeholders until the GitHub organisation exists.
- No CI badge in the README. `ci.yml` is written but has not run, and a badge without a pipeline
  behind it undermines exactly the credibility it is meant to signal.
- TypeScript is pinned to 6.0.3 because `typescript-eslint` does not yet support 7.x.
