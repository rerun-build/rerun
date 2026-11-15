# Factory resolver: the dispatcher's self-repair loop

as_of 2026-11-15. Source: `tools/factory/problems.py`, `tools/factory/resolver.py`, the hooks in `tools/factory/dispatch.py`, `resolver_brief` in `tools/factory/briefs.py`, `tools/factory/dispatch.json`.

Rob, 2026-11-15: "We need to empower the factory with a special agent who resolves any and all issues, in order to make things run smoothly."

## 1. The loop

Each beat, after the jobs step, `Resolver.beat` looks for problems. Each problem has a key and gets one GitHub issue: label `factory-problem`, title `Factory problem: <key>`, and a `Problem-Key:` line in the body. The body carries the evidence; when the evidence changes, the dispatcher edits the body. HOUSE (the `resolver` pool) is sent the problem and ends with a final line. The dispatcher then checks whether the problem is gone and closes the issue itself.

## 2. The switches

Set in `tools/factory/dispatch.json` under `resolver`.

| Switch | What it turns on |
|---|---|
| `resolver.detect` | Finding problems, opening, editing and closing their issues, and the `problems N open, M owner` count in the beat line. |
| `resolver.resolve` | Sending problems to HOUSE and running its DO lines. Works only with `detect` on and a `resolver` pool in the config. |

Shipped as detect on, resolve off. The operator turns resolve on after looking at how many problems the live ledger opens.

## 3. The kinds

| Key | When | Evidence |
|---|---|---|
| `unreadable #n` | An issue the dispatcher refused to read as a job. | The refusal reasons. |
| `dead #n` | A job in `waiting` whose dependencies can never finish. | The job's wait line. |
| `ended #n` | A job ended `blocked`, `failed` or `rejected` and its issue is still open. The open-issue list is read every 10 beats. | The job number, end state, reason and pull request. |
| `idle line` | A job is queued, a dead wait or an unreadable issue exists, and no run is in flight for 10 beats. | Frozen at the 10th beat: the beat line of that moment. |
| `repeating error` | The same pass-level `log("-", ...)` line 5 or more times in the last hour. Per-item lines carry an issue number and are not counted. | Each line with its count. |

## 4. The states of a problem

| State | What moves it |
|---|---|
| `resolve_wait` | Entered when the issue is opened. Leaves when a HOUSE copy, a `resolve` slot and no hold allow the send; the send makes it `resolving`. A run that ended with no final line puts it back here once, with a note in the next brief. |
| `resolving` | The run is checked every beat. A run past `run_limit_s` is cancelled. When the run is over: `RESOLVED:` or `FILED:` goes to `verify`; `ESCALATE:` goes to `owner`; no final line goes back to `resolve_wait` once, and the second time to `owner`. |
| `verify` | Counts beats in which the problem is still found. At 6 beats the attempt counter goes up. The clock is held while a `FILED: #n` job is live in the store. The attempt goes back to `resolve_wait`; when the counter reaches 3 (two attempts that did not clear it) the problem goes to `owner`. |
| `owner` | The issue gets the `owner` label and a comment with the final line. When Rob removes the `owner` label, it goes back to `resolve_wait` as attempt 1. |
| `closed` | The problem has been absent for 3 beats in a row, in any state except `resolving`. The issue is closed with a "cleared at" comment. A problem that reappears resets the count. |

## 5. The DO verbs

Before its final line, HOUSE may ask for a step only the dispatcher can take, one `DO:` line each. The dispatcher comments the result on the problem issue.

| Verb | What the dispatcher does | What it checks first |
|---|---|---|
| `requeue #n` | Puts the job label back on issue n and removes `factory-blocked`; intake takes it next beat. | n is a job in `blocked`, `failed` or `rejected`. |
| `clear-hold <kind>` | Clears that hold. | The kind is `plan limit` or `sign-in renewal`. |
| `rerun-ci #pr` | Re-runs the failed jobs of the latest failed runs at the head of the pull request. | The number is the pull request of a job in the store. |
| `wait-off #n` | Drops the stale wait reason of job n. | The job has a wait reason. |

DO lines are read only from the `get_run` output of a run the dispatcher itself sent, at line start only, at most 10 per run, and each run once. Any other verb, or a verb that fails its check, is answered "not allowed". Echoed text loses at-signs and backticks and is cut to 200 characters.

## 6. The limits

| Limit | Value |
|---|---|
| New issues a beat | 10 |
| Open problem issues | 30 |
| When capped | One log line, `problems capped: ...`, again only when its text changes. It is not a pass-level line, so it is never counted as a repeating error. |
| HOUSE | 2 copies |
| `resolve` station | Takes slots like the other stations, and never more than HOUSE's free copies. |
| Holds | Every send waits while a hold is on. |
| Run tokens | HOUSE runs are not written to the fires ledger. |
| Records | In the store's kv table, under job `problems`. |
