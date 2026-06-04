# PR Summary Template

Use this for the PR body. Adapt sections as needed — omit sections that don't apply.

```markdown
## Summary

<2-3 sentences: what this PR does and why>

Closes #<issue-number>

## What changed

| File | Change |
|------|--------|
| `path/to/file` | <brief description> |

## Decisions

<Architectural / design choices made during implementation and the reasoning.
Reference existing decision records where applicable; note if a new one is warranted.>

- **Decision:** <what was decided>
  - **Why:** <rationale>
  - **Alternatives considered:** <what else, and why rejected>

## Acceptance criteria

- [x] Criterion 1 — <how it was met>
- [ ] Criterion 2 — <why not met / deferred>

## Testing

- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] Manual testing performed
- [ ] Build passes
- [ ] Tests pass
- [ ] Lint / format clean

<Describe specific test scenarios covered. Note any pre-existing failures on the
base branch so reviewers don't attribute them to this PR.>

## Screenshots

<If UI changes were made, include before/after screenshots>

## Follow-up items

<Deferred work, tech debt, or items for future PRs>

---
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```
