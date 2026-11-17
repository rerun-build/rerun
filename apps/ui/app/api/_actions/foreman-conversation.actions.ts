'use server'

import type { Conversation } from '@rerun/contracts'
import type { UIMessage } from 'ai'

import { requireWorkspaceContext } from '@/app/api/_auth/ownership'
import { pendingRequestPeek, type PendingRequestPeek } from '@/lib/chat/pending-request-peek'
import { resolveMemberIdentities } from '@/app/api/_services/members.service'
import { foremanAgentId } from '@/lib/foreman/agent-row'
import { listForemanConversations, listTeamForemanConversations, readForemanEngineMessages, readTeamForemanTranscript } from '@/lib/foreman/conversation'
import { createServiceRoleClient } from '@/supabase/serviceRole'

/** The Chief of Staff's row of `agents`, what its chat addresses it by like a coworker. */
export async function getForemanAgentIdAction(): Promise<string | null> {
    try {
        const ctx = await requireWorkspaceContext()
        if (ctx.authUser.is_anonymous) return null
        return await foremanAgentId(ctx.workspace.id)
    } catch {
        return null
    }
}

/** General and its threads, for the column: the same list the app reads from /api/v1/foreman/conversations. */
export async function listForemanConversationsAction(): Promise<Conversation[]> {
    try {
        return await listForemanConversations(await requireWorkspaceContext())
    } catch {
        return []
    }
}

/** What a conversation of the Chief of Staff waits on, read the way `peekPendingRequestAction` reads a coworker's. */
export async function peekForemanPendingRequestAction(sessionId: string): Promise<PendingRequestPeek | null> {
    try {
        const messages = await readForemanEngineMessages(await requireWorkspaceContext(), sessionId)
        return messages.length ? pendingRequestPeek(messages) : null
    } catch {
        return null
    }
}

export type TeamForemanConversationEntry = Conversation & { ownerId: string; ownerName: string | null }

/** For an admin: the other members' conversations with the Chief of Staff, to read, never to continue. */
export async function listTeamForemanConversationsAction(): Promise<TeamForemanConversationEntry[]> {
    try {
        const ctx = await requireWorkspaceContext()
        const conversations = await listTeamForemanConversations(ctx)
        const identities = await resolveMemberIdentities(createServiceRoleClient(), [...new Set(conversations.map(conversation => conversation.ownerId))])
        return conversations.map(conversation => ({ ...conversation, ownerName: identities.get(conversation.ownerId)?.name ?? identities.get(conversation.ownerId)?.email ?? null }))
    } catch {
        return []
    }
}

export async function readTeamForemanConversationAction(sessionId: string): Promise<UIMessage[] | null> {
    try {
        return await readTeamForemanTranscript(await requireWorkspaceContext(), sessionId)
    } catch {
        return null
    }
}
