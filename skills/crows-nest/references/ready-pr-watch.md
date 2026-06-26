# crows-nest §3 — the PR track: dispatch ready PRs into the review→merge pipeline

> Reference for [`crows-nest`](../SKILL.md) §3. The body keeps the hot path (config/scope §1,
> the unified tick §2, arming the loop §6, safety §7); this file holds the ready-PR track's
> detail. Section numbers (§3, §3a–§3f) match the labels other skills cross-reference.

The PR track is **not a separate tick** — it's scheduled in the same unified tick as the issue track
([SKILL.md §2](../SKILL.md#2-one-tick-of-the-unified-scheduler)), from the same batched scan. §3 is
what the scheduler does for each **PR on the frontier** (SKILL.md §2c): claim it and launch its
review→merge pipeline ([review-merge-pipeline.md §4](review-merge-pipeline.md)) as a **background**
Workflow, then return. PR pipelines run **concurrently with issue builds and with each other**,
bounded by `maxConcurrentReviews` — the lookout doesn't drain the issue track before starting reviews.

## 3a. Eligibility (evaluated in the §2a scan)

The ready-PR gate is applied during the unified scan (SKILL.md §2a), not as a second `gh pr list`. A
PR is **ready** — eligible for the frontier — when **all** hold:

- it is **open** and **not draft**;
- it carries the `<triggerLabel>` (`armada`) — shipwright auto-arms it with this when it opens the
  PR, so ARMADA-created PRs enter the pipeline automatically with no manual PR-arming gate;
- **CI is not failing** — `statusCheckRollup` has no `FAILURE`/`ERROR`/`TIMED_OUT` checks (pending
  is fine to re-check next tick; a green or not-yet-failing rollup passes this stage);
- it isn't **already mid-pipeline** — not labelled `armada:reviewing`, and not already
  `armada:merged` or `armada:blocked` (terminal states a future tick must not re-pick);
- it is **fresh for review** — either the fleet has **not yet reviewed it**, **or** it has **new
  human activity since the fleet's last review** (a comment, PR review, or commit added after the
  review — see "Re-engage on new activity" below). A PR the fleet already reviewed that has had **no**
  new human activity since is **held**, not re-reviewed.

This is the ready-PR analogue of SKILL.md §2a's issue dedup. There are **two** idempotency guards,
covering the two windows in which a PR could be wrongly re-picked:

- `armada:reviewing` is the **in-pipeline** guard — it stops a second tick double-driving a PR while
  its review is still running.
- the **fresh-for-review** clause is the **post-review** guard — it stops the fleet re-reviewing the
  *same unchanged* PR on every tick (which, with `autoMerge` off, would otherwise post a duplicate
  review every interval forever), **while still re-engaging the instant a human adds a comment**. A
  reviewed PR is therefore **monitored, not abandoned**: quiet → held; new comment → picked back up.

### Re-engage on new activity (post-review monitoring)

After a review completes with `autoMerge` off (§3e), the PR returns to bare `armada` and the fleet's
review summary comment (`🔭 crows-nest: ✅ reviewed … awaiting human merge`) stands as the
**"reviewed-at" marker** — its `createdAt` is the point the last review covered. The marker is the
comment itself, so **no new label is needed** and this works in any commissioned repo with no extra
setup.

On each tick, for every `armada` PR that passes the other gates, classify its review state from a
**bounded per-candidate** fetch of its **full** timeline. "Full" is the operative word: a reviewed
PR's new feedback most often arrives as an **inline reply inside one of the review threads**, and
those replies are **not** returned by `gh pr view --json comments` (which carries only top-level PR
comments). You must therefore union **three** comment surfaces — top-level comments, review
submissions, and **inline review-thread comments/replies** — or you will miss exactly the comments a
reviewer leaves in response to the review (this is the bug that let an inline "please also do X" reply
sit unactioned because the check only looked at top-level comments):

```bash
gh pr view <n> --json comments,reviews,commits      # top-level comments, review bodies, commits
gh api repos/<owner>/<repo>/pulls/<n>/comments       # inline review-THREAD comments + replies
```

Build the timeline as the **union of all three comment surfaces** — top-level `comments[].createdAt`,
review `reviews[].submittedAt`, and inline `pulls/<n>/comments[].created_at` — plus commit
`commits[].committedDate`. Then:

- **No fleet `✅ reviewed … awaiting human merge` marker exists** → **never reviewed** → eligible
  (first review).
- **A marker exists, and any non-fleet event is newer than it** — a top-level comment, a review, an
  **inline review-thread reply**, or a commit dated after the marker → **new activity** → **eligible
  again (re-engage)**. The re-dispatched pipeline is told to **address the new feedback** (shipwright
  address-review on the new comments — *including the inline replies* — re-validate, push, reply per
  thread), not blindly repeat the prior review.
- **A marker exists and nothing non-fleet is newer** → **reviewed & quiet** → **held** with reason
  `reviewed — awaiting human merge (no new activity)`; reported in SKILL.md §2e, **not** dispatched.

**"Fleet" vs "human" — how to classify each event depends on `fleetLogin`** (config; see
[fleet-identity.md § Detection](fleet-identity.md#detection-fleet-vs-human), the canonical rule):

- **`fleetLogin` is set (the fleet has its own GitHub App identity) → author-based is PRIMARY.** An
  event is **fleet** iff its `author.login` (or commit author) **equals `fleetLogin`** after
  **normalising the `[bot]` suffix off both sides** (case-insensitive). This normalisation is
  **required**: GraphQL/`--json` returns the bot login `[bot]`-stripped (`lc-armada-fleet`) while REST
  returns it in full (`lc-armada-fleet[bot]`), so a raw compare misses the fleet's own top-level
  comments/reviews and loops — see [fleet-identity.md § Detection](fleet-identity.md#detection-fleet-vs-human).
  **Everything else is human** and, dated after the marker, re-opens the PR. Fleet markers (`🔭 crows-nest:`, `## muster review`,
  `✅ reviewed … awaiting human merge`, inline findings) are kept only as a **backstop** for legacy
  fleet comments written before the App switch — treat marker-carrying comments as fleet too. Because
  the maintainer's account ≠ the bot, the maintainer's **inline review replies are unambiguously
  human** and reliably re-engage the PR.
- **`fleetLogin` is blank (fleet runs under the maintainer's own `gh` login) → decide by MARKER, not
  by author.** A fleet comment/review is one that carries a fleet marker (the prefixes above);
  **everything without a fleet marker is human activity**. **Do not filter by `author.login` in this
  mode:** the fleet's comments and the human's share the *same* login, so author detection fails both
  ways — it either treats the human's reply as "fleet" (ignoring it forever) or the fleet's own marker
  as "human" (re-reviewing on a loop). The **marker** is the only reliable signal here.

Either way the fleet **monitors all open PRs for additional comments even after review — including
inline thread replies** — and any human event dated after its last action re-opens the PR.

The graph (SKILL.md §2b) may still **hold** a ready PR behind a base-about-to-move or same-file edge
even when it passes this gate — those held PRs are reported in SKILL.md §2e, not dispatched.

## 3b. Selection (the §2c frontier, up to `maxConcurrentReviews`)

The scheduler (SKILL.md §2c) selects which ready PRs to launch this tick — the frontier PRs,
oldest-update-first (FIFO on `updatedAt`), up to `(maxConcurrentReviews − reviews-in-flight)`.
**Multiple PRs are reviewed concurrently** when the budget allows and the graph permits; the rest are
held for later ticks. If no PR is on the frontier and none is in flight, the SKILL.md §2e report notes
the harbour is clear.

## 3c. Claim it

These — and the §3e reconcile labels/comments — are fleet writes: when `fleetLogin` is set, prefix
each with a freshly-minted App token (`GH_TOKEN="$(node "${CLAUDE_PLUGIN_ROOT}/scripts/mint-app-token.mjs")" gh …`,
per [fleet-identity.md](fleet-identity.md)); drop the prefix when `fleetLogin` is blank.

```bash
GH_TOKEN="$(node "${CLAUDE_PLUGIN_ROOT}/scripts/mint-app-token.mjs")" gh pr edit <n> --add-label "armada:reviewing"
GH_TOKEN="$(node "${CLAUDE_PLUGIN_ROOT}/scripts/mint-app-token.mjs")" gh pr comment <n> --body "🔭 crows-nest: ready-PR pipeline started — review → address → re-validate → gated merge."
```

## 3d. Drive the pipeline (background Workflow)

Hand the claimed PR to the **review→merge Workflow** ([review-merge-pipeline.md §4](review-merge-pipeline.md)),
launched as a **background** dispatch (via the **`Agent` tool**, non-interactive, isolated context,
`run_in_background: true`) — exactly as issue builds run in SKILL.md §2d. Launching it in the
background means the tick **kicks off the pipeline and returns immediately** instead of blocking the
whole `/loop` tick until the review-address-merge finishes (which takes many minutes). The lookout
goes straight back to scheduling — dispatching more PR pipelines up to `maxConcurrentReviews` and more
issue builds up to `maxConcurrentBuilds`, all concurrently. The Workflow returns a single terminal
result the lookout maps to the PR-track labels when it **completes** (§3e). The lookout itself stays
thin: it claims, launches the Workflow, and records the outcome — it does **not** carry the review or
build transcripts (those live in the subagents' own contexts).

## 3e. Record the outcome (on completion)

The pipeline result arrives **asynchronously** — the tick that launched it has long since returned,
so this reconcile runs when the background Workflow **completes** (the `Agent` tool surfaces its
return). Until then the PR stays `armada:reviewing`, and the in-flight guard (SKILL.md §2a / §3a)
keeps it out of every intervening tick. On completion, map the Workflow's terminal result to a
PR-track label and a comment — a PR must **never** be left on `armada:reviewing`:

- `merged` → `gh pr edit <n> --remove-label "armada:reviewing" --add-label "armada:merged"`; comment
  the merge commit. (Only reachable with `autoMerge: true` and all gates green.)
- `ready_awaiting_human` → `gh pr edit <n> --remove-label "armada:reviewing"` (leave `armada` on so a
  human sees it); comment "✅ reviewed, addressed, green — **awaiting human merge** (auto-merge off)".
  This is the default terminal state when `autoMerge` is off. The PR returns to bare `armada`, and
  **this comment is the "reviewed-at" marker** (§3a "Re-engage on new activity"): future ticks
  **hold** it as reviewed-and-quiet instead of re-reviewing it on a loop, but **re-engage
  automatically** the moment a human adds a new comment, review, or commit dated after this marker —
  so a reviewed PR stays monitored, never abandoned and never blindly re-reviewed.
- `blocked` → `gh pr edit <n> --remove-label "armada:reviewing" --add-label "armada:blocked"`; comment
  the reason (blocking finding, red CI, no convergence, non-mergeable, branch protection unmet).

## 3f. Report

The PR track's dispatch is reported as part of the **unified schedule line** (SKILL.md §2e), alongside
the issue builds dispatched the same tick — builds running, reviews running, held + why, in one line.
The per-PR pipeline outcome is logged separately when its background Workflow completes (§3e):

```
crows-nest: #150 review pipeline completed → awaiting human merge (auto-merge off)
```
