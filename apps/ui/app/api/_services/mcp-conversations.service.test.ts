import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Actor } from '@/app/api/_auth/access'

const mocks = vi.hoisted(() => ({
    listAgentSessions: vi.fn(),
    readSessionTranscript: vi.fn(),
    searchConversationsAs: vi.fn(),
    resolveRunTarget: vi.fn(),
    runSessionsInReach: vi.fn(),
    getRun: vi.fn(),
    cancelRun: vi.fn(),
    dispatchInboxTool: vi.fn(),
    dispatchPublishTool: vi.fn(),
}))

vi.mock('./conversation.service', () => ({ listAgentSessions: mocks.listAgentSessions, readSessionTranscript: mocks.readSessionTranscript, searchConversationsAs: mocks.searchConversationsAs }))
vi.mock('./chat.service', () => ({ resolveRunTarget: mocks.resolveRunTarget }))
vi.mock('./mcp-publish.service', () => ({ dispatchPublishTool: mocks.dispatchPublishTool }))
vi.mock('@/lib/foreman/inbox-tools', () => ({ dispatchInboxTool: mocks.dispatchInboxTool }))
vi.mock('@/lib/engine/client', () => ({ getRun: mocks.getRun, cancelRun: mocks.cancelRun }))
vi.mock('@/app/api/_auth/access', async importOriginal => ({ ...(await importOriginal<typeof import('@/app/api/_auth/access')>()), runSessionsInReach: mocks.runSessionsInReach }))

const { dispatchConversationTool } = await import('./mcp-conversations.service')

const conn = { baseUrl: 'https://engine.test', apiKey: null }
const MEMBER: Actor = { kind: 'user', userId: 'u-ada', workspaceId: 7, role: 'member', boxScope: 'all' }

const run = (status: string) => ({ id: 'run-1', status, sessionId: 'engine-s1', provider: null, model: null, triggerSource: 'api', triggerSlug: null, stepCount: 2, inputTokens: null, outputTokens: null, totalTokens: null, costMicros: null, startedAt: '2026-11-26', finishedAt: null, error: null })

beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveRunTarget.mockResolvedValue({ conn, engineAgentId: 'engine-lea' })
    mocks.runSessionsInReach.mockResolvedValue({ inReach: () => true })
})

describe('reading conversations', () => {
    const entry = (overrides: Record<string, unknown> = {}) => ({ id: 'conv-1', agentId: 'agent-lea', engineSessionId: 'e1', title: 'Weekly report', status: 'idle', updatedAt: '2026-11-26', source: 'schedule', originAgentId: null, originAgentName: null, automationName: 'weekly', outcome: null, kind: 'thread', createdAt: '2026-11-25', firstMessage: 'go', ...overrides })

    it('lists a coworker conversations with the id read_conversation takes, and the one send_message continues', async () => {
        mocks.listAgentSessions.mockResolvedValue({ entries: [entry(), entry({ id: null, engineSessionId: 'e2', originAgentName: 'Max', automationName: null, source: 'agent' })], before: '2026-11-20' })
        await expect(dispatchConversationTool(MEMBER, 'list_conversations', { agentId: 'agent-lea', before: '2026-11-27' })).resolves.toEqual({
            conversations: [
                { conversationId: 'conv-1', sessionId: 'e1', title: 'Weekly report', status: 'idle', kind: 'thread', source: 'schedule', automation: 'weekly', createdAt: '2026-11-25', updatedAt: '2026-11-26' },
                { conversationId: null, sessionId: 'e2', title: 'Weekly report', status: 'idle', kind: 'thread', source: 'agent', openedBy: 'Max', createdAt: '2026-11-25', updatedAt: '2026-11-26' },
            ],
            before: '2026-11-20',
        })
        expect(mocks.listAgentSessions).toHaveBeenCalledWith('agent-lea', MEMBER, 'all', '2026-11-27')
    })

    it('continues a conversation with the Chief of Staff by its own id, the one its turns go through', async () => {
        mocks.listAgentSessions.mockResolvedValue({ entries: [entry({ agentId: 'foreman', id: 'conv-cos', engineSessionId: 'e-cos', source: 'api', automationName: null })], before: null })
        await expect(dispatchConversationTool(MEMBER, 'list_conversations', { agentId: 'foreman' })).resolves.toMatchObject({ conversations: [{ conversationId: 'conv-cos', sessionId: 'conv-cos' }] })
    })

    it('reads the latest messages first, with the text and a preview of each tool call', async () => {
        const messages = Array.from({ length: 60 }, (_, index) => ({ id: `m${index}`, role: index % 2 ? 'assistant' : 'user', parts: [{ type: 'text', text: `line ${index}` }], metadata: { createdAt: '2026-11-26' } }))
        messages[59].parts.push({ type: 'tool-web_search', toolCallId: 't1', toolName: 'web_search', state: 'output-available', input: { q: 'x' }, output: 'y'.repeat(3000) } as never)
        mocks.readSessionTranscript.mockResolvedValue({ messages, updatedAt: '2026-11-26' })

        const out = (await dispatchConversationTool(MEMBER, 'read_conversation', { conversationId: 'conv-1' })) as { total: number; from: number; before: number | null; messages: { id: string; text: string; toolCalls?: { tool: string; input: string; result: string }[] }[] }
        expect(mocks.readSessionTranscript).toHaveBeenCalledWith('conv-1', MEMBER)
        expect(out).toMatchObject({ total: 60, from: 10, before: 10 })
        expect(out.messages).toHaveLength(50)
        const last = out.messages[49]
        expect(last).toMatchObject({ id: 'm59', text: 'line 59', toolCalls: [{ tool: 'web_search', input: '{"q":"x"}' }] })
        expect(last.toolCalls?.[0].result).toContain('[truncated]')

        await expect(dispatchConversationTool(MEMBER, 'read_conversation', { conversationId: 'conv-1', before: 10 })).resolves.toMatchObject({ from: 0, before: null })
    })

    it('searches the titles, and asks for something to search', async () => {
        mocks.searchConversationsAs.mockResolvedValue([{ id: 'conv-1', agentId: 'agent-lea', title: 'Pricing', status: 'idle', updatedAt: '2026-11-26' }])
        await expect(dispatchConversationTool(MEMBER, 'search_conversations', { query: 'pric' })).resolves.toEqual({ conversations: [{ conversationId: 'conv-1', agentId: 'agent-lea', title: 'Pricing', status: 'idle', updatedAt: '2026-11-26' }] })
        expect(mocks.searchConversationsAs).toHaveBeenCalledWith(MEMBER, 'pric', undefined)
        await expect(dispatchConversationTool(MEMBER, 'search_conversations', {})).rejects.toThrow('Pass a query')
    })
})

