# The factory world: design spec
as_of 2026-11-14. Status: APPROVED LOOK (owner: "Looks nice" on the production line), build not cut yet.
Supersedes `docs/research/2026-11-14-factory-view/DESIGN.md` except its section 5 (what the app could read).
Prototype: `apps/ui/components/factory/` on sample data; the belt and trace lines in `packages/ui/src/iso-grid`.

The factory is a production line in Rerun's own isometric world, dark by default. Everything on it is a
finite, known thing: a feature is cut into a known number of tasks, each task passes known stages, so every
level on the floor is exact and every motion says something true. Nothing moves for decoration.

## 0. Shape language (binding; owner, 2026-11-14)

Owner: "shapes must mean something", "like in diagrams a shape says something", "the ghosts or replicas
are the only things transparent", "idle coworkers or other shapes, do not animate the body shape, only
their faces". Every object on the floor takes its meaning from a flowchart shape (ISO 5807) or, for work in
flight, a Petri-net token. A new object must use one of these shapes for its meaning, or this table changes
first.

| Shape | Means | On the floor |
|---|---|---|
| Rectangle (process) with a face | a mind that does work | a Rerun coworker, in its own Rerun colour; unlit when idle, glowing when it has a run out |
| Rectangle, see-through | the same process running again in parallel | a copy (ghost); drawn only while that copy runs a job |
| Diamond (decision) | a yes/no choice | review: a diamond gate on the belt; pass leaves by one corner, fail by the other |
| Capsule (terminator) | where the flow starts and ends | the Loader (the delegator): faceless; intake, checks and merge happen there; clicking it opens the Loader tab |
| Cylinder (stored data) | where results collect | a feature: a tank filling gold as its tasks merge; the reject store: a red tank beside review |
| Token (Petri net) | one unit of work in flight | a task: a solid sphere, two-tone (filled part in its state colour, the rest dark) |
| Flow line with arrows | direction of flow | a belt, with chevrons pointing the way work moves; still when nothing is on it |
| D-shape (delay) | waiting | a hold: a red D-shaped barrier across the belts, with the time left |

Only copies are see-through. Spheres, tanks, gates and coworkers are solid.

Idle means still bodies: an idle coworker, the Loader, a gate, a tank or a belt does not move its shape (no
bob, squash, sway, running slats or travelling light). Only faces stay alive when idle: a coworker's eyes
may blink and look around. Motion of a body says work is happening.

Where section 1 below says otherwise (glass spheres, an open bin, a buddy for the loader, a scanner box),
this section wins; section 1 is kept for what each object is and how it moves while working.

## 1. Objects

| Object | What it is | How it looks |
|---|---|---|
| **Coworker** | a Rerun coworker (`code`, LINUS, the loader...) | Rerun's 2x2 buddy with its face: bob, blink, squash |
| **Copy** | one more run of the same coworker at once | the same buddy, see-through, joined to its coworker by a thin trace |
| **Belt** | a path work takes between coworkers | link variant `belt`: a dark band on the floor, slats running, a neon edge in the status colour of what is on it, a slow trace along its middle |
| **Trace** | a light connection (main to copy, studio) | link variant `trace`: a thin see-through line, a neon head travelling end to end, the line behind it lit and fading |
| **Task sphere** | one job (an issue cut for the factory) | a glass sphere riding the belts, filling like a liquid in its status colour; `#issue` and its percentage under it |
| **Scanner gate** | a review | an X-ray gate standing on the belt: the sphere waits inside while a line of light sweeps it; green and on, or red, a shake, and turned aside |
| **Reject bin** | where defects end | an open bin of dark red glass beside the scanners, the rejected spheres heaped in it, its count on the rim |
| **Feature sphere** | a feature (the parent issue a task was cut from) | a large glass sphere in Stock, one mark per task; merged tasks fill it gold, rejected ones settle red at the bottom; empty space is the exact work left; it glows when full |
| **Loader** | the dispatcher | a buddy at the head of the line; queued spheres wait on its belt; it carries the merged count |

## 2. What fills, and from what

- **A task sphere** fills by stage: build up to 40%, review to 70%, checks to 95%, merged full. Inside a
  stage it creeps by the run's steps (`fires.steps`) against the usual length of that stage, never past the
  stage's cap. A fix round takes it back to its builder and it creeps 50 to 60%.
- **A feature sphere's** level is ended tasks over all tasks of the feature (merged gold, rejected red).
  The count of tasks comes from the cut, so it needs the parent link (section 6).
- **A belt's edge** is the colour of what rides on it; a quiet belt keeps the board's blue-white.

Colours: queued `#8ea2ff`, building `#f5a524`, review `#2dd4a3`, fixing `#fb923c`, checks `#6ea8ff`,
merged `#ffe08a`, rejected and held `#ef4444` / `#f87171`.

## 3. Every state and its tell

Every state has a tell by shape and motion as well as colour. "Ledger" is `tools/factory/store.py`
`JOB_STATES`, `holds.py`, `fires`.

