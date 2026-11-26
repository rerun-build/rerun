import { and, asc, desc, eq, gt, gte, inArray, isNotNull, like, sql } from 'drizzle-orm'
import type { ModelMessage } from 'ai'
import { PROVIDER_SWITCH_ENTRY, readProviderSwitchEntry, visibleText, type MessageAuthor, type ProviderSwitch } from '@rerun/contracts'
import { getSystemDb } from '../systemDb.js'
import { compactionCheckpoints, messages, type MessageRow } from '../schema.js'
import { newId, nowIso } from '../../lib/ids.js'

// What was said, which is not everything that carries a `text`: a reasoning part does too, and so
// does the context the engine appends to a user turn. It feeds both the search index and the
// `output` of a run.
export function extractText(content: unknown): string {
    return visibleText(content, ' ')
}

export async function appendMessage(agentId: string, sessionId: string, message: ModelMessage, author?: MessageAuthor): Promise<MessageRow> {
    const row: MessageRow = {
        id: newId(),
        sessionId,
        role: message.role,
        contentJson: JSON.stringify(message.content),
        toolCallsJson: null,
        createdAt: nowIso(),
        authorId: author?.id ?? null,
        authorName: author?.name ?? null,
        authorVia: author?.via ?? null,
    }
    const { db, client } = await getSystemDb(agentId)
    await db.insert(messages).values(row)
    const text = extractText(message.content)
    if (text) await client.execute({ sql: 'INSERT INTO messages_fts(content, message_id) VALUES (?, ?)', args: [text, row.id] })
    return row
}

// The replies the model closed its answer with live beside the row, never in `content_json`: the
// history the model reads back must not show them, the chat and a reload must.
export async function setMessageToolCalls(agentId: string, messageId: string, calls: unknown[]): Promise<void> {
    const { db } = await getSystemDb(agentId)
    await db.update(messages).set({ toolCallsJson: JSON.stringify(calls) }).where(eq(messages.id, messageId))
}

// The last time this conversation moved between a subscription and a backup, read off the markers
// stored beside its messages.
export async function lastProviderSwitch(agentId: string, sessionId: string): Promise<ProviderSwitch | null> {
    const { db } = await getSystemDb(agentId)
    const [row] = await db
        .select({ toolCallsJson: messages.toolCallsJson })
        .from(messages)
        .where(and(eq(messages.sessionId, sessionId), like(messages.toolCallsJson, `%"${PROVIDER_SWITCH_ENTRY}"%`)))
        .orderBy(desc(messages.createdAt), desc(sql`rowid`))
        .limit(1)
    if (!row?.toolCallsJson) return null
    const entries = JSON.parse(row.toolCallsJson) as unknown[]
    return entries.map(readProviderSwitchEntry).filter(change => change !== null).at(-1) ?? null
}

export async function listMessages(agentId: string, sessionId: string): Promise<MessageRow[]> {
    const { db } = await getSystemDb(agentId)
    return db.select().from(messages).where(eq(messages.sessionId, sessionId)).orderBy(asc(messages.createdAt))
}

// Two messages of one turn can share a millisecond, so the insertion order breaks the tie.
export async function lastMessage(agentId: string, sessionId: string): Promise<MessageRow | undefined> {
    const { db } = await getSystemDb(agentId)
    const [row] = await db.select().from(messages).where(eq(messages.sessionId, sessionId)).orderBy(desc(messages.createdAt), desc(sql`rowid`)).limit(1)
    return row
}

export async function lastMessageId(agentId: string, sessionId: string): Promise<string | undefined> {
    return (await lastMessage(agentId, sessionId))?.id
}

export async function deleteMessage(agentId: string, messageId: string): Promise<void> {
    const { db, client } = await getSystemDb(agentId)
    await db.delete(messages).where(eq(messages.id, messageId))
    await client.execute({ sql: 'DELETE FROM messages_fts WHERE message_id = ?', args: [messageId] })
}

