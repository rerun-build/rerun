import { getSystemDb } from '../systemDb.js'

export type RedactCounts = { messages: number; searchRows: number; toolCalls: number; runs: number; checkpoints: number }

const TARGETS: { key: keyof RedactCounts; table: string; columns: string[] }[] = [
    { key: 'messages', table: 'messages', columns: ['content_json', 'tool_calls_json'] },
    { key: 'searchRows', table: 'messages_fts', columns: ['content'] },
    { key: 'toolCalls', table: 'tool_calls', columns: ['input_json', 'result_json'] },
    { key: 'runs', table: 'runs', columns: ['error'] },
    { key: 'checkpoints', table: 'compaction_checkpoints', columns: ['summary_json'] },
]

export async function redactValue(agentId: string, value: string, mark = '[redacted]'): Promise<RedactCounts> {
    if (value.length < 8) throw new Error('A value to redact has at least 8 characters')
    const escaped = JSON.stringify(value).slice(1, -1)
    const { client } = await getSystemDb(agentId)
    const counts: RedactCounts = { messages: 0, searchRows: 0, toolCalls: 0, runs: 0, checkpoints: 0 }
    for (const target of TARGETS) {
        const sets = target.columns.map((c) => `${c} = replace(replace(${c}, ?, ?), ?, ?)`).join(', ')
        const where = target.columns.map((c) => `instr(${c}, ?) > 0 OR instr(${c}, ?) > 0`).join(' OR ')
        const args = [
            ...target.columns.flatMap(() => [value, mark, escaped, mark]),
            ...target.columns.flatMap(() => [value, escaped]),
        ]
        const result = await client.execute({ sql: `UPDATE ${target.table} SET ${sets} WHERE ${where}`, args })
        counts[target.key] = result.rowsAffected
    }
    return counts
}
