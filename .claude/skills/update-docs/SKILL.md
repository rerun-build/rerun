---
name: update-docs
description: Keep the Rerun documentation in step with the code. From the diff of the branch, find every page a change makes wrong, missing or obsolete (the public site apps/docs, the READMEs, apps/engine/docs), then add, edit or delete them in the same pull request, with numbers read from the code. Use before calling any change done or opening a pull request when it touches apps/ui, apps/engine, packages/contracts, the English strings of packages/i18n, apps/mobile, apps/desktop-app, docker-compose.yml, .env.example or supabase/migrations, and when the user says "update the docs", "is the doc up to date", « mets à jour la doc », « la doc est à jour ? ».
---

# Docs follow the code

Reply in the user's language. Pages, READMEs and code stay in English.

The coworkers and the Chief of Staff answer customers out of docs.rerun.build: `rerun_hub_search_docs`
(`apps/engine/src/tools/builtin/hub.ts`) and the assistant's `search_docs` (`apps/ui/lib/foreman/search-docs.ts`)
read its `/llms-full.txt`. A page that lags behind the code is a wrong answer given to a customer, so the docs
change in the same pull request as the code, never as a follow-up.

The site deploys from `master` (`apps/docs/README.md`): the page and the code it describes ship in the same
release, so write what the branch does, not what production does today.

## 1. Read the diff

```sh
git fetch -q origin
git diff --stat origin/dev...
git diff origin/dev... -- packages/i18n/messages/en packages/contracts apps/ui/lib/mcp
```

List what a person can notice: a screen, a label, a button, a flow, a default, a limit, a price, a tool of the
MCP server, an engine route, an environment variable, a command, something removed.

Nothing a person can notice (a refactor, a test, an internal rename of code identifiers): say so in the pull
request and stop here.

## 2. Find the pages

Start from this map, then search: it is never complete.

| The diff touches | Pages to read |
| --- | --- |
| `packages/i18n/messages/en/*.json` (a label, a screen name) | every page quoting the old words: `rg -F "<old label>" apps/docs` |
| `apps/ui/lib/mcp/*-tools.ts`, `account-rpc.ts`, `import-scope.ts`, `mcp-*.service.ts` | `apps/docs/api/**`, the tool count in `api/introduction`, `api/connect`, `api/protocol`, `api/tools/templates` |
| `apps/ui/lib/mcp/api-keys.ts`, `api-keys.actions.ts`, `ee/lib/billing/entitlement.ts` | `api/authentication`, `api/limits`, `snippets/paid-plan-note.mdx` |
| `apps/ui/lib/triggers/*`, `app/api/t/**` | `api/webhooks`, `agents/automations` |
| `packages/contracts/src/billing.ts`, `apps/ui/ee/**` | `billing`, `teams` (seats), `templates/selling` |
| `packages/contracts/src/agent.ts` (capabilities, providers) | `agents/configure`, `api/tools/agents`, `self-host/models` |
| `packages/contracts/src/chat-hitl.ts`, `apps/engine/src/runtime/notify.ts` | `agents/human-in-the-loop` |
| `packages/contracts/src/template*.ts`, `apps/ui/lib/templates/**` | `templates/**`, `api/tools/templates`, `api/limits` |
| `packages/contracts/src/onboarding-intake.ts`, `apps/ui/lib/foreman/**`, `apps/ui/lib/onboarding/**` | `quickstart`, `concepts` |
| `apps/ui/lib/foreman/**`, `apps/ui/components/foreman/**`, `apps/ui/lib/onboarding/getting-started.ts`, `packages/i18n/messages/en/foreman.json` | `chief-of-staff`, `quickstart` |
| `apps/engine/src/brain/**`, `apps/engine/src/tools/builtin/brain.ts`, `apps/ui/components/brain/**`, `KnowledgeBaseDialog.tsx`, `packages/contracts/src/brain.ts`, `packages/i18n/messages/en/brain.json` | `brain` |
| `apps/engine/src/vault/**`, `apps/ui/components/vault/**`, `apps/ui/app/api/_services/vault*.service.ts`, `packages/contracts/src/vault.ts`, `packages/i18n/messages/en/vault.json` | `vault` |
| members, roles, Box access (`members.actions.ts`, `contracts/board.ts`) | `teams` |
| `process.env.*`, `.env.example`, `docker-compose.yml`, a Dockerfile | `self-host/configuration`, `self-host/install`, `INSTALL.md`, `README.md` |
| `apps/ui/cloud-oss/*` (the self-hosted behaviour) | `self-host/open-source-vs-cloud` and the self-host page of that domain |
| an engine route (`apps/engine/src/http/**`), a CLI command, the data-dir | `apps/engine/docs/API.md`, `apps/engine/README.md`, `apps/engine/docs/GUIDE.md` |
| `apps/desktop-app/**` | `desktop-app`, `self-host/desktop`, `apps/desktop-app/README.md` |
| `apps/mobile/**`, `apps/ui/app/api/v1/client` | `iphone-app`, `self-host/mobile` |
| a root or package script (`package.json`) | the README that documents it, `CONTRIBUTING.md`, `self-host/contributing` |
| `supabase/seed.sql` (the services catalog) | `self-host/services`, `agents/apps` |

Then search for what the diff removed or renamed, in the whole tree of docs:

```sh
rg -n -i "<old name>|<removed feature>" apps/docs README.md INSTALL.md CONTRIBUTING.md apps/*/README.md apps/engine/docs packages/*/README.md
```

And for the links of the app into the docs, which must land on a page and a heading that still exist:

```sh
rg -n "docsUrl\(|DocsLink|docs: '/" apps/ui --glob '!**/node_modules/**'
```

A heading becomes its anchor in lower case, spaces turned into hyphens, punctuation and backticks dropped,
underscores kept: `## A Rerun agent` is `#a-rerun-agent`, ``## `get_run` `` is `#get_run`. Renaming a heading
breaks every link to its old anchor, and `pnpm check:docs` does not catch it (it checks pages, not anchors):
search for the old anchor yourself.

## 3. Write

Follow `apps/docs/AGENTS.md`: its terminology (Box, App, coworker, Chief of Staff), its style (English, second
person, sentence case headings, **bold** for UI elements, no em dash) and its content boundaries (never the
`/admin` back office, infrastructure, keys or IPs).

- Read every number, default, bound, price and limit from the code, and every label from
  `packages/i18n/messages/en`. Never from memory, never from another page.
- Edit the page where a reader looks for the thing; a new feature with its own screen gets its own page.
- A new page is listed in `apps/docs/docs.json` navigation, or it does not appear on the site.
- A page that goes away gets a `redirects` entry in `docs.json` to the page that replaces it.
- A removed feature is removed, not marked "deprecated": the docs describe the product as it is.
- Self-hosted and Rerun Cloud behave differently through `@rerun/cloud/<domain>`: say which one a sentence
  is about when they differ.

## 4. Check

```sh
pnpm check:docs     # mint validate + mint broken-links, from apps/docs
```

Ask where to run it first, like every other check (the `tests-distants` rule). For a visible page, preview it
with `pnpm dev:docs` (http://localhost:3333) and look at it at mobile and desktop widths.

## 5. Report

In the pull request description, a **Docs** line: the pages added, edited or deleted, or why none needed to
change. In the final message, the same list.
