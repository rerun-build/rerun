# Ideas taken from other projects

As of 2026-11-19. On 2026-11-19 Rob handed over eight outside projects and one guide ("Five Agent Orchestration Patterns for an Autonomous Software Factory") to analyse. His ruling: "we go our own way". No outside code or plugin is installed; each idea worth having is rebuilt in our own code, and every one is measured before it stays. This file is the one place those ideas live: future work on them starts here.

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
| 11 | Two competing plans for large issues, scored by the review panel | the patterns guide (Best-of-N) | later | planning |
| 12 | A review finding is checked against the code before it starts a fix round | the patterns guide (specialist review) | later | review station |
| 13 | Prebuilt, role-specific packets for the fetches coworkers repeat | code mode's principle, worked through with ChatGPT | next, after 5 | dispatcher packets |
| 14 | Find content a run receives twice (brief, packet, files, earlier turns) | ChatGPT review of this file | next, after 13 | factory measurements |
| 15 | Model and effort per station decided by our own outcomes, with rework cost by cause | ChatGPT review of this file | later | factory measurements, tiers |
| 16 | A small fixed replay set to compare factory changes on the same tasks | ChatGPT review of this file | later | factory evaluation |

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
- **Three numbers, not one:** total input tokens, cached against uncached input, and the money each costs (cached input is billed at a fraction of the price). A million cached tokens can cost less than a much smaller uncached source; cuts are ranked by money, not by token count. `fires` already keeps `tokens_in`, `tokens_out` and `cache_read` per run (`tools/factory/tokenstats.py`).

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
- **Published data is the starting guess, not the authority:** once idea 15 has enough runs, the factory's own cost per accepted issue per station decides; public benchmarks only seed a station that has no runs yet.

## 9. Frugal's rules for the other stations (later)

- **Waits on:** the result of the planner trial (idea 3). If plans get cheaper without getting worse, the same rules go into the cut, build, review and proof briefs one station at a time, each measured the same way.

## 10. One script calling many tools, for product coworkers (later)

- **What:** UTCP code-mode (MPL-2.0) gives an agent one tool that runs a TypeScript script calling all its connected tools, and returns only the result.
- **Ours:** the engine already has the discovery half (`mcp_search`, `mcp_call`, loading only the tools a task needs). The other half helps Moldwright users whose coworkers have many connected apps; the factory measured almost no tool-server calls in its own runs (0.0% of 382 engine-loop calls), so it is a product feature, not a factory one.
- **Condition:** model-written scripts run inside the coworker's own box, never in the engine process. That library's "sandbox" is Node's `vm` module, which does not isolate code safely.

## 11. Two competing plans for large issues (later)

- **What:** the guide's Best-of-N: several independent candidates, compared against the same written criteria, the strongest kept, or all rejected.
- **Ours today:** one planner writes one plan; the review panel (LESLIE failure, ADA structure, BARBARA goal) reads it independently, in dry mode.
- **Change:** for an issue sized large, or a plan that names a design choice, two planners write plans without seeing each other's; the panel scores both against one list (correctness, reliability, complexity, operations, cost, fit) and the better one goes to the cut. Never for routine issues: it costs a second plan run.
- **Measure:** plan review notes and the rework of the children built from it, against single-plan issues of the same size.

## 12. A review finding is checked before it starts a fix round (later)

- **What:** the guide's specialist review: a finding is not a confirmed defect until it is checked against the code; false ones are dropped before they cause rework.
- **Ours today:** a reviewer's findings go straight to the builder as a fix round.
- **Change:** a cheap model (Haiku or Sonnet) confirms each finding against the diff and the code, with the line that proves it, before the fix round is sent; unconfirmed findings are recorded, not sent.
- **Measure:** fix rounds per green issue (1.4 build and fix runs per green issue on 2026-11-19, threshold 1.3) and findings dropped as unconfirmed.
- **Two outcomes kept apart:** a finding shown false (the code proves it wrong) and a finding not confirmed (no proof either way). Only false ones count against the reviewer; unconfirmed ones are kept and looked at again if the same spot fails later.

## 13. Prebuilt, role-specific packets (next, after idea 5)

