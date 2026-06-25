# MODIFICATIONS

Your personal changes to this ARMADA clone, plus how to run it on Windows **without** the public
marketplace, and what to set up on GitHub for Claude to review PRs directly.

This file is a checklist. Each change lists **what**, **why**, **the exact file(s)/lines**, and a
**before → after**. Line numbers are from the current checkout (commit `76f6395`); if they've
drifted, search for the quoted text.

---

## Change 1 — Don't use Codex for PR reviews

### Background

ARMADA reviews a PR with **two independent reviewers ("lenses")** in parallel (the `muster` skill):

- **Lens A — `code-review`**: a conventions/correctness pass (a Claude `general-purpose` agent that
  runs the built-in `/code-review`).
- **Lens B — `codex-rescue`**: a second opinion dispatched to the **Codex** agent
  (`agentType: codex:codex-rescue`). **This is the only Codex usage in the repo** and the one to
  remove.

You have two ways to do this. **Recommended: Option A** — keep two lenses but make Lens B a second
Claude agent. This preserves the "two independent perspectives" design and avoids ARMADA marking
every review as `degraded` (which it does whenever fewer than two lenses return — see
`consolidateLenses` in `scripts/review-merge-pipeline.mjs`).

> **Option B (drop to a single lens)** is simpler but worse: every review will be flagged
> `degraded` / "single-lens", and the merge-gate logic treats a degraded review as "not a green
> light". Only pick B if you genuinely want one reviewer. The edits for B are noted inline below.

### The one file that actually runs in the autonomous loop

**`scripts/review-merge-pipeline.mjs`** — this bundled script (not the prose) is what crows-nest
executes during the ready-PR pipeline. **Editing this is what changes real behaviour.**

**`scripts/review-merge-pipeline.mjs`, lines ~152–160** (the `LENSES` array, Lens B):

```js
  {
    name: 'codex-rescue',
    agentType: 'codex:codex-rescue',
    prompt: (pr) =>
      `Review PR #${pr} as the independent second-opinion lens (muster Lens B) — a root-cause / ` +
      ...
  },
```

**Option A — replace with a second Claude lens.** Change `agentType` away from Codex (keep the
name/prompt, or rename for clarity):

```js
  {
    name: 'second-opinion',
    agentType: 'general-purpose',
    prompt: (pr) =>
      `Review PR #${pr} as the independent second-opinion lens (muster Lens B) — a root-cause / ` +
      `second-opinion read of the same diff, coming at it cold so you catch what a conventions lens ` +
      `rationalises away. Read the diff directly; do NOT run /code-review (that's Lens A). Return ` +
      `ONLY your findings array in the per-finding schema {severity,file,line,title,detail}. Do not ` +
      `fan out to further agents.`,
  },
