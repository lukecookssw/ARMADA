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

Hand the claimed issue to the dispatch target. **How** you dispatch depends on whether the tick is
running autonomously or under a watching human — the two modes trade approval gates for context
isolation:

- **Autonomous (`/loop`) path — dispatch into a subagent.** When the tick is firing under `/loop`,
  the lookout commands and a subagent works. Spawn the dispatch target (`shipwright`, default — or
  `flagship` when that ship is in the fleet) via the **`Agent` tool**, non-interactive, with
  `isolation: "worktree"`. The subagent runs the full build (worktree → implement → validate → open
  PR) in **its own context and its own worktree**, then returns a structured result (below); the
  lookout never carries the build transcript. This keeps the lookout cheap and legible across
  hundreds of ticks, and it's the multi-agent shape ARMADA is named for.

- **Supervised single pick — run inline.** When a human asked for one named issue ("crows-nest,
  grab #142"), run [`shipwright`](../shipwright/SKILL.md) **inline in this turn** so the user keeps
  its approval gates — the plan sign-off (§3 of shipwright) and the base-branch choice (§1a). No
  subagent, because a subagent can't pause to ask.

**The subagent runs `shipwright` non-interactively.** It cannot pause to ask the user, so
shipwright's approval gates collapse to **sensible defaults** (accept the plan, take the default
base branch) rather than prompts. Two guards survive non-interactively and must **not** be
defaulted away:
- **Base branch** — use `baseBranch` from `.armada/config.json` (§1a's logic still applies if the
  issue's target code lives only on a feature branch; pick the safe base, don't merge to resolve it).
- **No destructive migrations** — never run a data-destructive schema/data migration unattended;
  if the only path forward needs one, return `blocked` rather than guessing.

#### Subagent return contract

The subagent reports back a single structured result the lookout maps to labels:

```json
{
  "issue":  142,
  "pr":     "https://github.com/<org>/<repo>/pull/150",
  "branch": "142-add-csv-export",
  "status": "opened",            // "opened" | "blocked"
  "reason": "one-line summary or, when blocked, why a human is needed"
}
```

The lookout maps that result to the claimed-state labels and the issue comment:

- `status: "opened"` → `gh issue edit <issue> --add-label "armada:done" --remove-label "armada:underway"`,
  then `gh issue comment <issue> --body "🔭 crows-nest: PR opened — <pr>"`.
- `status: "blocked"` → `gh issue edit <issue> --add-label "armada:blocked" --remove-label "armada:underway"`,
  then `gh issue comment <issue> --body "🔭 crows-nest: blocked — <reason>"`.

Either way the issue leaves `armada:underway`: never leave one stuck there, or it's invisible to
both the lookout and a human. (On the inline path the running shipwright opens the PR directly;
apply the same label swap and comment from its outcome.)

#### Concurrency stays opt-in

Worktree isolation is what makes the autonomous path safe to parallelise: because each subagent
builds in **its own worktree**, multiple issues could be dispatched in the same tick without
trampling a shared tree. That's the enabler, **not** the default — the one-issue-per-tick rule of
§2b is unchanged. Only raise the per-tick limit (one subagent per issue) when the user explicitly
asks for concurrency.

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
