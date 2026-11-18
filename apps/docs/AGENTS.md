# Rerun documentation instructions

## About this project

- Public documentation for Rerun, built on [Mintlify](https://mintlify.com) and living in `apps/docs` of the public `rerun-build/rerun` repository
- Pages are MDX files with YAML frontmatter, configuration lives in `docs.json`
- A page only appears on the site once it is listed in `docs.json` navigation
- Preview locally with `pnpm dev:docs` from the repo root
- For Mintlify product knowledge (components, configuration), use the docs MCP server `https://www.mintlify.com/docs/mcp`
- Coworkers and the Chief of Staff answer customers out of the deployed site (`/llms-full.txt`), so a stale page is a wrong answer. Every change to the product updates its pages in the same pull request: follow the `update-docs` skill (`.claude/skills/update-docs/SKILL.md`)
- Check with `pnpm check:docs` (validation and broken links)

## Terminology

- Box: a room of the workspace that groups agents by team, client or project, not "Space", "project" or "server". It is free, instant and unlimited, and it is not a machine. The code and the API say `space` (`list_spaces`, `space_db_query`), the product says Box
- Machine: the private computer in the cloud a workspace runs on, one per workspace, shared by every agent and every Box inside it. Anything about hosting, isolation, credentials or the shared folder and database belongs to the machine, never to a Box
- Agent: an autonomous worker inside a Box
- App: an integration with an external service, not "plugin" or "connector". The code and the API say `connector` (`attach_connector`), the product says App
- Run: one execution of an agent
- Template: a packaged agent setup installable from the marketplace

## Style preferences

- Write in English
- Never use em dashes
- Use active voice and second person ("you")
- Keep sentences concise, one idea per sentence
- Use sentence case for headings
- Bold for UI elements: Click **Settings**
- Code formatting for file names, commands, paths, and code references

## Accuracy

- Every default, bound and limit quoted in a page comes from the code, never from memory. Read the source before writing a number
- Tool parameters mirror `apps/ui/lib/mcp/account-tools.ts` and `apps/ui/lib/mcp/template-tools.ts`
- Prices and plan contents mirror `packages/contracts/src/billing.ts` and `packages/contracts/src/template.ts`

## Media

Screenshots and short loops show the screen where a picture says it faster than a paragraph: a dialog, a card, a gesture. Not every page needs one.

- The text stays complete without the media: the Chief of Staff reads `/llms-full.txt` and never sees an image, so a step, a label or a number that only lives in a picture is lost to it
- Use the components of `/snippets/media.jsx`, never a raw `<img>`, `<video>` or `![]()`:

```mdx
import { Shot, Loop } from '/snippets/media.jsx'

<Shot src="/images/vault/secret-form" alt="The masked form a coworker opens to ask for an API key" />
<Loop src="/images/agents/approve-action" alt="Approving an action a coworker paused on" caption="Approve, and the run picks up where it stopped." />
```

- `src` names the media without its extension, under `images/<page>/`. `<Shot>` reads `<src>.light.webp` and `<src>.dark.webp`; `<Loop>` reads `<src>.light.mp4`, `<src>.dark.mp4` and a `.webp` poster for each theme
- `alt` says what the media shows. `caption` is optional and short
- A capture frames one element (the dialog, the panel, the card), not the whole screen, in light and dark
- A loop is silent, under 15 seconds, and shows one gesture
- Budgets: a `.webp` under 300 KB, an `.mp4` under 3 MB
- Only demo data: no real customer, email, key or machine name, the repository is public
- A media that no page shows any more is deleted with the screen it captured
- `pnpm check:docs` checks all of the above except the content of the pictures

## Content boundaries

- Document the product as a user sees it: Boxes, agents, apps, triggers, templates, billing
- Never document the `/admin` back office, internal scripts, or infrastructure topology
- Never include API keys, tokens, engine IPs, or Supabase project references
