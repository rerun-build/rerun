# Plan quality: plan review, format gate, fact recheck

as_of 2026-11-18. Owner's ask: improve the factory's planning, as a self-contained part of the factory, with as little
human interaction as possible. Agents decide on their own or hand a decision to an overseer (Boss). The Foreman is the
only point of contact between Rob and the factory, and every question to Rob is a set of choices, the recommended one
first, or his own words.

## Why

From the stop comments of 2026-11-14 to 2026-11-17 (105 stops, `rerun-ops/2026-11-17-failure-map/B-stopped-jobs.md`):

| Class | Stops | What it was |
|---|---|---|
| Plan wrong from the start | 14 | numbers, counts and values the done-test asserted that were never true on dev |
| File list too narrow | 8 | an existing test outside Files pinned what the change alters (now covered by the "Tests adapted" rule) |
| Plan or issue contradicts itself | 4 | |
| Run line or red-before-green cannot pass | 20 | `uvx` and `pytest` missing on the runner, `-p` given a path (exit 5), a line in parentheses, the same `cd` twice, test-only Files |
| Truly stale (dev moved after the cut) | 1 | #946: the model map changed after the cut |

Every one was found at build, proof or CI, after the cut had been paid for. Until now nothing but the plan's author judged
a plan before the cut, and the cutter's verdict reached the planner as one sentence.

## The decision ladder

1. A coworker settles a point from evidence: the code, the issue, an earlier decision, the goal page.
2. A choice nothing settles is a `DECIDE` note. Boss decides it in the revise run as the overseer (his `council` skill
   when two options are close) and writes the decision, its reason and the dismissed options into the plan.
3. Only a choice in the fixed owner list in `notes.OWNER_CATEGORIES` (deploy, money, delete, outward, secrets, rules,
   product) becomes an `OWNER` note. The list is code: an `OWNER` note naming anything else is turned into a `DECIDE`.
4. An `OWNER` note becomes one GitHub issue labelled `factory-question`. Only that plan waits; every other plan goes on.

**The Foreman contract.** A question issue holds `**Question for**: #<parent>`, `**Category**`, the point with its
quote, and numbered `**Options**`, the first marked `(recommended)`. The Foreman lists open `factory-question` issues,
puts each to Rob as choices, and writes his pick back as a comment `ANSWER: <option number>` or `ANSWER: <his own
words>`, then closes the issue. A question closed without an answer keeps the recommended option. The dispatcher reads
closed questions every fifth beat and hands the answers to Boss as binding decisions. The Foreman side of this is #110's
work and is not built; until then a plan with an owner-only question stays parked.

## 1. Plan review (`planning.py`, `notes.py`)

After Boss's plan run ends `PLAN:`, and before the cut, a critic copy reviews the latest `## Plan` comment against
today's dev: the whole ask, decisions, facts, file lists, done-tests, risks and open choices. It answers in note blocks:

```
NOTE <n> <REMOVE|CHANGE|ADD|DECIDE|OWNER> <blocking|major|minor>
QUOTE: <words copied exactly from the plan>
PROBLEM: ...
EVIDENCE: ...
FIX: ...
```

The dispatcher keeps a note only when one of its quotes is in the plan word for word (whitespace and backticks
ignored, 12 characters or more). A quote is a check a script can make, so a note cannot point at something the plan
does not say. Thrown-away notes are counted and named in the review comment.

- **on:** owner notes become questions; blocking or major notes go back to Boss (`### Review answers` for those he
  rejects), at most `revisions` times; round 2 gets the earlier notes and the plan's diff and re-reads only what
  changed. What is left rides into the cut brief as points to check.
- **dry:** the review comment is posted and the plan goes to the cut unchanged. This is how it ships.
- **Fails open:** a critic run that errors, times out, or ends `BLOCKED:` lets the plan through to the cut (after two
  failed runs, or at once for `BLOCKED:`), and says so on the issue. The cut stays the backstop.
- **Who:** a copy of BARBARA (the `acceptor` pool), whose job is already to judge a finished parent against its ask;
  this moves that judgement to before the build. Sonnet 5.5, medium effort (`review_plan` tier).
- The review comment starts `## Review of the plan`, never `## Plan`, because the cut reads the last comment that
  starts `## Plan`.

The cut's own `BLOCKED: plan:` now carries note blocks too, and the re-plan brief hands all of them to the planner
instead of one sentence.

## 2. Format gate (`cutshape.py`, `issuecheck.py`, `planning.py`)

- **Checks from observed faults** in `cutshape.RUN_FAULTS` and `TEST_ONLY_ERROR`: a Run line in parentheses, unittest
  `discover -p` given a path, a `/data/` command, `pytest`, the same `cd` twice, and Files that are all tests without
  `**Red before green**: not applicable`. They run wherever `cutshape` runs: at the cut, at intake, and in the
  self-check. The test-file pattern moved into `cutshape.TESTF` and `gate.TESTF` is that same object.
- **Self-check:** `python3 -I tools/factory/issuecheck.py <body file>` prints the faults or `OK`. The cut, repair and
  recheck briefs tell the coworker to run it before saving an issue.
- **Repair loop** (`planning.repair.tries`): a child the label check refuses is no longer left with a comment that
  nobody acts on. A cutter copy gets the exact faults, edits only the issue text, and the check runs again. After the
  last try the old comment is posted.

## 3. Fact recheck (`drift.py`, `dispatch.py`, `planning.py`)

When a builder is free for a queued job, the dispatcher reads dev's diff since the job's `PLAN READY` commit, limited to
the job's fact files (Files, the test file, and paths named in Change, Done-test and Run). It is a hit only when:

- a fact file was removed or renamed;
- its diff was too large to read;
- dev changed 300 files or more;
- a changed line names a function the issue names.

On a hit the job goes back to `waiting` (reason `fact recheck`). A cutter copy re-proves the facts on dev's head and
ends `FRESH:`, `CORRECTED:` (with a `**Corrections**` block) or `BLOCKED: plan:`. Fresh or corrected, the next intake
reads the issue again and builds; blocked, the job is returned to the planner. Each step fails open: a diff that cannot
be read, a recheck that cannot be sent or ends without its line, all let the job build on what it has. `recheck.tries`
caps rechecks per job.

## Settings (`tools/factory/dispatch.json`)

```json
"planning": {
  "review": {"by": ["BARBARA"], "type": "acceptor", "mode": "dry", "revisions": 2},
  "repair": {"tries": 2},
  "recheck": {"tries": 2, "parallel": 2}
}
```

Tiers `review_plan` (Sonnet medium), `repair` (Sonnet low), `recheck` (Sonnet medium). Leaving a key out switches
that part off.

## Turning the review on

Grade the dry-run notes first, then set `"mode": "on"`:

1. **Replay:** run the critic on the original plans behind the stops above. Count the faults it flags and the false
   alarms on clean plans. This needs coworker runs, so it waits for the owner's word while the factory is stopped.
2. **Dry mode:** compare each review comment with what later stopped the same parent's children.
3. **Measure after:** plan-class stops per parent, returns to the planner per parent, cut `BLOCKED: plan:` per plan,
   review rounds and tokens per plan (`review_log` in each `plan:<n>` record).

## Open

- The Foreman's reading of `factory-question` issues (#110).
- Every coworker comments as the same GitHub account, so an `ANSWER:` comment is trusted by its format, not by its
  author. The Foreman writing through the app instead of GitHub would close that.
- The critic shares BARBARA's two-copy limit with her acceptance runs but counts only planning runs, so at a busy
  moment one extra run of hers can run at once.
