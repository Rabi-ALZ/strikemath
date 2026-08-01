# Status

Updated at the end of each session.

## 2026-08-01 — Documentation reviewed, verifier run, still not published

Phase 0 was already complete and the API frozen. This session did the one task that had been
named as non-delegable: reading `docs/MATH.md` and `README.md` as a quant would, and defending
every convention. Ten questions, each answered by measuring rather than by reading.

### Verification

- `pnpm test` — **184 tests across 12 files**
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

### The verifier run

`quant-verifier` was then run in its own right for the first time, in a fresh context, with the
four checks this session added. It found **nine things, two of them defects in behaviour**: an
off-by-one in the new `crrPrice` step-count helper, and `impliedVolatility` silently returning a
volatility outside `priceTolerance` when the bracket collapsed. Both are fixed, both carry
regression tests, and the full account is in DECISIONS.md.

The off-by-one is worth naming here. It was introduced this session, in the same hour the
convenient-points pattern was written up, and the test written to prevent it used a non-integral
ratio — the one case where the wrong formula and the right one agree. Three of the verifier's
four new checks fired, including mutation testing, which found that `Math.abs(r - q)` could be
changed to `r + q` and survive the entire suite.

### The second verifier run

Run again against those fixes, it found nine more — **three defects in behaviour, two of them
created by the previous fix.** `ceil(x)` corrected the integral-ratio overshoot and introduced an
undershoot whenever `q > r`, so `crrPrice` advised a step count it then refused; the test written
with that fix used positive drift, which is exactly where the defect is invisible. The
`impliedVolatility` collapse branch, having been made to throw, began refusing prices it can
reproduce exactly, because its collapse criterion was absolute rather than relative — the same
shape as round two's guard that rejected valid puts.

The third was pre-existing and the most serious of either run: **`bsCall` and `bsPut` returned
negative prices inside the documented domain**, about 23 calls and 30 puts per 500 000 draws, at
magnitudes around -1e-320. The no-arbitrage bound test could not see it: its slack is
`1e-9 * max(1, spotTerm, strikeTerm)`, a tolerance sized for ordinary prices applied to a quantity
that is not of that scale. Both exits are now clamped and a 7 200-contract sweep asserts it.

### Where this leaves the stopping question

Three rounds, and the shape is stable: each finds fewer defects in the mathematics and more in
whatever was written last. It does not converge to zero — it converges on the newest layer.

So the stopping rule cannot be "no defects remain". It is that the defects still being found are
cheaper to fix after publication than to hunt for before it. The last three behavioural defects
were real, but two lived in an error message and one at a tolerance no caller sets. That is close
to the line, and where exactly it falls is the open question, not a technical one.

### Named risk

- **This round's fixes are themselves unreviewed**, for the third time running. The pattern is
  now well enough understood that this is a known and priced risk rather than an oversight.

### Before the button can be pressed

All reversible, none urgent, all decisions rather than chores:

- `author` in package.json is set to Rabi Alzare; `repository` is still a placeholder pointing at
  a GitHub organisation that does not exist yet
- version is `0.0.0`; `0.1.0` is the intended first publication
- no GitHub organisation, no CI run, and therefore correctly no badge
- the README's section on Q-probabilities does not yet carry the delta-versus-`N(d2)` point from
  MATH.md §2.1, which is the library's sharpest single teaching point for a developer audience
