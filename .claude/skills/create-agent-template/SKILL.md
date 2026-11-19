---
name: create-agent-template
description: Create, from a topic ("an agent that makes TikTok carousels" / « un agent qui fait des carrousels TikTok », "copy ads" / « copier des pubs », "find leads" / « trouver des leads »), a lead-magnet-quality Rerun coworker and its private template draft, with a short interview in blocks with recommended defaults (apps from the service catalog, paid data, computer use, how tightly the process is framed, install depth), a full build through the Rerun MCP (SOUL, short INSTALL.md, skill, schedule), a test bench of real runs on the situations where customers dropped off (Skip, "I need 10", ChatGPT challenge, refusal with no reason) against a control coworker, and a capture as a draft only if the bench is green. Use whenever someone wants to create / generate / prepare an agent template, an agent for the marketplace, a lead magnet agent, or turn an agent idea into a Rerun template.
---

# Create a Rerun agent template (lead magnet)

I am given a topic. I turn it into **a coworker that delivers a real result from the first conversation**, then a **private template draft**, which only goes to capture after a **green test bench**. I ask few questions, always with my recommendation, and I leave the agent free to adapt to each owner.

I talk to the user in their language; **everything I write in Rerun is in English** (SOUL, INSTALL.md, skill, schedule, template page). The agent replies in its user's language anyway.

## The three golden rules

1. **As little text as possible, in the right place.** The engine already injects into every system prompt the install order, how to use the catalog, paid data, computer use, memory, the language. I write **only what is specific to the job**. Everything I repeat dilutes the rest. See `references/capabilities.md` § "What the engine already says".
2. **Defaults, not rules.** I describe what an excellent deliverable has in common, not a fixed procedure. No invented threshold, score, schema, provider or policy. Openness test before every write: *"if the owner asks for a reasonable variant (another network, another format, another tone), can the agent do it without contradicting its instructions?"* If not, I loosen.
3. **Result first, and a real one.** A new owner's first message contains a concrete deliverable, built on their data or on real public data (their site, their public account, their niche, paid data), never on sample numbers: a customer takes a realistic example for an analysis of their own account. That first deliverable already contains what the SOUL promises (volumes, rankings, prices, demand); a "first pass" that announces the checking for later is a failure. Any question or app that does not change this deliverable waits, and a skipped question (Skip) is replaced by a stated assumption, never by a stop.

## Length budgets

| Piece | Budget |
|---|---|
| Agent `description` | 1 sentence, about the result |
| `SOUL.md` | ≤ 120 words |
| `INSTALL.md` | Express ≤ 80 words · Standard ≤ 150 · Guided ≤ 250 |
| Agent skill | Guided ≤ 350 words · Framed ≤ 600 |
| Schedule body | ≤ 60 words |

I count the words (`wc -w` on a file in `.context/`) before sending. Over budget, I cut, I don't negotiate.

## Phase 0: Preflight (without asking anything)

1. The `mcp__rerun__*` tools must exist. Otherwise I stop and give the command:
   `claude mcp add --transport http rerun https://moldwright.robagentic.tech/api/mcp/account --header "Authorization: Bearer rk_…"`, with the key of an **expert account** (docs: `apps/docs/api/connect.mdx`).
2. `list_capture_sources` → the sandbox Box where the agent is created. Capture only accepts coworkers from an expert account's sandbox: I never create anywhere else.
3. `list_templates` and `list_agents` on that Box → if a draft or an agent already exists for this topic, I pick it up instead of creating a second one. I never touch a template that is `in_review`, `published`, `unlisted` or `archived`.

## Phase 1: Silent research

Before any question, I prepare my recommendations (details: `references/interview.md` § "Pre-computation"):

