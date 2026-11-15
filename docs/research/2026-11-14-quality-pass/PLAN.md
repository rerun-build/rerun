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
   Applied migrations under `supabase/migrations` stay out, as applied history. The comments of `tools/factory` and the factory contract are not carried into documentation by the purge: the last commit that has them is dev 86d04999, and the feature documents of step 6 are written from it.
   Left by the purge, by design or because the tool has no safe route: trailing `#` comments after code in shell, YAML and TOML, SQL comments, Kotlin, Markdown, files that declare themselves generated, and the tool directives on the keep list. In `apps/engine`, 8 more `no-empty` lint warnings (313 to 321): blocks that held only a comment are now empty.
3. **No new comments.** The rule goes into the cut format and issue text at once, into the dispatcher's build and fix briefs at the next owner update, and a CI check fails a pull request that adds comment lines (directives excepted).
4. **State machines, then review proof.** The factory's job states become one model with a test that fails when a state has no handler, no deadline or no screen entry. The proof step's states are added under that test:
   - CI check "Done-test red before green": the issue's Run lines fail with only the pull request's test files on dev's code, and pass at the head. Back-tested on this wave's merged pull requests before it is switched on.
   - Dispatcher step after an accepted review and green checks: a coworker who neither built nor reviewed the job maps every item of the issue to the diff line and the test that shows it; `PROOF: PASS` or `PROOF: FAIL`. A failed proof uses the job's one fix round.
   - Not covered in this version: a rendered check (stays a scripted check on the PC), and a red that comes only from a missing new file.
   Other state machines (engine runs, coworker moods, intake) follow the same pattern after the factory's.
5. **Timers.** A read-only classification first: each timer kept with its reason, or marked for removal. "No real reason" is written down as a test before anything is removed; waits that carry a deadline (FACTORY-CORE section 0a) stay.
6. **Runtime verification.** One document per feature: what it does, how a user reaches it, and what proves it works (a check that runs against the running app). Those documents also hold the reasons for kept timers and the comments worth keeping.

## Upstream syncs after the purge

Rehearsed on 2026-11-15 with the 65 upstream commits not yet in dev (upstream/dev 742a9cdd, base 2bf98517):

| Merge | Conflicted files |
|---|---|
| dev as it is + upstream | 51 |
| stripped dev + upstream as it is | 187 |
| stripped dev + upstream stripped first | 51, the same files as the first row |

So every sync strips the upstream side before merging. Branch `upstream-stripped` holds the stripped upstream commits: its first commit is the stripped base (e9b143cb, 2bf98517 stripped), which dev records as merged with `git merge -s ours`. A sync:

1. checks out the upstream tip in a throwaway worktree and runs `scripts/strip-comments/strip.py --write` there;
2. makes one commit whose tree is that stripped tree and whose two parents are the last `upstream-stripped` commit and the real upstream tip (`git add -A`, `git write-tree`, `git commit-tree <tree> -p <last upstream-stripped> -p <upstream tip>`), and moves `upstream-stripped` to it;
3. merges that commit into dev on a sync branch, as today.

The merge base is then the previous stripped commit, so only real changes conflict, and dev contains upstream's own commits, so `git rev-list dev..upstream/dev` reaches 0 after a sync. Rehearsed with this two-parent commit: 51 conflicted files, the same files as an unstripped merge.

## Guards: keeping antipatterns out

Owner, 2026-11-15: "We need a way or mechanism which prevents any new occurrences of antipatterns or gates them and or/minimizes them or alerts us about them automatically somehow."

One guard per rule, each with the owner's words, a detector, a mode and the message that names the fix. Rules are encoded at the highest level that holds: structure first (one source of truth, a single sanctioned helper), then types, then lint, then a CI diff check, then the proof step's judgement; text in briefs is the weakest level and never the only one.

| Rule | Level | Mode at start |
|---|---|---|
| No comments in code | lint rule in each package's eslint config (TypeScript); `guards.py --diff` for Python, shell, YAML, SQL | block |
| Done-test red before green | CI job on factory pull requests | block, after a back-test on merged pull requests |
| Every state handled | one state model with a test that fails on a state without a handler, deadline or screen entry; TypeScript `Record<State, …>` and the `switch-exhaustiveness-check` lint | block |
| Timers only with a reason | every timer goes through a few named helpers (debounce, deadline, retry with backoff, poll, animation frame); a lint forbids raw `setTimeout`, `setInterval` and `sleep` elsewhere, so the helper's name is the reason | warn until the timer pass has moved the existing ones, then block |
| Every ask of the issue delivered | proof step (a coworker who neither built nor reviewed) | block |
| Heuristic rules (idle animation, made-up lookup tables, magic numbers) | warning comment on the pull request and a count on dev | warn |

Where each runs:
1. In the builder's own loop: the brief already makes builders run lint and the type check before opening a pull request, so a lint guard is seen and fixed before CI.
2. CI on every pull request, diff-scoped: only lines the pull request adds are judged, so old code does not block new work.
3. CI on every push to dev, tree-scoped: one count per guard, kept as a scorecard. A count that rises (an upstream sync bringing comments back, a hand merge) raises an alert: a line on the factory page and a push to the owner.
4. Upstream syncs: the stripper runs on the upstream side, and the guards run on the sync pull request like any other.

Rollout per guard: back-test on the last merged pull requests first; a guard that would have blocked an accepted change is fixed before it blocks. Each block costs the job's one fix round, so a guard is promoted from warn to block only once its false-alarm count on real pull requests is zero. An exception is an entry in the guard's allow list with a reason, read by the proof step.

Learning loop: each review rejection and each fault the owner points out is checked for a rule a guard could hold; if there is one, the fix job adds the guard in the same pull request.

Benefit, measured: occurrences per guard per week on dev (blocked guards stay at zero), fix rounds spent on guards, and allow-list entries added. A guard that costs more fix rounds than the faults it stops is reconsidered.

## Status

| Step | State |
|---|---|
| 1 | wave #421 to #431 merged; nothing labelled |
| 2 | #444: CI, images, migrations and factory tests green; mobile and desktop suites run once on dev and on the purge |
| 3 | rule given to me and in memory; cut-format line and dispatcher brief line not yet; no CI check yet |
| 4 | red before green merged as #445 (back-test: 12 of 12 wave pull requests red on dev, green at the head); state model and dispatcher proof step not started |
| 5, 6 | not started |
