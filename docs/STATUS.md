# Status

Updated at the end of each session.

## 2026-08-01 — Documentation reviewed against measurement, still not published

Phase 0 was already complete and the API frozen. This session did the one task that had been
named as non-delegable: reading `docs/MATH.md` and `README.md` as a quant would, and defending
every convention. Ten questions, each answered by measuring rather than by reading.

### Verification

- `pnpm test` — **179 tests across 12 files**
- `pnpm test:coverage` — **100%** of statements, branches, functions and lines
- `pnpm typecheck`, `pnpm lint` — clean
- Runtime dependencies: none

### What the review found

**Sixteen defects, and all but one of them in the claims rather than in the code.** The full
account is in DECISIONS.md under 2026-08-01. The ratio is the point: two earlier rounds of
adversarial review of `/src` found nine defects in the mathematics; this pass found sixteen in the
description of that mathematics, while the code needed exactly one behavioural change.

The code held. What was written about the code did not — because prose has no test suite.

Two patterns account for nearly all of it. **Convenient points and convenient special cases**
(seven instances): the reference fixtures were integers and half-integers, which is precisely where
`z^2/2` is exactly representable, so the tail-accuracy figure was measured on the set where the
error vanishes. **Recipes that outlive the fix** (four instances): `1 - N(d2)` was removed from the
source in round one and survived in a JSDoc block as advice to callers.

Three of the corrections are to figures inside DECISIONS.md itself, including one in the entry
that establishes the library's thesis. Knowing the pattern did not prevent it. Only measuring did.

### The code change

One, to `crrPrice`. Its risk-neutral-probability error now names the step count that would be
needed, says plainly when that exceeds the 20 000 cap — a region reaching into the documented
domain — and qualifies the `bsPrice` fallback to European contracts. The unqualified version
returned 0.00 for an American put worth 60.00.

### Tests added

- The relative-accuracy floor in the tail, at five points where `z^2/2` is not exactly
  representable, asserted against the `(z^2/2) eps` envelope
- Theta at the kink with `r != q`, which no test reached: implementing the old wrong claim passed
  all 176 tests, eight runs out of eight
- The two branches of the new `crrPrice` advice, including that the step count it names actually
  works and the one below it does not

The boundary-rule property probe moved from `sigma = 1e-9` to `1e-8`, because below roughly 1e-8
the analytic branch moves away from the limit rather than towards it.

### Named risks

- **The `quant-verifier` subagent has still not been run in its own right.** It is defined in
  `.claude/agents/`, and this session added four checks to it — mutation testing for coverage gaps,
  searching the documentation after a code fix, sweeping products of extremes, and looking for the
  sibling of any correct qualification. None of those has been exercised by the agent itself.
- **This session's own work is unreviewed**, on the same principle that made round two necessary:
  a fix carries the blind spot of the thing it repairs.

### Before the button can be pressed

All reversible, none urgent, all decisions rather than chores:

- `author` and `repository` in package.json are placeholders
- version is `0.0.0`; `0.1.0` is the intended first publication
- no GitHub organisation, no CI run, and therefore correctly no badge
- the README's section on Q-probabilities does not yet carry the delta-versus-`N(d2)` point from
  MATH.md §2.1, which is the library's sharpest single teaching point for a developer audience