- I reduce the topic to **one hero deliverable** (the object produced: a 7-slide carousel, a list of 50 qualified leads, a swipe file of ads), an **audience** (the template's category), a likely **trigger**, and where the job **lands** (file, app, site);
- `search_connectors` **one capability at a time** (what it reads, what it does, where it writes), short queries, then `list_connectors` by category before concluding there is nothing;
- I decide whether **paid data** is useful (which groups) and whether **computer use** is useful (a site with no official connector on the deliverable's path), grid in `references/capabilities.md`;
- I pick the bench's **fictional owner**: a real small business in the niche, with its site and its country, never `example.com`.

## Phase 2: Interview in blocks

`AskUserQuestion`, **2 rounds, 3 at most, ≤ 4 questions per round, ≤ 12 questions in total.** Each question: my recommended option first, suffixed "(Recommended)", a one-line description saying what the choice changes. I never ask a question whose answer changes nothing in the build. Question bank and wording: `references/interview.md`.

- **Round 1: the job and the two dials**: promise / deliverable · trigger · **process framing** (Open / Guided / Framed) · **install depth** (Express / Standard / Guided).
- **Round 2: the capabilities**: catalog apps (multiSelect, or none declared) · paid data · computer use.
- **Round 3, only if useful**: outgoing actions that need approval, a real business constraint, price if paid.

Then I show a **half-page brief** and wait for an explicit OK before writing anything in Rerun:

```
Agent: {name}, {description}
Hero deliverable: {…}           Trigger: {…}
Framing: {Open|Guided|Framed}   Install: {Express|Standard|Guided}
Declared apps: {slug → role}    Tools turned off: {computer, paidData | none}
Skill: {name + 1 line | none}   Schedule: {cron + timezone | none}
Bench owner: {real business, site, country}
Bench: {scenarios played, S6/S7 yes|no} · {N runs} · ≈ ${X} (cap $8)
Marketplace title: {…}          Category: {…}
```

## Phase 3: Build

Templates and good / bad examples: `references/writing.md`. Two complete examples: `examples/tiktok-carousel.md` (Guided, Express, computer use) and `examples/lead-finder.md` (Framed, Standard, paid data, schedule).

1. **`create_agent`** in the sandbox Box:
   - `name`, `description`, `soul`, `connectors` (validated slugs);
   - `setup: { required: true, prompt: <INSTALL.md> }`; `required: false` only if the agent does all its work with the user's messages and files, without any lasting preference or app;
   - `tools`: **I only pass what I turn off** (every family is `true` by default): in practice `computer` and `paidData` depending on the interview. I never turn off `hub` or `suggestService`: without them the install cannot get anything connected. I leave `selfImprovement` at its default.
2. **Agent skill** depending on the framing: `upsert_skill`, none in Open, one in Guided or Framed, two at most if the topic contains two truly distinct jobs. Its `description` is a **trigger condition** ("Use when asked for…").
3. **Schedule**, only if the trigger is recurring: `upsert_schedule` with **`enabled: false`** (it must not run in the sandbox; `install_complete` turns it on at the owner's). Cron and timezone are defaults that the INSTALL.md has the owner confirm.
4. **Check**: `get_agent` (SOUL, setup, tools, skills, schedules) and `list_agent_connectors`. `needs_auth` / `needs_config` is the normal state of an app declared in a template; I never ask for a credential.

## Phase 4: Test bench, then capture

Full protocol, scenarios and grid: `references/benchmark.md`. **No green bench, no capture.**

1. **Bench.** I play on the sandbox Box, with the brief's fictional owner:
   - **S1** install, happy path: 3 runs on Rerun Max, 1 on a model from another family;
   - **S2** everything skipped (`[skipped]`) · **S3** "I need 3× more" with a strict criterion · **S4** "What can you do that ChatGPT can't?" · **S5** "Changes needed" with no reason;
   - **S6** explicit go-ahead and **S7** reasonable variant when they apply;
   - **T**, the control: the same request on a bare coworker (the `description` as SOUL, nothing else).
2. **Judgment** run by run on the tool calls (`get_run` with `includeToolCalls: true`), with the grid from `references/benchmark.md`. I keep `.context/template-bench/{agent}/bench.md` up to date, cost included.
3. **Gate**: S1 4/4, every other scenario played passes, the template beats the control, the cost fits in the announced budget. Red → I fix the piece at fault (SOUL, INSTALL.md or skill) with `update_agent` / `upsert_skill`, then I replay the red scenario and one S1. **Three rounds at most**; still red, I don't capture and I move to the report as `partial`.
4. **Cleanup**: `delete_agent` on the control, `update_agent({ model: null })` on the agent.

**Template** (fields and rules: `references/listing.md`):

1. `create_template({ title })`. The slug derives from the title and will never change: I validate the title first.
2. `update_template`: `tagline`, `longDescription`, `category`, `tags`, `setupMinutes`, `faq` (4 to 6), `metaDescription` (120 to 155 characters), `pricingModel: "free"`, `priceAmountCents: 0` unless asked otherwise.
3. `plan_template_capture` → I read **every** warning and **every** path. The bench left traces: files in `workspace/`, tables in `data/agent.db`. `memory/` is excluded by default, `workspace/` and `data/agent.db` are **not**.
4. `capture_template_agents` with the same `setup` as the agent and an `exclude` covering every bench artifact (except a sample file I deliberately want to ship).
5. `get_template` → I read `submitChecklist` and `missing`.

**I never submit** (`submit_template`) in this skill.

## Phase 5: Report

A short summary for the human:

- what was created (agent, skill, schedule, draft) and the two dials chosen;
- the bench: the scenario × verdict table, an excerpt of the S1 deliverable next to the control, what each fix round changed, the total cost;
- what is missing to submit (the `get_template` checklist), and the cover image, recommended but not required;
- the suggested next step, **without launching it**: `rerun-image-from-agent-task` → `add_template_image`; after publication, `template-story <slug>` then `rerun-x-article`.

Then a JSON record:

```json
{
  "sourceIdea": "an agent that makes TikTok carousels",
  "status": "created",
  "agent": { "id": "...", "name": "Carousel Studio" },
  "template": { "id": "...", "title": "Create TikTok Carousels", "status": "draft" },
  "levels": { "process": "guided", "install": "express" },
  "tools": { "computer": true, "paidData": false },
  "connectors": [{ "slug": "...", "status": "needs_auth" }],
  "skills": ["carousel-craft"],
  "schedules": [],
  "bench": {
    "passed": true,
    "rounds": 1,
    "costUsd": 6.4,
    "scenarios": { "S1": "4/4", "S2": "1/1", "S3": "1/1", "S4": "1/1", "S5": "1/1", "S6": "n/a", "S7": "1/1", "control": "beaten" },
    "notes": "..."
  },
  "humanFollowUp": ["Add a cover image (recommended, not required to submit)"]
}
```

`status` is `created`, `reused` or `partial`. `template` is `null` if the capture failed or if the bench stayed red, and `humanFollowUp` says exactly what remains.
