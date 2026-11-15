# Factory control: a foreman, project leaders and stations, declared and reconciled

as_of 2026-11-15, dev 946e5ce8. Status: design for cutting. Source of the facts: `tools/factory/` on dev, the live floor, the night of 2026-11-14/15.

## 1. The model

Rob, 2026-11-15: "you have input, you have a bunch of processes, and a foreman delegates work to his bosses and project leaders and other people to keep it running at maximum capacity at any time, then there is output (artefacts produced and shipped code)"; "we need some way to keep the threads and how this untangles, because we need to bring it together after too in the correct timeline"; "some sort of queuing monitoring and optimization agent who can take over dispatcher and acts sort of a load balancer"; "in a declarative way".

| Factory | Rerun |
|---|---|
| Input dock | the backlog: open issues, ranked by priority label (P0 to P3) and age |
| Foreman | a coworker with judgement (every 10 minutes and on events) plus the dispatcher as its hands (code, every 30 s beat) |
| Bosses | Boss: head of planning; gives each thread to a project leader, cuts the large ones |
| Project leaders | one planner copy per thread (a parent issue): cuts it, corrects plans a builder rejects, keeps its jobs moving, says when it is done |
| Stations | the pools: planning, build, review, checks, proof, merge; capacity is the number of copies (ghosts) per coworker |
| Output dock | shipped artefacts: merged on dev, live on the server, checked live; then the parent closes |

Measured on 2026-11-15, why it ran one job at a time: planning went through one planner at a time and through the operator (who checked each cut, labelled it, read diffs, unblocked jobs and fed the next brief); most jobs touched `tools/factory/dispatch.py` (941 lines), so they had to wait for each other; review and proof share two seats. Up to 7 coworkers stood idle while one job was ready.

## 2. Principle: declare, reconcile, measure

1. What the factory should do is written down as desired state. Code compares it with the observed state every beat and takes the next allowed step. No person sends work by hand, the operator included.
2. Two loops. The fast loop is code: the dispatcher, every beat, deterministic and cheap. The slow loop has judgement: the foreman coworker changes declarations only; it never sends work and never merges.
3. Every change to a declaration is an experiment: logged with the measures before and after, kept when throughput or cost improves, reverted when not.

## 3. The declarations

| What | Where | Who writes it |
|---|---|---|
| Job | the issue body in the cut format of #333, read by `cutshape.py`, with `dev <sha>` of its facts | planners |
| Thread | the parent issue: priority label and a `**Thread**` block: `lead:` (planner copy), `after: #n` (thread order), `done when:` (a runtime check), `budget:` | Boss, the foreman |
| Control | one pinned issue "Factory control" with one JSON block: copies per coworker, WIP limit per station, priority weights, planning (`auto`, parallel plans), budget, release mode | the foreman and Rob |
| Bounds | `tools/factory/control-bounds.json` in the repo: highest copies per coworker (server memory, plan limits), budget caps, which knobs the foreman may change | Rob only |

The dispatcher reads the control block every few beats, checks it against the bounds, applies what is valid, records each change as a ledger event (who, from, to, when) and answers an invalid value with a comment. An issue keeps its edit history and Rob can edit it from the phone; the Factory page can later edit the same block.

Example control block:

```json
{
  "copies": {"code": 6, "LARRY": 1, "LINUS": 3, "BRUCE": 2, "Boss": 1, "Scope Shaper": 2, "IKE": 3},
  "wip": {"building": 8, "review_wait": 6, "proof_wait": 4},
  "weights": {"P0": 8, "P1": 4, "P2": 2, "P3": 1, "critical_path": 1.5, "age_per_hour": 0.1},
  "planning": {"auto": true, "parallel": 4},
  "budget": {"plan_week_max": 0.85},
  "release": "ask"
}
```

## 4. The fast loop (dispatcher, every beat)

observe (GitHub, engine, ledger) -> status -> schedule -> apply -> record.

