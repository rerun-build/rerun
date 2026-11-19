import { realEmail } from '@/lib/auth/placeholder-email'
import { after } from 'next/server'
import { FOREMAN_AGENT_ID } from '@moldwright/contracts'

import { boxAccessOf, toAccessLevel } from '@/app/api/_auth/access'
import { toBoxScope } from '@/app/api/_auth/box-scope'
import type { Database } from '@/app/api/database.types'
import { BANNER_WARM_INLINE_MS, buildUnsubscribeUrl, emailBoardBanner, pushNotification, sendIncidentResolvedEmail, sendNotificationEmail } from '@moldwright/cloud/email'
import { notificationUrl } from '@/lib/app-url'
import type { NotificationPayload } from '@/lib/engine/types'
import { RERUN_BUDGET_ERROR_CODE, suppressesErrorEmail } from '@/lib/notifications/budget-notice'
import { recipientLocale } from '@/lib/i18n/recipient-locale'
import { announcesRecovery, emailSourceLabel, incidentKeyFor, resolvedIncidentKeysFor } from '@/lib/notifications/incidents'
import { automatedRunOutcome, automatedRunReport, completionStatus, isRunCompletion, storedKind, type StoredNotification } from '@/lib/notifications/inbound'
import { NOTIFICATION_EMAILS_PAUSED, coworkerRuleOf, normalizeNotificationPrefs } from '@/lib/notifications/prefs'
import { isPresent } from '@/lib/notifications/presence'
import { emailReasonSentence } from '@/lib/notifications/reason-copy'
import { computeRecipients, needsOwnerFollow, wantsIncidentEmail, wantsRecoveryEmail, type NotificationRecipients, type RoutedEvent, type RoutedMember } from '@/lib/notifications/routing'
import { boardStatusOfKind } from '@/lib/og/team-board'
import { generateRunTitle } from '@/lib/ai/generate-run-title'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'
import { ensureSessionRow } from './chat.service'
import { writeNotificationPrefs } from './notification-audience.service'
import { loadPresence } from './presence.service'
import { authenticateEngineToken } from './workspace-engine.service'
import { resolveWorkspaceMemberEmail, resolveWorkspaceOwner } from './workspace-owner.service'
import { captureServer, deterministicUuid } from '@moldwright/analytics/server'
import { emailTranslator } from '@moldwright/emails/i18n'

type NotificationInsert = Database['public']['Tables']['notifications']['Insert']
type SessionUpdate = Database['public']['Tables']['sessions']['Update']
type SessionSource = Database['public']['Enums']['session_source']
type ServiceRoleClient = ReturnType<typeof createServiceRoleClient>

export type RecordNotificationResult = { ok: true } | { ok: false; status: number; error: string }

export async function recordNotification(token: string, payload: NotificationPayload): Promise<RecordNotificationResult> {
    const supabase = createServiceRoleClient()

    const engine = await authenticateEngineToken(token)
    if (!engine) return { ok: false, status: 401, error: 'Unauthorized' }

    if (payload.agentId === FOREMAN_AGENT_ID) return { ok: true }

    const { data: agent } = await selectMaybeSingle(supabase, 'agents', ['id', 'name', 'space_id'] as const, { workspace_id: engine.workspaceId, engine_agent_id: payload.agentId })

    if (payload.event === 'agent.session.created') {
        if (agent?.id && payload.sessionId) await mirrorSession(supabase, engine.workspaceId, agent.id, payload)
        return { ok: true }
    }

    const kind = storedKind(payload)
    if (!kind) return { ok: true }
    const notification: StoredNotification = { ...payload, kind }

    if (isCancelled(notification)) {
        await applySessionStatus(supabase, agent?.id ?? null, notification)
        return { ok: true }
    }

    const audience = await resolveAudience(supabase, engine.workspaceId, agent ?? null, notification)
    const recipients = computeRecipients(audience.event, audience.members)

    const { data: stored, error } = await supabase.from('notifications').insert<NotificationInsert>({
        workspace_id: engine.workspaceId,
        space_id: agent?.space_id ?? null,
        agent_id: agent?.id ?? null,
        engine_agent_id: notification.agentId,
        engine_session_id: notification.sessionId ?? null,
        engine_run_id: notification.runId ?? null,
        event: notification.event,
        kind: notification.kind,
        source: audience.source,
        message: notification.message,
        metadata: (notification.metadata ?? null) as unknown as NotificationInsert['metadata'],
        recipients: recipients as unknown as NotificationInsert['recipients'],
        notified_at: notification.timestamp,
    })
        .select('id')
        .single()
    if (error || !stored) return { ok: false, status: 500, error: 'Failed to store notification' }

    await applySessionStatus(supabase, agent?.id ?? null, notification)
    after(() => retitleAutomatedRun(supabase, agent?.id ?? null, notification))

    if (!engine.isSandbox) await reportChatRun(engine.workspaceId, agent?.id ?? notification.agentId, notification)

    if (!engine.isSandbox && !NOTIFICATION_EMAILS_PAUSED) await emailIncidents(supabase, { workspaceId: engine.workspaceId, notificationId: stored.id, agentId: agent?.id ?? null, agentName: agent?.name ?? 'your coworker', notification, recipients, members: audience.members })
    if (!engine.isSandbox) {
        const sourceKey = incidentKeyFor({ event: notification.event, kind: notification.kind, agentId: notification.agentId, source: notification.source, metadata: notification.metadata, sessionId: notification.sessionId })
        await pushNotification(supabase, { workspaceId: engine.workspaceId, agentId: agent?.id ?? null, agentName: agent?.name ?? 'your coworker', conversationId: audience.conversationId, sourceKey, notification, recipients, members: audience.members })
    }

    return { ok: true }
}