| State | Ledger | Tell |
|---|---|---|
| waiting on a task | `waiting` | sphere parked at the loader, empty, dimmed, with a thin thread of light to the sphere it waits on |
| queued | `queued` | sphere in line on the loader's belt; the line closes up as the front one leaves |
| held | `holds.py` | every belt edge turns red and its slats stop; waiting spheres get a red rim; a band shows the time left; the loader shows a padlock |
| building | `building` | sphere settled on the trace between `code` and the copy building it; the copy bobs; amber liquid rises |
| review wait | `review_wait` | sphere queued on the belt in front of the scanners, lid dark |
| reviewing | `reviewing` | inside a scanner gate; the scan line sweeps; green liquid rises |
| fix wait | `fix_wait` | sphere turned aside by a red gate, parked at the scanner with an orange rim |
| fixing | `fixing` | sphere rides the orange belt back to its builder; orange liquid rises |
| checks | `checks` | sphere on the belt back to the loader, blue liquid, the belt edge blue |
| merged | `merged` | sphere full, a gentle shake, rides gold to its feature sphere and pours in |
| rejected | `rejected` | red gate and a shake; the sphere rides to the reject bin and lands on the heap |
| blocked | `blocked` | sphere stops where it is, one sharp shake, a diamond badge and the reason in a bubble; stays until someone acts |
| failed / returned | `failed`, `returned` | a crack across the sphere, one shake, its liquid drains to grey; it goes to the reject bin |
| stalled | `fires` (steps not moving past the clock) | the copy holding it greys and slows; a clock badge on the sphere |
| over budget | `fires` (tokens past the cap) | the sphere glows red at the rim and the copy shudders |
| delegator not answering | heartbeat older than two beats | the floor dims, every slat and trace stops, a clock shows the last beat |

## 4. The motion language

Refined: data flows on the lines; each change of state has its own tell (start = a squash and a light,
finish = a pulse that settles, error = one shake, waiting on a person = a slow breath, hold = dim and lock);
hints sit where the change happened; glows fade, never blink; idle things stay quietly alive.

Cheap, never: everything moving on one beat; loops that mean nothing; colour as the only signal; shaking what
is not wrong; pop-ins with no easing; piled bubbles (two at most); motion that fights a drag or a click;
layout jumping when data refreshes.

Recipes and their sources: MOTION.md (hop, landing, copy ripple, handoff), PACKETS.md (tapered comet that
bends at corners, a queue that backs up with minimum spacing, a squash at corners, the plain route for slot
positions), OPEN-SOURCE.md (one id per job so a task travels; play live data one beat behind, AI Town).
Two traps PACKETS.md measured: a per-route `linear()` easing works only on two-keyframe animations, and
nothing that rides `offset-path` may carry its own scale or translate.

## 5. Around the floor (Rerun parts, repurposed)

- **Foreman chat:** Rerun's coworker chat (`components/chat/AgentChat.tsx`) for Boss, in the shell of the
  foreman column (`components/foreman/ForemanColumn.tsx`), restyled to the factory.
- **Bot panel:** clicking a coworker opens Rerun's side panel (`components/agent/AgentPanel.tsx`): chat, runs,
  schedules, model, effort, skills, tools, services. Missing in Rerun: pausing a coworker by hand.
- **KPIs:** the bar of `factory-metrics.ts` (Rerun's own run measures, the job counts, plan and sign-in),
  and Rerun's monitoring cards and charts (`packages/ui/src/monitoring`) summed across the factory coworkers.
- **Settings:** Rerun's dialog pattern (`PanelEditorShell`, `Segmented`, `Switch`) over the delegator's
  settings: pools, runs per coworker, clocks, holds. Needs a write path to the delegator (later).

## 6. Where the data comes from

**Push.** On every beat the delegator sends one snapshot of the line to the app through the account tool
server it already calls with its own key; the app keeps the latest snapshot per workspace and the factory
page reads it behind sign-in. Chosen because the delegator is deliberately closed (no published ports, no
other networks, no host paths but its read-only tools mount), its ledger is SQLite in WAL mode (not read
cleanly through a read-only mount), and the app has no SQLite reader.

- **One value, replaced each beat,** with the time it was made; "not answering" is a snapshot older than two
  beats.
- **Never stops a beat:** its own try, a short timeout, an unknown-tool answer logged once.
- **Trust:** the schema lives in `packages/contracts` with a size cap; the snapshot is keyed by the calling
  key's workspace, never global; the read is behind sign-in; BRUCE reviews the new write before it merges.
- **Carries:** every job with its state, when it entered it, coworker and copy, run steps and tokens
  (`fires`), PR and fix round; the holds with their end time; the pools and runs per coworker; the beat
  number; the repository; each job's parent feature (nullable until the link below exists).

**Parent link: needs dispatcher work.** The ledger has no task-to-feature link; the cut names its parent in
prose ("Part of #198"). The cut format gets a `**Part of**: #n` line, read like `**Depends on**`.

## 7. Open

- Eyes that look around on a board: Rerun turns them off with many buddies. Proposed: a per-task eye motion
  (scan while reviewing, look down while building). The owner decides.
- Frame cost: slats and trace layers animate dash offset (a repaint per frame); `offset-distance` runs on the
  main thread in Chrome (PACKETS.md). Measure with a full floor before shipping.
