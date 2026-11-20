# `B6c`: `/api/hub` Falls Back to Admin-Equivalent `workspaceActor` When `FOREMAN_HUB_TOKEN_SECRET` Is Unset and `team_hub` Bypasses Restricted Box (`space_access`) Boundaries

- **Finding:** Two box-isolation (`space_access`) bypasses exist in `/api/hub`: (1) when `FOREMAN_HUB_TOKEN_SECRET` is unset (not listed in `.env.example` or `docker-compose.yml`), `foremanHubTokenRequired()` returns `false` and `/api/hub` grants `x-rerun-agent: foreman` full `workspaceActor(engine.workspaceId)` admin access across restricted boxes; and (2) `dispatchTeamHubTool` always executes `team_status`, `team_list_runs`, and `team_get_run` as `workspaceActor(workspaceId)`, letting a coworker inside a restricted box read run outputs and schedules of coworkers in other private/restricted boxes.

## Evidence

- `apps/ui/lib/foreman/hub-token.ts:7-9,41-43`:
  ```ts
  function secret(): string | undefined {
      return process.env.FOREMAN_HUB_TOKEN_SECRET || undefined
  }
  ...
  export function foremanHubTokenRequired(): boolean {
      return secret() !== undefined && process.env.FOREMAN_HUB_TOKEN_REQUIRED !== '0'
  }
  ```
- `apps/ui/app/api/hub/route.ts:27-44`:
  ```ts
    const isForeman = engineAgentId === FOREMAN_AGENT_ID
    let foremanActor: Actor = workspaceActor(engine.workspaceId)
    if (isForeman) {
        const foremanToken = req.headers.get(FOREMAN_HUB_TOKEN_HEADER)
        if (foremanToken) {
            ...
        } else if (foremanHubTokenRequired()) {
            return new Response('Missing foreman token', { status: 403 })
        } else {
            console.warn('[hub] foreman call without token (tolerated)', { workspaceId: engine.workspaceId })
        }
    }
  ```
- `apps/ui/app/api/_auth/access.ts:42-44,50-52`:
  ```ts
  export function workspaceActor(workspaceId: number): Actor {
      return { kind: 'workspace', workspaceId }
  }
  ...
  export function isAdminActor(actor: Actor): boolean {
      return actor.kind === 'workspace' || actor.role === 'admin'
  }
  ```
- `apps/ui/app/api/_services/team-hub.service.ts:31-35`:
  ```ts
  export async function dispatchTeamHubTool(callerAgentId: string, workspaceId: number, name: TeamTool, args: Record<string, unknown>): Promise<unknown> {
      await assertTeamSwitchedOn(callerAgentId, workspaceId)
      const result = await dispatchAccountTool(workspaceActor(workspaceId), TEAM_READS[name], args)
      return name === 'team_list_triggers' ? withoutTriggerUrls(result) : result
  }
  ```
- **Command / test run:** `pnpm --filter ./apps/ui exec vitest run --maxWorkers=2 app/api/hub/route.test.ts`
  ```text
   ✓ app/api/hub/route.test.ts (15 tests) 14ms
  ```

## Trigger

1. **Missing `FOREMAN_HUB_TOKEN_SECRET` in self-hosted / misconfigured deploys (`hub-token.ts:41-43`, `hub/route.ts:39-43`):** Neither `.env.example` nor `docker-compose.yml` defines `FOREMAN_HUB_TOKEN_SECRET`. When it is unset, `mintForemanHubToken` returns `null` (`hub-token.ts:17`) and `foremanHubTokenRequired()` returns `false` (`hub-token.ts:42`). Any non-admin workspace member restricted to `box_scope = 'assigned'` (excluded from private HR/Finance/Executive boxes) talks to Foreman; Foreman calls `/api/hub` with `x-rerun-agent: foreman` and no `x-rerun-foreman-token`; `/api/hub` logs `[hub] foreman call without token (tolerated)` and executes `dispatchForemanHubTool(workspaceActor(engine.workspaceId), ...)` where `isAdminActor(actor)` is `true` (`access.ts:51`) and `userId` defaults to `founderOf(workspaceId)` (`foreman-hub.service.ts:22`), reading and mutating every restricted box in the workspace!
2. **`dispatchTeamHubTool` crosses restricted-box boundaries (`team-hub.service.ts:33`):** Even when `FOREMAN_HUB_TOKEN_SECRET` *is* set, a restricted member (`use` or `manage` on Box A only, zero access to restricted Box B) asks a coworker in Box A that has `config.tools.team === true` to call `team_list_runs` and `team_get_run` on a coworker in restricted Box B. `dispatchTeamHubTool` passes `workspaceActor(workspaceId)` (admin-equivalent!) to `dispatchAccountTool`, returning full run summaries and outputs of Box B's private coworkers!

## Impact and severity

- **Severity:** `high` (Critical on any install missing `FOREMAN_HUB_TOKEN_SECRET` that relies on `space_access` restricted boxes)
- **Impact:** Breaks the `space_access` private-box security boundary (`20261105130000_space_access.sql`), allowing restricted workspace members to read private coworker runs via `team_*` tools and (whenever `FOREMAN_HUB_TOKEN_SECRET` is unset) gain full founder/admin control over every box through Foreman.

## Proposed fix

- **Smallest causal change (`apps/ui/lib/foreman/hub-token.ts`, `apps/ui/app/api/_services/team-hub.service.ts`, `docker-compose.yml`):**
  1. Derive a fallback HMAC key when `FOREMAN_HUB_TOKEN_SECRET` is unset (e.g., `createHmac('sha256', process.env.SUPABASE_SECRET_KEY!).update('foreman-hub-token-v1').digest()` in `hub-token.ts:7`) and make `foremanHubTokenRequired()` default to `true` unless `process.env.FOREMAN_HUB_TOKEN_REQUIRED === '0'`, eliminating the fail-open `workspaceActor` fallback on unconfigured installs.
  2. In `dispatchTeamHubTool` (`apps/ui/app/api/_services/team-hub.service.ts:31`), look up the calling coworker's `space_id` and `visibility` in `agents`/`spaces`: if the calling coworker lives in a `restricted` box (or targets a coworker in a `restricted` box different from its own `space_id`), restrict `team_*` reads to coworkers in the same `space_id` (or open `visibility === 'workspace'` boxes), never allowing an open-box coworker to read a `restricted` box's runs via `workspaceActor`.
- **Must not break:** Coworkers inside the same restricted box coordinating via `team_get_run`, or coworkers in open `visibility = 'workspace'` boxes reading other open boxes.
- **Failing test that proves the fix:**
  - **File:** `apps/ui/app/api/hub/route.test.ts`
  - **Test name:** `it('rejects foreman hub calls without x-rerun-foreman-token by default and blocks team_get_run from reading a restricted box')`
  - **Assertion:** Unset `FOREMAN_HUB_TOKEN_SECRET`, send `POST /api/hub` with `x-rerun-agent: foreman` and no `x-rerun-foreman-token`, and assert HTTP `403` (not `200`). Second, call `POST /api/hub` as an agent in open Space A requesting `team_get_run` for an agent in `restricted` Space B, and assert `AccessDeniedError` / `Coworker not found`.
- **Alternative fix and trade-off:** Propagate the initiating human user's signed `actor` token on every chat run into `team_hub` as well as Foreman. Enforces exact per-user `space_access` on interactive runs, though headless cron/webhook runs have no human user and still need the box-to-box (`space_id` / `visibility`) rule above.

## Confidence

`proven`