type OrderedRow = { id: string; role: string; createdAt: string }

async function orderedRows(agentId: string, sessionId: string): Promise<OrderedRow[]> {
    const { db } = await getSystemDb(agentId)
    return db.select({ id: messages.id, role: messages.role, createdAt: messages.createdAt }).from(messages).where(eq(messages.sessionId, sessionId)).orderBy(asc(messages.createdAt), asc(sql`rowid`))
}

// A compaction summary that covers a removed message would hand it back to the model, so every
// checkpoint reaching it goes; the next run summarises again from what is left.
async function removeRows(agentId: string, sessionId: string, rows: OrderedRow[]): Promise<string[]> {
    if (rows.length === 0) return []
    const ids = rows.map(row => row.id)
    const earliest = rows.reduce((min, row) => (row.createdAt < min ? row.createdAt : min), rows[0].createdAt)
    const { db, client } = await getSystemDb(agentId)
    await db.delete(messages).where(and(eq(messages.sessionId, sessionId), inArray(messages.id, ids)))
    await client.execute({ sql: `DELETE FROM messages_fts WHERE message_id IN (${ids.map(() => '?').join(', ')})`, args: ids })
    await db.delete(compactionCheckpoints).where(and(eq(compactionCheckpoints.sessionId, sessionId), gte(compactionCheckpoints.throughCreatedAt, earliest)))
    return ids
}

// Removes the message and everything written after it: an edited message, or a reply asked again,
// starts the conversation over from there.
export async function truncateSessionFrom(agentId: string, sessionId: string, messageId: string): Promise<string[] | null> {
    const rows = await orderedRows(agentId, sessionId)
    const at = rows.findIndex(row => row.id === messageId)
    if (at < 0) return null
    return removeRows(agentId, sessionId, rows.slice(at))
}

// A message of the user goes alone. A reply goes whole, from the first row the coworker wrote after
// the user's message to the next one: its tool calls and their results never outlive each other.
export async function deleteConversationMessage(agentId: string, sessionId: string, messageId: string): Promise<string[] | null> {
    const rows = await orderedRows(agentId, sessionId)
    const at = rows.findIndex(row => row.id === messageId)
    if (at < 0) return null
    if (rows[at].role === 'user') return removeRows(agentId, sessionId, [rows[at]])
    let start = at
    while (start > 0 && rows[start - 1].role !== 'user') start--
    let end = at + 1
    while (end < rows.length && rows[end].role !== 'user') end++
    return removeRows(agentId, sessionId, rows.slice(start, end))
}

export async function listSessionAuthorIds(agentId: string, sessionId: string): Promise<string[]> {
    const { db } = await getSystemDb(agentId)
    const rows = await db.selectDistinct({ authorId: messages.authorId }).from(messages).where(and(eq(messages.sessionId, sessionId), isNotNull(messages.authorId)))
    return rows.flatMap(row => (row.authorId ? [row.authorId] : []))
}

export async function listMessagesAfter(agentId: string, sessionId: string, after?: string): Promise<MessageRow[]> {
    const { db } = await getSystemDb(agentId)
    const where = after ? and(eq(messages.sessionId, sessionId), gt(messages.createdAt, after)) : eq(messages.sessionId, sessionId)
    return db.select().from(messages).where(where).orderBy(asc(messages.createdAt))
}

export async function collectAssistantText(agentId: string, sessionId: string, from: string, to: string | null): Promise<string> {
    const { db } = await getSystemDb(agentId)
    const rows = await db
        .select()
        .from(messages)
        .where(and(eq(messages.sessionId, sessionId), gte(messages.createdAt, from)))
        .orderBy(asc(messages.createdAt))
    return rows
        .filter(r => r.role === 'assistant' && (!to || r.createdAt <= to))
        .map(r => extractText(JSON.parse(r.contentJson)))
        .filter(Boolean)
        .join('\n')
}
