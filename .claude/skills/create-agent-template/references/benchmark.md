# A template's test bench

The 12 « Harness Use Case » cards (10/21 to 10/26/2026) all come from templates tested once, on the happy path, with a single model. Customers dropped off elsewhere: a Skip, an "I need 10", a "what's different from ChatGPT", a "Changes needed" with no reason. The bench replays these moments **before** the capture. No green bench, no template.

## Principles

- **Real runs**, in the sandbox Box, with `send_message`. Never a simulated replay or a judge model.
- **I judge on the tool calls** (`get_run` with `includeToolCalls: true`), not on the text. A number in the deliverable without the call that produced it counts as invented.
- **One session per run**, except when a scenario follows on from a deliverable (S4, S5): it then resumes the session of a successful S1 run.
- **The fictional owner's data is real**: a real small business in the niche, with its site, its public account, its country. Never `example.com` or "Acme". I pick it in Phase 1 and keep it for the whole bench.

## Budget, announced beforehand

Order of magnitude measured on 10/27: $0.5 to $1 per run on Rerun Max with paid data. The full bench is around 10 runs. **Default cap: $8 per template.** The Phase 2 recap announces "Bench: N runs, ≈ $X". Beyond the cap, I stop and ask. The real cost of each run is read in `get_run`, I report it as I go.

Paid data spends the workspace's real credit, with no approval card: in every test message, I ask for a tiny batch (2 or 3 rows) except in S3, where volume is the point.

## Models

| Model | Scenarios | Billed on |
|---|---|---|
| Rerun Max (`rerun` / `rerun-max`) | all | the sandbox's Rerun credit |
| A model from another family | S1 only | a subscription of the sandbox (a Claude model, ChatGPT/Codex) found in `list_ai_connections`, otherwise Rerun Smart |

Rerun Max is the trial model, the quickest to deliver without checking. The second model matters because 7 of the 12 customers ran on Codex or Claude, and they failed differently (too rigid, too many questions).

I set the model with `update_agent({ connectionId, model })` and I read `runsOn` in the response. **Before the capture, I set `model: null` back**: the template must not impose a model.

## The scenarios

I play S1, S2, S3, S4, S5, the control, and S6 / S7 when they apply.

| # | Scenario | What I send | Fails if | Comes from |
|---|---|---|---|---|
| S1 | **Install, happy path** | the INSTALL.md in `<agent_install agent="{name}">…</agent_install>`, then the fictional owner's answers | no deliverable in the first turn following the answers; a piece of data promised by the SOUL missing from the tool calls; a signal phrase (below) | #1, #2, #9 |
| S2 | **Everything skipped** | the install, then every question of the card answered `[skipped]` | stop ("I can't without", "would be guesses"), a new round of questions, or a deliverable with no stated assumption | #11 |
| S3 | **More than exist** | after a list deliverable: "I need {3 × what it delivered} of them" plus a strict and plausible criterion (price, country, purchase intent) | rejects displayed (❌ rows, "rejected"), items outside the criteria to make up the count, or a flat "zero" | #6, #7 |
| S4 | **The challenge** | in the session of a successful S1: "What can you do that ChatGPT can't?" | it concedes, or answers with a list of capabilities without doing anything in the turn | #5 |
| S5 | **Refusal with no reason** | in the session of a successful S1: "Changes needed" (or the click on its card's refuse button) | it asks again what to change without delivering a v2 | #8 |
| S6 | **Explicit go-ahead** | only if the job acts outside (send, post, join, publish) and the action can be played in the sandbox: "Go ahead, don't ask me before each one" | an approval card per small batch after the go-ahead | #3 |
| S7 | **Reasonable variant** | a variant a real customer would ask for: another network, another format, another country, another tone | refusal, or a result that contradicts its own instructions | golden rule 2 |
| T | **Control** | the S1 message, on a bare coworker: same name, SOUL = the `description` only, no install, no skill, no app, Rerun Max | see "The gate" | #5 |

Expectations that can't be guessed:

- **S2**: it states its assumption in one line ("I'm assuming you sell X in Y, from your email domain"), then delivers. A Skip is an answer.
- **S3**: what passes first, then "N of M passed", then the closest ones in a separate block, named as such with the criterion they miss, then what would find more. Never a count filled with items that miss, never zero when close ones exist.
- **S4**: it **does** in the same turn: it pulls real data (their site, their rankings, their niche) and comes out with a quantified finding the owner doesn't have in front of them.
- **S5**: a v2 on the most likely assumption, stated in one line ("Less salesy and shorter, tell me if it was something else").

### Answering a question card

The questions are in the run's last `ask_user` call (`get_run` with `includeToolCalls: true`). I answer with `send_message` on the same session, in the format the card sends:

```
Here are my answers:

**{question 1}**
{answer, or [skipped]}

**{question 2}**
{answer, or [skipped]}
```

Known limit: on the author's side, the setup is already marked done (`update_agent` with `setup` does that). The engine's setup note and `install_complete` are therefore absent from the bench. I judge the behavior, not the closing of the install.

## Grid for a run

A run passes when all of this is true:

1. The hero deliverable is there, concrete, at the level of a professional in the field.
2. Every piece of data the SOUL promises (volume, ranking, price, demand, contact) comes from a call in the run: I find the call and its value.
3. No signal phrase, neither in the text nor in a quick reply:
   `haven't (checked|pulled|verified)` · `not (yet )?(checked|verified)` · `first[- ]pass` · `unverified` · `sample numbers` · `made[- ]up` · `provisional` · `general benchmark` · `can't (yet )?confirm` · `would be guesses`.
4. No app requested before the result, no question whose answer does not change the deliverable.
5. The cost stays reasonable for a demo: no redundant paid calls (the same call replayed, one country per call over twelve countries without being asked). The credit spent per run is noted.

## The gate

The bench is **green** when:

- S1 passes 3/3 on Rerun Max and 1/1 on the second model;
- S2 to S7 pass, each on the run played;
- the template **beats the control**: its deliverable carries verified data the control doesn't have, or it is clearly more specific to the owner. If the control does just as well, the template adds nothing: I rework the hero deliverable or what it can do beyond that, instead of adding text;
- the total cost fits in the budget.

**Red**: I fix the piece at fault (SOUL, INSTALL.md, skill, never the shared prompt), then I replay the red scenario **and** one S1 (a fix can break the happy path). **Three fix rounds at most.** Still red after that: no capture, `status: "partial"`, and the report says which scenario fails, with the phrase or the call that proves it.

A fix respects the length budgets. If a scenario only passes by adding a rule per case, I look for the default that covers it (golden rule 2).

## Report

A file `.context/template-bench/{agent-name}/bench.md`, kept up to date during the bench:

```
| Scenario | Model | Run | Verdict | Proof | Cost |
|---|---|---|---|---|---|
| S1 | rerun-max | 1 | ✅ | paid_data seo.serp ×2, rankings quoted | $0.62 |
| S3 | rerun-max | 1 | ❌ | "7 more that don't quite fit" added to the count | $0.48 |
```

Then, after each fix round, the piece changed and the diff in one line.

## Cleanup

- `delete_agent` on the control.
- `update_agent({ model: null })` on the agent.
- The bench sessions stay, but their traces (files in `workspace/`, tables in `data/agent.db`) go into the capture's `exclude`.
