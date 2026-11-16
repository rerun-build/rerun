import 'server-only'

import { sleep } from '@rerun/contracts'
import { captureServer } from '@rerun/analytics/server'
import { after } from 'next/server'

import { isAdminActor, actorFromContext } from '@/app/api/_auth/access'
import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import { asString, asStringArray } from '@/lib/mcp/args'
import { buildTeamOnce } from '@/lib/foreman/build-once'
import type { BuildTeamResult } from '@/lib/foreman/build-team'
import { writePlan } from '@/lib/foreman/onboarding-tools'
import { pinnedPlanBoxes } from '@/lib/foreman/phases'
import { loadForemanState } from '@/lib/foreman/state'
import { starterPackPlan } from '@/lib/foreman/starter-pack'
import { loadStarterPack } from '@/lib/foreman/starter-pack-offer'
import { MAX_STARTER_PICKS } from '@/lib/onboarding/starter-packs'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMany } from '@/supabase/supabase-helpers'

// Long enough for the common build, short enough for the model's turn: past it the build goes on
// after the answer, and calling the tool again reads it.
const ANSWER_WITHIN_MS = 60_000

type Team = { status: 'built'; team: { name: string; agentId: string; active: boolean; lead: boolean }[]; failed: { name: string; error: string }[] } | { status: 'building'; note: string }

function teamOf(result: BuildTeamResult): Team {
    return { status: 'built', team: result.agents.map(agent => ({ name: agent.name, agentId: agent.agentId, active: agent.active, lead: !!agent.lead })), failed: result.failed }
}

async function teamInPlace(ctx: WorkspaceContext): Promise<Team> {
    const { data } = await selectMany(createServiceRoleClient(), 'agents', ['id', 'name', 'disabled_at'] as const, { workspace_id: ctx.workspace.id }, { column: 'created_at' })
    return { status: 'built', team: (data ?? []).map((agent, index) => ({ name: agent.name, agentId: agent.id, active: !agent.disabled_at, lead: index === 0 })), failed: [] }
}

function counted(ctx: WorkspaceContext, result: BuildTeamResult): void {
    void captureServer(ctx.userId, 'onboarding_team_built', { agents: result.agents.length, failed: result.failed.length, error: false }).catch(() => {})
    if (result.agents.length) void captureServer(ctx.userId, 'first_agent_created', { template: 'foreman' }).catch(() => {})
}

// The first team, built once by the hub from what the person chose: the picks of the starter pack, or
// the one coworker the Chief of Staff designed with them. The model names nothing that is installed
// and writes nothing that is set up: the build is the one the hub's onboarding already ran.
export async function setUpTeam(ctx: WorkspaceContext, args: Record<string, unknown>): Promise<Team> {
    if (!isAdminActor(actorFromContext(ctx))) throw new Error('Only an admin of the workspace can set up its team: say so, and suggest they ask one.')
    const load = () => loadForemanState(ctx, null)
    let state = await load()
    if (state.foreman.firstRunAt || state.agents.length > 0) return teamInPlace(ctx)

    const picks = asStringArray(args.picks).slice(0, MAX_STARTER_PICKS)
    const coworker = args.coworker && typeof args.coworker === 'object' ? (args.coworker as Record<string, unknown>) : null
    if (picks.length && coworker) throw new Error('Pass the picks or one coworker, not both.')
    const title = state.answers.company_name ?? state.workspaceName
    if (picks.length) {
        const pack = await loadStarterPack(ctx, state)
        if (!pack) throw new Error('There is no starter pack for this workspace: design one coworker with them instead.')
        const shown = starterPackPlan(pack, picks)
        if (!shown.items.length) throw new Error('None of those slugs is a card of their starter pack: pass the slugs of their message as they are.')
        await writePlan(ctx, { ...shown, title }, ['template'])
    } else if (coworker) {
        const boxes = pinnedPlanBoxes(state)
        await writePlan(ctx, { title, items: [{ kind: 'agent', name: asString(coworker.name), role: asString(coworker.role), need: asString(coworker.need), box: boxes[0] }], boxes: boxes.map(name => ({ name })) }, ['agent'], asString(coworker.need) ?? null)
    } else if (!state.foreman.plan) {
        throw new Error('Pass the slugs they picked, or the one coworker you designed with them.')
    }

    state = await load()
    const build = buildTeamOnce({ ctx, state, emit: () => {}, reload: load }).then(result => {
        counted(ctx, result)
        return result
    })
    const result = await Promise.race([build, sleep(ANSWER_WITHIN_MS).then(() => null)])
    if (result) return teamOf(result)
    after(() => build.catch(err => console.error('[onboarding] the first team build failed after the answer', err)))
    return { status: 'building', note: 'The team is still being installed. Tell them it lands on the board in a moment, then call set_up_team again to read it.' }
}
