<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Rerun — Web UI for rerun-engine

## Vision

Interface web moderne pour **rerun-engine** : un moteur d'agents IA autonomes, auto-hébergeable, exposé via une API HTTP (voir `apps/engine`). Rerun lui donne une UI riche et visuelle (grille isométrique).

## Architecture

```
┌─────────────────────────────────────────────┐
│  Rerun Web UI (Next.js)                     │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │  Isometric Grid                     │    │
│  │                                     │    │
│  │  ┌─────────┐  ┌─────────┐          │    │
│  │  │  Box A  │  │  Box B  │  ...      │    │
│  │  └─────────┘  └─────────┘          │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────┐
│  1 workspace = 1 machine (rerun-engine)     │
│  engine_pool.claimed_by_workspace_id        │
│                                             │
│  ┌───────────────────────────────────┐      │
│  │  Agents (adressés par /agents/:id)│      │
│  │  ┌─────────┐ ┌─────────┐         │      │
│  │  │ Agent 1 │ │ Agent 2 │  ...     │      │
│  │  └─────────┘ └─────────┘         │      │
│  │       │                           │      │
│  │       ▼                           │      │
│  │  Sessions (conversations)         │      │
│  │  File management                  │      │
│  │  Task assignment                  │      │
│  └───────────────────────────────────┘      │
└─────────────────────────────────────────────┘
```

## Labs et UI kit

Les labs de composants (`/render/lab/*`) et la galerie du UI kit (`/render/kit`) vivent dans l'app
admin de Rerun Cloud (`cloud/apps/admin`, privée), qui tourne sur les sources de cette app :
`pnpm --dir cloud/apps/admin dev` (port `ADMIN_PORT`, 3052 par défaut). Les labs y répondent 404 sur
un hôte déployé sans le jeton `BRAND_GATE_TOKEN` (`?key=<jeton>` une fois, puis le cookie).

## Staging sous mot de passe

Quand `STAGING_PASSWORD` est défini (seulement sur l'app de staging de Dokploy), `proxy.ts`
répond `401` en Basic Auth sur toute page tant que le mot de passe n'est pas fourni, le nom
d'utilisateur est libre. `/api/*` et `/ingest/*` restent ouverts, comme tout ce qui est hors du
matcher : un webhook ou une box n'a pas de popup, et ces routes s'authentifient elles-mêmes. Sans la
variable (prod, local), la porte n'existe pas. Logique dans `lib/staging-gate.ts`.

## Concepts clés

| Concept       | Description                                                                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Workspace** | Le compte. Il tient le plan, les membres, et **la machine** : une par workspace, dans `engine_pool.claimed_by_workspace_id` (service-role).    |
| **Machine**   | L'instance rerun-engine du workspace, atteinte via `engine_pool.engine_host` + `engine_api_key`. Toute porte dessus passe par `workspace-engine.service.ts`. |
| **Box**       | Un rectangle sur la grille iso, qui regroupe les agents par équipe, client ou projet. Ni machine, ni cloison : gratuite, instantanée, illimitée. |
| **Agent**     | Un agent du workspace, adressé par `/agents/:id` sur l'engine. Personnalité (SOUL), skills, mémoire propres. Il se déplace d'une Box à l'autre sans rien perdre. |
| **Session**   | Conversation avec un Agent. Historique persistant côté engine (`engine_session_id`), contexte maintenu.                                        |
| **Files**     | Le dossier partagé du **workspace**, commun à tous ses agents quelle que soit leur Box. Chaque agent a en plus le sien.                        |

> **Une Box n'est pas une machine.** `spaces` ne porte qu'un rectangle et un nom ; l'hôte, la clé et
> l'instance du pool sont sur `engine_pool`. Tout ce qui touche à l'hébergement, l'isolation, les
> credentials, le dossier et la base partagés appartient à la machine du workspace, jamais à une Box.

> **Wording vs code** : le concept s'appelle **Box** partout dans l'UI, mais le code garde `spaces` / `space_id` / `Space*` (table, colonnes, routes, composants). Ne renomme pas le technique.

## Stack

- **Frontend**: Next.js, isometric grid UI
- **Backend**: Supabase (auth, DB, realtime)
- **Agents**: rerun-engine (HTTP), self-hostable — voir `apps/engine`
