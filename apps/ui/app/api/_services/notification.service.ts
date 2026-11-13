import { realEmail } from '@/lib/auth/placeholder-email'
import { after } from 'next/server'
import { FOREMAN_AGENT_ID } from '@rerun/contracts'

import { boxAccessOf, toAccessLevel } from '@/app/api/_auth/access'
import { toBoxScope } from '@/app/api/_auth/box-scope'
import type { Database } from '@/app/api/database.types'
import { BANNER_WARM_INLINE_MS, buildUnsubscribeUrl, emailBoardBanner, pushNotification, sendIncidentResolvedEmail, sendNotificationEmail } from '@rerun/cloud/email'
import { notificationUrl } from '@/lib/app-url'
import { seedSessionTitle } from '@/lib/chat/session-title'
import type { NotificationPayload } from '@/lib/engine/types'
import { RERUN_BUDGET_ERROR_CODE, suppressesErrorEmail } from '@/lib/notifications/budget-notice'
import { recipientLocale } from '@/lib/i18n/recipient-locale'
import { announcesRecovery, emailSourceLabel, incidentKeyFor, resolvedIncidentKeysFor } from '@/lib/notifications/incidents'
import { agentReplyOf, automatedRunOutcome, automatedRunReport, completionStatus, isRunCompletion, storedKind, type StoredNotification } from '@/lib/notifications/inbound'
import { NOTIFICATION_EMAILS_PAUSED, coworkerRuleOf, normalizeNotificationPrefs } from '@/lib/notifications/prefs'
import { isPresent } from '@/lib/notifications/presence'
import { emailReasonSentence } from '@/lib/notifications/reason-copy'
import { computeRecipients, needsOwnerFollow, wantsIncidentEmail, wantsRecoveryEmail, type NotificationRecipients, type RoutedEvent, type RoutedMember } from '@/lib/notifications/routing'
import { boardStatusOfKind } from '@/lib/og/team-board'
import { setForemanConversationStatus } from '@/lib/foreman/conversation'
import { generateRunTitle } from '@/lib/ai/generate-run-title'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'
import { ensureSessionRow } from './chat.service'
import { recordAgentReply } from './session-preview.service'
import { writeNotificationPrefs } from './notification-audience.service'
import { loadPresence } from './presence.service'
import { authenticateEngineToken } from './workspace-engine.service'
import { resolveWorkspaceMemberEmail, resolveWorkspaceOwner } from './workspace-owner.service'
import { captureServer, deterministicUuid } from '@rerun/analytics/server'
import { emailTranslator } from '@rerun/emails/i18n'

type NotificationInsert = Database['public']['Tables']['notifications']['Insert']
type SessionUpdate = Database['public']['Tables']['sessions']['Update']
type SessionSource = Database['public']['Enums']['session_source']
type ServiceRoleClient = ReturnType<typeof createServiceRoleClient>

export type RecordNotificationResult = { ok: true } | { ok: false; status: number; error: string }

// `token` is the engine's RERUN_API_KEY, which names one workspace: the same identity the engine
// uses for /api/embed and for the Hub. `notifications.space_id` records which Box the agent was
// sitting in when it spoke, and nothing reads it back — the inbox filters on the workspace.
export async function recordNotification(token: string, payload: NotificationPayload): Promise<RecordNotificationResult> {
    const supabase = createServiceRoleClient()

    const engine = await authenticateEngineToken(token)
    if (!engine) return { ok: false, status: 401, error: 'Unauthorized' }

    // The foreman answers in the column the user is looking at: none of its runs is inbox news, an
    // email, or the first agent run that counts as activation. Where a run stopped still shows, on
    // its thread in General.
    if (payload.agentId === FOREMAN_AGENT_ID) {
        await applyForemanStatus(engine.workspaceId, payload)
        return { ok: true }
    }

    const { data: agent } = await selectMaybeSingle(supabase, 'agents', ['id', 'name', 'space_id'] as const, { workspace_id: engine.workspaceId, engine_agent_id: payload.agentId })

    if (payload.event === 'agent.session.created') {
        if (agent?.id && payload.sessionId) await mirrorSession(supabase, engine.workspaceId, agent.id, payload)
        return { ok: true }
    }

    const kind = storedKind(payload)
    if (!kind) return { ok: true }
    const notification: StoredNotification = { ...payload, kind }

    // A stopped run still has to clear the conversation's "working" state, but it is not news: the
    // person who pressed Stop does not need "Run finished" in their inbox and in their mailbox.
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

    // The engine is the source of truth for run completion. Mirror it onto the session
    // status so the UI unsticks from 'working' even when the SSE stream was cut. Best-effort.
    await applySessionStatus(supabase, agent?.id ?? null, notification)
    // After the response: a model call must not hold the engine's webhook open.
    after(() => retitleAutomatedRun(supabase, agent?.id ?? null, notification))
    const reply = agentReplyOf(notification)
    const agentId = agent?.id
    const engineSessionId = notification.sessionId
    if (reply && agentId && engineSessionId) after(() => recordAgentReply(agentId, engineSessionId, reply))

    if (!engine.isSandbox) await reportChatRun(engine.workspaceId, agent?.id ?? notification.agentId, notification)

    // Best-effort: a delivery failure must never fail the webhook, the notification is already
    // stored. A sandbox workspace keeps its in-app notifications but never emails anyone.
    if (!engine.isSandbox && !NOTIFICATION_EMAILS_PAUSED) await emailIncidents(supabase, { workspaceId: engine.workspaceId, notificationId: stored.id, agentId: agent?.id ?? null, agentName: agent?.name ?? 'your coworker', notification, recipients, members: audience.members })
    if (!engine.isSandbox) {
        const sourceKey = incidentKeyFor({ event: notification.event, kind: notification.kind, agentId: notification.agentId, source: notification.source, metadata: notification.metadata, sessionId: notification.sessionId })
        await pushNotification(supabase, { workspaceId: engine.workspaceId, agentId: agent?.id ?? null, agentName: agent?.name ?? 'your coworker', conversationId: audience.conversationId, sourceKey, notification, recipients, members: audience.members })
    }

    return { ok: true }
}