The scheduler is a pure function in its own module (`scheduler.py`), tested on made-up queues:

- ready = every `Depends on` merged, plan fresh (its files unchanged on dev since `dev <sha>`, or checked again), not held, no file locked by a live job, thread not waiting on its `after:`
- score = weight of the thread's priority x (1 + critical-path weight x jobs after it in its thread) x (1 + age weight x hours waiting) / size (files and lines of the plan)
- each station is filled up to the lower of free copies and its WIP limit, best score first; a picked job locks its files; the prover is neither builder nor reviewer
- planning is a station like the others: unplanned backlog issues by score go to free planner copies, and a child that passes `cutshape` with a fresh `dev <sha>` is labelled `factory` by the dispatcher
- copies follow demand: desired copies = demand x service time / target use, within the bounds, one step per 10 minutes at most, lower when the plan week passes `plan_week_max` or the server runs short of memory

## 5. Threads and the timeline

- A thread is a parent issue, the graph of its jobs (`Depends on`) and its footprint (every file its jobs name).
- Order on dev: a job merges only after the jobs it depends on. When dev moved in its files after its checks, it takes dev into its branch and its checks run again before the merge.
- Between threads: `after:` and the file locks.
- The ledger keeps per job its start and its merge commit, and per thread its first start, last merge, release (the server's running commit contains the last merge), live check and close. The Tasks tab shows each thread as one lane in that order (`timeline.py gantt` draws it today).

## 6. The foreman (coworker, every 10 minutes and on events)

Input: a digest the dispatcher computes from the ledger, not raw logs: per station the queue, the oldest wait, the service time and the use of copies; per thread the progress, the critical path, the expected end and what blocks it; anomalies (a job stuck past its clock, the same block reason twice, the proof fail rate, a test that fails and passes on the same commit, budget burn); the top of the unplanned backlog.

Output: one final block of declarations, parsed by code: control changes within the bounds, priority changes, re-plan orders for blocked jobs (to the thread's project leader), thread splits and joins, holds, and a report of at most five lines shown on the Factory page.

Liveness: its last decision time stands in the control issue; past 30 minutes the floor shows it red.

Name: the app already has a built-in "Foreman" (the chat on the home board, `FOREMAN_AGENT_ID`), so this coworker needs another name.

## 7. Measures (from the ledger, every beat)

Jobs merged per hour and threads shipped per day; lead time per job and per thread; wait per station; work in progress; first-pass yield (proof passed without a fix round); rework (fix rounds per job); blocks by cause; tokens per merged job; minutes the owner or the operator had to act (target 0).

## 8. What exists, what is new

Exists on dev: the state table (`states.py`), pools with copies (`pools.py`), holds (`holds.py`), `Depends on`, `cutshape.py`, the proof step, "Done-test red before green", the planner reader (`planners.py`), the snapshot, `measures.py` (queue, occupancy, tokens, review), `timeline.py` (status, gantt), ledger transitions.

New: the control issue and the bounds file, `scheduler.py` (out of `dispatch.py`), planning as a station with automatic labels, the thread block and lanes, the digest, the foreman coworker, copies that follow demand, the control desk on the floor.

Cut 14 (being cut now) fits in: its fresh-plan check is the readiness rule, its re-plan is the project leader's job, its file lock is a scheduler rule.

## 9. Build order (threads apart by files, several at once)

| Thread | What | After |
|---|---|---|
| A | planning station and automatic labels (`dispatch.py` intake): the operator leaves the serial path | none |
| B | control issue reader, bounds file, change events (`control.py`) | none |
| C | digest and measures in the snapshot (contract first) | none |
| D | `scheduler.py`: readiness, score, WIP limits, file locks | cut 14 |
| E | the foreman coworker: instructions, schedule, output parser | B, C |
| F | copies that follow demand | B, D |
| G | floor: the foreman's desk, station gauges, thread lanes | C |
