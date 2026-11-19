# Copies pilot: three builds on one coworker at once

as_of 2026-11-14.

## Result

Three builds ran side by side on one coworker and did not get in each other's way. Each job had its own run, its
own worktree and its own pull request, and all three were merged eleven minutes after the label. Points 1 to 4
of the bar passed. Point 5 did not hold as worded: one build left a file in the folder where the worktree tool
keeps its worktrees, and that file stopped the next job. Copies did not cause it (below). It was still the one
file the plan had named as shared between runs, so the pilot found what it was there to find.

The setting stays: `code` first in the coder list, with three runs. The fold into one main per type waits for a
second wave with the fixes of this night live.

## What was tested

Whether three runs of one builder can build three different jobs at the same time. Not tested: copies of a
reviewer, more than three runs, a long build.

Settings: in `tools/factory/dispatch.json` the coder list starts with `code` at three runs; the four other
builders stay behind it at one run each (#287).

## The bar, written before the wave

1. All three builds go to `code` and overlap: each starts before the first of them ends.
2. Three pull requests, each touching only the files of its own job, each body naming only its own issue.
3. No job ends blocked or failed, and no build is sent a second time.
4. Each build uses at most 475,100 tokens, the largest of `code`'s own builds on 2026-11-13, when it ran alone.
5. Nothing of one job shows up in another: no commit on a wrong branch, no file of another job in a worktree's
   diff.

Three notes were added before the wave, after reading the code that would run it:

- The copy number on a job's row is written at every send, the review's too. After the builds it no longer says
  which copy built, so point 1 is read from the coworker's run list.
- A send that raises moves the sibling builds to the next builder by design (#292). Such a wave is repeated, not
  counted as failed.
- With an hour or less of sign-in left, three jobs are not labelled at once.

## The wave

2026-11-14, times in UTC. The three issues were labelled with one command at 02:21:05.

| Job | Build | Tokens | Pull request | Merged |
|---|---|---|---|---|
| #288, engine: the run list carries each run's goal | 02:21:20 to 02:23:27 | 348,102 | #298 | 02:27:56 |
| #289, web app: a run's answer carries its cached input tokens | 02:21:22 to 02:27:37 | 243,809 | #299 | 02:32:04 |
| #293, factory tools: `status` says when sending is held | 02:21:25 to 02:22:34 | 174,979 | #297 | 02:28:06 |

- All three had started before the first ended. The engine ran them as three sessions of the same coworker.
- Each pull request has one commit and its own two files, and its body names its own issue.
- There was no fourth build run on `code` and none on another builder. The reviews went to two reviewers (two
  to LINUS, one to BRUCE) and did not overlap on either.
- The sign-in had 225 minutes left at the label and 479 after the first start. The engine renewed it at that
  start, with the two other starts two and four seconds behind it, and cut none of them.
- The plan's weekly window read 48% before the wave and 54% after it. The rise is not the wave's alone: the
  other jobs of that hour and the orchestrator's own session are on the same plan.

## The file that stopped the next job

The build of #289 put five things into one shell command: the web app's lint, its type check, the write of the
pull request text to `/tmp`, the commit, and `pr-open`. The shell tool killed the command at its limit of 120
seconds, before the write. The build then wrote the text into the folder above its worktree, which is the
folder that holds every worktree of the repository, opened #299 from it, and left it there.

`wt` took every entry of that folder for a worktree and ran git inside it. With a file among them, `wt new`,
`wt list` and `wt sweep` crashed. The next job (#296, labelled after the three builds had ended) stopped at its
first step, and every later job would have.

Copies did not cause it. The build read no other job's file or folder. The two other pilot builds wrote their
text to `/tmp`, three single builds earlier that night did the same, and so did this one at first. Whether three
builds at once made its command slower than the limit is not shown either way: the recorded calls carry no
duration.

What was done, in order: the debugging coworker looked at the folder (one stray entry, a pull request text) and
removed that file; #296 went back in and merged; two fixes merged within the same half hour; the factory tools
were installed again on the server at 02:50, and a test file in that folder no longer stops `wt list`.

| Fix | What changes |
|---|---|
| #301 | `wt` treats only folders as worktrees; `wt list` names the stray entries and removes none |
| #302 | the briefs say that such a file goes into `/tmp`, carries the issue number, and is removed after use |
| #296 | found before the wave, by reading the change of #292: the resend of a failed attempt did not follow the rule that a coworker with an unresolved send gets no further send |

## Not cut yet

- The builder reported the crash of the worktree tool as a fault of the plan, so the job was returned to the
  planner. And nothing stops the line when the first step fails for every job: a wide cut would have spent one
  run per job before anyone looked.
- The type check a build is told to run printed 897 errors in a fresh worktree of the web app. The ones read all
  say that the module `@moldwright/contracts` cannot be found. It cost that build minutes and proved nothing.
- A build that chains lint, type check, commit and `pr-open` in one shell command runs into the shell tool's
  limit of 120 seconds.
- `/tmp` still holds the drafts of the builds from before #302.

## Next

The fold (one main per type, with one coworker kept behind each main for the case that the main has an
unresolved send) is a settings change of its own, with its own bar written before its wave. That wave has to
show what this one did not: reviews overlapping on one reviewer, and one long build.

The ceiling for builds is set by the machine, not by the pools. The server has four processor cores and 15 GB
of memory, and a build runs tests, a lint and a type check. Today's settings allow seven builds at once (three
on `code`, one on each of four others). The fold brings that to four.
