import 'server-only'

import { MAX_OPEN_CHATS, type ChangeOpenChats, type DeviceKind, type OpenChats } from '@rerun/contracts'

import { assertAgentAccess, type AccessedAgent, type Actor } from '@/app/api/_auth/access'
import { ownerFilterOf } from '@/app/api/_services/conversation.service'
import type { Database } from '@/app/api/database.types'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'

type OpenChatInsert = Database['public']['Tables']['open_chats']['Insert']
type OpenChatStateInsert = Database['public']['Tables']['open_chat_states']['Insert']
type Caller = { userId: string; agent: AccessedAgent; actor: Actor }

const NOTHING_OPEN: OpenChats = { chats: [], last: null }

// Whose open chats are asked for: a person's. An API key or the workspace itself has none.
async function callerOf(agentId: string, actor?: Actor): Promise<Caller | null> {
    const { actor: resolved, agent } = await assertAgentAccess(agentId, 'use', actor)
    return resolved.kind === 'user' ? { userId: resolved.userId, agent, actor: resolved } : null
}

// The threads of this coworker the caller may read among those: one deleted, of another coworker, or
// held by another member is left out.
async function readableThreads({ agent, actor }: Caller, sessionIds: string[]): Promise<Map<string, string | null>> {
    const owner = ownerFilterOf(agent, actor)
    if (!owner || sessionIds.length === 0) return new Map()
    const { data, error } = await selectMany(createServiceRoleClient(), 'sessions', ['id', 'title'] as const, { id: sessionIds, agent_id: agent.id, kind: 'thread', ...owner.filter })
    if (error) throw error
    return new Map((data ?? []).map(row => [row.id, row.title]))
}

async function openRows({ userId, agent }: Caller): Promise<{ session_id: string; opened_at: string }[]> {
    const { data, error } = await selectMany(createServiceRoleClient(), 'open_chats', ['session_id', 'opened_at'] as const, { user_id: userId, agent_id: agent.id }, { column: 'opened_at', ascending: true })
    if (error) throw error
    return data ?? []
}

async function lastPicked({ userId, agent }: Caller) {
    const { data, error } = await selectMaybeSingle(createServiceRoleClient(), 'open_chat_states', ['active_session_id', 'device_id', 'device_kind', 'changed_at'] as const, { user_id: userId, agent_id: agent.id })
    if (error) throw error
    return data
}

async function readFor(caller: Caller): Promise<OpenChats> {
    const [rows, last] = await Promise.all([openRows(caller), lastPicked(caller)])
    const ids = rows.map(row => row.session_id)
    const readable = await readableThreads(caller, ids)
    const chats = ids.filter(id => readable.has(id)).map(id => ({ id, title: readable.get(id) ?? null }))
    const activeId = chats.some(chat => chat.id === last?.active_session_id) ? (last?.active_session_id ?? null) : null
    return { chats, last: last ? { activeId, deviceId: last.device_id, deviceKind: last.device_kind as DeviceKind, changedAt: last.changed_at } : null }
}

// Each a moment after the one before it, and after those already open: their order is the tabs'.
async function open(caller: Caller, sessionIds: string[]): Promise<void> {
    if (sessionIds.length === 0) return
    const latest = (await openRows(caller)).at(-1)
    const from = Math.max(Date.now(), latest ? Date.parse(latest.opened_at) + 1 : 0)
    const rows = sessionIds.map((sessionId, index): OpenChatInsert => ({ user_id: caller.userId, agent_id: caller.agent.id, session_id: sessionId, opened_at: new Date(from + index).toISOString() }))
    const { error } = await createServiceRoleClient().from('open_chats').upsert<OpenChatInsert>(rows, { onConflict: 'user_id,session_id', ignoreDuplicates: true })
    if (error) throw error
}

async function close({ userId, agent }: Caller, sessionIds: string[]): Promise<void> {
    if (sessionIds.length === 0) return
    const { error } = await createServiceRoleClient().from('open_chats').delete().eq('user_id', userId).eq('agent_id', agent.id).in('session_id', sessionIds)
    if (error) throw error
}

// The oldest go past the ceiling, never the one picked last.
async function closeOldest(caller: Caller, activeId: string | null): Promise<void> {
    const ids = (await openRows(caller)).map(row => row.session_id)
    const surplus = ids.length - MAX_OPEN_CHATS
    if (surplus > 0) await close(caller, ids.filter(id => id !== activeId).slice(0, surplus))
}

export async function readOpenChats(agentId: string, actor?: Actor): Promise<OpenChats> {
    const caller = await callerOf(agentId, actor)
    return caller ? readFor(caller) : NOTHING_OPEN
}

export async function changeOpenChats(agentId: string, { device, changes, merge = [] }: ChangeOpenChats, actor?: Actor): Promise<OpenChats> {
    const caller = await callerOf(agentId, actor)
    if (!caller) return NOTHING_OPEN

    const readable = await readableThreads(caller, [...new Set([...merge, ...changes.flatMap(change => change.sessionId ?? [])])])
    const opened = new Set<string>()
    const closed = new Set<string>()
    let picked: string | null | undefined
    for (const { type, sessionId } of changes) {
        if (type === 'close') {
            opened.delete(sessionId)
            closed.add(sessionId)
        } else if (sessionId === null || readable.has(sessionId)) {
            picked = sessionId
            if (sessionId === null) continue
            closed.delete(sessionId)
            opened.add(sessionId)
        }
    }

    await close(caller, [...closed])
    if (merge.length > 0) {
        const held = (await openRows(caller)).map(row => row.session_id)
        const missing = merge.filter(id => readable.has(id) && !held.includes(id) && !closed.has(id))
        const room = Math.max(0, MAX_OPEN_CHATS - held.length)
        await open(caller, room > 0 ? missing.slice(-room) : [])
    }
    await open(caller, [...opened])
    if (picked !== undefined) {
        const state: OpenChatStateInsert = { user_id: caller.userId, agent_id: caller.agent.id, active_session_id: picked, device_id: device.id, device_kind: device.kind, changed_at: new Date().toISOString() }
        const { error } = await createServiceRoleClient().from('open_chat_states').upsert<OpenChatStateInsert>(state, { onConflict: 'user_id,agent_id' })
        if (error) throw error
    }
    if (opened.size > 0) await closeOldest(caller, picked ?? null)
    return readFor(caller)
}
