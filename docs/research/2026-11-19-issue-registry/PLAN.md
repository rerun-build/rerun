# Issue registry: every issue, its factory step and its handover

Approved by Rob on 2026-11-19 ("Ok approved"), after: "tracking of all issues and where they are with which factory step" and "any station handover should have its own statuses". Reviewed against the code the same day (architect read of `tools/factory`); its corrections are in this version.

## Why

On 2026-11-19 a session spent hours finding why the factory planned nothing:

- planner copies were 0 in the control block;
- 11 issues carried a hand-added `factory-plan`;
- #1290's plan sat in `planned`;
- 54 duplicate gap issues were open.

Each fact lived in a different place:

- the ledger's `jobs` table;
- `plan:N`, `recheck:N`, `accept:N`, `instr:N` and `classify:N` records in `kv`;
- GitHub labels;
- the control issue.

Nothing joined them, and nothing compared labels with the ledger.

## Shape

One registry row per issue the factory holds, derived from what is stored. There is no second record to keep in step.

```
row(issue) = {
  step:     intake | planning | cutting | plan-review | children | queued | building | review | fixing | checks | proof
            | merged | acceptance | done | parked | ended (rejected, failed, superseded, unsolvable) | problem
  handover: {from, to, status, since, why}
  labels:   GitHub labels (slice 2 on)
  drift:    what disagrees between the ledger and the labels (slice 2 on)
}
```

### Stations and their records

| station | record | states |
|---|---|---|
| classifier (intake) | `classify:N` | see `classify.py` |
| planning (plan, cut, panel review, repair) | `plan:N` | `LIVE`, `ENDED`, `planned` (which handover is in `stage`), `replan`, `revise`, `repair`, `resend`, `asked`, `unsent` |
| recheck | `recheck:N` | `sending`, `running`, `fresh`, `corrected`, `blocked` |
| build line | `jobs` + `transitions` | `states.TABLE` |
| acceptance | `accept:N` | `running`, `unsent` (with `sends`), `no_acceptor`, `gaps`, `accepted`, `closed`, `left` |
| instructions | `instr:N` | `review`, `unsent`, `unreadable`, `refused`, `rejected` |
| resolver | keyed by problem name; files "Factory problem:" issues | `notice`, `resolve_wait`, `resolving`, `verify`, `owner`, `closed` |

The step mapping is one table next to `states.TABLE`. A test fails if any state name in the table above has no step, or has two.

One issue can sit in two records: a parent's `plan:N` or `accept:N`, and its own build job. **Precedence:** a live build job, then live acceptance, then the plan, then intake.

### Handover statuses

The name `returned` is already a build-job end state, so the handover statuses use other words.

| status | meaning | read from |
|---|---|---|
| `sent` | the earlier station is done; the work waits for the next | job `state` in `states.QUEUE` or `waiting`; `checks` is a wait on CI, not on a station; plan `planned`, `replan`, `resend`; accept `unsent` with `sends=0`, or `no_acceptor` |
| `taken` | the next station has a run out | job `state` in `states.RUNNING`; plan `LIVE`; recheck `sending` / `running`; accept `running`; instr `review` |
| `back` | the next station sent it back, with why | only these real send-backs: `reviewing→fix_wait`, `checks→fix_wait`, `checks→review_wait`, `proving→fix_wait`, `proving→checks`; plan `revise` / `repair`; accept `gaps` |
| `retry` | a run dropped back to its wait state (plan limit, failed attempt, transient) | a `RUNNING→BACK[state]` move whose reason is one of the retry reasons |
| `with-owner` | waiting on a person | plan `asked`; resolver `owner` |
| `refused` | it could not be handed over | accept `unsent` with `sends>0`, or `left`; instr `refused` / `unreadable`; a `factory-paused` issue (labels) |
| `lost` | taken, but the run is gone | newest `fires` row `status='lost'`; plan `lost`; no live account call |

- **`since`:** for build jobs, the newest transition with `from_state != to_state`. `save()` writes a row on every save, and those bookkeeping rows are skipped, as `digest.py` already does. For kv records, a new `moved_at` stamp, written beside every `store.set(job, "state", …)`. All times are ISO. Today plan and recheck `started` is ISO, while accept and instr `started` is an epoch.
- **`why`:** the job's `wait_reason` / `reason` or the record's `why`, not the last transition's reason.
- Plan records are overwritten in place, so a plan's earlier send-backs have no history. The registry shows the current handover only.

## Slices (one PR each in `tools/factory`, live without a deploy)

0. **`factory-paused` is never built** (a bug fix first, test first). Intake does not take in a parked issue, and a job parked after it was queued is not built. A second try of a build already running (`failed_attempt`) still goes ahead: it is a retry, not a new build. Before this, only planning honoured the label.
1. **`registry.py`, read-only, no GitHub calls.**
   - `read(store)` makes one pass over the ledger: jobs, the newest real move per job (`MAX(id) … WHERE from_state != to_state GROUP BY job`), the `plan:`, `recheck:`, `accept:`, `instr:` and `classify:` records, and the newest fire per job.
   - `rows(data, now)` is pure.
   - `summary(rows, now, cfg)` gives `steps` (count per step) and `stuck`, capped like `MAX_THREADS`. Stuck means: `sent` longer than a limit while copies are free, `taken` past the run limit, `lost`, `refused`, `with-owner`.
   - `moved_at` stamps are added in planning, recheck, acceptance and instructions.
   - Wired into `Dispatcher.status()` inside its try. It replaces `planner_holders`.
2. **`labelcheck.py`, report only.** `drift.py` is taken. It reads the open issues with labels only when the digest is about to post (every 10 minutes), not every beat. It reports:
   - `factory-plan` with no live plan;
   - `factory` with no job;
   - a parked issue with a `sent` or `taken` handover;
   - duplicate open `Gaps of #N`;
   - an ended or blocked issue with no label saying so.
3. **Rules that fix drift**, one per PR, each tested, each logged in the digest when it acts, each acting at most once per issue:
   - a stray `factory-plan` comes off;
   - an older duplicate gap issue is closed in favour of the newest, after one dry-run digest that lists what it would close.

   The lost-plan re-send already exists (`planning.lost`).
4. **`step:*` labels.** Exactly one per issue, set only by the factory, edited only when the step changes, with a cap per beat. The first run labels every open issue, so it spreads over beats. Before this slice, check what a label edit wakes in `repo_events.py`, so label churn wakes no coworker. Hand-set labels stay intent only: P level, `tokens`, `factory-paused`, `factory-replan`.
5. **Factory room view** (app; needs the owner's deploy): the registry as a table per step with the handover column. Later.

## Limits

- Derived, not stored, apart from the `moved_at` stamps: a restart loses nothing, and a wrong row is fixed in one place.
- Slices 1 and 2 only read. Slices 3 and 4 write to GitHub within caps.
- Comments stay under GitHub's 65,536-character limit: `stuck` and the drift lists are capped.

## Measure

- **Before:** a stall's cause was found by hand over hours (2026-11-19, 08:00 to 11:40 UTC).
- **After slice 2:** the digest names every stuck handover and every drift within one digest period (10 minutes).
- **After slice 3:** the drift counts in the digest fall to 0 and stay there.
