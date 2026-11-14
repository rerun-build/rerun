import 'server-only'

import { callableEngineAgentIds, workspaceActor, type Actor } from '@/app/api/_auth/access'
import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import { ensureSessionRow, resolveAgentTarget } from '@/app/api/_services/chat.service'
import { chat as engineChat, getAgent as engineGetAgent } from '@/lib/engine/client'
import type { EngineConnection } from '@/lib/engine/types'
import { buildInstallMessage, installSessionTitle } from '@/lib/chat/install-marker'
import { preferredLanguage } from '@/lib/foreman/language'
import { requireString } from '@/lib/mcp/args'
import { selectMany } from '@/supabase/supabase-helpers'
import { headers } from 'next/headers'

type Handoff = { agentId: string; message: string }

export type HandoffResult = { agentId: string; started: boolean; inactive?: boolean; conversationId?: string | null; runId?: string | null; ranItsOwnInstall?: boolean; error?: string }

function handoff(raw: unknown): Handoff {
    const value = (raw ?? {}) as Record<string, unknown>
    return { agentId: requireString(value.agentId, 'agents[].agentId'), message: requireString(value.message, 'agents[].message') }
}

async function messageFor(conn: EngineConnection, engineAgentId: string, written: string, agentName: string | undefined): Promise<{ message: string; title: string; ranItsOwnInstall: boolean }> {
    try {
        const detail = await engineGetAgent(conn, engineAgentId)
        const pending = detail.config.setup.required === true && detail.config.setup.completedAt === null && detail.install.trim().length > 0
        if (!pending) return { message: written, title: written, ranItsOwnInstall: false }
        const name = agentName ?? detail.config.displayName ?? detail.config.name
        return { message: buildInstallMessage(detail.install, name), title: installSessionTitle(name), ranItsOwnInstall: true }
    } catch {
        return { message: written, title: written, ranItsOwnInstall: false }
    }
}

function installInFlight(refusal: string): string | null {
    try {
        const body = JSON.parse(refusal) as { code?: string; sessionId?: string }
        return body.code === 'install_in_flight' && body.sessionId ? body.sessionId : null
    } catch {
        return null
    }
}

async function browserLanguage(): Promise<string | undefined> {
    try {
        return preferredLanguage((await headers()).get('accept-language')) ?? undefined
    } catch {
        return undefined
    }
}

async function start(actor: Actor, { agentId, message }: Handoff, fresh: boolean, agentName: string | undefined): Promise<HandoffResult> {
    try {
        const [{ conn, engineAgentId }, callableAgentIds] = await Promise.all([resolveAgentTarget(agentId, actor), callableEngineAgentIds(actor)])
        const written = fresh ? { message, title: message, ranItsOwnInstall: false } : await messageFor(conn, engineAgentId, message, agentName)

        const userLanguage = written.ranItsOwnInstall ? await browserLanguage() : undefined
        const res = await engineChat(conn, engineAgentId, { message: written.message, source: 'api', install: written.ranItsOwnInstall, userLanguage, callableAgentIds })
        if (!res.ok) {
            const refusal = await res.text().catch(() => '')
            const inFlight = installInFlight(refusal)
            if (inFlight) {
                const conversationId = await ensureSessionRow(agentId, inFlight, written.title, { source: 'api' })
                return { agentId, started: true, conversationId, runId: null, ranItsOwnInstall: true }
            }
            throw new Error(`${res.status} ${refusal}`.trim())
        }

        const engineSessionId = res.headers.get('x-session-id')
        const runId = res.headers.get('x-run-id')
        await res.body?.cancel().catch(() => {})

        const conversationId = engineSessionId ? await ensureSessionRow(agentId, engineSessionId, written.title, { source: 'api', status: 'working' }) : null

        return { agentId, started: true, conversationId, runId, ranItsOwnInstall: written.ranItsOwnInstall }
    } catch (err) {
        return { agentId, started: false, error: err instanceof Error ? err.message : 'The coworker could not be reached.' }
    }
}

export async function startAgentSetup(ctx: Pick<WorkspaceContext, 'supabase'> & { workspace: Pick<WorkspaceContext['workspace'], 'id'>; actor?: Actor }, args: Record<string, unknown>, { fresh = new Set<string>() }: { fresh?: ReadonlySet<string> } = {}): Promise<unknown> {
    const actor = ctx.actor ?? workspaceActor(ctx.workspace.id)
    const listed = Array.isArray(args.agents) ? args.agents.map(handoff) : []
    if (!listed.length) throw new Error('start_agent_setup needs at least one agent: its agentId and the message to hand it.')

    const requests = listed.filter((request, index) => listed.findIndex(other => other.agentId === request.agentId) === index)

    const { data: rows } = await selectMany(
        ctx.supabase,
        'agents',
        ['id', 'name', 'disabled_at'] as const,
        { workspace_id: ctx.workspace.id, id: requests.map(request => request.agentId) },
    )
    const inactive = new Set((rows ?? []).flatMap(row => (row.disabled_at ? [row.id] : [])))
    const names = new Map((rows ?? []).map(row => [row.id, row.name]))

    const agents = await Promise.all(requests.map(request => (inactive.has(request.agentId) ? Promise.resolve<HandoffResult>({ agentId: request.agentId, started: false, inactive: true }) : start(actor, request, fresh.has(request.agentId), names.get(request.agentId)))))
    const waiting = agents.filter(result => result.inactive)
    const failed = agents.filter(result => !result.started && !result.inactive)

    return {
        agents,
        next: `${agents.length - failed.length - waiting.length} agent(s) are working in their own chat and will ask the user for what they need there. Do not answer for them and do not describe the steps: say in one line that their team is asking for them. List the ones that started with show_agents, each row on the chat tab carrying that coworker's conversationId and runId from this answer: without them the row opens on an empty conversation, beside the one already running. Do not open any of those chats yourself.${waiting.length ? ` ${waiting.length} are built but have no free slot on their plan: say they are waiting on a slot the user can open, never that they failed.` : ''}${failed.length ? ` ${failed.length} could not be reached: say which ones.` : ''}`,
    }
}