// Chat runs only: schedules and triggers run on their own and say nothing about whether someone is
// getting value out of the product. Captured here rather than in the browser because the lead's
// first run is started by the server, and ends whether or not a tab is still watching it.
async function reportChatRun(workspaceId: number, agentId: string, notification: StoredNotification): Promise<void> {
    if (notification.event !== 'agent.message.completed' || (notification.kind !== 'done' && notification.kind !== 'error')) return
    try {
        const metadata = notification.metadata ?? {}
        // Credited to the member who sent the message. An engine that predates `authorId`, or a run
        // rebuilt at boot, names nobody and falls back to the owner.
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
        // The browser sees the same 402 in its stream and already reports it, along with the budget
        // refusals raised before any run exists: budget is the client's, whichever way it hit.
        if (errorCode === RERUN_BUDGET_ERROR_CODE) return
        await captureServer(person, 'agent_run_failed', { ...props, error_type: errorCode }, { uuid })
    } catch (err) {
        console.error('[notification] failed to report the run to analytics', err)
    }
}

// A session the dashboard never opened: a schedule, a trigger, or one agent calling another. It has
// to exist before the run reports anything, because a run that stops on a HITL call carries its
// `awaiting_*` state through this row alone. Same write as the one the hub makes when it starts a
// run itself, hence the shared helper: there is one way to mirror an engine session, not two.
async function mirrorSession(supabase: ServiceRoleClient, workspaceId: number, agentId: string, payload: NotificationPayload): Promise<void> {
    if (!payload.sessionId) return
    try {
        const { data: origin } = payload.originAgentId ? await selectMaybeSingle(supabase, 'agents', ['id'] as const, { workspace_id: workspaceId, engine_agent_id: payload.originAgentId }) : { data: null }
        await ensureSessionRow(agentId, payload.sessionId, payload.title ?? 'Scheduled run', { status: 'working', source: (payload.source ?? 'schedule') as SessionSource, originAgentId: origin?.id ?? null })
    } catch (err) {
        console.error('[notification] failed to create session', err)
    }
}

async function applyForemanStatus(workspaceId: number, payload: NotificationPayload): Promise<void> {
    const kind = storedKind(payload)
    const status = kind ? completionStatus({ ...payload, kind }) : null
    if (status && payload.sessionId) await setForemanConversationStatus(workspaceId, payload.sessionId, status)
}

function isCancelled(notification: StoredNotification): boolean {
    return (notification.metadata as { status?: unknown } | null)?.status === 'cancelled'
}

async function applySessionStatus(supabase: ServiceRoleClient, agentId: string | null, notification: StoredNotification): Promise<void> {
    const status = completionStatus(notification)
    if (!status || !agentId || !notification.sessionId) return
    try {
        let query = supabase.from('sessions').update<SessionUpdate>({ status }, { count: 'exact' }).eq('agent_id', agentId).eq('engine_session_id', notification.sessionId)
        // The other awaiting_* states hold because the run stopped on them and never emitted its
        // `done`. An `info` notification does not stop the run, so that `done` does arrive, seconds
        // later: without this guard it would clear the acknowledgement the notification just asked for.
        if (status === 'idle') query = query.neq('status', 'awaiting_ack')
        const { error, count } = await query
        if (error) console.error('[notification] failed to update session status', error)
        // Postgres does not fail an UPDATE that matches nothing, so an unmirrored session would
        // silently keep whatever status it ends up with.
        else if (count === 0 && status !== 'idle') console.warn('[notification] no session row for', { agentId, engineSessionId: notification.sessionId, status })
    } catch (err) {
        console.error('[notification] failed to update session status', err)
    }
}

