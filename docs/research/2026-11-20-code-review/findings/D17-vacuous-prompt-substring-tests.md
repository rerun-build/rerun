# `D17`: Multiple Recent Factory Prompt Tests (`test_firstslice.py`, `test_dispatch_replanbrief.py`, `test_planning_rules.py`, `test_planning_brief.py`) Assert Only Substring Presence in Prompt Templates Rather Than Runtime Behavior

- **Finding:** While recent `apps/engine/` tests (`2026-11-17..2026-11-20`, including PR #1688's 13 test files, `providers.gaps.test.ts`, `schedule.gaps.test.ts`, `loop.labels.test.ts`, and `room-contract.test.ts`) genuinely exercise production parsers, HTTP fetchers, Zod boundaries, and runtime state, a recurring cluster of `tools/factory/` tests (`test_firstslice.py`, `test_dispatch_replanbrief.py`, `test_planning_rules.py`, `test_dispatch_buildasks.py:24-31`, `test_causes.py:76-95`) passes `red-green.yml` solely by asserting literal English prose substrings (`assertIn(SENTENCE, brief)`) or index ordering (`assertLess(text.index(A), text.index(B))`) inside prompt strings without exercising any parser, validator, or state transition.

## Evidence

- `tools/factory/test_firstslice.py:5-19`:
  ```python
  SENTENCE = "The first job of a feature crosses every layer"

  class FirstSlice(unittest.TestCase):
      def text(self):
          return planning.brief({"number": 9, "title": "t"}, "o/rerun")

      def test_rule(self):
          self.assertIn(SENTENCE, self.text())

      def test_order(self):
          text = self.text()
          self.assertIn(SENTENCE, text)
          self.assertLess(text.index(SENTENCE), text.index("Do not label a child"))
  ```
- `tools/factory/test_dispatch_replanbrief.py:6-17`:
  ```python
  class ReplanBrief(unittest.TestCase):
      def test_a_changed_run_line_is_written_inside_the_run_block(self):
          text = D.replan_brief({"issue": 5, "title": "T", "reason": "BLOCKED: x"}, "o/r", 1)
          self.assertIn("inside the `**Run**` block", text)
          self.assertIn("reads only that block", text)
  ```
- `tools/factory/test_planning_rules.py:21-23`:
  ```python
      def test_the_rules_keep_the_run_small_and_the_facts_exact(self):
          for words in ("Batch", "never read an unchanged file again", "not, never, only"):
              self.assertIn(words, planning.RULES)
  ```
- `apps/engine/src/runtime/curator.test.ts:22-27` (source-text regex test in engine):
  ```ts
  describe('the curator never writes a skill', () => {
      it('imports nothing from the skill loader but its summaries', () => {
          const source = readFileSync(new URL('./curator.ts', import.meta.url), 'utf8')
          expect(source).not.toMatch(/writeSkill|writeSkillFolder|writeSkillFile|deleteSkill|applySkillProposal|skill_(create|update|edit|propose)/)
  ```
- **Command / test run:** Inspected 27 test files across `tools/factory/` and `apps/engine/` (`git log --since="2026-11-17"` + full repo `assertIn`-only scan across `tools/factory/test_*.py` and `readFileSync` scan across `apps/engine/src/**/*.test.ts`).

## Trigger

How these tautological prose-echo tests pass `red-green.yml` (`tools/factory/redgreen.py:61-80`):
1. `redgreen.py` checks only whether checking out `base` (`HEAD^1`) for non-test files makes the PR's new test file fail (`exit != 0`) and keeping `HEAD` makes it pass (`exit == 0`).
2. When a PR adds a sentence `S` to a prompt string in `planning.py` or `dispatch.py` and adds a test `self.assertIn(S, planning.brief(...))`, `redgreen.py` restores `planning.py` from `dev` (which lacks sentence `S`), sees `AssertionError: S not found in ...` (`exit 1` -> "red"!), and passes the PR as "proven"!
3. In reality:
   - Deleting or breaking the actual enforcement (`plancheck.faults` checking whether slice 1 crosses layers or whether `**Run**` changed outside the code fence, or `Dispatcher.send` passing `planning.RULES` into the actual `account("send_message")` payload) leaves `test_firstslice.py`, `test_dispatch_replanbrief.py`, and `test_planning_rules.py:21-23` 100% green while pinning brittle English wording that breaks harmless copy edits.
   - Similarly, `curator.test.ts:22-27` regex-matches raw `curator.ts` source text (`not.toMatch(/writeSkill.../)`) instead of running `curateSession` against a skill directory and asserting the directory on disk is untouched (a behavioral invariant that cannot be bypassed by renaming a helper or indirecting an import).

## Impact and severity

- **Severity:** `low`
- **Impact:** Brittle wording-lock tests in `tools/factory/` create false confidence that `plancheck` / `dispatch` enforces invariants that exist only as English prompt sentences (directly contributing to `C15` and `C12` where prompt-only rules were assumed to hold at runtime!).

## Proposed fix

- **Smallest causal change (`tools/factory/test_firstslice.py`, `tools/factory/test_dispatch_replanbrief.py`, `tools/factory/test_planning_rules.py`, `apps/engine/src/runtime/curator.test.ts`):**
  1. Delete pure prose-wording tests (`test_firstslice.py`, `test_dispatch_replanbrief.py`, `test_planning_rules.py:test_the_rules_keep_the_run_small_and_the_facts_exact`, `test_causes.py:76-95` literal phrasing checks); keep only contract assertions on structured machine tokens that parsers consume (`PLAN READY`, `CUT:`, `BLOCKED:`, `ASK 1:`).
  2. Where the rule is behavioral (e.g. `replan` rejecting an updated `**Run**` outside a fenced block in `plancheck.faults`, or `Station.send` forwarding `rules` into `account("send_message")` and recording `kv["rules"] == RULES_V`, or `curateSession` leaving `skills/` unmodified on disk), test the behavioral function end-to-end.
- **Must not break:** `tools/factory` unittest discovery and `apps/engine` vitest suite.
- **Failing test that proves the fix:**
  - **File:** `tools/factory/test_planning_rules.py`
  - **Test name:** `test_station_send_includes_rules_only_when_configured_and_records_version_in_kv`
  - **Assertion:** Call `Station(cfg_with_rules, store, fake_account, fake_gh, now).send(ISSUE, ("a1", 1))` and assert `fake_account` received `planning.RULES` in `args["message"]` and `store.get_all("plan:7")["rules"] == planning.RULES_V` (testing `Station.send` wiring, not `assertIn("Batch", planning.RULES)`).
- **Alternative fix and trade-off:** Add an explicit `**Red before green**: not applicable (prompt wording only)` convention in `planning.py` for prompt-copy tweaks so builders aren't forced by `red-green.yml` to invent `assertIn("exact sentence", prompt)` tests just to turn `redgreen.py` red on `dev`.

## Confidence

`proven`
