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
1. The chunker's validator in `tools/factory` (replaces `check_cut.py`).
2. The epic scorecard.
3. Integration gates at joins.
4. Self-healing: classification, blast radius, environment repair (dev freeze and revert first).
5. Re-planning while running (split, merge, re-layer a subgraph).
6. Adaptive width and per-task model choice.
7. Size learning.
The ledger (SPEC.md 5b) comes first so all of this can be watched.

## 7. What exists today (as_of 2026-11-14)
Needs via `**Depends on**` (`tools/factory/cutshape.py`); the delegator runs jobs whose needs are merged,
with pools per worker type and runs per coworker (`dispatch.py`, `pools.py`); holds before a sign-in
renewal (`holds.py`, `renewal.py`); one fix round after a review; reconciliation of jobs ended outside the
delegator (#356). Not yet: any of sections 1 to 6 beyond those.
