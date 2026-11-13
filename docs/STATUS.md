# Status

Updated at the end of each session, newest first.

## 2026-11-13 — Published: `strikemath@0.1.0` on npm, repository public, CI green

No change to `/src`. The one change in the repository is the removal of `"private": true` from
`package.json`, by Rabi's explicit decision on this date — the trigger the DECISIONS entry of
2 August named as the only one. The entry superseding it, and what was learned during the
publish, are in DECISIONS under today's date.

### Verification

- `npm view strikemath version` — **0.1.0**, `latest` → 0.1.0, one maintainer
- Fresh `npm install strikemath` in an empty directory; Hull 13.6 via ESM and via CJS —
  **4.759422392871535** on both, matching README and the Hull benchmark
- Installed package: 12 files, 162 kB packed, `docs/` included
- `gh repo view --json isPrivate` — **false**; tag `v0.1.0` on the remote
- CI — green on Node 24 since run 37230653360 (4 October)
- `pnpm test` — 192 tests across 12 files; coverage 100% on all four metrics (unchanged)

### Known

- `0.0.0-stage`, npm's staging placeholder, is listed as a version. `latest` does not point at
  it. Deprecating it is on the 0.1.1 backlog, not done.
- No provenance on 0.1.0: published from a laptop while the repository was private.

### 0.1.1 backlog — recorded, not started

- Remove `docs/STATUS.md` from `files`: it is a session log, not documentation of the library,
  and it goes stale the moment it ships.
- `CHANGELOG.md`, `SECURITY.md`.
- Release through a GitHub Actions workflow with trusted publishing (OIDC), so 0.1.1 carries
  provenance and no publish is typed by hand.
- Decide whether to `npm deprecate strikemath@0.0.0-stage`.
- `engines` is `>=18`; Node 18 and 20 are end-of-life and CI tests only 24.
- `.claude/settings.json` still denies `npm publish` and `pnpm publish`. Keep until the workflow
  exists; then it is the only path.

### Named risk, carried forward

Unchanged: the scaling and range check added to `historicalCvar` on 24 September were written by
the second verifier round and have not been through a third. Now with users able to hit them.

## 2026-09-24 — Stale copies restored, CI unproven, a defect in `historicalCvar` fixed

One change to `/src`, in `historicalCvar`. Three things surfaced, and one of them was a
behavioural defect.

### Verification

