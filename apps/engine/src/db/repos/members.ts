import { FOREMAN_AGENT_ID, validTimeZone, type MessageAuthor } from '@rerun/contracts'
import { nowIso } from '../../lib/ids.js'
import { getSystemDb } from '../systemDb.js'

export type Member = { id: string; name: string | null; timezone: string | null; instructions: string | null; firstSeenAt: string; lastSeenAt: string }

const rowOf = (row: Record<string, unknown>): Member => ({
    id: String(row.id),
    name: (row.name as string | null) ?? null,
    timezone: (row.timezone as string | null) ?? null,
    instructions: (row.instructions as string | null) ?? null,
    firstSeenAt: String(row.first_seen_at),
    lastSeenAt: String(row.last_seen_at),
})

// Every message a person writes, to any coworker of the box. A message that names no zone, from an
// older client, keeps the one the member had: their zone does not move because one app forgot it.
export async function touchMember(author: MessageAuthor, at: string = nowIso()): Promise<void> {
    const { client } = await getSystemDb(FOREMAN_AGENT_ID)
    await client.execute({
        sql: `INSERT INTO members (id, name, timezone, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET name = COALESCE(excluded.name, members.name), timezone = COALESCE(excluded.timezone, members.timezone), last_seen_at = MAX(members.last_seen_at, excluded.last_seen_at)`,
        args: [author.id, author.name ?? null, validTimeZone(author.timezone) ?? null, at, at],
    })
}

// The member who came by last first.
export async function listMembers(): Promise<Member[]> {
    const { client } = await getSystemDb(FOREMAN_AGENT_ID)
    const result = await client.execute('SELECT * FROM members ORDER BY last_seen_at DESC')
    return result.rows.map(row => rowOf(row as unknown as Record<string, unknown>))
}

export async function readMemberInstructions(id: string): Promise<string | null> {
    const { client } = await getSystemDb(FOREMAN_AGENT_ID)
    const result = await client.execute({ sql: 'SELECT instructions FROM members WHERE id = ?', args: [id] })
    return (result.rows[0]?.instructions as string | null | undefined) ?? null
}

// Written whole, from the settings or by the Chief of Staff itself. A member who never wrote a message
// yet can already set theirs from the settings, so the row is created here when it is missing.
export async function saveMemberInstructions(id: string, instructions: string | null, at: string = nowIso()): Promise<void> {
    const { client } = await getSystemDb(FOREMAN_AGENT_ID)
    await client.execute({
        sql: `INSERT INTO members (id, instructions, instructions_updated_at, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET instructions = excluded.instructions, instructions_updated_at = excluded.instructions_updated_at`,
        args: [id, instructions, at, at, at],
    })
}
