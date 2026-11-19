import 'server-only'

import { callableEngineAgentIds, workspaceActor, type Actor } from '@/app/api/_auth/access'
import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import { ensureSessionRow, resolveAgentTarget } from '@/app/api/_services/chat.service'
import { chat as engineChat, getAgent as engineGetAgent } from '@/lib/engine/client'
import type { EngineConnection } from '@/lib/engine/types'
import { buildInstallMessage, installSessionTitle } from '@/lib/chat/install-marker'
import { preferredLanguage } from '@/lib/foreman/language'
import { refusalOf, type ErrorCode, type ErrorParams } from '@/lib/i18n/action-error'
import { requireString } from '@/lib/mcp/args'
import { selectMany } from '@/supabase/supabase-helpers'
import { headers } from 'next/headers'

// The end of the guided setup: the team asks for what it still needs, each agent in its own chat,
// rather than the foreman walking the user through one Apps tab at a time. Every agent is started
// at once and none of them is waited for: what the user sees is their whole company working, and
// then coming back to them one by one with a sign-in card or a question.
//
// So this is send_message without the wait: the engine buffers the run on its side and nothing has
// to stay connected to the stream for the user to be asked. The session row is mirrored here rather
// than left to the notification webhook, which only writes one for a session the engine announced
// with `agent.session.created`, and /chat announces nothing. Without that row the run executes for
// nobody: it never reaches the agent's chat, and the `awaiting_*` state it stops on has nothing to
// be written to.

type Handoff = { agentId: string; message: string }

export type HandoffResult = { agentId: string; started: boolean; inactive?: boolean; conversationId?: string | null; runId?: string | null; ranItsOwnInstall?: boolean; error?: string; code?: ErrorCode; params?: ErrorParams }

function handoff(raw: unknown): Handoff {
    const value = (raw ?? {}) as Record<string, unknown>
    return { agentId: requireString(value.agentId, 'agents[].agentId'), message: requireString(value.message, 'agents[].message') }
}

// An agent installed from a template carries the install its author wrote for this exact moment,
// and its system prompt is already told the user sends those instructions as a message. Handing it
// anything else would have it improvise a setup beside the one it was shipped with. It goes out
// wrapped, so the agent's chat draws a setup block rather than a guide the user never typed.
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

// The guide is the publisher's words: the browser is all that says the user's language before they write.
// Outside a request (an MCP client, a job) there is no browser to ask.
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
            // Its install already runs elsewhere, started from its own chat or by an earlier
            // handoff: the user is sent to that conversation rather than asked everything twice.
            const inFlight = installInFlight(refusal)
            if (inFlight) {
                const conversationId = await ensureSessionRow(agentId, inFlight, written.title, { source: 'api' })
                return { agentId, started: true, conversationId, runId: null, ranItsOwnInstall: true }
            }
            throw new Error(`${res.status} ${refusal}`.trim())
        }

        const engineSessionId = res.headers.get('x-session-id')
        const runId = res.headers.get('x-run-id')
        // Dropping the stream reads as one subscriber leaving: the agent carries on working, and
        // the user reads it live in its own chat.
        await res.body?.cancel().catch(() => {})

        // The id handed back is the row's, never the engine's: that is the one the agent panel opens
        // a conversation on. Answering with both would be two ids for one conversation, and the
        // wrong one lands the user on an empty chat beside the run they came to watch.
        const conversationId = engineSessionId ? await ensureSessionRow(agentId, engineSessionId, written.title, { source: 'api', status: 'working' }) : null

        return { agentId, started: true, conversationId, runId, ranItsOwnInstall: written.ranItsOwnInstall }
    } catch (err) {
        return { agentId, started: false, ...refusalOf(err, 'coworkerCouldNotBeReached') }
    }
}

// `fresh` names the agents a caller has just created with the very install it hands over: there is
// nothing on the engine to read back that it does not already hold. `actor` is whose access each
// setup starts with: the member behind a foreman turn, or, left out, the workspace itself.
export async function startAgentSetup(ctx: Pick<WorkspaceContext, 'supabase'> & { workspace: Pick<WorkspaceContext['workspace'], 'id'>; actor?: Actor }, args: Record<string, unknown>, { fresh = new Set<string>() }: { fresh?: ReadonlySet<string> } = {}): Promise<unknown> {
    const actor = ctx.actor ?? workspaceActor(ctx.workspace.id)
    const listed = Array.isArray(args.agents) ? args.agents.map(handoff) : []
    if (!listed.length) throw new Error('start_agent_setup needs at least one agent: its agentId and the message to hand it.')

    // The same agent twice would start two runs at once on it, and ask the user the same thing in
    // two conversations. One setup per agent, the first message written for it.
    const requests = listed.filter((request, index) => listed.findIndex(other => other.agentId === request.agentId) === index)

    // An agent the plan does not run cannot be addressed at all: resolveAgentTarget refuses it, and
    // that refusal would land in `failed` beside a real breakage, so the last screen of the funnel
    // would announce half the team as broken when it is a slot to buy. Read it first, report it for
    // what it is.
    const { data: rows } = await selectMany(
        ctx.supabase,
        'agents',
        ['id', 'name', 'disabled_at'] as const,
        { workspace_id: ctx.workspace.id, id: requests.map(request => request.agentId) },
    )
    const inactive = new Set((rows ?? []).flatMap(row => (row.disabled_at ? [row.id] : [])))
    const names = new Map((rows ?? []).map(row => [row.id, row.name]))

    // One agent that cannot be reached is reported beside the ones that started, never thrown: the
    // rest of the team is already asking the user, and saying otherwise would be a lie on screen.
    const agents = await Promise.all(requests.map(request => (inactive.has(request.agentId) ? Promise.resolve<HandoffResult>({ agentId: request.agentId, started: false, inactive: true }) : start(actor, request, fresh.has(request.agentId), names.get(request.agentId)))))
    const waiting = agents.filter(result => result.inactive)
    const failed = agents.filter(result => !result.started && !result.inactive)

    return {
        agents,
        next: `${agents.length - failed.length - waiting.length} agent(s) are working in their own chat and will ask the user for what they need there. Do not answer for them and do not describe the steps: say in one line that their team is asking for them. List the ones that started with show_agents, each row on the chat tab carrying that coworker's conversationId and runId from this answer: without them the row opens on an empty conversation, beside the one already running. Do not open any of those chats yourself.${waiting.length ? ` ${waiting.length} are built but have no free slot on their plan: say they are waiting on a slot the user can open, never that they failed.` : ''}${failed.length ? ` ${failed.length} could not be reached: say which ones.` : ''}`,
    }
}
