# The fixed part of every step, measured per coworker

Issue #936 (part of #916). Read 2026-11-16 (UTC) on dev c815bbd and the live engine data. Docs only, no code changed.

## Summary

- A step re-sends the same block every time: the instructions, the tool definitions, the skills index and the memory index. Measured per step it is about 26k tokens for code, 34k for LINUS, 35k for BRUCE and 46k for Boss. (verified fit, see Method)
- Tool results are small next to it: about 0.4k to 1.3k tokens per step. The fixed part is about 65 times (code), 43 times (LINUS) and 29 times (BRUCE) a step's results, and about 40 times (Boss).
- Every run is 91% to 97% cached input, so the saving in money is smaller than the saving in tokens. Tokens below are input tokens re-sent.
- In the last 20 runs each coworker called only `shell_exec` (plus 1 `fs_edit` for code and 1 `shared_edit` for LINUS). No `skill_read`, no `call_agent`, no `web`, no `brain`, no `memory`, no EverOS call. (verified)
- Largest cut by saving per run: Boss (about 240k per run), then code (about 57k at 9.3 steps, if memory, brain, web, shared and EverOS go), then LINUS and BRUCE (about 36k to 37k).

## Method

- Source: the engine database of each coworker, `/data/agents/<id>/data/system.db`, tables `runs`, `run_steps`, `tool_calls`, read-only, 2026-11-16 about 14:30 UTC. The last 20 runs with status done of each coworker (verified).
- Tokens per run are the engine's own counts (`usage_json` and `team_get_run`): input tokens summed over the steps, cached input, output. Where no count exists (instruction text, skills, tool results) tokens are characters / 4 (said each time).
- The `run_steps` table holds one row per run, not per step, so a per-step input count does not exist. Fixed part per step is fitted: input per run = F x steps + G x steps x (steps - 1) / 2, least squares over 20 runs. F is the part re-sent every step, G the part each earlier step adds. The cheapest run (input / steps) is a verified upper bound for F.
- Tool definitions are not stored anywhere readable. Their size is an inference: the character volume of the same tool groups as listed in a coworker's prompt, / 4, plus or minus 50%. A cut must be measured once by running a coworker with the tools off.
- Not checked: the exact system text the engine adds (not stored); the prices of cached against fresh tokens; whether an engine feature needs a tool that was never called (for example `call_agent` for escalation); runs older than the last 20.

## code (general builder)

- Run read: `inmhst4gket9wqgtm8du0`, model claude-sonnet-5-5, 9 steps, input 228,549, cached 215,879, output 3,281. (verified, `team_get_run`) Per step 25.4k input.
- Last 20 runs: 20 done, mean 9.3 steps, mean input per run 254,783, cached share 95.2%. Fit F = 25.9k per step (about 241k of 255k per run is the fixed part, 95%), G = 0.2k. Cheapest run 23.9k per step (upper bound). (verified)
- Instructions: SOUL.md 9,305 characters = 2.3k tokens (chars / 4, verified). Skills: the skills tool is off, none listed (verified in config). Memory index: 3 memories, 2,440 characters = 0.6k tokens. Tools on: filesystem, shared, shell, web, memory, callAgent, brain, plus the EverOS server.
- Results: that run, 15,225 characters = 3.8k tokens, 0.4k per step. Last 20 runs: 280,139 characters = 70k tokens in 187 calls, 3.5k per run. (verified)
- Tools called in the last 20 runs: `shell_exec` 185, `fs_edit` 1, `shell_exec` (builtin name) 1. Never called: shared, web, memory, brain, callAgent, EverOS, every other filesystem tool. (verified)
- Prompt sections that do not apply to a builder on a plain chunk: "EverOS shared memory" 1,304 characters = 0.33k tokens (the prompt itself says to skip it on plain tasks). Kept: "Factory: how a chunk is built", "Waiting on CI", "Code tools".

## LINUS (code reviewer)

- Run read: `tbocjvg4ilzjnzappsexi`, claude-opus-5-5, 4 steps, input 129,432, cached 120,078, output 2,481. Per step 32.4k input. (verified)
- Last 20 runs: mean 4.3 steps, mean input 145,662 per run, cached 92.6%. Fit F = 34.4k per step (about 100% of the run), G about 0. Cheapest run 31.0k per step. (verified; the fit is inference)
- Instructions: SOUL.md 8,317 characters = 2.1k tokens. Skills index: 2 skills (`pr-review-and-land`, `read-only-review-evidence-discipline`), bodies 10,670 characters = 2.7k tokens that enter the context only when read. Memory index: none. Tools on: filesystem, shared, shell, web, memory, skills, callAgent, brain, EverOS.
- Results: that run 12,604 characters = 3.2k tokens, 0.8k per step. Last 20 runs: 254,583 characters = 63.6k tokens in 87 calls, 3.2k per run. (verified)
- Tools called: `shell_exec` 86, `shared_edit` 1. Never called: `skill_read` (0 in 20 runs, both skills unread), web, memory, brain, callAgent, EverOS, filesystem. (verified)
- Prompt sections that do not apply: "EverOS shared memory" 1,305 characters = 0.33k tokens.

## BRUCE (security reviewer)

