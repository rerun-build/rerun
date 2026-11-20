# `C11`: `labelcheck.close_gaps` Closes Distinct Non-Duplicate Gap Issues When `**Repairs**` Is Empty (`set() - set() == set()`) and `busy()` Misses `recheck`, `classify`, and Open Child Slices

- **Finding:** `covered()` in `tools/factory/labelcheck.py:95-102` compares *only* parsed `**Repairs**: #N` numbers (`set(escapes.repairs(old)) - set(escapes.repairs(kept))`), so whenever an older `"Gaps of #<parent>:"` issue has `**Repairs**: none` or omits `**Repairs**` (`set() - anything == set()`), `close_gaps()` closes it as `"not planned"` even when its prose gaps are completely absent from the newer gap issue; additionally, `busy()` (`lines 83-88`) misses `recheck:{n}`, `classify:{n}`, and open cut child issues of `n`.

## Evidence

- `tools/factory/labelcheck.py:83-89,95-103,136-139`:
  ```python
  def busy(n, data):
      j = data["jobs"].get(str(n))
      plan = (data["kv"].get("plan:%d" % n) or {}).get("state")
      accept = (data["kv"].get("accept:%d" % n) or {}).get("state")
      return ((j is not None and j["state"] not in states.END) or (plan is not None and plan not in IDLE_PLAN)
              or (accept is not None and accept not in DONE_ACCEPT))
  ...
  def covered(gh, repo, dup, n):
      kept = body(gh, repo, dup["keep"])
      if not re.search(r"Part of\W*#%d\b" % dup["parent"], kept):
          return "#%d does not say it is part of #%d" % (dup["keep"], dup["parent"])
      extra = set(escapes.repairs(body(gh, repo, n))) - set(escapes.repairs(kept))
      if extra:
          return "it lists repairs %s that #%d does not" % (", ".join("#%d" % x for x in sorted(extra)), dup["keep"])
      return None
  ```
- `tools/factory/escapes.py:11-18`:
  ```python
  def repairs(body):
      found = set()
      for line in REPAIRS.findall(body or ""):
          named = line.split("(")[0]
          if named.strip().lower().startswith("none"):
              continue
          found.update(int(n) for n in re.findall(r"#(\d+)", named))
      return sorted(found)
  ```
- `tools/factory/acceptance.py:72-75` (explicitly instructs acceptors to write `**Repairs**: none` when no merged child carried the gap!):
  ```python
        "- Give each gap issue one line `**Repairs**: #<child>` naming the child job that should have carried it; "
        "write `**Repairs**: none` when no cut job should have, and one line `**Part of**: #%d` for the issue, "
  ```
- **Command / test run:** `wsl -e sh -c "cd /mnt/e/project/moldwright/tools/factory && python3 -m unittest test_labelcheck test_drift test_escapes"`
  ```text
  OK (passed inside the 314-test Tier 3 batch)
  ```

## Trigger

1. **Silent loss of valid gap issues (`labelcheck.py:99-102` + `acceptance.py:73`):**
   - Acceptor run 1 files `#501` (`Gaps of #500: missing mobile layout`, body has `**Repairs**: none` per `acceptance.py:73` because no cut slice owned mobile layout).
   - Later, acceptor run 2 files `#510` (`Gaps of #500: broken webhook retry`, body has `**Repairs**: #504`).
   - `labelcheck.check()` flags `duplicate_gaps: [{"parent": 500, "keep": 510, "older": [501]}]`.
   - `covered()` computes `set(escapes.repairs(body_501)) - set(escapes.repairs(body_510))` -> `set() - {504} == set()` -> returns `None`!
   - On the second pass, `close_gaps()` permanently closes `#501` as `"not planned"` with the false comment `"lists every repair this one lists"`, silently dropping the mobile layout gap forever! The same bug occurs if two gap issues repair two *different* defects inside the same child `#504` (`{504} - {504} == set()`).
2. **Incomplete `busy(n, data)` live-work check (`labelcheck.py:83-88`):**
   - If gap issue `#501` was **cut by the planner** (`plan:501` state is `"cut"`, which is *not* in `IDLE_PLAN = ("blocked", "lost")`, so `plan:501` happens to stay truthy — **unless** `#501` was manually planned without `plan:501` in `kv`, in which case its open child slices `Part of #501` are running while `jobs["501"]` is `None`!), or if `recheck:501` / `classify:501` is active in `kv`, `busy(501, data)` returns `False` and `close_gaps()` closes `#501` underneath live work!

*(What holds: `FIXES = 5` per pass and `TRIES = 3` / `rec.get("plan")` / `rec.get("closed")` / `rec.get("kept")` in `store` `kv` persist across restarts so neither `fix()` nor `close_gaps()` loops infinitely on the same issue.)*

## Impact and severity

- **Severity:** `high`
- **Impact:** `labelcheck.close_gaps` automatically closes legitimate, unaddressed `"Gaps of #<parent>:"` issues as `"not planned"` whenever the older gap issue has `**Repairs**: none` or repairs a different bug on the same child number.

## Proposed fix

- **Smallest causal change (`tools/factory/labelcheck.py`):**
  1. In `covered(gh, repo, dup, n)` (`tools/factory/labelcheck.py:95-102`), refuse automatic closure when `old_repairs` is empty (`if not old_repairs: return "it has no **Repairs** numbers to compare"`), and also require either normalized gap titles/headings to match or an explicit `Supersedes #%d` marker written by the acceptor before closing an older gap issue.
  2. In `busy(n, data)` (`tools/factory/labelcheck.py:83-88`), also check `(data["kv"].get("recheck:%d" % n) or {}).get("state") in ("sending", "running")`, `(data["kv"].get("classify:%d" % n) or {}).get("state") == "running"`, and pass `issues` into `close_gaps` so any open issue referencing `Part of #%d` marks `n` busy.
- **Must not break:** Closing genuine duplicate gap issues filed when an acceptor re-runs on the exact same unmerged child repair set (`test_labelcheck.py`).
- **Failing test that proves the fix:**
  - **File:** `tools/factory/test_labelcheck.py`
  - **Test name:** `test_close_gaps_keeps_older_gap_issue_when_repairs_is_none`
  - **Assertion:** Create open issue `#10` (`Gaps of #1: first`, body `**Part of**: #1\n**Repairs**: none`) and `#11` (`Gaps of #1: second`, body `**Part of**: #1\n**Repairs**: #2`); run `close_gaps` twice and assert `#10` is **not** closed (`did == "left open: ..."` and `store.get_all("gapclose:10")["kept"] == "1"`).
- **Alternative fix and trade-off:** Have `acceptance.py` update/append to an existing open `Gaps of #<parent>:` issue instead of creating a second gap issue, removing the need for heuristic post-hoc duplicate gap closure altogether.

## Confidence

`proven`
