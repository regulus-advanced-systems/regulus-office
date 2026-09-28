# Contributing to Regulus Office

Thanks for helping. This project is built largely by AI agents working from `docs/SPEC.md` and the GitHub issues, with humans reviewing. The same rules apply to both.

## Ground rules

- The spec is authoritative. If an issue and the spec disagree, the spec wins; open an issue to change the spec first.
- One issue, one branch, one PR. Branch name `<area>/<issue-number>-<slug>`.
- Every PR must pass `bun run lint`, `bun run typecheck` and `bun test`, and must add or update tests for behaviour it changes.
- Never commit secrets, provider tokens, or copyrighted assets (no Game Dev Tycoon art; only CC0/CC-BY assets with entries in `packages/assets/ATTRIBUTION.md`).
- Do not weaken the credential rules in SPEC §8. PRs that store, log or forward subscription tokens will be closed.
- Keep files small and focused. If a module passes ~400 lines, split it.
- Architecture decisions go in `docs/adr/NNNN-title.md` (short: context, decision, consequences).

## Layout

See SPEC §4.3. `packages/protocol` is the single source of truth for enums and message shapes; change it first, then consumers.

## Running locally

```
bun install
bun run dev        # server + web
bun run typecheck
bun test
```

## Commit messages

Imperative mood, one line under 72 chars, body explains why. Reference the issue (`Closes #123`).
