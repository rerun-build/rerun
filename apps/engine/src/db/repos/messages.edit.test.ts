import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-message-edit-'))
process.env.RERUN_API_KEY = ''

const { afterEach, beforeEach, describe, expect, it, vi } = await import('vitest')
const { appendMessage, deleteConversationMessage, listMessages, truncateSessionFrom } = await import('./messages.js')
const { getLatestCheckpoint, saveCheckpoint } = await import('./checkpoints.js')
const { getSystemDb } = await import('../systemDb.js')

const agent = 'editagent'
let session = ''
let ids: Record<string, string> = {}

async function indexedIds(): Promise<string[]> {
    const { client } = await getSystemDb(agent)
    const rows = await client.execute('SELECT message_id FROM messages_fts')
    return rows.rows.map(row => String(row.message_id))
}

async function remaining(): Promise<string[]> {
    return (await listMessages(agent, session)).map(row => row.id)
}

// Two turns, the second one with a tool call: user, assistant + tool + assistant, user, assistant.
beforeEach(async () => {
    session = `s-${Math.random().toString(36).slice(2)}`
    vi.useFakeTimers({ toFake: ['Date'] })
    const at = (minute: number) => vi.setSystemTime(new Date(`2026-11-26T10:${String(minute).padStart(2, '0')}:00.000Z`))
    at(0)
    const ask = await appendMessage(agent, session, { role: 'user', content: 'find agencies' })
    at(1)
    const call = await appendMessage(agent, session, { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'search', input: {} }] })
    const result = await appendMessage(agent, session, { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c1', toolName: 'search', output: { type: 'text', value: 'ok' } }] })
    const answer = await appendMessage(agent, session, { role: 'assistant', content: 'found 20 agencies' })
    at(2)
    const follow = await appendMessage(agent, session, { role: 'user', content: 'send the emails' })
    at(3)
    const sent = await appendMessage(agent, session, { role: 'assistant', content: 'sent' })
    vi.useRealTimers()
    ids = { ask: ask.id, call: call.id, result: result.id, answer: answer.id, follow: follow.id, sent: sent.id }
})

afterEach(() => {
    vi.useRealTimers()
})

describe('truncateSessionFrom', () => {
    it('removes the message and everything written after it, rows of the same millisecond included', async () => {
        expect(await truncateSessionFrom(agent, session, ids.result)).toEqual([ids.result, ids.answer, ids.follow, ids.sent])
        expect(await remaining()).toEqual([ids.ask, ids.call])
    })

    it('takes the removed messages out of the search index', async () => {
        await truncateSessionFrom(agent, session, ids.follow)
        const indexed = await indexedIds()
        expect(indexed).toContain(ids.answer)
        expect(indexed).not.toContain(ids.follow)
        expect(indexed).not.toContain(ids.sent)
    })

    it('drops a compaction summary that covered a removed message, keeps an older one', async () => {
        await saveCheckpoint(agent, session, { summaryMessage: { role: 'user', content: 'first turn' }, throughMessageId: ids.answer, throughCreatedAt: '2026-11-26T10:01:00.000Z' })
        await truncateSessionFrom(agent, session, ids.follow)
        expect(await getLatestCheckpoint(agent, session)).toMatchObject({ throughMessageId: ids.answer })
        await truncateSessionFrom(agent, session, ids.call)
        expect(await getLatestCheckpoint(agent, session)).toBeNull()
    })

    it('is null for a message of another conversation', async () => {
        expect(await truncateSessionFrom(agent, 'another', ids.ask)).toBeNull()
        expect(await remaining()).toHaveLength(6)
    })
})

describe('deleteConversationMessage', () => {
    it('deletes a message of the user alone and keeps the replies', async () => {
        expect(await deleteConversationMessage(agent, session, ids.follow)).toEqual([ids.follow])
        expect(await remaining()).toEqual([ids.ask, ids.call, ids.result, ids.answer, ids.sent])
    })

    it('deletes a whole reply with its tool call and result, from any of its rows', async () => {
        expect(await deleteConversationMessage(agent, session, ids.answer)).toEqual([ids.call, ids.result, ids.answer])
        expect(await remaining()).toEqual([ids.ask, ids.follow, ids.sent])
    })

    it('deletes the last reply', async () => {
        expect(await deleteConversationMessage(agent, session, ids.sent)).toEqual([ids.sent])
        expect(await remaining()).toEqual([ids.ask, ids.call, ids.result, ids.answer, ids.follow])
    })

    it('is null for an unknown message', async () => {
        expect(await deleteConversationMessage(agent, session, 'nope')).toBeNull()
    })
})
