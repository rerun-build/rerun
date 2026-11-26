import 'server-only'

import { FOREMAN_AGENT_ID } from '@rerun/contracts'

import { assertRunInReach, runSessionsInReach, type Actor } from '@/app/api/_auth/access'
import type { HistoryMessage } from '@/lib/chat/engine-history'
import { cancelRun, getRun } from '@/lib/engine/client'
import { dispatchInboxTool } from '@/lib/foreman/inbox-tools'
import { asNumber, asString, clamp, requireString } from '@/lib/mcp/args'
import { DEFAULT_CONVERSATION_MESSAGES, MAX_CONVERSATION_MESSAGES } from '@/lib/mcp/conversation-tools'
import { projectRun } from '@/lib/mcp/run-projection'
import { truncateField } from '@/lib/mcp/truncate'
import { resolveRunTarget } from './chat.service'
import { listAgentSessions, readSessionTranscript, searchConversationsAs, type SessionHistoryEntry } from './conversation.service'
import { dispatchPublishTool } from './mcp-publish.service'

// `sessionId` is what send_message takes to continue it: the engine's id for a coworker, the
// conversation's own for the Chief of Staff, whose turns go through the member's row.
function conversationView(entry: SessionHistoryEntry) {
    return {
        // A conversation another coworker opened lives on the machine alone until someone opens it in the app.
        conversationId: entry.id,
        sessionId: entry.agentId === FOREMAN_AGENT_ID ? entry.id : entry.engineSessionId,
        title: entry.title,
        status: entry.status,
        kind: entry.kind,
        source: entry.source,
        ...(entry.originAgentName ? { openedBy: entry.originAgentName } : {}),
        ...(entry.automationName ? { automation: entry.automationName } : {}),
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
    }
}

const asJson = (value: unknown) => (value === undefined ? null : typeof value === 'string' ? value : JSON.stringify(value))

// A tool call's input and result are unbounded: a preview, the way get_run hands them back.
function messageView(message: HistoryMessage) {
    const text = message.parts.flatMap(part => (part.type === 'text' ? [part.text] : [])).join('\n\n')
    const toolCalls = message.parts.flatMap(part =>
        part.type.startsWith('tool-') && 'toolCallId' in part
            ? [{ tool: part.toolName, state: part.state, input: truncateField(asJson(part.input)), ...(part.output !== undefined ? { result: truncateField(asJson(part.output)) } : {}), ...(part.errorText ? { error: truncateField(part.errorText) } : {}) }]
            : []
    )
    return {
        id: message.id,
        role: message.role,
        ...(message.metadata?.createdAt ? { createdAt: message.metadata.createdAt } : {}),
        ...(message.metadata?.authorId ? { authorId: message.metadata.authorId } : {}),
        ...(message.metadata?.relayedBy ? { relayedBy: message.metadata.relayedBy } : {}),
        text,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
    }
}

async function listConversations(actor: Actor, args: Record<string, unknown>) {
    const page = await listAgentSessions(requireString(args.agentId, 'agentId'), actor, 'all', asString(args.before))
    return { conversations: page.entries.map(conversationView), before: page.before }
}

async function readConversation(actor: Actor, args: Record<string, unknown>) {
    const conversationId = requireString(args.conversationId, 'conversationId')
    const { messages, updatedAt } = await readSessionTranscript(conversationId, actor)
    const limit = clamp(asNumber(args.limit), DEFAULT_CONVERSATION_MESSAGES, MAX_CONVERSATION_MESSAGES)
    const requested = asNumber(args.before)
    const end = requested === undefined ? messages.length : Math.min(Math.max(0, Math.trunc(requested)), messages.length)
    const start = Math.max(0, end - limit)
    return { conversationId, updatedAt, total: messages.length, from: start, messages: messages.slice(start, end).map(messageView), before: start > 0 ? start : null }
}

async function searchConversations(actor: Actor, args: Record<string, unknown>) {
    const query = asString(args.query) ?? ''
    const agentId = asString(args.agentId)
    if (!query.trim() && !agentId) throw new Error('Pass a query, an agentId, or both.')
    const hits = await searchConversationsAs(actor, query, agentId)
    return { conversations: hits.map(hit => ({ conversationId: hit.id, agentId: hit.agentId, title: hit.title, status: hit.status, updatedAt: hit.updatedAt })) }
}

// The same reach as get_run: a run of a coworker whose conversations are each member's own is the
// member's whose conversation it ran in.
async function cancelAgentRun(actor: Actor, args: Record<string, unknown>) {
    const agentId = requireString(args.agentId, 'agentId')
    const runId = requireString(args.runId, 'runId')
    const { conn, engineAgentId } = await resolveRunTarget(agentId, 'use', actor)
    const run = await getRun(conn, engineAgentId, runId)
    assertRunInReach(await runSessionsInReach(agentId, [run.sessionId], actor), run)
    if (run.status !== 'running') return { ...projectRun(run), cancelled: false, note: `This run already ended (${run.status}): nothing to stop.` }
    await cancelRun(conn, engineAgentId, runId)
    return { ...projectRun(await getRun(conn, engineAgentId, runId)), cancelled: true }
}

// Chained after the knowledge tools: the published pages come next.
export async function dispatchConversationTool(actor: Actor, name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
        case 'list_conversations':
            return listConversations(actor, args)
        case 'read_conversation':
            return readConversation(actor, args)
        case 'search_conversations':
            return searchConversations(actor, args)
        case 'cancel_run':
            return cancelAgentRun(actor, args)
        case 'list_pending_cards':
        case 'answer_card':
            return dispatchInboxTool(actor, name, args, 'api')
        default:
            return await dispatchPublishTool(actor, name, args)
    }
}
