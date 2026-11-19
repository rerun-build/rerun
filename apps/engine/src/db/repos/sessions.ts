import { and, desc, eq } from 'drizzle-orm'
import type { SessionSource } from '@moldwright/contracts'
import { getSystemDb } from '../systemDb.js'
import { sessions, type SessionRow } from '../schema.js'
import { newId, nowIso } from '../../lib/ids.js'

export type SessionOrigin = { originAgentId: string; originSessionId: string }

export async function createSession(agentId: string, title = 'Untitled', origin?: SessionOrigin, source: SessionSource = 'dashboard'): Promise<SessionRow> {
    const now = nowIso()
    const row: SessionRow = {
        id: newId(),
        agentId,
        title,
        status: 'open',
        source,
        originAgentId: origin?.originAgentId ?? null,
        originSessionId: origin?.originSessionId ?? null,
        createdAt: now,
        updatedAt: now,
    }
    const { db } = await getSystemDb(agentId)
    await db.insert(sessions).values(row)
    return row
}

export async function getSession(agentId: string, id: string): Promise<SessionRow | undefined> {
    const { db } = await getSystemDb(agentId)
    const rows = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1)
    return rows[0]
}

export async function listSessions(agentId: string): Promise<SessionRow[]> {
    const { db } = await getSystemDb(agentId)
    return db.select().from(sessions).where(eq(sessions.agentId, agentId)).orderBy(desc(sessions.updatedAt))
}

export async function touchSession(agentId: string, id: string, title?: string): Promise<void> {
    const patch: Partial<SessionRow> = { updatedAt: nowIso() }
    if (title) patch.title = title
    const { db } = await getSystemDb(agentId)
    await db.update(sessions).set(patch).where(eq(sessions.id, id))
}

export async function sessionBelongsToAgent(id: string, agentId: string): Promise<boolean> {
    const { db } = await getSystemDb(agentId)
    const rows = await db.select({ id: sessions.id }).from(sessions).where(and(eq(sessions.id, id), eq(sessions.agentId, agentId))).limit(1)
    return rows.length > 0
}