// A schedule or a trigger opens its session under the routine's name, and every run of it would
// read the same in the list. Once over, the session is titled after what the run did, the routine's
// name kept in `automation_name`. A session someone renamed keeps the name they gave it.
// Best-effort: on any failure the session keeps the routine's name.
async function retitleAutomatedRun(supabase: ServiceRoleClient, agentId: string | null, notification: StoredNotification): Promise<void> {
    const run = automatedRunReport(notification)
    if (!run || !agentId || !notification.sessionId) return
    try {
        const { data: session } = await selectMaybeSingle(supabase, 'sessions', ['id', 'title', 'automation_name'] as const, { agent_id: agentId, engine_session_id: notification.sessionId })
        if (!session) return
        const routineName = session.automation_name ?? session.title
        const generated = run.report ? await generateRunTitle(routineName, run.report, run.failed) : null
        const renamed = session.title !== seedSessionTitle(routineName)
        const { error } = await supabase
            .from('sessions')
            .update<SessionUpdate>({ automation_name: routineName, outcome: automatedRunOutcome(run.failed, generated?.nothingToReport ?? false), ...(generated && !renamed && { title: generated.title }) })
            .eq('id', session.id)
        if (error) console.error('[notification] failed to retitle the run', error)
    } catch (err) {
        console.error('[notification] failed to retitle the run', err)
    }
}

type Audience = { event: RoutedEvent; source: SessionSource | null; members: RoutedMember[]; conversationId: string | null }

type Membership = { user_id: string; role: Database['public']['Enums']['workspace_role']; box_scope: string }

// The members who reach the Box the notification comes from, with the same rule as everywhere else.
// The Box and its grants are read once for the whole audience. A Box that is gone keeps the admins.
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

// Who the notification is about: the member who started the run, whoever wrote in its conversation,
// and the source that tells a cron from a chat. Every id is checked against the workspace members
// who reach the coworker's Box, so an engine can never route a notification to someone outside it,
// nor to a member the Box is closed to.
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
    // A question or a heads-up names nobody on older engines: the last one to write is who is waiting.
    const authorId = typeof claimed === 'string' && memberIds.has(claimed) ? claimed : (participantIds[0] ?? null)
    // An event without a source is a HITL stop or a notify_user: the session knows what started it.
    const source = (notification.source ?? session?.source ?? null) as SessionSource | null

    const slug = notification.metadata?.scheduleSlug ?? notification.metadata?.triggerSlug
    const event: RoutedEvent = { agentId, kind: notification.kind, source, authorId, participantIds, taskSlug: typeof slug === 'string' ? slug : null }
    const members = (users ?? []).map(u => ({ id: u.id, prefs: u.email_notification_prefs }))
    return { event, source, members: await withOwnerFollow(supabase, workspaceId, event, members), conversationId: session?.id ?? null }
}

// A cron written before authors were recorded reaches the owner, who keeps following it from then on.
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

// One email when something needs a recipient who is away, then nothing on that source until it
// works again, and one more when it does. Someone with the app open already got the toast.
async function emailIncidents(supabase: ServiceRoleClient, context: IncidentContext): Promise<void> {
    const { notification } = context
    try {
        const keyInput = { event: notification.event, kind: notification.kind, agentId: notification.agentId, source: notification.source, metadata: notification.metadata, sessionId: notification.sessionId }
        if (notification.kind === 'done' && isRunCompletion(notification.event)) {
            await resolveIncidents(supabase, context, resolvedIncidentKeysFor(keyInput))
            return
        }
        // A budget-exhausted failure keeps its in-app row but never emails per occurrence: the
        // workspace-level notice from the LLM proxy replaces it.
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
                // An incident stays open only once its email has left: otherwise the next failure
                // on the source would find it taken and the recipient would hear nothing until recovery.
                if (!sent?.ok) await dropIncident(supabase, userId, key)
            }),
        )
    } catch (err) {
        console.error('[notification] failed to email the incident', err)
    }
}

// Every incident on these sources closes, and whoever was told a scheduled task broke and is still
// away hears that it works again.
async function resolveIncidents(supabase: ServiceRoleClient, context: IncidentContext, keys: string[]): Promise<void> {
    const now = new Date()
    const banner = lazyBanner(supabase, context)
    const prefsOf = new Map(context.members.map(m => [m.id, m.prefs]))
    await Promise.allSettled(
        keys.map(async key => {
            const { data: userIds, error } = await supabase.rpc('resolve_notification_incidents', { p_source_key: key })
            if (error) throw new Error(error.message)
            if (!userIds?.length || !announcesRecovery(key)) return
            // The incident table outlives a membership: someone removed since the source broke is not told it works again.
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

// One board capture per notification whoever it goes to, asked for by the first email that leaves.
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
