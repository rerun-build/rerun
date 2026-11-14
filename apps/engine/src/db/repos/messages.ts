import { and, asc, desc, eq, gt, gte, isNotNull, sql } from 'drizzle-orm'
import type { ModelMessage } from 'ai'
import { visibleText, type MessageAuthor } from '@rerun/contracts'
import { getSystemDb } from '../systemDb.js'
import { messages, type MessageRow } from '../schema.js'
import { newId, nowIso } from '../../lib/ids.js'

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
    }
    const { db, client } = await getSystemDb(agentId)
    await db.insert(messages).values(row)
    const text = extractText(message.content)
    if (text) await client.execute({ sql: 'INSERT INTO messages_fts(content, message_id) VALUES (?, ?)', args: [text, row.id] })
    return row
}

export async function setMessageToolCalls(agentId: string, messageId: string, calls: unknown[]): Promise<void> {
    const { db } = await getSystemDb(agentId)
    await db.update(messages).set({ toolCallsJson: JSON.stringify(calls) }).where(eq(messages.id, messageId))
}

export async function listMessages(agentId: string, sessionId: string): Promise<MessageRow[]> {
    const { db } = await getSystemDb(agentId)
    return db.select().from(messages).where(eq(messages.sessionId, sessionId)).orderBy(asc(messages.createdAt))
}

export async function lastMessageId(agentId: string, sessionId: string): Promise<string | undefined> {
    const { db } = await getSystemDb(agentId)
    const [row] = await db.select({ id: messages.id }).from(messages).where(eq(messages.sessionId, sessionId)).orderBy(desc(messages.createdAt), desc(sql`rowid`)).limit(1)
    return row?.id
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
