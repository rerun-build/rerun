# Rerun docs

Public documentation site, built with [Mintlify](https://mintlify.com) and deployed from this folder of the monorepo.

Mintlify is configured in monorepo mode on the public repository `rerun-build/rerun`, docs directory `/apps/docs`: every push to `master` that touches this folder redeploys the site. The Chief of Staff reads the deployed site (`/llms-full.txt`), not this folder, so a page it should know about is live only once `master` has it.

## Local preview

```bash
pnpm dev:docs
```

This runs the Mintlify CLI (`npx mint dev`) on http://localhost:3333, with hot reload on every save. The CLI is not a workspace dependency, so nothing here affects the pnpm lockfile or the app builds.

The CLI pulls in puppeteer. If its install fails on `chrome-headless-shell ... exists but the executable is missing`, delete the incomplete cache folder it names under `~/.cache/puppeteer` and rerun.

Search is disabled in local preview unless you run `npx mint login`. Everything else renders exactly like production.

## Structure

- `docs.json`: site config: name, colors, navigation (four tabs: Documentation, Templates, Self-hosting, API), navbar, footer
- `*.mdx`: pages, referenced by path (without extension) in `docs.json` navigation
- `agents/`: building and configuring a coworker
- `templates/`: installing, authoring and selling templates
- `self-host/`: running Rerun on your own server
- `api/`: the MCP server and the webhook endpoint, with `api/tools/` holding the tool reference
- `snippets/`: reusable MDX fragments, imported with `import X from '/snippets/x.mdx'`
- `logo/`, `favicon.svg`: brand assets
- `AGENTS.md`: instructions for agents editing the docs, with the `update-docs` skill (`.claude/skills/update-docs`) for keeping pages in step with the code