- `pnpm test` — **192 tests across 12 files**; `pnpm test:coverage` — 100% on all four metrics
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check` — clean, after the restore below
- `git fsck --full` — clean. The reflog is linear from the initial commit, and no file has ever
  been deleted from history

### Three documents were overwritten by stale editor buffers, and restored

On 3 September `CLAUDE.md`, `docs/DECISIONS.md` and `docs/MATH.md` were saved in the same second,
uncommitted, carrying an `editor_options: markdown: wrap: 72` header — the signature of a visual
Markdown editor, not of a session. Compared against every historical version, each matched a
commit from 29–30 July: DECISIONS the initial commit, MATH `38540cd`. The saved MATH still quoted
the superseded `2.4e-16`. So these were month-old buffers written over the current files, not
edits: DECISIONS had fallen from 23 entries to 10, and the `CLAUDE.md` imports had collapsed onto
one line, so the docs stopped loading.

Nothing was ever committed, so history was never at risk. Restored from `HEAD` on 24 September.
**Close the files in that editor without saving**, or it will write the same buffers again.

### The work of 26 August, which this file never recorded

Four commits: the Prettier violation in `test/blackScholes.test.ts` fixed; CI moved to Node 24
and actions v7/v6, with `format:check` added to the workflow; publish and push denied in
`.claude/settings.json`; and a debugging rule added to `quant-verifier.md`. Both items carried
forward on 2 August — Node 20 in CI and the Prettier drift — are therefore closed in the source.

**The CI change is not proven.** The push of `cdeb0ab` triggered run 32985780685, which failed
after 15 minutes with "The job was not acquired by Runner of type hosted even after multiple
attempts" — no step ran. Re-run on 24 September; it sat queued with no runner assigned. Actions is
enabled on the repository; billing could not be inspected without the `user` token scope. Until a
run goes green, the last verified CI result is 2 August.

`3fd1ad3` is not pushed.

### A new defect: `historicalCvar` counts one loss too many at common sample sizes

The tail is `Math.ceil((1 - c) * n)`, and `1 - c` is not exact in binary. `1 - 0.95` is
`0.050000000000000044`, so at `n = 20` the product is `1.0000000000000009` and `ceil` gives 2.
Measured by running the function:

| `n`  | `c`   | Intended tail | Used |
| ---- | ----- | ------------- | ---- |
| 20   | 0.95  | 1             | 2    |
| 100  | 0.99  | 1             | 2    |
| 500  | 0.99  | 5             | 6    |
| 1000 | 0.99  | 10            | 11   |
| 1000 | 0.975 | 25            | 26   |

The existing test sits at `n = 10, c = 0.9`, where the product rounds _down_ to
`0.9999999999999998` and `ceil` happens to be right — a convenient point again. **Fixed** by
replacing the estimator with the fractional-tail form of Acerbi and Tasche.

**The first two versions of the fix were themselves wrong.** `quant-verifier` ran twice before
commit. Round one: the fraction only shrank the excess — a stray weight of 1e-15 on a large gain
still moved a result near zero without bound — plus an underflow at `n = 1` and a pre-existing
overflow. Round two: the fix for those still overflowed at `Number.MAX_VALUE` and underflowed
subnormals at `m >= 2`, a regression. Both rounds also found false claims in the new documentation,
and tests that could not see the defects they were written for. The final form snaps a tail mass
within `2 n eps` of a whole number, sums in power-of-two units, and holds the result to the tail's
range. Fifteen mutants tried: restoring `ceil` fails seven tests, every safeguard is pinned by at
least one, and the two survivors are harmless. Tests 184 -> 192, coverage 100% on all four metrics.

**Named risk.** Round two's behavioural findings were only at the extremes of the double range, but
a third round was not run. The pattern since July is that each round finds defects in whatever the
previous round wrote, and this one wrote the scaling and the range check.

## 2026-08-02 — Versioned, pushed to a private repo, CI green, publication still locked

No change to `/src`. The session was about everything that surrounds the code: the headline
figure, what ships in the tarball, and where the repository lives.

### Verification

- `pnpm test` — **184 tests across 12 files**, unchanged
- `pnpm typecheck`, `pnpm lint`, `pnpm build`, `prettier --check` — clean
- **First CI run in the project's history, and it passed.** Including `pnpm build`, added the day
  before and never executed until now. Run 30760756059.

### The count was corrected

"Nine defects" appears in four DECISIONS entries, three commit messages and this file, and it was
never the result of counting. Counted: **17 in behaviour, 29 in claims**, with the counting rule
and its sensitivity written out in the DECISIONS entry of this date. Five of the seventeen were
created by fixes to the other twelve — 29%, and that is the figure to lead with.

### What now ships in the tarball

Twelve files, 152 kB packed. Two decisions, both recorded in DECISIONS under this date:

- **`docs/MATH.md`, `docs/DECISIONS.md` and `docs/STATUS.md` are included.** README follows seven
  links into `docs/`, and every one of them was dead in the published package.
- **`docs/ROADMAP.md` is excluded.** It is commercial strategy, not documentation of the library.
  Listed as an allowlist rather than a negation pattern, so the failure mode is closed for future
  internal documents and not only for this one.
- **Source maps stay**, at 60% of the unpacked size. For a library that asks to be trusted, being
  able to step into the code is a feature.

### Where the repository lives

`github.com/Rabi-ALZ/strikemath`, **private**, `main` fully pushed and tracking `origin/main`.
Verified two ways: the API reports `isPrivate: true`, and an unauthenticated request returns 404.

No commit count is recorded here on purpose. A count written into the file that is about to be
committed is wrong the moment it is saved, and this project has a DECISIONS entry about exactly
that class of number. `git log --oneline main | wc -l` answers it and cannot go stale.

### Publication is locked, deliberately

`package.json` carries `"private": true`. Verified against npm's own guard rather than assumed:
`libnpmpublish` throws `EPRIVATE` before any network call. **`npm publish --dry-run` cannot
demonstrate this** — dry-run skips the call containing the check and exits 0, which looks exactly
like the flag not working. Worth knowing on the day it is removed.

**These are two independent locks.** `private: true` blocks npm; the private repository hides the
source. Opening one does not open the other, and publication is therefore two deliberate acts.

### Before the button can be pressed

The list that stood here on 1 August is done: author, repository and homepage are correct,
`bugs` was wrong the same way and is fixed, version is `0.1.0`, the repository exists, CI has run,
and the README carries the delta-versus-`N(d2)` point. What is left:

- **The decision itself.** Nothing technical stands in the way.
- A CI badge is now possible and is not added.
- `actions/checkout@v4`, `setup-node@v4` and `pnpm/action-setup@v4` target Node 20, which GitHub
  has deprecated and currently forces onto Node 24. Not urgent; it will become an error.
- `test/blackScholes.test.ts` violates Prettier and has done since before this session. Left alone
  rather than mixed into an unrelated commit.

### Named risk, carried forward

Unchanged from 1 August: **the fixes from the last review round are themselves unreviewed.** Four
rounds in, the pattern is that defects concentrate in whatever was written most recently.

---

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

**Seventeen defects, fifteen of them in the claims rather than in the code.** The full account is
in DECISIONS.md under 2026-08-01. The ratio is the point: two earlier rounds of adversarial review
of `/src` found ten defects in the mathematics, and this pass found fifteen in the description of
it.

The "nine" that stood here until 2 August was never counted — see the DECISIONS entry of that date,
which corrects every use of it and states the counting rule.

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
