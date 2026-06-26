# Fleet identity — running the fleet as a GitHub App

**The single source of truth for how the fleet authenticates and how "fleet vs human" is decided.**
crows-nest, shipwright, muster, and the review→merge pipeline all defer to this file.

The fleet can run two ways. **Both are supported; the config key `fleetLogin` selects which.**

| Mode | `fleetLogin` | Fleet writes authored by | Detection signal |
| --- | --- | --- | --- |
| **App identity** (recommended) | a bot login, e.g. `my-app[bot]` | the **GitHub App** | **author login** (primary) + marker (backstop) |
| **Shared login** (historical default) | `""` (blank) | the maintainer's own account | **comment marker** only |

Everything below describes **App-identity mode**. When `fleetLogin` is blank, skip all token-minting
and commit-identity steps (writes use ambient `gh` auth) and fall back to **marker-based** detection
exactly as before — see [§ Detection](#detection-fleet-vs-human).

---

## Why an App

So everything the fleet writes — PR/issue comments, review replies, labels, commits, PRs — is authored
by `fleetLogin` (e.g. `lc-armada-fleet[bot]`), **not** by the maintainer. That removes the identity
ambiguity that forces marker-guessing: `author == fleetLogin → fleet`, anything else → a human →
re-engage. It installs once per account (tick the repos), uses short-lived auto-minted tokens (no
manual re-auth ever), and scales across many repos and machines.

## What's set up where

| Piece | Where | Secret? |
| --- | --- | --- |
| `fleetLogin` | `.armada/config.json` (committed) | no — public bot login only |
| `ARMADA_APP_ID` | environment (per machine) | no |
| `ARMADA_APP_INSTALLATION_ID` | environment (per machine; optional — auto-discovered if unset) | no |
| `ARMADA_APP_PRIVATE_KEY_PATH` | environment (per machine) → points at a `.pem` file | path only |
| the `.pem` private key | a file in the user profile, **never** committed | **YES** |

The maintainer sets the env vars + key once per machine (Windows `setx`; Linux export in shell
profile). The fleet never touches them beyond reading; the key's *contents* never enter env or config.

## Minting a token (every write runs as the App)

`gh` can't authenticate as a GitHub App directly, so the fleet mints a **1-hour installation token**:
sign a short JWT with the private key → exchange it for an installation token → use it as `GH_TOKEN`.
The bundled helper does this and **caches** the token (re-minting only near expiry), so calling it
once per write command is cheap:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/mint-app-token.mjs"   # prints a valid token to stdout
node "${CLAUDE_PLUGIN_ROOT}/scripts/mint-app-token.mjs" --check   # self-test: identity + visible repos
```

### The write-wrapping convention — **this is the rule every skill follows**

> **Every fleet WRITE is prefixed with a freshly-minted token; reads are not.**
>
> ```bash
> GH_TOKEN="$(node "${CLAUDE_PLUGIN_ROOT}/scripts/mint-app-token.mjs")" gh <write-subcommand> …
> ```

Scoping the token **per write command** (not exporting it for the whole shell) keeps the fleet's
*reads* under the maintainer's ambient `gh` — so the maintainer's own manual comments stay authored by
the maintainer and correctly count as **human** activity. A write is anything that mutates GitHub:

- `gh pr comment`, `gh issue comment`, `gh pr review`, replying to a review thread
- `gh pr edit` (labels, body), `gh pr create`, `gh pr merge`, `gh issue edit`/`close`
- any `gh api` call with `--method POST/PATCH/PUT/DELETE` (or `-X …`) that mutates
- **git pushes** (see below)

Reads — `gh pr view`, `gh pr list`, `gh issue view`, `gh api` GETs, `git fetch`/`clone` of public or
already-authenticated repos — need **no** token prefix.

### Git pushes and PR creation

A `git push` authenticates via the remote's credential, not `GH_TOKEN`. To push as the App, run the
push (and the `gh pr create` that follows) with the token in the environment for that command. The
simplest portable form is to let `gh` act as git's credential helper for that one command:

```bash
GH_TOKEN="$(node "${CLAUDE_PLUGIN_ROOT}/scripts/mint-app-token.mjs")" \
  gh auth setup-git --hostname github.com >/dev/null 2>&1   # once per worktree is enough
GH_TOKEN="$(node "${CLAUDE_PLUGIN_ROOT}/scripts/mint-app-token.mjs")" git push -u origin <branch>
GH_TOKEN="$(node "${CLAUDE_PLUGIN_ROOT}/scripts/mint-app-token.mjs")" gh pr create --title … --body …
```

## Commit identity (commits authored by the App)

In each build worktree, set git's author/committer to the bot so commits and the PR show the App as
author. The bot's noreply email is `<bot-user-id>+<fleetLogin>@users.noreply.github.com`; fetch
`<bot-user-id>` once with `gh api "users/<fleetLogin>" --jq .id` (it's stable per App). Then:

```bash
git config user.name  "lc-armada-fleet[bot]"
git config user.email "296802139+lc-armada-fleet[bot]@users.noreply.github.com"
```

> For the **LC Armada Fleet** App in this repo the values are filled in above
> (`fleetLogin = lc-armada-fleet[bot]`, bot user id `296802139`). For a different App, derive them
> from `fleetLogin` + the `gh api users/<fleetLogin>` lookup.

Set these in the worktree **before the first commit**. If `fleetLogin` is blank, don't set them — let
commits use the maintainer's ambient git identity.

## Detection (fleet vs human)

This is the rule crows-nest's ready-PR re-engage check (§3a) and any other "did a human act?" check
use:

> **Normalise the `[bot]` suffix before comparing — this is mandatory, not optional.** GitHub returns
> a bot's login **two different ways**: the **REST** API (`gh api repos/.../pulls/<n>/comments`, used
> for inline review-thread replies) returns the full `lc-armada-fleet[bot]`, but the **GraphQL/`--json`**
> projection (`gh pr view --json comments,reviews`, `gh issue list --json author`) returns it **with
> `[bot]` stripped** — `lc-armada-fleet`. So a raw `author.login == fleetLogin` check **matches the
> inline replies but misses the fleet's own top-level comments and reviews**, misclassifying them as
> human and re-reviewing on a loop. **Always compare after stripping an optional trailing `[bot]` from
> *both* sides**, case-insensitively: `strip(author.login) == strip(fleetLogin)` where
> `strip(x) = x.lower().removesuffix("[bot]")`. (`fleetLogin` is stored *with* `[bot]`, e.g.
> `lc-armada-fleet[bot]`, so it must be stripped too.) The same normalisation applies to the
> public-intake trusted-author guard (P1) and anywhere else a `--json author.login` is matched against
> `fleetLogin`.

- **`fleetLogin` is set (App mode): author-based is PRIMARY.** An event (comment, review, inline
  reply, commit) is **fleet** iff its `author.login` (or commit author), **`[bot]`-normalised as
  above**, **equals the `[bot]`-normalised `fleetLogin`**. Everything else is **human** → re-engage.
  The fleet's own marker text
  (`🔭 crows-nest:`, `## muster review`, `✅ reviewed … awaiting human merge`) is kept only as a
  **backstop** for any legacy fleet comment written before the App switch (treat marker-carrying
  comments as fleet too). Because the maintainer's account ≠ the bot, the maintainer's inline review
  replies are now **unambiguously human** and reliably re-open the PR.
- **`fleetLogin` is blank (shared-login mode): marker-based, as before.** A comment/review is fleet
  iff it carries a fleet marker; everything else is human. **Do not** filter by `author.login` in this
  mode — the fleet and the human share one login, so author detection fails both ways. The marker is
  the only reliable signal.

Either way the principle is identical: a fleet event is "the fleet already did this"; a human event
dated after the fleet's last action re-opens the PR for the fleet to address.
