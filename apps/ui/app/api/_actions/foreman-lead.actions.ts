'use server'

import { actorFromContext, assertAgentInWorkspace } from '@/app/api/_auth/access'
import { requireWorkspaceContext } from '@/app/api/_auth/ownership'
import { PLAIN_KICKOFF } from '@/lib/foreman/build-team'
import { startAgentSetup, type HandoffResult } from '@/lib/foreman/setup-handoff'
import { selectMany } from '@/supabase/supabase-helpers'
import { failure, failureOf, type ActionFailure } from '@/lib/i18n/action-error'

export type StartLeadSetupResult = { ok: true; conversationId: string; runId: string | null } | (ActionFailure & { inactive?: boolean })

type WorkspaceContext = Awaited<ReturnType<typeof requireWorkspaceContext>>

async function latestConversationId(ctx: WorkspaceContext, agentId: string): Promise<string | null> {
    const { data: sessions } = await selectMany(ctx.supabase, 'sessions', ['id'] as const, { agent_id: agentId }, { column: 'created_at', ascending: false }, 1)
    return sessions?.[0]?.id ?? null
}

// What the button reads to know it was already pressed: a lead that has a conversation has started
// its install, on this device or another, today or weeks ago.
export async function readLeadInstallAction(agentId: string): Promise<{ conversationId: string | null }> {
    try {
        const ctx = await requireWorkspaceContext()
        await assertAgentInWorkspace(agentId, 'use', actorFromContext(ctx))
        return { conversationId: await latestConversationId(ctx, agentId) }
    } catch {
        return { conversationId: null }
    }
}

// The button the Foreman leaves under the build: the lead's install runs only once the user asks
// for it. A press that lands on a lead already started opens the conversation it runs in rather
// than a second install beside it.
export async function startLeadSetupAction(agentId: string): Promise<StartLeadSetupResult> {
    try {
        const ctx = await requireWorkspaceContext()
        await assertAgentInWorkspace(agentId, 'use', actorFromContext(ctx))

        const existing = await latestConversationId(ctx, agentId)
        if (existing) return { ok: true, conversationId: existing, runId: null }

        const handoff = (await startAgentSetup(ctx, { agents: [{ agentId, message: PLAIN_KICKOFF }] })) as { agents: HandoffResult[] }
        const result = handoff.agents[0]
        if (result?.inactive) return { ...failure('noFreeSlot'), inactive: true }
        if (!result?.started || !result.conversationId) return result?.error ? { ok: false, error: result.error } : failure('startCoworkerFailed')
        return { ok: true, conversationId: result.conversationId, runId: result.runId ?? null }
    } catch (err) {
        return failureOf(err, 'startCoworkerFailed')
    }
}
