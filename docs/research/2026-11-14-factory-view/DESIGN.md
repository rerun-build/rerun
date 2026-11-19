# Design: a Factory view in the web app
as_of 2026-11-14

**SUPERSEDED** by `docs/research/2026-11-14-factory-world/SPEC.md` (the production line the owner
approved). Only section 5, what the app could read, still holds; both flat options below were rejected.

Issue #312. Status: DRAFT. VISUALLY UNVERIFIED: no browser here may open a file on disk, so the two mocks were
checked by running their scripts against a stub (all four views build, no `undefined`), not by eye. A person
should open `mock-a.html` and `mock-b.html` in light and dark at 1280x800 and 1920x1080 before the build.
Sample data in the mocks is invented in the shape of the wave of 2026-11-14 (`docs/research/2026-11-14-copies-pilot/PILOT.md`)
and is labelled "(sample)". Each mock has a Building / Held / Job switch and a Light / Dark switch; `#held`,
`#detail` and `#detailheld` in the address open a view directly.

## 1. Where it lives

A page of its own, `apps/ui/app/(dashboard)/factory/page.tsx`, not a part of the dashboard.
- The dashboard (`apps/ui/app/(dashboard)/page.tsx`, `components/layout/HomeContent.tsx`) is the board of spaces
  and coworkers: it shows `BuilderView` and a side panel per coworker. A view that needs the full width
  (seven columns, or four worker blocks beside a rail) does not fit in `SidePanel.tsx`.
- Reached from the Control Center (`components/control-center/ControlCenter.tsx`, commands in
  `lib/control-center/commands.ts`): a command "Factory" that navigates to `/factory`, plus the same word in
  the workspace menu. Only for a workspace that has a delegator; otherwise the command is absent.
- The page sits in the `(dashboard)` group so it keeps the frame, the theme and the sign-in of the app
  (`app/(dashboard)/layout.tsx`).
- A small signal on the board when the line is held (a dot on the Control Center entry, as
  `SidePanelTabSwitcher.tsx` does for attention) is wanted; not designed further.

## 2. The two options

Shared by both: header with the two gauges (plan window as a meter with its reset time, sign-in minutes as a
meter), the Building / Held / Job switch (mock only), a hold band under the header, the beat line at the foot
in mono. App colours (`app/globals.css`: neutral oklch ramp, brand `#4d34f7`, `#b7a8ff` as text in dark),
mono for numbers, 14 px body. State is shown by shape and word, never colour alone (solid square building,
hollow circle waiting for a worker, dashed circle waiting on a job, filled circle merged, diamond blocked).

### A: the line (`mock-a.html`)
- **First**: seven columns, left to right: Waiting, Queued, Building, Review, Fix, Checks, Ended today. Each job
  is a row-card with issue and PR number, title, state word, time in state and, if waiting, what on and why.
  Under the columns, one strip per worker type with its coworkers as chips and runs out of their ceiling
  (`code 3/3`).
- **For**: it is the owner's own picture (MACHINE.md section 2, a line of stages); you see where work piles up;
  a stuck job reads at once as the oldest card in a column; quiet days show an almost empty line.
- **Against**: ghosts are only a count and a copy label on the card, so "who holds which run" needs a click or
  the strip; seven columns need about 1100 px; reviewer-side wait is spread over three columns.
- **Phone width**: columns stack in one list, each with its title and count; the line is read top to bottom,
  the strip stays below. Works, long.

### B: the floor (`mock-b.html`)
- **First**: four blocks (coder, reviewer, researcher, designer), each with its coworkers, each coworker with
  its runs in flight as rows (copy number, issue, state, start, age, step count) and "n of max runs". Jobs
  waiting for a reviewer sit under the reviewer block. A rail at the right holds what has no worker yet
  (waiting on a job) and what ended today.
- **For**: it answers the new question the web app cannot answer today, who is running what, and shows ghosts
  as first-class (three rows under `code`); it matches the floor of MACHINE.md section 2a; capacity is visible
  as "2 of 3".
- **Against**: the order of the stages is lost: a job's place in its life shows only as a state word; a long
  queue has no obvious home; idle worker blocks use room.
- **Phone width**: blocks stack, rail goes under them. Works, shorter than A.

## 3. The recommendation

