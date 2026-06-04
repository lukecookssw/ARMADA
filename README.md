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

## Install

ARMADA is a Claude Code plugin. Clone it and point Claude Code at it:

```bash
git clone https://github.com/calumjs/ARMADA.git
```

Then add it as a plugin marketplace / local plugin (see the Claude Code plugin docs), or drop
the `skills/` directories into your project's `.claude/skills/`.

## Per-repo configuration

ARMADA skills run *your* project's commands. Drop a `.armada/config.json` in the target repo so
the fleet knows how to build, test, lint, and run it:

```jsonc
{
  // The label crows-nest watches for. Issues without it are ignored.
  "triggerLabel": "armada",
  // How crows-nest dispatches a claimed issue: "shipwright" (single pass) or "flagship" (auto loop).
  "dispatch": "shipwright",
  // Your project's commands. Any can be omitted; skills will try to infer them.
  "commands": {
    "build":  "npm run build",
    "test":   "npm test",
    "lint":   "npm run lint",
    "format": "npm run format",
    "run":    "npm run dev"
  },
  // Default base branch for new work.
  "baseBranch": "main"
}
```

If `.armada/config.json` is absent, skills fall back to inferring commands from the repo
(`package.json` scripts, a `Makefile`, `*.csproj`, `Cargo.toml`, etc.) and ask before guessing
anything destructive.

## Safety

The fleet **opens PRs and pushes commits but never merges** — the final merge is always a human
action. `crows-nest` only ever acts on issues carrying the configured trigger label, so it can't
run away with your whole backlog.

---
🤖 Built with [Claude Code](https://claude.com/claude-code)
