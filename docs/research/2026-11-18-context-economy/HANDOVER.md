# Planner handover: design (2026-11-18)

Status: proposed, for review. Nothing here is built yet.

## Why

The owner decided (2026-11-18) what happens when a coworker's context reaches its compaction point:
- **Builders, reviewers and testers compact** with Claude Code's own summary. Their real state lives in git: the branch, the PR and the test results. This is live (#1423).
- **Planners and orchestrators hand over** to a structured note that also survives a restart. These are Boss, Scope Shaper and IKE.

Measured in the week of 2026-11-11..18 (see `rerun-ops/2026-11-18-token-spend/REPORT.md`):
- Runs of 30+ steps held 53% of the factory's tokens, and nearly all of them were Scope Shaper, Boss, code and IKE.
- The largest single runs were Scope Shaper with 31.1M tokens over 164 steps, Boss with 20.9M over 99 steps, and Scope Shaper with 18.3M over 116 steps.
- On 2026-11-18 a Scope Shaper CUT run (`lmn604x5`, 59 steps) hit the dispatcher's 45-minute run limit (`run_limit_s` 2700) and was cancelled. Its work was redone from scratch in a new run, so all of it was paid for twice.

A planner's state lives only in its conversation, so losing a run loses the plan in progress.

## What the Claude CLI actually does

Measured on 2026-11-18 with Agent SDK 0.3.322 and Haiku 5.5, with the compaction window forced to 100K:

| Fact | Evidence |
|---|---|
| A `PreCompact` callback that returns `{ systemMessage }` steers the summary | All 3 summaries began with the requested marker line and section list |
| `PostCompact` receives the whole summary as `compact_summary` | 2,266 / 3,982 / 3,398 characters |
| The boundary message carries `pre_tokens`, `post_tokens` and `duration_ms` | 146,886 to 68,327 tokens in 7.7 s; 152,007 to 58,021 in 9.4 s |
| A `PreCompact` hook can block compaction | CLI string "Compaction blocked by PreCompact hook" (not exercised) |
| Compaction can fail the whole run | "Autocompact is thrashing: the context refilled to the limit within 3 turns of the previous compact, 3 times in a row" ended the test run with an error result |

The thrashing came from single tool results of about 65K tokens. In the engine, tool results are capped by result handles (20,000 characters, about 5K tokens), so at 480K and 940K it should not happen. It is still a failure mode the design must handle.

## The design: steered compaction with a saved note

There is one mechanism, so the engine runs no multi-part session.

```text
planner class (Boss, Advisor: large; Scope Shaper, IKE, Idea Partner, ADA, HOLMES: medium)
  PreCompact hook  -> systemMessage = the note format below, so the summary is the note
  PostCompact hook -> write compact_summary to
                      shared/handover/<agent>/<run-id>-<n>.md   (n = 1, 2, ... per compaction)
                      and record it on the run (handover_path, the last one)
run ends normally  -> nothing else happens; the notes stay as a record of the run
run is lost        -> (restart, run limit, thrash error) the next send of the same job
                      carries "Continue from the handover note at <path>" before the brief
```

The note format, which the summary is told to follow:

```text
HANDOVER <agent> <run-id> <n>
Task: the goal in one line, and the job or issue reference
Done: what is finished, with paths and links
Left: what remains, in order
Decisions: what was decided and why, one line each
Open questions: what is still unknown
Files: paths read or written that matter for continuing
```

### Why steered compaction and not a fresh session

| | Steered compaction (this design) | Block and hand over to a fresh session |
|---|---|---|
| Engine change | two hooks plus a file write, about 40 lines | a multi-part run inside one run record, deep in `runTurn` and `settle` |
| Note quality | written by the model with the full context, in our format | the same, but the run needs an extra turn to write it |
| Resume after a crash | from the saved note | from the saved note |
| Context after the event | summary plus preserved recent messages (58-68K measured) | only the note |
| Risk | the CLI's compaction path, already in use for builders | new code on the hottest path in the engine |

Both are equally resumable once the note is on disk, and the fresh session only buys a smaller context after the event. That is worth building only if the measurements show planners losing the thread after a steered compaction.

### The resume path

The dispatcher already re-sends a job whose run ended without its goal line. A lost run's run record carries `handover_path`, and the re-send puts one line in front of the brief:

```text
Continue from your handover note: <path>. Read it first; do not redo what it marks done.
```

This applies to dispatcher sends with a goal (PLAN, CUT, resolve). For a chat run, such as Advisor to Boss, the note is kept and named in the run's error, but nothing re-sends it automatically.

### The thrash error

When a run ends with the thrashing error, the engine records it as a failed run with that cause, so the dispatcher's failure counts see it. The re-send then starts from the note in a fresh session. This is the only case where the fresh session comes for free.

## What is measured

Per run, already recorded since #1423: `compactions`, `compact_summary_chars`, `compact_at_tokens`. This design adds `handover_path`. These feed the judgement:

1. **Steps after a compaction until the goal line,** compared with planner runs that did not compact.
2. **Redone work:** the same file read again after a compaction.
3. **Lost runs that resumed from a note,** against lost runs redone from scratch, both in tokens.
4. **Thrash errors** per 100 compactions.

## Rollback

`contextSize: 'off'` on a coworker turns compaction, and with it the handover, off for that coworker with no deploy. Removing the planner classes falls back to plain compaction.

## Open questions for review

1. Is `shared/handover/` the right home? It is readable by every coworker, which the resume needs, but it also exposes one coworker's plan to all of them.
2. Should the note format also carry the cost so far (tokens, steps)? It is cheap to add, and useful for the next run's judgement.
3. Does a steered summary that starts with `HANDOVER` confuse the CLI's own parser? The CLI reported "the model's reply has no <summary> block" as a failure string. The test summaries still contained `<analysis>`, and the run went on after each compaction until the thrash.
