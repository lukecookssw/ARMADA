---
name: commission
description: >
  Commission the ARMADA fleet in the current repository — the one-time (idempotent) setup that
  every other ARMADA skill depends on. Detects the project's build/test/lint/run commands and base
  branch, writes .armada/config.json, creates the GitHub trigger + state labels, checks gh auth,
  and prints how to arm the crows-nest watch. Trigger when the user says "commission armada", "set
  up armada", "initialise armada", "armada bootstrap", "get armada ready", just installed the
  ARMADA plugin, or invokes /commission. Also auto-invoked by crows-nest and shipwright when they
  find the repo isn't commissioned yet. Safe to re-run.
---

# commission — bring ARMADA into service in this repo

This skill is ARMADA's self-setup. Installing the plugin makes the *skills* available; commissioning
makes them *work in this repository* by creating the GitHub labels they key off and writing the
config that tells them how to build the project. **It is idempotent** — re-running it reconciles
state rather than duplicating it, so it's safe to run any time you're unsure whether a repo is ready.

> Any ARMADA skill that finds no `.armada/config.json` should run this first (or offer to).

## 1. Preflight

Confirm the environment before changing anything:

```bash
gh auth status                              # must be logged in
gh repo view --json nameWithOwner,defaultBranchRef   # must be a GitHub repo with a remote
git rev-parse --is-inside-work-tree         # must be a git work tree
```

If `gh` isn't authenticated, stop and tell the user to run `gh auth login` (or `! gh auth login`
in-session) — don't try to proceed. If there's no GitHub remote, ARMADA can't watch issues; say so.

## 2. Detect the project's commands and base branch

ARMADA is stack-agnostic, so commissioning *discovers* how to build this specific repo instead of
assuming. Inspect the repo and derive the commands. **Don't fabricate commands that don't exist** —
omit any you can't find, and the skills will infer or ask later.

| Signal in repo | Likely commands |
| :--- | :--- |
| `package.json` with `scripts` | use the `build` / `test` / `lint` / `format` / `dev`/`start` scripts that exist |
| `Makefile` | `make build`, `make test`, `make lint` (only targets that exist) |
| `*.csproj` / `*.sln` / `*.slnx` | `dotnet build`, `dotnet test`, `dotnet format` |
| `Cargo.toml` | `cargo build`, `cargo test`, `cargo clippy`, `cargo fmt` |
| `pyproject.toml` / `tox.ini` / `setup.py` | `pytest`, `ruff check`, `ruff format` / `black` |
| `go.mod` | `go build ./...`, `go test ./...`, `go vet ./...` |
| a skills-only repo (only `skills/*/SKILL.md`, no build system) | leave `build` empty; use a frontmatter/markdown validator as `test` if one exists |

Base branch: read it from `gh repo view --json defaultBranchRef` (the GitHub default), falling back
to `git symbolic-ref --short refs/remotes/origin/HEAD` then `main`.

**Show the detected commands to the user and let them correct before writing.** Detection is a
best-effort guess; a wrong `test` command poisons every later skill's validation step.

## 3. Write `.armada/config.json`

Write the config at the repo root. If one already exists, show a diff and **confirm before
overwriting** — the user may have hand-tuned it.

```jsonc
{
  "triggerLabel": "armada",        // crows-nest only acts on issues with this label
  "dispatch": "shipwright",        // "shipwright" (one build pass) or "flagship" (auto loop)
  "baseBranch": "<detected default>",
  "commands": {
    "build":  "<detected or omitted>",
    "test":   "<detected or omitted>",
    "lint":   "<detected or omitted>",
    "format": "<detected or omitted>",
    "run":    "<detected or omitted>"
  }
}
```

Add `.armada/` is fine to commit (it's project config, not secrets). Mention that the user can edit
`triggerLabel`/`dispatch` later.

## 4. Create the GitHub labels

The fleet tracks issue state entirely through labels, so they must exist. `--force` makes this
idempotent (creates or updates, never errors on re-run). Use the configured `triggerLabel`:

```bash
gh label create "armada"           --color "1d76db" --description "Eligible for the ARMADA fleet to pick up"     --force
gh label create "armada:underway"  --color "fbca04" --description "Claimed by crows-nest; a build is in progress" --force
gh label create "armada:done"      --color "0e8a16" --description "ARMADA opened a PR for this issue"            --force
gh label create "armada:blocked"   --color "b60205" --description "ARMADA could not finish; needs a human"       --force
```

(If `triggerLabel` was customised, name the eligible label to match and adjust the state labels'
prefix accordingly.)

## 5. Report readiness and how to set sail

Print a short readiness summary and the two things the user does next — **don't auto-create issues
and don't arm the loop for them** (both are the user's call):

```
⚓ ARMADA commissioned in <owner/repo>.
  base branch : <base>
  build/test  : <commands, or "none detected — skills will infer">
  labels      : armada, armada:underway, armada:done, armada:blocked ✓

Next:
  1. Label the issues you want built with `armada`:
       gh issue edit <number> --add-label armada
  2. Arm the lookout (crows-nest will hand you the exact /loop line):
       run the crows-nest skill, or say "watch for issues"
```

## Idempotency & re-runs

- Labels: `--force` reconciles them — safe.
- Config: diff-and-confirm before overwrite — never clobbers hand edits silently.
- Nothing here creates issues, opens PRs, or merges. Commissioning only prepares the repo.

## Inputs

- Optional: a custom trigger label, dispatch target, or base branch (otherwise detected/defaulted).

## Output

- `.armada/config.json` written (or confirmed up-to-date).
- The four GitHub labels created/reconciled.
- A readiness summary + the two next-step commands.
