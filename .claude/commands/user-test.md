---
description: Run the simulated user-testing pipeline against the published strikemath package — five personas in parallel, then triage, quant-verifier on math findings, and the product report.
---

Run the simulated user-testing pipeline against **the published package `strikemath@0.1.0`**. This
is a cheap filter before real users, not a replacement for them.

**Findings and a report only.** No changes to `/src`, `docs/`, `README.md` or `package.json`. No
fixes, no publish, no push. The maintainer decides what gets fixed.

## 0. Set up

1. `REPO=$(git rev-parse --show-toplevel)`; `DATE=$(date +%F)`; `DIR=$REPO/.claude/findings/$DATE`. If `$DIR` already exists and is not
   empty, stop and ask whether to overwrite or use a suffix (`$DATE-2`). Never delete a previous run.
2. `mkdir -p "$DIR"`.
3. Confirm `.claude/findings/` is ignored: `git check-ignore -q .claude/findings/x`. If not, stop.
4. Confirm the published package matches the source: `git diff --stat v0.1.0 -- src` must be
   empty. If it is not, say so in the report — quant-verifier then reads newer source than the
   personas ran.
5. Record `npm view strikemath version dist-tags --json` and the Node versions available
   (`source ~/.nvm/nvm.sh && nvm ls`). Node 18 is **NOT MEASURED — engines bump pending**; do not
   install it.

## 1. Personas — all five in parallel

Launch `user-quant`, `user-fintech`, `user-beginner`, `user-legacy` and `user-risk` in a single
message. Give each its absolute report path, today's date, and nothing else about the library:

> Today is <DATE>. The repository checkout is <REPO>. Write your report to <DIR>/<persona>.md —
> that is the only file you may write outside your temporary directory. Follow your hard rules.

Do not pass them hints about known defects, the STATUS backlog or the maintainer's local notes. They are
strangers. Wait for all five. If one fails to produce a report, record that and continue.

## 2. Triage

Launch `triage-analyst` with `<DIR>` and `<REPO>`. It writes `<DIR>/TRIAGE.md` and lists the items routed to
quant-verifier.

## 3. quant-verifier on math findings

If TRIAGE.md lists items under "For quant-verifier", launch `quant-verifier` once with all of them.
Tell it:

> These findings came from users of the **published** package strikemath@0.1.0. For each item,
> reproduce it in a fresh `mktemp -d /tmp/...` directory against `npm install strikemath@0.1.0`,
> then use `/src` and `docs/MATH.md` to decide whether it is a defect, a documented convention, or
> a measurement error by the user. Give a verdict per T-id: defect / convention (documented where)
> / measurement error (which), with your own measured numbers. Do not edit `/src` — this run makes
> no fixes, so the mutation-testing step in your instructions does not apply here.

quant-verifier has no Write tool: write its answer verbatim to `<DIR>/quant-verifier.md`. If no
items were routed, write that one line to the file instead.

## 4. Product report

Launch `product-analyst` with `<DIR>`. It reads TRIAGE.md, quant-verifier.md, the persona reports,
`.claude/findings/ROADMAP.local.md` and `docs/STATUS.md`, and writes `<DIR>/REPORT.md`.

## 5. Hand back

- Confirm `git status --short` shows no change outside `.claude/findings/` (which is ignored), and
  `git diff --stat` is empty. If anything else changed, report it and do not revert it without
  asking.
- Give the maintainer REPORT.md and TRIAGE.md, and say plainly what this run measured and what it
  did not.
