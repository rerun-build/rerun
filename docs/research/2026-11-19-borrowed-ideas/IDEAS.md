# Ideas taken from other projects

As of 2026-11-19. On 2026-11-19 Rob handed over eight outside projects to analyse. His ruling: "we go our own way". No outside code or plugin is installed; each idea worth having is rebuilt in our own code, and every one is measured before it stays. This file is the one place those ideas live: future work on them starts here.

Status words: **done** (merged), **trial** (live and being measured), **next** (decided, not built), **later** (decided, waits on something named), **not taken** (looked at, left out, with the reason).

## The list

| # | Idea | From | Status | Where |
|---|---|---|---|---|
| 1 | Code mode switched on for Claude Code coworkers | Claude Code's experimental code mode | done | #1618 |
| 2 | Claude Code CLI kept current inside the engine | (asked with 1) | done | #1618 |
| 3 | Working rules that keep a run small, in the planner's brief | frugal | trial | #1621 |
| 4 | A pull request may not add stubs or switch tests off | autopilot | done once #1622 merges | #1622 |
| 5 | Tokens each tool puts into a coworker's context, per tool | Code-Mode-MCP | next | factory measurements |
| 6 | Near the weekly plan limit, step stations down an effort level instead of stopping | modelplan | next | factory holds |
| 7 | A second reviewer from another model family, advisory | autopilot | next | review station |
| 8 | Station model and effort chosen from published ability and cost data | modelplan | later | dispatch.json tiers |
| 9 | Frugal's rules for the other stations (build, review, cut) | frugal | later | briefs |
| 10 | One script calling many tools, for product coworkers with many connected apps | UTCP code-mode | later | engine (product) |

## 1. Code mode for Claude Code coworkers (done, #1618)

- **What:** Claude Code can write one short script that calls its tools, instead of one model turn per tool call; only what the script prints comes back. Reported savings: 35 to 71% of tokens read on multi-step work.
- **Ours:** `CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=1` in `CLAUDE_HARNESS_ENV` (`apps/engine/src/agents/providers.ts`), the settings every Claude Code coworker run starts with.
- **Measured fact:** Claude Code 2.1.328 refuses it in headless runs (`claude -p`): "for now it only works in the interactive terminal". In JSON output the refusal is silent. So it changes nothing today and switches on by itself on the first release that allows headless use.
- **When it switches on:** tool calls may reach the engine as one script instead of single calls; check the factory's step and tool counts then.

## 2. Claude Code CLI kept current (done, #1618)

- Agent SDK pin in `pnpm-workspace.yaml` moved from 0.3.322 (Claude Code 2.1.322) to 0.3.327 (2.1.327): a security fix in decoding compressed responses, compaction and resume fixes for long runs.
- 0.3.328 was left out: under a day old, and pnpm's minimum release age would only take it with an exception written into the repo. The safety rule stays.
- Deployed 2026-11-19 22:09 UTC.

## 3. Working rules in the planner's brief (trial, #1621)

- **What:** frugal (MIT) measured, in headless `claude -p` runs on a 39-task benchmark, 38% lower cost than plain Claude Code on Opus 5.5 and 13% on Sonnet 5.5, with every check passed. Its point: most of the bill is re-reading input, so keep the context small and the calls few.
- **Ours:** `planning.RULES` (version `frugal-1`) in `tools/factory/planning.py`, appended to the plan brief when `planning.rules` is true in `tools/factory/dispatch.json`: batch independent calls; read a file once and never repeat a search; read line ranges, not whole files; skip calls whose answer cannot change the next step; write the plan briefly; keep names, numbers and every not, never and only exact. Each `plan:N` record keeps `rules` so plans with and without them can be told apart.
- **Why the planner first:** plan runs are the largest token user: 2,375,401 input tokens and 26 steps per run on average, 96.3% cached (`docs/research/2026-11-19-code-mode/BASELINE.md`).
- **Keep or drop:** after about ten plans, compare input tokens and steps per plan run with that baseline, and the plan reviews' notes. Off is `"rules": false`.
- **Left out of frugal:** its "secondary accounts" mode, which spreads work over other Claude, Codex and Grok logins to stretch usage limits; that is a terms-of-service risk.

## 4. No stubs or switched-off tests (done once #1622 merges)

- **What:** autopilot's quality gate scans finished work for stubs and TODOs before it counts as done.
- **Ours:** `scripts/no-stubs/check.py` with `.github/workflows/no-stubs.yml`. It reads only the lines a pull request adds and fails on `NotImplementedError`, `todo!()`, `unimplemented!()`, "not implemented", unconditional skips (`it.skip`, `xit`, `@unittest.skip`, `@pytest.mark.skip`) and focused tests (`.only`, which silently turns the rest of a file off). Conditional and runtime skips stay allowed. `TODO` notes are already refused by "No comments in code".
- **Measured:** over the 14 days of dev before 2026-11-19 it finds nothing; the only near-matches were five runtime `skipTest("no sh")`, which are allowed.
- The factory's checks step waits on every workflow, so this gates factory merges with no factory change.

