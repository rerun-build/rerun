import 'server-only'

import { FOREMAN_AGENT_ID, FOREMAN_DISPLAY_NAME } from '@rerun/contracts'

import { memberActor, visibleAgentIds } from '@/app/api/_auth/access'
import type { NotificationPayload } from '@/lib/engine/types'
import { pushNotification } from '@rerun/cloud/email'
import { coworkerRuleOf, normalizeNotificationPrefs } from '@/lib/notifications/prefs'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import { openForemanRoutineThread } from './conversation'
import { sanitizeForemanName } from './name'

// A check-in of the Chief of Staff that decided to speak, as the engine announces it: the session it
// ran in, opened as a thread of the member it is for. Every other session the engine opens on its
// own is one of its routines.
export function isCheckinAnnouncement(payload: Pick<NotificationPayload, 'event' | 'metadata'>): boolean {
    const checkin = payload.metadata?.checkin
    return payload.event === 'agent.session.created' && !!checkin && typeof checkin === 'object'
}

// The member the engine named, held to what they reach now: still a member, and one who sees the
// whole workspace. The thread is the session the check-in ran in, so its reader gets everything the
// run read, across every Box. Null leaves the thread to whoever reads the foreman's routines.
export async function checkinReaderOf(workspaceId: number, metadata: NotificationPayload['metadata']): Promise<string | null> {
    const memberId = typeof metadata?.memberId === 'string' ? metadata.memberId : null
    if (!memberId) return null
    const actor = await memberActor(workspaceId, memberId)
    if (!actor || actor.organizationStaff) return null
    return (await visibleAgentIds(actor)) === 'all' ? memberId : null
}

export async function foremanNameOf(workspaceId: number): Promise<string> {
    const { data } = await selectMaybeSingle(createServiceRoleClient(), 'workspace_onboarding', ['answers'] as const, { workspace_id: workspaceId })
    const answers = data?.answers as { foreman?: { name?: unknown } } | null
    return sanitizeForemanName(answers?.foreman?.name) ?? FOREMAN_DISPLAY_NAME
}

// Opens the thread waiting to be read, and tells its reader's phone, unless they muted the Chief of
// Staff or asked for nothing at all. Never thrown, like everything the engine's webhook does.
export async function openCheckinThread(workspaceId: number, payload: NotificationPayload, { push }: { push: boolean }): Promise<void> {
    if (!payload.sessionId) return
    const reader = await checkinReaderOf(workspaceId, payload.metadata).catch(() => null)
    const thread = await openForemanRoutineThread(workspaceId, payload.sessionId, payload.title ?? FOREMAN_DISPLAY_NAME, { userId: reader, status: 'awaiting_ack' })
    if (!thread || !push) return
    try {
        const supabase = createServiceRoleClient()
        const { data: user } = await selectMaybeSingle(supabase, 'users', ['email_notification_prefs'] as const, { id: thread.userId })
        const prefs = normalizeNotificationPrefs(user?.email_notification_prefs)
        if (prefs.scope === 'nothing' || coworkerRuleOf(prefs, FOREMAN_AGENT_ID).mode === 'muted') return
        await pushNotification(supabase, {
            workspaceId,
            agentId: FOREMAN_AGENT_ID,
            agentName: await foremanNameOf(workspaceId),
            conversationId: thread.id,
            sourceKey: `checkin:${payload.sessionId}`,
            notification: { ...payload, kind: 'info' },
            recipients: { [thread.userId]: 'workspace' },
            members: [{ id: thread.userId, prefs: user?.email_notification_prefs ?? null }],
        })
    } catch (err) {
        console.error('[foreman] failed to push a check-in', err)
    }
}