Build B first as the main screen, and take from A its time-in-state ordering inside each block, because the
owner's request was to see the new things (ghosts, holds, gauges) and only the floor makes ghosts visible
without a click; the stage order is already in the state word and in the beat line. If the owner thinks in
stages when something is slow, add A as a second tab of the same page later: both read the same data, so it
costs a second renderer, not a second source. The job detail is the same for both and is built once.

## 4. States

| State | Screen |
|---|---|
| Empty line | A: seven empty columns with "nothing"; B: workers show "idle", rail says "nothing today". One line: "No jobs. The delegator is up, last beat 12 s ago." |
| Held line | Warn band under the header: kind, end time in UTC and time left; waiting jobs keep their cards and say "sending is held: <kind>" in the warn role; running builds are unchanged. Gauges stay. |
| Blocked job | Diamond, word "blocked", red role, reason in one line on the card (what refused); lives in Ended today until the owner leaves it. Failed, returned, rejected the same way with their own word. |
| Sign-in running out | The sign-in gauge turns warn below the renewal threshold (run limit plus five minutes, `renewal_hold` in `tools/factory/dispatch.py`), the label says "renews at hold end"; when a hold of kind sign-in renewal is on, the band shows too. |
| Delegator not answering | Grey band "The delegator has not answered since <time>"; the last data stays, dimmed, with its age; ages stop counting; no hold or gauge is shown as fresh. Engine-side gauges may still be live and keep their own timestamp. |

## 5. What the builder needs

"Reads today" means the web app has code that reads it; "cannot" means it does not. The way to read the
delegator's ledger is left to the next job.

| Part | Data | Can the app read it today? |
|---|---|---|
| Line / floor cards | job number, state, issue number, PR number, time entered state, waits-on and why, copy number | Cannot. Lives in the delegator ledger (`tools/factory/store.py`, tables `jobs`, `transitions`; `fires`). |
| Job detail: states | every transition with its time | Cannot. `transitions` (`store.py`, printed by `timeline.py`). |
| Ghosts: coworkers per worker type | pools and ceilings | Cannot. `tools/factory/dispatch.json`. |
| Ghosts: runs in flight | coworker, run id, start, step count | Partly. The app lists a coworker's runs (`components/agent/AgentRunHistory.tsx`, `lib/engine/client.ts`; `apps/engine/src/http/routes/runs.ts`). Which job and copy a run belongs to: cannot, ledger only. Team status across coworkers: no page uses it. |
| Hold | kind, end time | Cannot. `tools/factory/holds.py` (one ledger row per kind). |
| Gauge: plan window | per cent used, reset time | Can. `components/connections/PlanLimitsBlock.tsx`, `lib/engine/ai-sources.ts`, `apps/engine/src/connections/plan-limits.ts`. Only the window shown by the connection; which window the owner wants here (weekly) is a choice for the build. |
| Gauge: sign-in minutes | minutes left | Cannot as a number on a screen found. The delegator reads it from `list_ai_connections` (`renewal_hold`); not checked whether the app has the expiry. |
| Run cost | tokens in, cached, out | Contract has `inputTokens`, `outputTokens`, `cachedInputTokens` (`packages/contracts/src/stats.ts`); whether the single run read returns them per run was not checked in `routes/runs.ts`. |
| Goal verdict | met or not met and why | Can. `runs.ts` returns `goal` (`runGoalRecordSchema` in `@moldwright/contracts`) on the list and the single run. |
| The beat | counts per state, ended today, time of last beat | Cannot. Written by `heartbeat` in `dispatch.py` to `/state/heartbeat`. Also gives "delegator not answering" its clock. |
| Links | issue and PR URL | Built from numbers and the repository; the repository name is not in any datum above. |

Wanted by the screen, whatever the way: one fresh read of everything about the line, with a time it was made,
so the "not answering" state can be shown; refresh about every 30 seconds to follow the beat.

## 6. Not designed

- How the app reads the ledger, the heartbeat or the holds (next job).
- Any action: no cancel, release of a hold, retry or merge button; the screen only shows.
- Notifications, history beyond today, charts of cost over time, the gantt of `timeline.py`.
- A view for several delegators or several repositories.
- Reviewer copies (not tested in the pilot) and the fold into one main per type.
- Real titles, copy and translations: the mock strings are English and invented; the app's `next-intl` keys
  are the builder's.
- The small signal on the board (section 1) and anything about the engine's own team-status page.
