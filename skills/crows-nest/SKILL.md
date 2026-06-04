---
name: crows-nest
description: >
  The ARMADA lookout. Keeps watch for new GitHub issues and dispatches each one into the fleet
  to be built. Runs as a recurring watch via /loop: each tick lists open issues carrying the
  configured trigger label that aren't already claimed, claims the next one, and hands it to
  shipwright (or flagship) to implement. Trigger when the user says "watch for issues", "start
  the crows-nest", "keep an eye on the backlog", "listen for new issues", "man the lookout", or
  invokes /crows-nest. Accepts an optional trigger label (default from .armada/config.json, else
  "armada") and an optional poll interval.
---

# crows-nest — watch for new issues and dispatch them

`crows-nest` is ARMADA's entry point: the lookout that turns a GitHub backlog into a stream of
work for the fleet. It does **one tick of triage** each time it runs, and `/loop` is what makes
it run again and again unattended:

> **Arm a `/loop`** → each tick **list new labelled issues** → **claim the next one** → **dispatch
> it** to [`shipwright`](../shipwright/SKILL.md) (or `flagship`) → repeat.

## How the watch is wired (read this first)

These are constraints the design is built around:

1. **A skill cannot type `/loop` itself.** `/loop` is a built-in command and the Skill tool only
   runs skills — model text isn't executed as a command. So `crows-nest`'s job is to **compose the
   exact `/loop` line and hand it to you to run** (§3). Everything after that repeats automatically.
2. **Only act on the trigger label.** The lookout must never grab the whole backlog. It acts solely
   on open issues carrying the configured `triggerLabel` (default `armada`). No label → not its job.
3. **Claiming must be atomic-ish and visible.** Before dispatching, mark the issue claimed (a label
   swap + a comment) so a second tick — or a second human — doesn't pick up the same issue.
4. **Always bound the loop.** Pass `/loop` an interval and let the user stop it. A lookout that
   never sleeps and never reports is just noise.

## 1. Resolve config and scope

Read `.armada/config.json` from the target repo:

- `triggerLabel` — the label to watch (default `armada`).
- `dispatch` — how to hand off a claimed issue: `"shipwright"` (one build pass, default) or
  `"flagship"` (autonomous drive-to-merge loop).
- `baseBranch` — default base for new work.

**If the config or the labels are missing, the repo isn't commissioned** — run the
[`commission`](../commission/SKILL.md) skill first (it detects commands, writes the config, and
creates the labels), then continue. Don't fall back to silent defaults: an uncommissioned repo
usually has no `armada` label, so the watch would find nothing and look broken.

Confirm the watch parameters with the user **once** before arming the loop — label, dispatch
target, interval, and the claimed-state convention below. This is the only human checkpoint, so
make it count.

### Claimed-state convention

The lookout tracks issue state purely through labels so it survives restarts:

- `armada` — eligible, not yet picked up.
- `armada:underway` — claimed; a tick is building it (or it has an open branch/PR).
- `armada:done` — a PR has been opened (set by the dispatched skill / on handoff).
- `armada:blocked` — the fleet gave up; needs a human. Skipped by future ticks.

## 2. One tick of the watch

Each tick does exactly this, then returns:

### 2a. List eligible issues

```bash
gh issue list --label "<triggerLabel>" --state open \
  --json number,title,labels,createdAt,assignees --limit 50
```

Filter **out** any issue that is already:
- labelled `armada:underway`, `armada:done`, or `armada:blocked`, **or**
- has an open PR that references it (`gh pr list --search "<number> in:body" --state open`), **or**
- already has a worktree/branch named for it locally.

That dedup check is what keeps the loop idempotent — a tick that fires while the previous build is
still running must not double-pick.

### 2b. Pick the next issue

Order the remaining issues oldest-first (FIFO on `createdAt`) unless a `priority`/`P0` label
suggests otherwise. Process **one issue per tick** by default — sequential is safer for an
unattended loop sharing one working tree. (Only raise concurrency if the user asks and each build
runs in its own worktree.)

If nothing is eligible, log `crows-nest: horizon clear` and return — the loop will check again next
interval. Don't invent work to look busy.

### 2c. Claim it

```bash
gh issue edit <number> --add-label "armada:underway" --remove-label "<triggerLabel>"
gh issue comment <number> --body "🔭 crows-nest: picked up by ARMADA — dispatching to <dispatch target>."
```

### 2d. Dispatch it

Hand the claimed issue to the dispatch target:

- **`shipwright`** (default) — run the [`shipwright`](../shipwright/SKILL.md) skill for issue
  `#<number>` end-to-end: worktree → implement → validate → open PR. One build pass.
- **`flagship`** — hand off to the autonomous drive-to-merge loop (when that ship is in the fleet).

On a successful PR, swap the label to `armada:done` and comment the PR link on the issue. If the
dispatched build fails or stalls, label `armada:blocked`, comment why, and move on — never leave an
issue stuck on `armada:underway`, or it'll be invisible to both the lookout and a human.

### 2e. Report the tick

Print a one-line summary so the loop's history is legible:

```
crows-nest tick: 3 eligible · picked #142 "Add CSV export" · dispatched to shipwright · PR #150 opened
```

## 3. Arm the loop — hand the /loop line to the user

`crows-nest` can't type `/loop` itself, so compose the command and hand it over. Pick the interval
from the user (default ~5 minutes; faster burns API for little gain on a slow backlog):

```text
/loop 5m Run the crows-nest skill: do one watch tick for label "armada" — list eligible open issues, claim the next one, and dispatch it to shipwright. If the horizon is clear, report that and wait for the next tick.
```

Tell the user: *"Paste that to arm the lookout, or I can do single ticks on demand."* Note that
`/loop` with no interval lets the model self-pace, and that they can stop it any time. If `/loop`
is unavailable in their environment, offer to run manual ticks (§2) when asked.

## 4. Stopping and safety

- **Stop** is the user's call (`/loop` is interruptible). The lookout never decides to stop the
  watch on its own; it only reports `horizon clear` and waits.
- The fleet **opens PRs but never merges.** `crows-nest` only escalates an issue to a build; a human
  still merges.
- **Label discipline is the safety rail.** Because the lookout acts only on `triggerLabel`, you
  arm autonomy by adding the label and disarm it by removing it — per issue, no code change needed.
- If a tick errors (network, `gh` auth, rate limit), report it and let the next interval retry;
  don't spin-retry inside one tick.

## Inputs

- `label` *(optional)* — the trigger label to watch. Defaults to `.armada/config.json` → `triggerLabel`, else `armada`.
- `interval` *(optional)* — poll cadence for the `/loop` line. Default ~5m.
- `dispatch` *(optional)* — `shipwright` | `flagship`. Defaults to config, else `shipwright`.

## Output

- A composed `/loop` command the user can paste to arm the watch.
- Per tick: eligible count, the issue picked (if any), the dispatch target, and the resulting PR.
- Issue labels kept in sync (`armada` → `armada:underway` → `armada:done` / `armada:blocked`).