describe('cancel_run', () => {
    it('stops a run that is working, within the reach get_run has', async () => {
        mocks.getRun.mockResolvedValueOnce(run('running')).mockResolvedValueOnce(run('cancelled'))
        await expect(dispatchConversationTool(MEMBER, 'cancel_run', { agentId: 'agent-lea', runId: 'run-1' })).resolves.toMatchObject({ runId: 'run-1', status: 'cancelled', cancelled: true })
        expect(mocks.resolveRunTarget).toHaveBeenCalledWith('agent-lea', 'use', MEMBER)
        expect(mocks.runSessionsInReach).toHaveBeenCalledWith('agent-lea', ['engine-s1'], MEMBER)
        expect(mocks.cancelRun).toHaveBeenCalledWith(conn, 'engine-lea', 'run-1')
    })

    it('leaves a run that already ended', async () => {
        mocks.getRun.mockResolvedValue(run('success'))
        await expect(dispatchConversationTool(MEMBER, 'cancel_run', { agentId: 'agent-lea', runId: 'run-1' })).resolves.toMatchObject({ cancelled: false })
        expect(mocks.cancelRun).not.toHaveBeenCalled()
    })

    it("never stops another member's run with the Chief of Staff", async () => {
        mocks.getRun.mockResolvedValue(run('running'))
        mocks.runSessionsInReach.mockResolvedValue({ inReach: () => false })
        await expect(dispatchConversationTool(MEMBER, 'cancel_run', { agentId: 'foreman', runId: 'run-1' })).rejects.toThrow()
        expect(mocks.cancelRun).not.toHaveBeenCalled()
    })
})

it('answers the cards as the member, not as the Chief of Staff', async () => {
    await dispatchConversationTool(MEMBER, 'answer_card', { sessionId: 's1', action: 'approve', toolCallId: 't1' })
    expect(mocks.dispatchInboxTool).toHaveBeenCalledWith(MEMBER, 'answer_card', { sessionId: 's1', action: 'approve', toolCallId: 't1' }, 'api')
})

it('hands any other name to the published pages', async () => {
    await dispatchConversationTool(MEMBER, 'list_published_pages', {})
    expect(mocks.dispatchPublishTool).toHaveBeenCalledWith(MEMBER, 'list_published_pages', {})
})