```

**Option B — single lens.** Delete the entire Lens B object so `LENSES` contains only
`code-review`. (Expect every review to be reported `degraded`.)

**Same file, line ~561** (the `--help`/banner text — cosmetic, keep it honest):

```
'  §4.1 review     → agent(code-review) + agent(codex:codex-rescue)  TWO top-level lenses',
```
→ replace `codex:codex-rescue` with `second-opinion` (Option A) or rewrite the line for a single
lens (Option B).

### Documentation/prose to keep in sync (no runtime effect, but avoids confusion)

These describe the behaviour; update them so the docs don't lie:

| File | Where | What to change |
| :--- | :--- | :--- |
| `skills/muster/SKILL.md` | `description` (lines 3–11), §1 "Lens B — codex-rescue" (lines 87–92), §3 inline-comment template `flagged by: code-review + codex-rescue` (line 143), §4 return example `"lenses": ["code-review", "codex-rescue"]` (line 172) | Replace `codex-rescue` / `codex:codex-rescue` with `second-opinion` (Option A) or remove Lens B references (Option B) |
| `skills/crows-nest/SKILL.md` | line 724 — `(code-review + codex:codex-rescue)` | Same replacement |
| `skills/crows-nest/references/review-merge-pipeline.md` | line 51 — `Lens B codex:codex-rescue` | Same replacement |
| `README.md` | line 27 — `muster` row mentions "code-review + codex-rescue" | Same replacement |

> Tip: `grep -ri codex .` (or the Grep tool) finds every occurrence — there are 5 files. The only
> one that changes behaviour is `scripts/review-merge-pipeline.mjs`; the rest are docs.

---

## Change 2 — No "policing" of issues: build every issue you add

### What "policing" means here, and what to turn off

ARMADA has several gates that stop an arbitrary issue from being built. On a **private repo where
you author every issue**, you want them off so **every open issue gets picked up and built**:

1. **Trigger-label gate (the main one).** crows-nest *only* acts on issues carrying the `armada`
   label (`triggerLabel`). This is the "master switch" the README describes. To build everything,
   stop filtering issues by that label.
2. **Author allowlist.** Already off by default (`authors: ""`). Leave it blank. ✅ nothing to do.
3. **`charter`'s "buildable quality bar"** and auto-arm step — only relevant if you create issues
   *through* the `charter` skill. Since you'll add issues directly on GitHub, charter is bypassed
   anyway. No edit required, but see the note below.
4. **Public-intake screening** — for screening *public* suggestions. Irrelevant on a private repo;
   turn it off in config (below).

> ⚠️ **Trade-off / safety note.** The trigger label is ARMADA's deliberate "you can't run away with
> my whole backlog" safety rail. Removing it means **every open issue is fair game** — exactly what
> you asked for, but be aware: an issue you open just to *discuss* something will also get built.
> To exempt one, close it, or label it `armada:blocked` (crows-nest skips that label). The
> `armada:*` lifecycle labels (`armada:underway`, `armada:done`, `armada:shipped`, `armada:blocked`)
> still do their job — we only stop using the **plain `armada` label as the entry gate**.

### Edit: `skills/crows-nest/SKILL.md`

**(a) The issue-list query — §2a, lines ~245–247.** This is the line that does the gating.

Before:
```bash
gh issue list --label "<triggerLabel>" --state open \
  --json number,title,labels,createdAt,assignees,author,body --limit 50
```

After (drop `--label`, so *all* open issues are scanned; the eligibility filter below removes ones
already in flight or terminal):
```bash
gh issue list --state open \
  --json number,title,labels,createdAt,assignees,author,body --limit 50
```

> Leave the **`gh pr list --label "<triggerLabel>"`** line (line ~248) **as-is.** PRs ARMADA opens
> are auto-armed by `shipwright` (it adds the `armada` label when it opens the PR), so the ready-PR
> pipeline keeps working. Removing the label from the issue query is all you need for "build every
> issue". (If you *also* want crows-nest to review PRs you open by hand, drop `--label` there too —
> but for "Claude reviews my PRs on GitHub" see the GitHub section below, which is the better tool.)

**(b) Issue eligibility filter — §2a, lines ~256–260.** Make sure it still excludes issues already
in a lifecycle state (it does today), and add the terminal `armada:shipped`:

Before:
```
- labelled `armada:underway`, `armada:done`, or `armada:blocked`, **or**
```
After:
```
- labelled `armada:underway`, `armada:done`, `armada:shipped`, or `armada:blocked`, **or**
```
The other two bullets (has an open PR referencing it / has a local branch) already prevent
double-pickup and need no change.

**(c) The design rule — §"How the scheduler is wired", rule 2, lines ~55–57.** This is prose, but
update it so the doc matches behaviour:

Before:
> **2. Only act on the trigger label.** The lookout must never grab the whole backlog. It acts
> solely on open issues *and* PRs carrying the configured `triggerLabel` (default `armada`)…

After (your policy):
> **2. Build every open issue; gate PRs by label.** On this install the lookout builds *all* open
> issues that aren't already in an `armada:*` lifecycle state. PRs are still claimed only when they
> carry `triggerLabel` (the fleet auto-arms its own PRs).

**(d) Optional cleanups** (no behaviour change, just tidiness): the §1 `triggerLabel` description
(lines 75–77) and the author-allowlist section (§2a "Author allowlist", lines 271–292) can be left
exactly as they are — the allowlist is already a no-op when `authors` is blank.

### Edit: `.armada/config.json` (in **your project repo**, written by `/commission`)

This file lives in the repo ARMADA works on, not in the plugin. After commissioning, set:

```jsonc
{
  "authors": "",                 // keep blank → any author (it's you anyway)
  "publicIntake": { "enabled": false },   // private repo: no public screening
  // ...everything else commission wrote stays as-is
}
```

> `triggerLabel` can stay `"armada"` in config — the lifecycle labels (`armada:underway`, etc.)
> still derive from it. After your Change-2 edit, the plain label simply isn't required to *enter*
> the build queue any more.

### Note on `charter` (only if you use it)

`charter` auto-arms and enforces a "buildable" bar before creating an issue. Since you'll add
issues straight on GitHub, you can ignore `charter` entirely. If you *do* use it, nothing breaks —
an armed-or-not issue is now built either way. No edit needed.

---

## Change 3 — Remove the "degraded review" decision point entirely

### Background

ARMADA tags a review **`degraded: true`** whenever **fewer than two lenses return** (i.e. a
single-lens review). That flag then **blocks the merge** and **forces extra review rounds**. With
Change 1 you keep two Claude lenses, so you normally won't hit it — but you want the entire concept
gone, so a single review is treated as a **complete, valid** review (never "degraded", never a
merge blocker on those grounds).

The flag is **produced in exactly one place** and read in several. The cleanest fix is to
**neutralise it at the source** — once `degraded` is always `false`, every downstream consumer
(merge gate, pipeline loop, posted summary) goes inert automatically. The optional cleanups below
just remove the now-dead branches so the code/docs don't lie.

### Primary edit (this alone removes the decision point)

**`scripts/review-merge-pipeline.mjs`, `consolidateLenses()`, line ~173:**

Before:
```js
  // A review is degraded whenever fewer than two lenses returned — that's the
  // single-lens/degraded state issue #76 makes sure is NAMED, never silent.
  const degraded = ranNames.length < lensResults.length;
