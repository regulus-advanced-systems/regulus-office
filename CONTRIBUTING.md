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
bun run e2e          # Playwright: the main office flow
bun run e2e:agents   # Playwright: the henchman flow (needs Docker)
```

### The office e2e flow

The `setup` project (`tests/e2e/office.setup.ts`) registers the owner and a member once per run and saves both sessions; the steps in `tests/e2e/office.e2e.ts` then run in order in two browsers opened from those sessions. The steps are not serial: when one fails, Playwright opens the two browsers again and the next step still runs, so each step must not rely on an earlier one having passed (a step that needs the Apollo operation calls `ensureApollo()`). Add a step as a `test()` that calls its `tests/e2e/xxxChecks.ts` function with `ownerPage` and `memberPage`. One step can run on its own, also repeatedly: `bunx playwright test -g "rings the gong" --repeat-each 5` (after `bun run build:web`).

### E2E runners and cleanup

Each e2e run gives its office its own runner prefix, so parallel runs (and your own `office`) never list, recover or reap each other's containers:

- `bun run e2e` uses `rgo2e-<run>`. Its office's Docker backend points at a socket that does not exist, so it never starts a runner, whether or not a runner image is on your machine; the spawn dialog no longer refuses locally with "Connect Claude Code first" and the request reaches the server, as in CI. The global teardown still removes any `rgo2e-<run>-*` container and volume of that exact run.
- `bun run e2e:agents` uses `rge2e-<run>` (or `$E2E_RUNNER_PREFIX-<run>`) and removes its own runners when it ends.
- Before every run, the global setup removes `rgo2e-*` and `rge2e-*` containers and volumes older than an hour, left by a run whose teardown crashed.

Deletion is by exact name only, after checks (`tests/e2e/runnerCleanup.ts`): the prefix must match `rgo2e-<run>` or `rge2e-<run>` (an empty or other prefix throws before anything is listed), and each name must start with that prefix and carry the same `org.regulus.office.prefix` label. The cleanup never prunes and never touches `office-*`, `deploy-*` or anything else; remove those yourself if you need to.

## Commit messages

Imperative mood, one line under 72 chars, body explains why. Reference the issue (`Closes #123`).