async function reportChatRun(workspaceId: number, agentId: string, notification: StoredNotification): Promise<void> {
    if (notification.event !== 'agent.message.completed' || (notification.kind !== 'done' && notification.kind !== 'error')) return
    try {
        const metadata = notification.metadata ?? {}
        const author = typeof metadata.authorId === 'string' ? await resolveWorkspaceMemberEmail(workspaceId, metadata.authorId) : null
        const person = author ?? (await resolveWorkspaceOwner(workspaceId))?.email
        if (!person) return
        const props = {
            agent_id: agentId,
            workspace_id: workspaceId,
            session_id: notification.sessionId ?? undefined,
            run_id: notification.runId ?? undefined,
            steps: typeof metadata.stepCount === 'number' ? metadata.stepCount : undefined,
            model: typeof metadata.model === 'string' ? metadata.model : undefined,
            cost_micros: typeof metadata.costMicros === 'number' ? metadata.costMicros : undefined,
        }
        const uuid = notification.runId ? deterministicUuid(`run:${notification.runId}`) : undefined
        if (notification.kind === 'done') {
            await captureServer(person, 'agent_run_completed', props, { uuid })
            return
        }
        const errorCode = typeof metadata.errorCode === 'string' ? metadata.errorCode : 'run_error'
        if (errorCode === RERUN_BUDGET_ERROR_CODE) return
        await captureServer(person, 'agent_run_failed', { ...props, error_type: errorCode }, { uuid })
    } catch (err) {
        console.error('[notification] failed to report the run to analytics', err)
    }
}

async function mirrorSession(supabase: ServiceRoleClient, workspaceId: number, agentId: string, payload: NotificationPayload): Promise<void> {
    if (!payload.sessionId) return
    try {
        const { data: origin } = payload.originAgentId ? await selectMaybeSingle(supabase, 'agents', ['id'] as const, { workspace_id: workspaceId, engine_agent_id: payload.originAgentId }) : { data: null }
        await ensureSessionRow(agentId, payload.sessionId, payload.title ?? 'Scheduled run', { status: 'working', source: (payload.source ?? 'schedule') as SessionSource, originAgentId: origin?.id ?? null })
    } catch (err) {
        console.error('[notification] failed to create session', err)
    }
}

function isCancelled(notification: StoredNotification): boolean {
    return (notification.metadata as { status?: unknown } | null)?.status === 'cancelled'
}

async function applySessionStatus(supabase: ServiceRoleClient, agentId: string | null, notification: StoredNotification): Promise<void> {
    const status = completionStatus(notification)
    if (!status || !agentId || !notification.sessionId) return
    try {
        let query = supabase.from('sessions').update<SessionUpdate>({ status }, { count: 'exact' }).eq('agent_id', agentId).eq('engine_session_id', notification.sessionId)
        if (status === 'idle') query = query.neq('status', 'awaiting_ack')
        const { error, count } = await query
        if (error) console.error('[notification] failed to update session status', error)
        else if (count === 0 && status !== 'idle') console.warn('[notification] no session row for', { agentId, engineSessionId: notification.sessionId, status })
    } catch (err) {
        console.error('[notification] failed to update session status', err)
    }
}

async function retitleAutomatedRun(supabase: ServiceRoleClient, agentId: string | null, notification: StoredNotification): Promise<void> {
    const run = automatedRunReport(notification)
    if (!run || !agentId || !notification.sessionId) return
    try {
        const { data: session } = await selectMaybeSingle(supabase, 'sessions', ['id', 'title', 'automation_name'] as const, { agent_id: agentId, engine_session_id: notification.sessionId })
        if (!session) return
        const routineName = session.automation_name ?? session.title
        const generated = run.report ? await generateRunTitle(routineName, run.report, run.failed) : null
        const { error } = await supabase
            .from('sessions')
            .update<SessionUpdate>({ automation_name: routineName, outcome: automatedRunOutcome(run.failed, generated?.nothingToReport ?? false), ...(generated && { title: generated.title }) })
            .eq('id', session.id)
        if (error) console.error('[notification] failed to retitle the run', error)
    } catch (err) {
        console.error('[notification] failed to retitle the run', err)
    }
}

