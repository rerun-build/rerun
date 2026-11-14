# The factory core: chunker, dispatcher, gates, self-healing
as_of 2026-11-14. Status: DESIGN (owner's goals below; nothing built yet beyond what section 7 lists).

## Owner's goals (verbatim)
- "Factory end goal is proper hierarchical organization so things can be worked on in paralel, and their
  codependancy gates their completion rate so we can control how and when they come together for
  efficiency sake."
- "This needs to be fully dynamic and self optimizing no matter what the work is. So dispatcher and chunker
  are king."
- "also self healing, when things break unexpectedly when some dependency hits a wall, the whole plan needs
  to adapt to that critical change."
- "we cannot afford to be rigid in execution"

The screen side (the ledger: epic, dependency layers, tasks with department tags, subtasks) is SPEC.md 5b.
This document is the machine side.

**The governing principle: the plan is a living thing.** A cut is the best current guess, not a contract.
Any fact learned while executing (a task larger than predicted, a need that turns out unnecessary or
missing, a wall, a faster path, a pool sitting idle) may change the plan at once: split, merge, reorder,
widen, narrow, re-route or re-gate. Nothing waits for a person to re-approve a plan whose goal has not
changed. What stays fixed is only the epic's goal and the owner's rules.

## 0. Signals drive everything (owner: "self improving mechanisms, self healing based on the signals (statuses of tasks) received")

Healing and improving are not schedules or a person's review: they are reactions to signals.

- **Signals** are the facts the line already produces, each written to the ledger with its time: a task's
  state change (`transitions`), a run started or ended with its status, steps, tokens and minutes
  (`fires`), a review verdict and its reasons, a fix round, a gate passed or failed, a CI or check result,
  a stall (steps not moving against the clock), a hold starting or ending, plan usage, dev's health after
  each merge.
- **Detectors** read the stream and name a pattern, for example: one task failing twice the same way (a
  plan fault, not bad luck); several tasks failing the same check at once (an environment wall, not
  several bugs); reviews sending tasks back mostly in one department (tasks cut too large there); a run
  stalling (wrong model or effort, or a wall); a gate failing on the same join twice (needs wrong in the
  cut).
- **Actions** answer a detected pattern: retry, fix round, re-cut, re-route, split out a spike, hold,
  tighten or loosen a gate, change width, change a task's model or effort. Every action is itself a
  signal, so the ledger shows why the plan changed.
- **Self-healing** is detector plus action within the running epic (section 4).
- **Self-improving** is the same loop one level up: each action's effect is judged by the signals that
  follow it (did the re-cut task pass? did the wider line fail more?). The settings the actions use (size
  limits per department and kind, width, gate strictness, model choices, retry counts) are **policies
  kept as data** in the ledger, versioned, never hard-coded; a policy change that the following signals
  show to be worse is rolled back by the same loop, and every change and its measured effect is written
  down. No setting changes without a signal behind it.
- **On the heartbeat** (owner: "so feedback loop needs to also be on the heartbeat"): the loop runs every
  delegator beat (about 30 s), not at the end of an epic. Each beat reads the signals since the last beat,
  runs the detectors and takes the healing actions within that beat; the improving loop judges each policy
  over a rolling window of recent signals on every beat. Against thrashing: a policy changes only with
  enough evidence behind it (a minimum count of tasks in the window), waits a cooldown after a change
  before it is judged again, and a new setting must beat the old one by a clear margin, not by noise. The
  epic scorecard remains as the summary of what the beats did.

## 0a. Liveness (mandatory; owner: "If coworkers or sessions get stuck due to various reasons we absolutely cannot afford waiting on them indefinitely. Liveness check is mandatory")

**The rule: nothing waits without a deadline, and silence is a signal.** Every wait (a tool call, a run, a
job in a state, a run waiting on another run, the delegator itself) has a limit, ends on every terminal
state (not only on success), and a missing answer is acted on, never waited out.

**Each layer is watched by the one outside it**, so no single hang can stop everything unnoticed:

| Layer | What can hang | Watched by | Action |
|---|---|---|---|
| Tool call | a command waiting on input, a server started in the foreground, a watch-mode test | the engine | the tool's own time limit (600 s for shell); a command with no output and an idle process is stopped early and the model is told why ("it waited on input"), so the run continues instead of dying |
| Run (every coworker, not only factory jobs) | a provider stream that stops sending, a wedged tool, a model loop | the engine | the run reports `lastActivityAt` and its current tool; no activity while not inside a tool for the idle limit ends the provider request and retries it once; still silent ends the run as `stalled`; a wall-clock limit per run kind as the last bound |
| Run waiting on a run | a coworker calling another (`call_agent`, Boss waiting on a helper) | the engine | the wait names the child run; the child's end, of any kind, is delivered to the parent; a stalled child is reported to the parent, which is never left waiting |
| Waiting on a person | a run asking the owner | the delegator and the page | its own state, shown and counted, never mistaken for stuck; the line never stops for one answer: work that does not need it goes on |
| Job (delegator) | a run that stops moving; a job stuck in a state | the delegator, every beat | step progress per run (stall clock); a deadline per state (queued with free pools, review wait, fix wait, checks); a job waiting on a need that is blocked or failed is re-planned (section 4), never left waiting |
| Delegator process | the beat loop hanging (a lock, a call without a time limit) | a watchdog thread in the delegator | a beat not finished within three beat lengths: write the stack to the log and exit; the container's restart policy brings it back and it resumes from the ledger |
| Engine and app processes | a blocked event loop | an in-process watchdog | event-loop blocked past its limit: log and exit; the restart policy restarts it |
| The whole line | the delegator silent; the engine not answering | the app (a different process) | the Factory page shows "not answering" after two beats; past a few minutes the owner gets one notification, not repeated until it recovers |

**The action ladder on a suspected stall**: notice (a signal; a clock badge on the floor) → probe (is the
process working: stream bytes, CPU, a tool running within its limit?) → nudge (stop the stuck tool inside
the run and tell the model) → cancel and re-dispatch a fresh run (another copy, perhaps another model),
with the reason written into the new brief ("the last attempt hung on X") → after two, the job is blocked
and section 4 re-plans around it → the learning loop records the cause (a builder starting a dev server in
the foreground becomes a brief rule).

**Limits are measured, not guessed** (lesson of 2026-11-13: the stall clock was switched off because the
step count stood still through healthy 25-minute builds of command-line coworkers). Today's facts: the step
count now moves live with every tool call (a build went from 3 to 7 steps within one minute on
2026-11-14); one shell call is limited to 600 s and one `ci-wait` call blocks at most 450 s, so a healthy
run's count moves at least every ~14 minutes even at worst. Interim stall limit: 1,200 s (20 minutes).
The delegator then records every gap between count changes (it overwrites the last one today), and the
limit becomes a policy set from the measured distribution with a margin, retuned on the heartbeat.

## 1. The chunker: any epic into a graph that runs in parallel
- **A planner proposes, the chunker decides.** Boss (or any planner) writes a cut; the chunker validates it
  in the factory before anything runs: file overlaps between parallel tasks, needs that do not exist,
  cycles, a task predicted too large, run lines that cannot run, a worker type with no pool. A failing cut
  returns to the planner with its reasons, never to a person. (Today this check is `check_cut.py` on
  Rob's orchestrator's PC: a proof of concept to be replaced by code in `tools/factory`.)
- **Sized by measurement.** From finished tasks it learns what a task costs (files, steps, tokens, minutes,
  review rounds) per department and kind; a task predicted over the limit is split, tiny siblings that
  always travel together are merged.
- **Shaped for width.** Needs are kept to what is real, so more runs at once; every need carries a reason.
- **Re-cuts while running**: a task that turns out larger than predicted is split mid-flight (finished
  parts kept), a need that proves unnecessary is dropped, a missing one added, and the graph is re-layered.

## 2. The dispatcher: run the graph as wide as the evidence allows
- Starts every task whose needs are met, up to an **adaptive width** set from what is observed: CI time,
  plan usage, conflicts between tasks touching neighbouring code, failure rate under load.
- Picks **model and effort** per task from what similar tasks needed; changes them on the next run when a
  run shows the choice was wrong.
- Keeps the ledger honest: every state, gate, re-plan and repair is a row the page can show.

## 3. Integration gates: control how and when work comes together
- A **join** is a task with two or more needs. Before it starts, its inputs are merged and the gate runs
  on dev: the full checks, plus a render check for UI work.
- A passed gate releases the join; a failed one holds everything downstream and opens a fix task at the
  join, so a fault is caught where the parts meet.
- **Gate strictness adapts** (checks only; checks and render; checks, render and an owner's look) from the
  join's history; the owner can fix it per epic.
- **Completion is measured by gates**: an epic's progress counts gates passed, the share of the work
  proven to fit together, beside tasks merged.

## 4. Self-healing: the plan adapts when something hits a wall
1. **Classify** every break: flaky (retry); task-local (fix round); plan fault (back to the chunker);
   dependency wall (what a task needs does not work as planned); environment wall (dev broken, plan quota
   out, sign-in expired, a service down).
2. **Blast radius**: walk the graph from the break; everything downstream is "at risk", with its share of
   the epic; the ledger shows the break red, its downstream amber, the rest green.
3. **Keep healthy branches running** at full width; one wall never stops the factory.
4. **Re-plan the affected subgraph only**: route around (another approach, a stub that unblocks the
   dependents), split out a spike to investigate the wall, reorder so ready work runs first. The new cut
   passes the same validator.
5. **Repair the environment**: dev broken freezes merges, finds the breaking commit, reverts or fixes it,
   resumes; plan quota low holds new work and lets running work finish; sign-in renewal holds before work
   fails (the hold mechanism).
6. **Escalate only what changes the goal**: a re-plan that still delivers the epic just happens and is
   written down; a wall that means the epic cannot deliver what was asked becomes one question to the
   owner, with options and a recommendation first.

## 5. Self-optimizing: the loop
Every epic ends with a scorecard: predicted against actual time and tokens per task, parallel width
achieved, rework rounds, gate failures, re-plans, breaks by kind and the repair that worked. The chunker and
the dispatcher adjust their numbers from it; every adjustment and its measured effect is written down, so a
change that made things worse is visible and rolled back. Measure, change, measure.

## 6. Order of building
0. Liveness first (section 0a): the stall clock on at 1,200 s; the delegator's watchdog; gap recording;
   per-state deadlines; then the engine's run liveness (`lastActivityAt`, the tool-input stop, child runs)
   and the app's alert when the line goes silent.
1. The signal record: every signal above written to the ledger with its time, and shown in the ledger.
2. The chunker's validator in `tools/factory` (replaces `check_cut.py`).
3. The epic scorecard and the policy table (policies as data, versioned).
4. Integration gates at joins.
5. Detectors and actions for self-healing: classification, blast radius, environment repair (dev freeze and
   revert first).
6. Re-planning while running (split, merge, re-layer a subgraph).
7. The improving loop: actions judged by the signals that follow; policies adjusted and rolled back.
8. Adaptive width and per-task model choice, size learning: as policies the loop tunes.
The ledger (SPEC.md 5b) comes first so all of this can be watched.

## 7. What exists today (as_of 2026-11-14)
Needs via `**Depends on**` (`tools/factory/cutshape.py`); the delegator runs jobs whose needs are merged,
with pools per worker type and runs per coworker (`dispatch.py`, `pools.py`); holds before a sign-in
renewal (`holds.py`, `renewal.py`); one fix round after a review; reconciliation of jobs ended outside the
delegator (#356). Not yet: any of sections 1 to 6 beyond those.