- Run read: `8w9nj65czpzkq41ashuak`, claude-opus-5-5, 4 steps, input 134,710, cached 122,267, output 3,322. Per step 33.7k input. (verified)
- Last 20 runs: mean 4.2 steps, mean input 147,583 per run, cached 91.4%. Fit F = 34.9k per step. Cheapest run 31.2k per step. (verified; the fit is inference)
- Instructions: SOUL.md 7,779 characters = 1.9k tokens. Skills index: 4 skills (advisory-prep-checklist, read-only-review-evidence-discipline, secret-leak-response, security-triage), bodies 18,530 characters = 4.6k tokens, read 0 times in 20 runs. Memory index: none. Tools on as LINUS.
- Results: that run 18,802 characters = 4.7k tokens, 1.2k per step. Last 20 runs: 291,605 characters = 72.9k tokens in 84 calls, 3.6k per run. (verified)
- Tools called: `shell_exec` 84 only. Never called: `skill_read`, web, shared, memory, brain, callAgent, EverOS, filesystem. (verified)
- Prompt sections that do not apply: "EverOS shared memory" 1,305 characters = 0.33k tokens.

## Boss (orchestrator)

- Runs read: `yocnqaw2jginbx3ob85m3` (4 steps, input 198,176, cached 182,685, output 2,858; 49.5k per step) and `la97jvk0tjoyrqjbdcqrc` (32 steps, input 2,642,297, cached 2,519,910, output 59,721; 82.6k per step). Model in the runs: claude-opus-5-5, while the config names claude-fable-5-2. (verified)
- Last 20 runs: mean 21.1 steps, mean input 1,743,209 per run, cached 96.7%. Fit F = 45.5k per step (about 960k of 1.74M, 55%), G = 2.1k per earlier step, so the history grows and the rest of the cost is the context carried forward. Cheapest run 46.7k per step. (verified; the fit is inference)
- Instructions: SOUL.md 30,678 characters = 7.7k tokens, the largest (15 sections). Skills index: 5 skills, bodies 33,644 characters = 8.4k tokens (typesafe-ai alone 18,085), read 0 times. Memory index: 16 memories, 14,663 characters = 3.7k tokens. Tools on: filesystem, shared, shell, memory, skills, callAgent, team, aiProviders, notify, brain, EverOS.
- Results: run `yocnqaw2jginbx3ob85m3` 20,153 characters = 5.0k tokens, 1.3k per step; run `la97jvk0tjoyrqjbdcqrc` 131,539 characters = 32.9k tokens, 1.0k per step. Last 20 runs: 1,354,325 characters = 338k tokens in 421 calls, 16.9k per run. (verified)
- Tools called in 20 runs: `shell_exec` 421, nothing else. Never called: `call_agent` (the log shows none; Boss routes by it, so this needs a check of how the engine logs it before it is cut), team, aiProviders, notify, shared, filesystem, memory, skills, brain, EverOS. (verified for the log, inference for the reason)
- Prompt sections that do not apply: none clearly; "Jev, a second opinion" 2,041 characters = 0.5k tokens is advisory and rarely used (inference).

## Closing table

Token figures: tokens re-sent per step, saved per run = per step x mean steps (code 9.3, LINUS 4.3, BRUCE 4.2, Boss 21.1). Drop sizes are inferences (see Method) except instruction text (chars / 4). Fixed and results are verified.

| Coworker | Fixed part per step | Results per step | What to drop | Saved per step | Saved per run | Job to cut (Files) |
| --- | --- | --- | --- | --- | --- | --- |
| code | 25.9k (verified fit) | 0.4k (verified) | shared 1.1k, web 0.3k, memory 0.7k, brain 1.9k, EverOS tools 1.8k, EverOS section 0.3k (inference) | about 6.1k | about 57k | `/data/agents/3ttbky22c9mlghv0gge7y/config.json`, `/data/agents/3ttbky22c9mlghv0gge7y/SOUL.md` |
| LINUS | 34.4k (verified fit) | 0.8k (verified) | shared 1.1k, web 0.3k, memory 0.7k, brain 1.9k, skills tools 2.5k, EverOS tools 1.8k, EverOS section 0.3k (inference) | about 8.6k | about 37k | `/data/agents/u5i0q94iul40pwtpxxupx/config.json`, `/data/agents/u5i0q94iul40pwtpxxupx/SOUL.md` |
| BRUCE | 34.9k (verified fit) | 1.2k (verified) | same as LINUS (skills tools 2.5k; 4 skills never read) | about 8.6k | about 36k | `/data/agents/b331xgs9a1u0lv6m3wqts/config.json`, `/data/agents/b331xgs9a1u0lv6m3wqts/SOUL.md` |
| Boss | 45.5k (verified fit) | 1.0k to 1.3k (verified) | team 1.7k, aiProviders 0.5k, notify 0.4k, filesystem 0.9k, shared 1.1k, memory 0.7k, skills tools 2.5k, brain 1.9k, EverOS tools 1.8k (inference); keep callAgent | about 11.5k | about 243k | `/data/agents/7e5z0evmyvn3u8rqn5nt8/config.json` |

Notes for the next cut:

- The numbers to beat are the F column and the mean input per run: code 254.8k, LINUS 145.7k, BRUCE 147.6k, Boss 1,743.2k (verified, 20 runs each, 2026-11-16).
- A coworker's tool toggles live in each coworker's `config.json` under `tools` and `mcpServers`. Whether the engine reads a repo file for them, or only that file on the server, was not checked; the job that cuts must start there.
- To verify a cut, run one coworker with the tools off and refit F on the next 20 runs.
- Dropping `shared` from LINUS removes the tool used once for `shared_edit` (a HANDOFF line); the shell can append to the same file.
- Dropping `skills` removes the way to read a skill; the 2 to 5 skills per coworker were never read in 20 runs, so their text could instead move into SOUL.md only if a rule in them is needed on every run (not checked).
