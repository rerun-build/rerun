import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-redact-'))
process.env.RERUN_API_KEY = ''

const { describe, expect, it } = await import('vitest')
const { appendMessage, listMessages, setMessageToolCalls } = await import('./messages.js')
const { getSystemDb } = await import('../systemDb.js')
const { redactValue } = await import('./redact.js')

const SECRET = 'sk-live-"q"-0123456789'

describe('redactValue', () => {
    it('removes the value from every run record and the search index, and counts the rows', async () => {
        const agent = 'agent-r'
        await appendMessage(agent, 's1', { role: 'user', content: 'my key is ' + SECRET })
        await appendMessage(agent, 's1', { role: 'assistant', content: [{ type: 'text', text: 'nothing here' }] })
        const third = await appendMessage(agent, 's1', { role: 'assistant', content: [{ type: 'text', text: 'calling' }] })
        await setMessageToolCalls(agent, third.id, [{ input: { token: SECRET } }])
        const { client } = await getSystemDb(agent)
        await client.execute({
            sql: "INSERT INTO runs (id, agent_id, session_id, started_at, error) VALUES ('r1', ?, 's1', '2026-01-01', ?)",
            args: [agent, 'boom ' + SECRET],
        })
        await client.execute({
            sql: "INSERT INTO tool_calls (id, run_id, agent_id, session_id, step_number, tool_name, input_json, created_at) VALUES ('t1', 'r1', ?, 's1', 1, 'x', ?, '2026-01-01')",
            args: [agent, JSON.stringify({ k: SECRET })],
        })
        await client.execute({
            sql: "INSERT INTO compaction_checkpoints (id, session_id, summary_json, through_message_id, through_created_at, created_at) VALUES ('c1', 's1', ?, 'm', '2026-01-01', '2026-01-01')",
            args: [JSON.stringify({ s: SECRET })],
        })

        expect(await redactValue(agent, SECRET)).toEqual({ messages: 2, searchRows: 1, toolCalls: 1, runs: 1, checkpoints: 1 })
        expect(await redactValue(agent, SECRET)).toEqual({ messages: 0, searchRows: 0, toolCalls: 0, runs: 0, checkpoints: 0 })

        const found = await client.execute({ sql: 'SELECT count(*) AS n FROM messages_fts WHERE messages_fts MATCH ?', args: ['"0123456789"'] })
        expect(Number(found.rows[0]?.n)).toBe(0)
        const rows = await listMessages(agent, 's1')
        for (const row of rows) {
            expect(row.contentJson).not.toContain('0123456789')
            expect(row.toolCallsJson ?? '').not.toContain('0123456789')
        }
        expect(JSON.parse(rows[0]!.contentJson)).toBe('my key is [redacted]')
    })

    it('refuses a value under 8 characters', async () => {
        await expect(redactValue('agent-r', 'short')).rejects.toThrow('at least 8 characters')
    })
})
