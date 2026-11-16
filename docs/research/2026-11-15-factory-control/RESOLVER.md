# Factory resolver: the dispatcher's self-repair loop

as_of 2026-11-15. Source: `tools/factory/problems.py`, `tools/factory/resolver.py`, the hooks in `tools/factory/dispatch.py`, `resolver_brief` in `tools/factory/briefs.py`, `tools/factory/dispatch.json`.

Rob, 2026-11-15: "We need to empower the factory with a special agent who resolves any and all issues, in order to make things run smoothly."

## 1. The loop

Each beat, after the jobs step, `Resolver.beat` looks for problems. Each problem has a key and gets one GitHub issue for good: label `factory-problem`, title `Factory problem: <key>`, and a `Problem-Key:` line inside the code block of the body, so an issue number there links nothing. The body carries the evidence; when the evidence changes, the dispatcher edits the body. HOUSE (the `resolver` pool) is sent the problem and ends with a final line. The dispatcher then checks whether the problem is gone and closes the issue itself.

## 2. The switches

Set in `tools/factory/dispatch.json` under `resolver`.

| Switch | What it turns on |
|---|---|
| `resolver.detect` | Finding problems, opening, editing and closing their issues, and the `problems N open, M owner` count in the beat line. |
| `resolver.resolve` | Sending problems to HOUSE and running its DO lines. Works only with `detect` on and a `resolver` pool in the config. |

Shipped as detect on, resolve on since 2026-11-16, after detection opened 0 problems on the live ledger. Setting `resolve` to false stops new sends; a run already out is not cancelled.

## 3. The kinds

| Key | When | Evidence |
|---|---|---|
| `unreadable #n` | An issue the dispatcher refused to read as a job. | The refusal reasons. |
| `dead #n` | A job in `waiting` whose dependencies can never finish. | The job's wait line. |
| `ended #n` | A job ended `blocked`, `failed` or `rejected` at or after the first watched beat (`problems_since` in the store; the end time is the job's `ended_at`), and its issue is still open. The open-issue list is read on each beat that has such a job or a FILED fix in verify. Older endings are not problems. | The job number, end state, reason and pull request. |
| `idle line` | A job waits in a queue state, no run is in flight and no hold is on, for 10 beats in a row. Unreadable issues and dead waits have their own problems and do not count. | Frozen at the 10th beat: the beat line of that moment. |
| `repeating error` | The same pass-level `log("-", ...)` line 5 or more times in the last hour. Per-item lines carry an issue number and are not counted. | Each line with its count. |

## 4. The states of a problem

| State | What moves it |
|---|---|
| `notice` | The state of the problem `backlog growing` (more issues opened than closed in 24 hours, counted hourly by `inboxsort.py`). It has a ticket whose text follows the numbers and that closes by itself when the flow turns; it is never sent to HOUSE and takes no `resolve` slot. |
| `resolve_wait` | Entered when the issue is opened. Leaves when the problem is still found, a HOUSE copy, a `resolve` slot and no hold allow the send; the send makes it `resolving`. A send that raised keeps its copy until `run_limit_s` has passed, then goes back here. A run that ended with no final line puts it back here once, with a note in the next brief. |
| `resolving` | The run is checked every beat. A run past `run_limit_s` is cancelled; a run whose `get_run` keeps failing is given up after that time. A plan-limit error arms the 30-minute plan-limit hold and goes back to `resolve_wait`; a transient error is sent again, at most 3 times, without counting as a missing line. When the run is over: `RESOLVED:` or `FILED:` goes to `verify`; `ESCALATE:` goes to `owner`; no final line goes back to `resolve_wait` once, and the second time to `owner`. |
| `verify` | Counts beats in which the problem is still found. At 6 beats the attempt counter goes up. The clock is held while the `FILED: #n` job is live in the store or its issue is open. The attempt goes back to `resolve_wait`; when the counter reaches 3 (two attempts that did not clear it) the problem goes to `owner`. |
| `owner` | The issue gets the `owner` label and a comment with the final line in a code block; the label and the comment go out before the state is saved. Only Rob (special-place-administrator, read from the issue timeline) removing `owner` sends it again, as attempt 1; anyone else's removal is undone. A problem sent to HOUSE 6 times in its life goes here instead of a seventh send; after that, removing `owner` sends it straight back here and HOUSE gets no further try. The owner check reads the newest 20 label removals of the issue. |
| `closed` | The problem has been absent for 3 beats in a row (120 for `idle line` and `repeating error`, which are also never counted absent in the first 10 beats after a start), in any state except `resolving`. The issue is closed with a "cleared at" comment and the record is kept: when the key comes back, the same issue is reopened and its body rewritten. A problem issue a person closes while the problem lasts keeps being edited, and is reopened when the key returns. A problem issue that no longer exists (deleted or moved) is forgotten and a fresh one opened; any other gh error stops the issue pass for that beat. |

## 5. The DO verbs

Before its final line, HOUSE may ask for a step only the dispatcher can take, one `DO:` line each. The dispatcher comments the result on the problem issue.

| Verb | What the dispatcher does | What it checks first |
|---|---|---|
| `requeue #n` | Puts the job label back on issue n and removes `factory-blocked`; intake takes it next beat. | n is a job in `blocked`, `failed` or `rejected`, taken fewer than 3 times. Intake itself never takes a job a fourth time with the same issue text and says so once on the issue; a change to the issue text resets the count. |
| `clear-hold <kind>` | Clears that hold. | The kind is `plan limit` or `sign-in renewal`. |
| `rerun-ci #pr` | Re-runs the failed jobs of the latest failed runs at the head of the pull request. | The number is the pull request of a job in the store. |
| `wait-off #n` | Drops the back-off and the wait reason of job n, so a job held by a stale back-off starts on the next beat; the dispatcher writes the true reason again. | The job is in a waiting state and has a back-off or a wait reason. |

DO lines are read only from the `get_run` output of a run the dispatcher itself sent, at line start only and outside code blocks (a block never closed hides everything after it), repeats removed, at most 4 per run, and each run once. Any other verb, or a verb that fails its check, is answered "not allowed". Echoed text loses at-signs and backticks and is cut to 200 characters. HOUSE is told never to change the `factory-problem`, `owner`, `factory` or `factory-blocked` labels itself.

## 6. The limits

| Limit | Value |
|---|---|
| New issues a beat | 10 |
| Open problem issues | 30; new ones are opened in the order idle line, repeating error, dead, unreadable, ended. Before a create, an open `factory-problem` issue with the same `Problem-Key:` line is adopted, so a create that timed out opens no duplicate. The first gh error stops the issue pass for that beat. |
| When capped | One log line, `problems capped: ...`, again only when its text changes. It is not a pass-level line, so it is never counted as a repeating error. |
| HOUSE | 2 copies; with `resolve` off they count toward no slot, and a problem left in `resolving` can close |
| `resolve` station | Takes slots like the other stations, and never more than HOUSE's free copies. |
| Holds | Every send waits while a hold is on. |
| Run tokens | HOUSE runs are not written to the fires ledger. |
| Records | In the store's kv table, under job `problems`. |
| Text on GitHub | Evidence and escalation lines go in code blocks, and the cleared comment drops at-signs, so nothing mentions a GitHub user. |
