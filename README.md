# ⚓ ARMADA

**A**utonomous **R**ecursive **M**ulti-**A**gent **D**evelopment **A**ssembler.

ARMADA is a fleet of [Claude Code](https://claude.com/claude-code) skills. One skill keeps
watch for new GitHub issues; the rest pick them up, build them, review them, verify them, and
drive them to a merge-ready PR — with as much or as little human steering as you want.

The skills are **stack-agnostic**. They drive GitHub (`gh`), git worktrees, and your project's
own build/test/lint/run commands — they don't care whether you're shipping Go, Rust, .NET,
TypeScript, or Python.

## The fleet

Skills are colourful by design (a `crows-nest` is more memorable than a `github-issue-poller`),
but each one's **`description`** frontmatter carries explicit trigger phrases, so Claude fires
the right skill from natural language — you rarely type the name.

| Skill | Role | Status |
| :--- | :--- | :--- |
| **`commission`** | The bootstrap. Sets ARMADA up in a repo: detects build/test commands, writes `.armada/config.json`, creates the GitHub labels. Idempotent. | ✅ shipped |
| **`crows-nest`** | The lookout. Runs under `/loop` and watches for new GitHub issues, then dispatches each one into the fleet. | ✅ shipped |
| **`shipwright`** | The builder. Takes one issue and works it end-to-end in an isolated worktree, opening a PR. | ✅ shipped |
| `flagship` | The command vessel. An autonomous build → review → verify → fix loop that drives an issue all the way to merge-ready. | 🚧 roadmap |
| `sea-trial` | The shakedown run. Launches the app and drives a real flow with Playwright to verify a change works at runtime. | 🚧 roadmap |
| `logbook` | The voyage record. Records a narrated "done" walkthrough video for stakeholders. | 🚧 roadmap |
| `muster` | Inspection before sailing. Reviews the diff against the project's conventions. | 🚧 roadmap |
| `signal-flags` | Signals back. Addresses reviewer comments on a PR and replies to each thread. | 🚧 roadmap |
| `cargo-manifest` | The manifest. Writes task/PR documentation for completed work. | 🚧 roadmap |

We're adding ships as we need them, not all at once. `crows-nest` + `shipwright` already form a
working loop: an issue appears → it gets built → a PR opens.

## Install & set up

ARMADA is a Claude Code plugin. Add it as a marketplace and install it, then **commission** it in
whatever repo you want the fleet to work on:

```text
/plugin marketplace add calumjs/ARMADA      # or a local path: /plugin marketplace add ./
/plugin install armada@armada
/armada:commission                          # one-time, idempotent, per repo
```

Installing makes the *skills* available. **`commission`** is what makes them work in a given repo:
it auto-detects your build/test/lint/run commands and base branch, writes `.armada/config.json`,
creates the four GitHub labels, and tells you how to arm the watch. You don't hand-configure
anything — that knowledge lives in the skill, so any install self-sets-up.

> Prefer not to use the plugin system? Drop the `skills/` folders into your project's
> `.claude/skills/` and run `/commission` — same result, project-scoped.

### Then set sail

```text
1. Label the issues you want built:   gh issue edit <n> --add-label armada
2. Arm the lookout:                   run crows-nest (it hands you the /loop line)
```

The `armada` label is the arming switch — `crows-nest` only ever touches issues that carry it, so
you grant autonomy one issue at a time.

## Per-repo configuration

`commission` writes `.armada/config.json` for you, but you can hand-edit it. Shape:

```jsonc
{
  // The label crows-nest watches for. Issues without it are ignored.
  "triggerLabel": "armada",
  // How crows-nest dispatches a claimed issue: "shipwright" (single pass) or "flagship" (auto loop).
  "dispatch": "shipwright",
  // Default base branch for new work.
  "baseBranch": "main",
  // Your project's commands. Any can be omitted; skills will infer or ask.
  "commands": {
    "build":  "npm run build",
    "test":   "npm test",
    "lint":   "npm run lint",
    "format": "npm run format",
    "run":    "npm run dev"
  }
}
```

## Safety

The fleet **opens PRs and pushes commits but never merges** — the final merge is always a human
action. `crows-nest` only ever acts on issues carrying the configured trigger label, so it can't
run away with your whole backlog.

---
🤖 Built with [Claude Code](https://claude.com/claude-code)