- **The principle taken from code mode:** move repeated preparation out of the model's turns and into deterministic code. Scripting tool calls inside a run is not the lever for us: coworkers make almost no tool-server calls (0.0% of 382 engine-loop calls, `docs/research/2026-11-19-code-mode/BASELINE.md`), and most input is re-reading (95-96% cached). A packet the dispatcher prepares in Python before the run removes fetches the coworker would otherwise make step by step, each one re-read on every later step.
- **Ours today:** `tools/factory/packet.py` (`retry_packet`: a failed run's output, cut to a budget, for the next try), `tools/factory/reviewpacket.py` (`review_diff`: the diff from git for the reviewer), and #1580 (open: "the packet hands over the dev code inside one budget"). Plan freshness is already checked against dev by the recheck (`FRESH:` or `CORRECTED:` with the dev commit).
- **Change:** idea 5 names the fetches coworkers repeat most and their token cost; each one worth it moves into a packet, built per role, never one large dump:
  - builder: the task, its asks and done-test, the code it names at the dev commit, its limits;
  - reviewer: the diff, the asks, the CI results for that exact commit, the code around the change;
  - prover: what must be proven and the evidence the dispatcher collected itself.
- **Freshness:** every packet names what it was built from (dev commit, pull request head, issue edit time); a packet whose source moved is rebuilt, never reused. A packet only carries facts the dispatcher read itself, with their source; it never states that something passed.
- **Measure:** per role, input tokens and steps per run before and after, and the repeated fetches idea 5 counted; keep a packet part only if runs get cheaper without more fix rounds.

## 14. Content a run receives twice (next, after idea 13)

- **What:** a coworker's input comes through several channels: the engine's system prompt, the factory brief, packets, files read through shell commands, and earlier turns. The same text can arrive through two of them, and every later step re-reads it.
- **Change:** a diagnostic over recent runs that finds text repeated across those channels, names each source and its token size, and separates repetition that must stay (critical rules the coworker has to see) from accidental duplication (the same code or issue text in a packet and again from a shell read).
- **Measure:** duplicate input tokens per run, and the cost of the run, before and after removing the accidental ones; no drop in quality allowed.

## 15. Model and effort per station from our own outcomes (later)

- **What:** public benchmarks cannot tell which model is best at our stations on our code. The deciding number is cost per accepted issue, per station, not cost per token or a benchmark score.
- **Ours today:** the data mostly exists. `fires` keeps tokens and cache reads per run with model and thinking level; `failures` keeps each failure's station, coworker, model, tier, plan run and brief; `changes` keeps the before and after verdict of each change the factory makes to itself; `tools/factory/causes.py` names failure causes.
- **Change:** one report per station and model (and thinking level): runs, cost, fix rounds, review findings, acceptance and time to green. Included: rework cost per accepted issue split by its cause and the station it started at (an incomplete plan, a missed ask, a build fault, a false review finding, a test environment problem, a stale packet), so a good builder handed poor plans is not mistaken for a weak builder.
- **Decision rule:** a station's model changes only when its cost per accepted issue is better over enough runs; idea 8's published data only seeds stations with no history.

## 16. A small fixed replay set (later)

- **What:** comparing a change against recent production runs is noisy: the tasks differ, so a cheaper setting may just have had easier work.
- **Change:** a handful of past tasks with a fixed starting commit, the original asks, known acceptance and a reproducible test setup. A significant change (rules, models, effort, packets, review) runs the same set before and after, compared on cost per accepted result, correctness, fix rounds, wrong acceptances, wrong rejections and time.
- **Limit:** a separate evaluation run on demand, never a stage in every job; it costs model runs, so it is used for changes big enough to matter.

## Order of work

From the ChatGPT review of this file (2026-11-20), checked against the factory's data: idea 5 (where the waste is, in money), 13 (packets that remove it), 3 (finish the planner trial), 14 (duplication), 15 (station choice from our outcomes), 12 and 7 (review), 16 (replay set). Nothing new is added to this list until some of these have results.

One line kept from that review: the factory may change its own code through the normal controls (review, tests, CI, merge rules); the rules agents operate under (the `CLAUDE.md` files, the constitution, the gates themselves) change only by the owner. Automatic improvement of the factory is allowed; automatic loosening of its governing rules is not.

## The guide, mapped to the factory

As of 2026-11-19, the factory already runs builder and verifier separation (builder never reviews its own work, prover is not the reviewer, BARBARA accepts against the original asks, CI and "Done-test red before green" on the real commit, required last lines `PR:`, `VERDICT:`, `PROOF:`), independent lanes (the cut's Files, Depends on and worker per child, path leases, CI on dev as integration), a plan review panel close to a council, specialist review (LINUS, BRUCE; risk routing queued as #1587), explicit states (`tools/factory/states.py`, the registry), evidence in the ledger, failure handling (timeouts, bounded retries, failure causes, the resolver, dev red self-heal) and cost per green issue in the digest. Its gaps are ideas 11 and 12, idea 7, and coworker shell commands running in the engine's container (recorded under secure-claude-code below).

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