## 5. Tokens per tool in a coworker's context (next)

- **What:** Code-Mode-MCP's usage screen lists which tools put the most tokens into the context (for example "playwright browser snapshot, 239 calls, about 358k tokens"). That is where to cut.
- **Ours:** add a per-tool breakdown to the factory's measurements, beside the per-job-type table of `BASELINE.md`: for each tool or shell program, calls and tokens of its results across recent coworker runs, read from the runs the engine already keeps.
- **Expected:** full issue bodies from `gh issue view`, whole-file reads and long `git diff` output near the top (a guess until measured). Then cap or trim the biggest in the engine or the briefs, and measure again.

## 6. Step down near the weekly limit instead of stopping (next)

- **What:** modelplan advises stepping a model's effort down when a usage window is tight and back up after the reset, instead of running out.
- **Ours today:** the factory's "plan week" hold stops sends when the weekly window is spent. On 2026-11-19 at 21:27 UTC the Claude weekly window stood at 92%, resetting 2026-11-23 10:00 UTC.
- **Change:** past a first threshold, stations move one effort or model step down (for example plan at a lower thinking level, builds on the cheaper model), and back after the reset; the stop stays as the last step. The window percentages come from the connection's `planLimits`, which the engine already reads.
- **Measure:** merges per day and the share of the week spent stopped, before and after.

## 7. A second reviewer from another model family (next)

- **What:** autopilot sends Claude's work to GPT, Gemini and others for review, since one model family shares one set of blind spots. It fits the factory rule never to trust a plan produced by a single agent.
- **Ours:** the workspace has an OpenRouter connection serving `openai/gpt-6.1-sol` and `google/gemini-3.8-flash`, with no sign-in needed. It is billed per token, unlike the Claude plan.
- **Trial:** one reviewer copy on a GPT model, advisory only (its verdict is recorded, it blocks nothing), on a sample of pull requests. Keep it if it finds real faults LINUS missed, at a cost worth paying; stop otherwise.

## 8. Station models and effort from published data (later)

- **What:** modelplan publishes, per model, the best-value effort and what one step up buys and costs (for example "+4.8 ability at ×1.37 cost"), from public benchmarks and official prices, through a free read-only API (`modelplan.ai/v1/client`, data under CC BY-SA, credit required).
- **Ours:** the factory picks a model and thinking level per station by hand in `tools/factory/dispatch.json`. A factory step could read that data and propose changes with the numbers behind them, as a pull request a person or the factory accepts.
- **Waits on:** idea 6, which uses the same model-and-effort steps.

## 9. Frugal's rules for the other stations (later)

- **Waits on:** the result of the planner trial (idea 3). If plans get cheaper without getting worse, the same rules go into the cut, build, review and proof briefs one station at a time, each measured the same way.

## 10. One script calling many tools, for product coworkers (later)

- **What:** UTCP code-mode (MPL-2.0) gives an agent one tool that runs a TypeScript script calling all its connected tools, and returns only the result.
- **Ours:** the engine already has the discovery half (`mcp_search`, `mcp_call`, loading only the tools a task needs). The other half helps Moldwright users whose coworkers have many connected apps; the factory measured almost no tool-server calls in its own runs (0.0% of 382 engine-loop calls), so it is a product feature, not a factory one.
- **Condition:** model-written scripts run inside the coworker's own box, never in the engine process. That library's "sandbox" is Node's `vm` module, which does not isolate code safely.

## Not taken

| Project | What it is | Why not |
|---|---|---|
| context-mode (mksglu) | Plugin with hooks that redirect large reads into a local index | The factory measured no read-only tool calls to bundle; overlaps Terminal Commander, SymForge and the engine's read caps; Elastic License 2.0 reserves hosted use, so it cannot ship in the product |
| UTCP code-mode, as a library | TypeScript library for scripted tool calls | Kept as idea 10 only; not installed |
| secure-claude-code (cberane) | Container that limits an autonomous Claude Code to one project folder, with an allow-list proxy | Analysis only, at Rob's word ("nah leave it"). Recorded finding: coworker shell commands run in the engine's container as its user, with no outbound limit |
| Code-Mode-MCP (DiegoT21) | JavaScript gateway that puts every tool server behind three tools | Its fair saving against deferred tool loading is 0 to 48% (Claude Code already defers tool definitions); one day old; its script runner is not a sandbox; it would hide the SymForge, Terminal Commander, EverOS and crawl4ai tool names our agents use. Kept as idea 5 only |
| autopilot (cookys) | Claude Code plugin: task routing, phase gates, close-out | Our factory already runs that pipeline. Kept as ideas 4 and 7 only |
| modelplan | Model and effort advice, quota reading; Swift and Go, Mac app | Kept as ideas 6 and 8 only |
| frugal | Low-token working rules for Claude Code | Kept as ideas 3 and 9; not installed on the owner's PC, where ponytail runs and the gain over it is about 6% on Opus |
