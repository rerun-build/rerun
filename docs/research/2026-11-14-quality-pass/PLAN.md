# Quality pass, 2026-11-14

Five owner instructions given in one evening, ordered so that no step is cut against file lines another step moves.

## The owner's words

1. "going forward, we are adding another step after review. Review proof."
2. "also prune whole codebase of comments. And any new work as a rule should NEVER make comments in code. Comments can be in documentation folder where each feature can be written about in detail if you want"
3. "next, prune whole codebase of any timers that have no real reason to be there. We need to introduce runtime verification also (what features exist, how users reach it, what proves it works)..."
4. "model state machines and check that all states are correctly handled."

## Sizes, measured on dev at d7102f3

| What | Count | Where most of it is |
|---|---|---|
| Comment lines (line heuristic) | about 24,900 in about 2,960 files | `apps/ui` 13,127; `packages/ui` 2,592; `apps/engine` 2,143; `apps/mobile` 1,695; `packages/contracts` 1,308; `supabase` 1,086 |
| Timer sites (regex: setTimeout, setInterval, sleep, waitForTimeout, delay) | 404, of them about 320 outside tests | `apps/ui` 150; `apps/mobile` 51; `apps/engine` 50; `packages/ui` 38 |
| Licence | AGPL-3.0 in `LICENSE`; no per-file licence header | |
| Hand-kept lists of factory job states | about a dozen: `store.py`, `dispatch.py` (RUNNING, BACK, GOALS, WAIT_STATES, hold lines, heartbeat), `snapshot.py`, `waits.py`, `timeline.py`, the contract enum, `factory-state.ts`, `factory-ledger.ts`, `factory-metrics.ts`, `from-snapshot.ts` | |

## Order

1. **Factory quiet.** Nothing new is labelled `factory` until the comment purge has merged. The jobs in flight finish and are proved by hand (Run lines red on dev, green at the head; every item of the issue found in the diff).
2. **Comment purge.** A stripping tool per language, run over the whole tree. It merges only when:
   - an upstream merge rehearsal on a throwaway branch counts the conflicts of `git merge upstream/dev` before and after stripping (a jump goes to the owner with the number);
   - every comment a tool reads is kept (shebang, `@vitest-environment`, `@ts-expect-error`, eslint and prettier directives, `/// <reference`, `sourceMappingURL`, coverage and bundler markers, `noqa`, `type:`, `shellcheck`, Dockerfile `# syntax=`), found by grepping the repo, not from memory;
   - the type check, lint, tests and the image build pass on the purge pull request;
   - a machine proof shows only comments changed (TypeScript: the syntax tree printed without comments is identical before and after; Python: `ast.dump` identical apart from removed docstrings).
   Applied migrations under `supabase/migrations` stay out if stripping changes a function body the database compares. Comments in `tools/factory` and the factory contract move into documentation, because briefs and plan checks cite them.
3. **No new comments.** The rule goes into the cut format and issue text at once, into the dispatcher's build and fix briefs at the next owner update, and a CI check fails a pull request that adds comment lines (directives excepted).
4. **State machines, then review proof.** The factory's job states become one model with a test that fails when a state has no handler, no deadline or no screen entry. The proof step's states are added under that test:
   - CI check "Done-test red before green": the issue's Run lines fail with only the pull request's test files on dev's code, and pass at the head. Back-tested on this wave's merged pull requests before it is switched on.
   - Dispatcher step after an accepted review and green checks: a coworker who neither built nor reviewed the job maps every item of the issue to the diff line and the test that shows it; `PROOF: PASS` or `PROOF: FAIL`. A failed proof uses the job's one fix round.
   - Not covered in this version: a rendered check (stays a scripted check on the PC), and a red that comes only from a missing new file.
   Other state machines (engine runs, coworker moods, intake) follow the same pattern after the factory's.
5. **Timers.** A read-only classification first: each timer kept with its reason, or marked for removal. "No real reason" is written down as a test before anything is removed; waits that carry a deadline (FACTORY-CORE section 0a) stay.
6. **Runtime verification.** One document per feature: what it does, how a user reaches it, and what proves it works (a check that runs against the running app). Those documents also hold the reasons for kept timers and the comments worth keeping.

## Status

| Step | State |
|---|---|
| 1 | #421 to #429 and #440 merged; #430, #431 building |
| 2 | tool not written yet |
| 3 to 6 | not started |