```
After:
```js
  // Single-lens reviews are treated as complete, not degraded (local policy).
  // Forcing this false makes every downstream `review.degraded` check inert:
  // the merge gate no longer blocks on it and the pipeline never re-loops on it.
  const degraded = false;
```

That's the whole behavioural change. `degradedReason` (lines ~209–212) will now always be
`undefined`, which every consumer already handles. Every place that reads `review.degraded ===
true` — the merge gate, the pipeline log, the muster summary prompt — now evaluates false and does
nothing.

### Optional cleanups (recommended — remove the now-dead branches so nothing is misleading)

These have **no behavioural effect** once `degraded` is always `false`, but they delete the dead
decision branches and keep the gate honest.

**1. `scripts/merge-gate.mjs` — this is the actual merge "decision point".**

- Line ~77: `const degraded = review.degraded === true;` → can stay (it'll just be `false`), or
  delete it along with its uses below.
- Lines ~90–97 (Gate 2): remove the `degraded` branch so it's not a blocker:

  Before:
  ```js
  // Gate 2 — no unresolved blocking finding, and the review was actually produced.
  if (degraded) {
    blockers.push('review degraded (a lens failed) — a missing review is not a green light');
  } else if (!Number.isFinite(blocking)) {
    blockers.push('no review summary — cannot confirm zero blocking findings');
  } else if (blocking > 0) {
    blockers.push(`${blocking} unresolved blocking finding(s)`);
  }
  ```
  After:
  ```js
  // Gate 2 — no unresolved blocking finding (single-lens reviews are complete, not degraded).
  if (!Number.isFinite(blocking)) {
    blockers.push('no review summary — cannot confirm zero blocking findings');
  } else if (blocking > 0) {
    blockers.push(`${blocking} unresolved blocking finding(s)`);
  }
  ```
  > ⚠️ Keep the `!Number.isFinite(blocking)` branch — that blocks a merge when **no review summary
  > exists at all**, which is a real safety check unrelated to "degraded". You only want single-lens
  > reviews to pass, not *missing* reviews.

- Line ~135 (convergence check): drop the leading `degraded ||`:

  Before:
  ```js
  const unresolvedThisRound =
    degraded || !Number.isFinite(blocking) || blocking > 0 || ci !== 'green' || localChecks !== true;
  ```
  After:
  ```js
  const unresolvedThisRound =
    !Number.isFinite(blocking) || blocking > 0 || ci !== 'green' || localChecks !== true;
  ```

- Line ~166 / ~27: the `degraded` field echoed into the gate's output (and the example comment) can
  be left or removed; it's just diagnostic.

**2. `scripts/review-merge-pipeline.mjs` — remove the dead handling.**

- Lines ~295–296: drop the `if (degraded) log(... DEGRADED ...)` line.
- Lines ~310–311: in the muster post prompt, drop the
  `degraded ? 'This review is DEGRADED — state that explicitly…' : ''` clause.
- Lines ~320–324 (the address step): with `degraded` always false this already behaves normally,
  but simplify for clarity:

  Before:
  ```js
  const actionable = degraded || !(blocking === 0) || (review?.findings?.length ?? 0) > 0;
  let addr = null;
  if (actionable && !degraded) {
  ```
  After:
  ```js
  const actionable = !(blocking === 0) || (review?.findings?.length ?? 0) > 0;
  let addr = null;
  if (actionable) {
  ```
- Line ~346: drop the leading `degraded ||` from `stillUnresolved`.
- Line ~384: `review: { blocking, degraded }` passed to the gate can stay (`degraded` is `false`) or
  be trimmed to `review: { blocking }`.
- Line ~76 (`REVIEW_SCHEMA`): the `degraded` schema field can stay; it'll just always serialise
  `false`.

**3. Prose to keep honest (no runtime effect).**

| File | Where | What |
| :--- | :--- | :--- |
| `skills/muster/SKILL.md` | §1 "single lens / degraded", §4 `"degraded": true` example, §5 "When something goes wrong" (the degrade-naming rules), Output bullet | Reword: a single lens is a complete review, not a degraded one. (You may keep the "both lenses failed → post nothing" safety case — that's *no* review, which is different from one review.) |
| `skills/crows-nest/references/review-merge-pipeline.md` | lines 57, 63–64, 68–69, 197, 218–219 | Remove "degraded is not a green light" wording; a single produced review is valid. Keep "a *missing* review (zero lenses) is not safe". |
| `skills/crows-nest/SKILL.md` | line ~725 ("naming any degrade") | Drop the degrade-naming clause. |
| `scripts/review-merge-pipeline.mjs` | line ~562 banner ("degrade NAMED") | Drop. |

> **Keep the distinction:** *one* review that ran = complete and valid (what you want).
> *Zero* reviews / no review summary at all = still unsafe to merge (the `!Number.isFinite(blocking)`
> gate and the muster "both lenses failed → post nothing" case). Change 3 only removes the
> **single-lens-is-degraded** penalty, not the **no-review-at-all** safety net.

---

## Change 4 — Remove the walkthrough video (the `logbook` skill)

### Background

**`logbook` is *only* the video feature** — it turns a shipped change into a short narrated
walkthrough video and attaches it to the PR. Removing the video and removing logbook are the same
thing. It's wired in at two points in the process:

- **`shipwright` §9** — optionally auto-records when it opens a PR.
- **`crows-nest` §8f** — optionally auto-records at merge/ship.

Both are **gated by the `logbook` key in `.armada/config.json`, which defaults to `"off"`.** So in
most setups the video is already not running. You have two levels of removal.

### Level 1 — Disable it (recommended; zero code change)

Just make sure `.armada/config.json` (in your project repo) has:

```jsonc
{
  "logbook": "off"   // never auto-record; the default
}
```

With `"off"`, both `shipwright` §9 and `crows-nest` §8f no-op — **no video is ever produced in the
process.** The `/logbook` skill still exists if you ever want to record one by hand, but nothing
fires automatically. `commission` already writes `"off"` by default, so on a fresh commission you
need do nothing. **This is the right choice unless you specifically want the skill physically gone.**

> If `logbook` is absent or set to an unrecognised value, the skills treat it as `"off"` too — so
> there's no way to "accidentally" get a video without explicitly setting `"user-visible"` or
> `"all"`.

### Level 2 — Physically remove the skill from the plugin (optional)

Only if you want logbook gone entirely (smaller plugin, no `/logbook` command, no recorder script).
Delete the skill + its script, then unwire the references so nothing points at a missing skill:

**Delete:**
- `skills/logbook/` (the whole directory: `SKILL.md` + `references/recorder.md`)
- `scripts/logbook-recorder.mjs` (the ~75 KB recorder the skill invokes)

**Unwire the auto-record hooks (the two integration points):**

| File | Where | What |
| :--- | :--- | :--- |
| `skills/shipwright/SKILL.md` | **§9 "Walkthrough video…"** (lines ~441–472) | Delete the whole section. shipwright opens the PR (§8) and is done — no walkthrough step. |
| `skills/crows-nest/SKILL.md` | **§8f "Logbook — record a walkthrough at merge/ship"** (lines ~1105–1182) | Delete the whole subsection. |
| `skills/crows-nest/SKILL.md` | §1 `logbook` config-key doc (lines ~124–135); the reconcile-point mentions (lines ~704–707, ~775–777); the summary bullet (~1211) | Remove the `logbook`/walkthrough references so the lookout never tries to dispatch it. |

**Tidy the config docs / catalog (no behaviour, just honesty):**

| File | Where | What |
| :--- | :--- | :--- |
| `skills/commission/SKILL.md` | `logbook` config line (~97), the explainer (~196–204), the report line (~405), the safe-defaults note (~431) | Drop the `logbook` references; stop writing the key into `.armada/config.json`. |
| `.armada/config.json` (your repo) | the `logbook` key | Remove it (or leave it — an unknown key is harmless). |
| `README.md` | the `logbook` table row (line ~28) and any prose mentions | Remove. |
| `.claude-plugin/marketplace.json` | the plugin `description` lists `logbook` among the skills (line ~12) | Remove `logbook` from the list. |
| `.gitignore` | the `logbook recorder` block (lines ~3–6: `.armada/logbook/bin/`, `.armada/logbook/cache/`) | Optional — harmless to leave; remove if you want it clean. |

**Leave alone:** other skills mention "logbook" only in passing (e.g. `foghorn`, `lighthouse`,
`spyglass-fixtures.mjs`, `crows-nest/references/public-intake.md`) — those are incidental references,
not wiring, and don't need edits for the process to work. A quick `grep -ri logbook .` after the
deletions will show any dangling links worth cleaning.

> **Level 1 vs Level 2:** Level 1 (config `"off"`) fully removes the video from the *process* and is
> reversible in one line. Level 2 removes the *capability* from the plugin. Unless you have a reason
> to delete the skill, Level 1 is enough.

---

## Setting this up on your machine (Windows) — without the public marketplace

You have ARMADA cloned at `C:\repos\Luke\ARMADA`. You want to run **your edited copy** against a
**different** repo (your private project), not the upstream `calumjs/ARMADA` marketplace.

### Recommended: add your local clone as a *local* marketplace

This is still "the plugin", but sourced from **your local, edited directory** — not the public one.
It keeps `${CLAUDE_PLUGIN_ROOT}` working (the skills reference bundled scripts via that variable, so
the plugin path matters).

Inside a Claude Code session:

```text
/plugin marketplace add C:\repos\Luke\ARMADA
/plugin install armada@armada
```

Then, **in your private project repo** (e.g. open Claude Code with that repo as the working dir):

```text
/armada:commission        # one-time, idempotent — detects build/test/lint, writes .armada/config.json, creates labels
```

`commission` writes `.armada/config.json` into the project; apply the Change-2 config edits above to
that file.

### Re-pulling your edits (important Windows/cache gotcha)

Installed plugins are **copied into a version-keyed cache**. Claude Code only picks up your edits
when the version changes. So **every time you edit the plugin**:

1. Bump `version` in `C:\repos\Luke\ARMADA\.claude-plugin\plugin.json` (e.g. `0.43.0` → `0.43.1`).
2. Re-run:
   ```text
   /plugin marketplace update armada
   /plugin install armada@armada
   ```

If a change "isn't taking", it's almost always a missed version bump.

### Alternative: project-scoped skills (no plugin system)

The README mentions dropping `skills/` into a project's `.claude/skills/`. **Caveat for Windows /
this repo:** several skills invoke bundled scripts via `${CLAUDE_PLUGIN_ROOT}/scripts/...`, and that
variable is **only set under the plugin system**. If you copy skills loose you must also:

- copy `C:\repos\Luke\ARMADA\scripts\` into the project, and
- find/replace `${CLAUDE_PLUGIN_ROOT}/scripts/` → your project-relative path (e.g. `.claude/scripts/`)
  in every `SKILL.md` and reference file.

Because of that fix-up burden, **prefer the local-marketplace route above** — it's the same "edit
my own copy" outcome with none of the path rewriting.

### Verify the install

```text
/armada:commission        # in the target repo; should report config + labels created
```
Then arm the lookout per the README ("run crows-nest — it hands you the `/loop` line"). With
Change 2 applied, every open issue (not just labelled ones) flows into the build queue on the next
tick.

---

## Getting PRs reviewed by Claude *directly on GitHub*

Two distinct things — don't conflate them:

- **ARMADA's `muster` review** runs **inside a Claude Code session** on your machine (the crows-nest
  loop). It posts inline review comments on the PR via `gh`. It only runs while your local loop is
  running. (This is the review you de-Codex'd in Change 1.)
- **Claude reviewing PRs on GitHub itself** (a comment appears automatically when a PR is opened,
  even with no local session running) is the **Claude Code GitHub Action / GitHub App**, a separate
  product. ARMADA does **not** set this up for you.

If you want the second one, set it up on the repo:

### Easiest: the installer slash command

From a Claude Code session opened on your private repo:

```text
/install-github-app
```

This walks you through installing the **Claude GitHub App** on the repo, storing your API key as a
repo secret, and committing a workflow. Follow its prompts.

### Manual setup (what the installer does)

1. **Install the Claude GitHub App** on your account/repo:
   <https://github.com/apps/claude> (grant it access to the private repo).
2. **Add a repository secret** `ANTHROPIC_API_KEY` (GitHub → repo → *Settings → Secrets and
   variables → Actions → New repository secret*). Use an Anthropic API key from the Console.
   - (If you use Bedrock/Vertex instead, configure those credentials per the action's docs rather
     than `ANTHROPIC_API_KEY`.)
3. **Add a workflow** at `.github/workflows/claude-code-review.yml` that runs the official action on
   every PR. Sketch:

   ```yaml
   name: Claude Code Review
   on:
     pull_request:
       types: [opened, synchronize]
   jobs:
     review:
       runs-on: ubuntu-latest
       permissions:
         contents: read
         pull-requests: write
         id-token: write
       steps:
         - uses: actions/checkout@v4
         - uses: anthropics/claude-code-action@v1
           with:
             anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
             # prompt / mode options per the action's README — e.g. an automatic review prompt,
             # or @claude mention-triggered mode.
   ```

   Check the action's README for the current input names and the exact "automatic review on every
   PR" vs "respond to @claude mentions" configuration:
   <https://github.com/anthropics/claude-code-action>.

4. **Pin a model** (optional): the action defaults to a current Claude model; you can set the latest
   (e.g. Opus 4.8 / Sonnet 4.6) via its model input if you want to control cost vs depth.

### Which review do you actually want?

- **Local-only fleet (no GitHub Action):** keep using ARMADA's `muster` (Change 1 applies). PRs are
  reviewed whenever your crows-nest loop is running. No GitHub setup needed.
- **Always-on review independent of your machine:** add the GitHub Action above. It complements
  ARMADA — you can run both; you'll just get two review comments.

> Note: nothing in Change 1 or Change 2 is required for the GitHub Action — that's a repo-side
> setup, orthogonal to the plugin edits.

---

## Summary checklist

- [ ] **Change 1** — `scripts/review-merge-pipeline.mjs`: swap Lens B `codex:codex-rescue` →
      `general-purpose` (Option A) or delete it (Option B); fix the banner line ~561; tidy the 4 doc
      files.
- [ ] **Change 2** — `skills/crows-nest/SKILL.md`: drop `--label "<triggerLabel>"` from the issue
      query (§2a ~line 246); add `armada:shipped` to the eligibility exclusions; update design-rule 2
      prose. In your project's `.armada/config.json`: `publicIntake.enabled: false`, keep
      `authors: ""`.
- [ ] **Change 3** — `scripts/review-merge-pipeline.mjs`: set `const degraded = false;` in
      `consolidateLenses` (~line 173) — the single edit that removes the decision point. Optionally
      strip the now-dead `degraded` branches in `merge-gate.mjs` (~90–97, ~135) and the pipeline
      (~295, ~310, ~320–324, ~346), and reword the prose. Keep the *no-review-at-all* safety net.
- [ ] **Change 4** — Remove the walkthrough video. **Level 1 (recommended):** `logbook: "off"` in
      `.armada/config.json` (already the default) — no code change. **Level 2 (optional):** delete
      `skills/logbook/` + `scripts/logbook-recorder.mjs` and unwire shipwright §9 / crows-nest §8f +
      config/README/marketplace references.
- [ ] **Version bump** `.claude-plugin/plugin.json` after editing.
- [ ] **Install** locally: `/plugin marketplace add C:\repos\Luke\ARMADA` → `/plugin install
      armada@armada` → `/armada:commission` in the target repo.
- [ ] **GitHub PR review (optional)** — `/install-github-app`, or manually install the Claude GitHub
      App + `ANTHROPIC_API_KEY` secret + a `claude-code-action` workflow.