type Audience = { event: RoutedEvent; source: SessionSource | null; members: RoutedMember[]; conversationId: string | null }

type Membership = { user_id: string; role: Database['public']['Enums']['workspace_role']; box_scope: string }

export async function membersReachingBox(supabase: ServiceRoleClient, workspaceId: number, spaceId: string | null, memberships: Membership[]): Promise<Membership[]> {
    if (!spaceId) return memberships
    const [{ data: space }, { data: grants }] = await Promise.all([
        selectMaybeSingle(supabase, 'spaces', ['workspace_id', 'visibility'] as const, { id: spaceId }),
        selectMany(supabase, 'space_members', ['user_id', 'access'] as const, { space_id: spaceId }),
    ])
    const box = space ?? { workspace_id: workspaceId, visibility: 'restricted' }
    const grantOf = new Map((grants ?? []).map(grant => [grant.user_id, toAccessLevel(grant.access)]))
    return memberships.filter(m => boxAccessOf({ kind: 'user', userId: m.user_id, workspaceId, role: m.role, boxScope: toBoxScope(m.box_scope) }, box, grantOf.get(m.user_id) ?? null) !== 'none')
}

async function resolveAudience(supabase: ServiceRoleClient, workspaceId: number, agent: { id: string; space_id: string } | null, notification: StoredNotification): Promise<Audience> {
    const agentId = agent?.id ?? null
    const [{ data: session }, { data: memberships }] = await Promise.all([
        agentId && notification.sessionId ? selectMaybeSingle(supabase, 'sessions', ['id', 'source'] as const, { agent_id: agentId, engine_session_id: notification.sessionId }) : Promise.resolve({ data: null }),
        selectMany(supabase, 'workspace_members', ['user_id', 'role', 'box_scope'] as const, { workspace_id: workspaceId }),
    ])
    const reaching = await membersReachingBox(supabase, workspaceId, agent?.space_id ?? null, memberships ?? [])
    const memberIds = new Set(reaching.map(m => m.user_id))
    const [{ data: participants }, { data: users }] = await Promise.all([
        session ? selectMany(supabase, 'session_participants', ['user_id'] as const, { session_id: session.id }, { column: 'last_message_at', ascending: false }) : Promise.resolve({ data: [] }),
        memberIds.size ? selectMany(supabase, 'users', ['id', 'email_notification_prefs'] as const, { id: [...memberIds] }) : Promise.resolve({ data: [] }),
    ])

    const participantIds = (participants ?? []).map(p => p.user_id).filter(id => memberIds.has(id))
    const claimed = notification.metadata?.authorId
    const authorId = typeof claimed === 'string' && memberIds.has(claimed) ? claimed : (participantIds[0] ?? null)
    const source = (notification.source ?? session?.source ?? null) as SessionSource | null

    const slug = notification.metadata?.scheduleSlug ?? notification.metadata?.triggerSlug
    const event: RoutedEvent = { agentId, kind: notification.kind, source, authorId, participantIds, taskSlug: typeof slug === 'string' ? slug : null }
    const members = (users ?? []).map(u => ({ id: u.id, prefs: u.email_notification_prefs }))
    return { event, source, members: await withOwnerFollow(supabase, workspaceId, event, members), conversationId: session?.id ?? null }
}

async function withOwnerFollow(supabase: ServiceRoleClient, workspaceId: number, event: RoutedEvent, members: RoutedMember[]): Promise<RoutedMember[]> {
    if (!event.agentId || !needsOwnerFollow(event, members)) return members
    try {
        const owner = await resolveWorkspaceOwner(workspaceId)
        const member = owner && members.find(m => m.id === owner.userId)
        if (!member) return members
        const prefs = normalizeNotificationPrefs(member.prefs)
        const followed = { ...prefs, coworkers: { ...prefs.coworkers, [event.agentId]: { ...coworkerRuleOf(prefs, event.agentId), follow: true } } }
        await writeNotificationPrefs(member.id, followed)
        return members.map(m => (m.id === member.id ? { ...m, prefs: followed } : m))
    } catch (err) {
        console.error('[notification] failed to hand the scheduled task to the owner', err)
        return members
    }
}

type IncidentContext = {
    workspaceId: number
    notificationId: string
    agentId: string | null
    agentName: string
    notification: StoredNotification
    recipients: NotificationRecipients
    members: RoutedMember[]
}

