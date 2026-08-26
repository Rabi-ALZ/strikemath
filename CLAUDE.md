# strikemath

Dependency-free TypeScript library for options mathematics: Black-Scholes, Greeks, binomial
trees, implied volatility, PoP, VaR/CVaR and Kelly.

## Project boundary

This repository is a standalone project. Work ONLY in this directory. Never read, reference or
import from any other project of mine, and never propose patterns or code
from them. If something requires access outside this directory, ask first.

## Strategic purpose

The library is not the product — it is the proof and the distribution. It ships free under MIT
to establish credibility with developers; a paid hosted API is built on the same engine later.
Consequences: the code must be clean, readable and pedagogical; mathematical correctness is
absolutely critical (one wrong Greek destroys the credibility that is the entire point).

## Commands

|                   |                                  |
| ----------------- | -------------------------------- |
| `pnpm test`       | full test suite (vitest run)     |
| `pnpm test:bench` | Hull golden benchmarks only      |
| `pnpm typecheck`  | `tsc --noEmit`                   |
| `pnpm lint`       | eslint                           |
| `pnpm build`      | tsup → ESM + CJS + `.d.ts`       |
| `pnpm examples`   | run every example in `examples/` |

## Code style

- Named exports only. No default export.
- Named object parameters, never positional: `bsCall({ spot, strike, timeToExpiry, ... })`.
  Swapped S and K in positional arguments produce a plausible but wrong number — that failure
  mode is closed in the API itself.
- No `any`. `strict` plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- Zero runtime dependencies. devDependencies only.

## Greek conventions — the core returns raw units, always

`delta` per 1.0 spot · `gamma` per 1.0 spot² · `vega` per 1.00 vol · `theta` per year ·
`rho` per 1.00 rate. Scaling happens exclusively through explicitly named helpers
(`vegaPerPercentagePoint`, `thetaPerCalendarDay`, `thetaPerTradingDay`, `rhoPerPercentagePoint`).
No runtime-configurable scaling, no units option object.

## Critical rules

- **YOU MUST** run `pnpm test` and show the result after ANY change in `/src`.
- **NEVER weaken a benchmark assertion** to make a test pass. If a benchmark fails, the code is
  wrong — not the test.
- **Exception with a duty to stop:** if after thorough verification you believe a deviation is
  caused by Hull's own rounding in the printed table, STOP and report it to me. Do not fix the
  code or the test on your own.
- **Never add a runtime dependency** without asking.
- **Never work outside this directory.**
- Put-call parity is a structural identity, not a precision requirement. If the parity test
  fails, the fault is in the reflection or the input domain — never in the CDF's accuracy.
- **Run `quant-verifier` AFTER fixing what it found, not only before.** Fixes come from the same
  mental model that produced the defect. Its boundary checklist is the canonical one — work
  through `.claude/agents/quant-verifier.md`, do not restate it elsewhere.
- Analysis and education only, never personal investment advice.

## Publication and the decision log

Neither rule is stated here. Both live in `docs/DECISIONS.md`, and this section exists only so
that the trigger is visible from the file that is always loaded.

- **Publication is locked, and the lock is `"private": true` in `package.json`.** Removing it
  requires an explicit decision from Rabi in the session — never as tidying up, never because it
  looks like an oversight on a library meant to be published. The reasoning, and the fact that
  `npm publish --dry-run` cannot demonstrate the guard, are in the DECISIONS entry of
  2026-08-02. `npm publish` and `pnpm publish` are additionally denied in
  `.claude/settings.json`; that is a speed bump, not the lock.
- **`docs/DECISIONS.md` is append-only.** Entries are never edited and never deleted. A reversed
  decision gets a new entry that names what it supersedes and why. Stated at the top of
  DECISIONS.md itself; repeated here only as a pointer, because a rule against duplication is a
  poor place to start duplicating.

@docs/MATH.md
@docs/STATUS.md
@docs/DECISIONS.md