async function emailIncidents(supabase: ServiceRoleClient, context: IncidentContext): Promise<void> {
    const { notification } = context
    try {
        const keyInput = { event: notification.event, kind: notification.kind, agentId: notification.agentId, source: notification.source, metadata: notification.metadata, sessionId: notification.sessionId }
        if (notification.kind === 'done' && isRunCompletion(notification.event)) {
            await resolveIncidents(supabase, context, resolvedIncidentKeysFor(keyInput))
            return
        }
        if (suppressesErrorEmail(notification.kind, notification.metadata)) return

        const prefsOf = new Map(context.members.map(m => [m.id, m.prefs]))
        const wanting = Object.entries(context.recipients).flatMap(([userId, reason]) => (wantsIncidentEmail(prefsOf.get(userId), reason, notification.kind, context.agentId) ? [{ userId, reason }] : []))
        if (!wanting.length) return

        const now = new Date()
        const presence = await loadPresence(supabase, wanting.map(w => w.userId))
        const online = new Set(presence.filter(row => isPresent(row.last_seen_at, now)).map(row => row.user_id))
        const away = wanting.filter(w => !online.has(w.userId))
        if (!away.length) return

        const key = incidentKeyFor(keyInput)
        const banner = lazyBanner(supabase, context)
        await Promise.allSettled(
            away.map(async ({ userId, reason }) => {
                const { data: opened, error } = await supabase.rpc('open_notification_incident', { p_user_id: userId, p_source_key: key })
                if (error) throw new Error(error.message)
                if (!opened) return
                const to = await emailOf(supabase, userId)
                const locale = await recipientLocale(supabase, userId, context.workspaceId)
                const sent = to
                    ? await sendNotificationEmail({
                          to,
                          kind: notification.kind,
                          agentName: context.agentName,
                          message: notification.message,
                          runId: notification.runId ?? null,
                          reason: emailReasonSentence(reason, context.agentName, emailTranslator(locale)),
                          boardUrl: await banner(),
                          conversationUrl: notificationUrl(context.notificationId),
                          unsubscribeUrl: buildUnsubscribeUrl(userId, undefined, 'runs'),
                          locale,
                      })
                    : null
                if (!sent?.ok) await dropIncident(supabase, userId, key)
            }),
        )
    } catch (err) {
        console.error('[notification] failed to email the incident', err)
    }
}

async function resolveIncidents(supabase: ServiceRoleClient, context: IncidentContext, keys: string[]): Promise<void> {
    const now = new Date()
    const banner = lazyBanner(supabase, context)
    const prefsOf = new Map(context.members.map(m => [m.id, m.prefs]))
    await Promise.allSettled(
        keys.map(async key => {
            const { data: userIds, error } = await supabase.rpc('resolve_notification_incidents', { p_source_key: key })
            if (error) throw new Error(error.message)
            if (!userIds?.length || !announcesRecovery(key)) return
            const wanting = userIds.filter(userId => prefsOf.has(userId) && wantsRecoveryEmail(prefsOf.get(userId), context.agentId))
            if (!wanting.length) return
            const presence = await loadPresence(supabase, wanting)
            const online = new Set(presence.filter(row => isPresent(row.last_seen_at, now)).map(row => row.user_id))
            await Promise.allSettled(
                wanting
                    .filter(userId => !online.has(userId))
                    .map(async userId => {
                        const to = await emailOf(supabase, userId)
                        if (!to) return
                        const reason = context.recipients[userId]
                        const locale = await recipientLocale(supabase, userId, context.workspaceId)
                        const t = emailTranslator(locale)
                        await sendIncidentResolvedEmail({
                            to,
                            agentName: context.agentName,
                            sourceLabel: emailSourceLabel(key, t),
                            reason: reason ? emailReasonSentence(reason, context.agentName, t) : undefined,
                            boardUrl: await banner(),
                            conversationUrl: notificationUrl(context.notificationId),
                            unsubscribeUrl: buildUnsubscribeUrl(userId, undefined, 'runs'),
                            locale,
                        })
                    }),
            )
        }),
    )
}

function lazyBanner(supabase: ServiceRoleClient, { workspaceId, agentId, notification }: IncidentContext): () => Promise<string | undefined> {
    let banner: Promise<string | undefined> | undefined
    return () => (banner ??= agentId ? emailBoardBanner(supabase, workspaceId, { [agentId]: boardStatusOfKind(notification.kind) }, BANNER_WARM_INLINE_MS) : Promise.resolve(undefined))
}

async function dropIncident(supabase: ServiceRoleClient, userId: string, key: string): Promise<void> {
    const { error } = await supabase.from('notification_incidents').delete().eq('user_id', userId).eq('source_key', key)
    if (error) console.error('[notification] failed to drop an incident nobody was emailed about', error)
}

async function emailOf(supabase: ServiceRoleClient, userId: string): Promise<string | null> {
    const { data } = await supabase.auth.admin.getUserById(userId)
    return realEmail(data.user?.email) ?? null
}
