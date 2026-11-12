// The WhatsApp sequence between the start and the end of a trial: one message a day at most, in
// the voice of a coworker, to bring its owner back to what their coworkers are doing. No
// 'server-only', like the rest of this folder: a Trigger.dev task runs it.
import { isStoreProvider } from '@rerun/contracts'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/app/api/database.types'
import { findWorkspaceEngine } from '@/app/api/_services/workspace-engine.service'
import { transformEngineMessages } from '@/lib/chat/engine-history'
import { getSessionMessages } from '@/lib/engine/client'
import { foremanUseCases, type ForemanAnswers } from '@/lib/foreman/phase'
import { loadFirstName } from '@/ee/lib/lifecycle/recipient'
import type { StoredAgentIdeas } from '@/lib/agent-ideas/stored'
import { loadTeam, type TeamMember, type TeamStatus } from '@/lib/og/team-board'
import { companyNameFromAnswers } from '@/lib/onboarding/box-name'
import { selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'
import { loadWhatsAppRecipient } from './recipient'
import { deliverWhatsApp } from './send'
import { teamBoardUrl } from './team'
import { firstResultPhrase, overnightResultPhrase, pendingActionPhrase, teaserPhrase, weeklyIdeaPhrase } from './trial-phrases'
import { openTrialSlot, pickTrialMessage, type TrialMessageKey, type TrialSignals } from './trial-sequence-decide'
import {
    trialAnythingBlockingMessage,
    trialFirstJobDoneMessage,
    trialIdeaForYouMessage,
    trialMorningReportMessage,
    trialNeedsYourOkMessage,
    trialNoFirstJobMessage,
    trialWeekRecapMessage,
    type WhatsAppMessage,
} from './templates'

type Client = SupabaseClient<Database>

const RUN_LOG_LIMIT = 500
const HOME_PATH = ''
const UNNAMED_COMPANY = 'your business'
const NEVER_CHATTED = 'you signed up'

const BLOCKING_STATUSES = ['awaiting_question', 'awaiting_approval', 'awaiting_connector'] as const
const WAITING_KINDS = ['question', 'approval', 'connector'] as const

const MANUAL_EVENT = 'agent.message.completed'
const SCHEDULE_EVENT = 'agent.schedule.completed'

const RUN_COLUMNS = ['id', 'agent_id', 'engine_agent_id', 'engine_session_id', 'event', 'kind', 'source', 'message', 'created_at'] as const

export type TrialSequenceReport = { considered: number; sent: Array<{ workspaceId: number; key: TrialMessageKey }>; skipped: string[] }

type TrialWorkspace = { id: number; trial_started_at: string | null; trial_ends_at: string | null; subscription_cancel_at: string | null }

type Run = { id: string; agent_id: string | null; engine_agent_id: string | null; engine_session_id: string | null; event: string; kind: string; source: string | null; message: string; created_at: string }

type Context = {
    supabase: Client
    workspaceId: number
    team: TeamMember[]
    firstName: string | null
    runs: Run[]
    waiting: Run | null
}

async function ownerOf(supabase: Client, workspaceId: number): Promise<string | null> {
    const { data } = await selectMany(supabase, 'workspace_members', ['user_id'] as const, { workspace_id: workspaceId }, { column: 'created_at', ascending: true }, 1)
    return data?.[0]?.user_id ?? null
}

// The request a coworker is waiting on: the newest question, approval or connection it asked for
// on a session that is still blocked on it.
async function waitingRequest(supabase: Client, team: TeamMember[], runs: Run[]): Promise<Run | null> {
    if (!team.length) return null
    const { data: sessions } = await selectMany(supabase, 'sessions', ['engine_session_id'] as const, { agent_id: team.map(agent => agent.id), status: [...BLOCKING_STATUSES] })
    const blocked = new Set((sessions ?? []).map(session => session.engine_session_id))
    return runs.find(run => (WAITING_KINDS as readonly string[]).includes(run.kind) && run.engine_session_id && blocked.has(run.engine_session_id)) ?? null
}

async function signalsOf(supabase: Client, workspace: { id: number; startedAt: Date; cancelled: boolean }, userId: string, team: TeamMember[], runs: Run[], waiting: Run | null): Promise<TrialSignals> {
    const [{ data: phone }, { data: sent }, { data: schedule }] = await Promise.all([
        selectMaybeSingle(supabase, 'user_phones', ['whatsapp_replied_at'] as const, { user_id: userId }),
        selectMany(supabase, 'whatsapp_messages', ['created_at', 'template_key'] as const, { user_id: userId, created_at: { gte: workspace.startedAt.toISOString() } }, { column: 'created_at', ascending: false }),
        selectMaybeSingle(supabase, 'workspace_getting_started', ['item'] as const, { workspace_id: workspace.id, item: 'schedule' }),
    ])

    return {
        cancelled: workspace.cancelled,
        repliedAt: phone?.whatsapp_replied_at ? new Date(phone.whatsapp_replied_at) : null,
        lastWhatsAppAt: sent?.[0] ? new Date(sent[0].created_at) : null,
        askedForOk: (sent ?? []).some(row => row.template_key === 'trial_needs_your_ok'),
        recapSent: (sent ?? []).some(row => row.template_key === 'trial_week_recap'),
        doneRuns: runs.filter(run => run.kind === 'done').map(run => ({ at: new Date(run.created_at), scheduled: run.event === SCHEDULE_EVENT })),
        chats: runs.filter(run => run.event === MANUAL_EVENT && run.source === null).map(run => new Date(run.created_at)),
        hasSchedule: !!schedule || runs.some(run => run.event === SCHEDULE_EVENT),
        waitingOnThem: !!waiting,
    }
}

// What the coworker said at the end of a run, read from its engine. The 200 characters kept in the
// run log stand in when the engine cannot be reached.
async function runOutput(workspaceId: number, run: Run): Promise<string> {
    if (!run.engine_agent_id || !run.engine_session_id) return run.message
    try {
        const engine = await findWorkspaceEngine(workspaceId)
        if (!engine) return run.message
        const history = transformEngineMessages(await getSessionMessages(engine.conn, run.engine_agent_id, run.engine_session_id))
        const reply = history.findLast(message => message.role === 'assistant' && message.parts.some(part => part.type === 'text'))
        const text = reply?.parts.flatMap(part => (part.type === 'text' ? [part.text] : [])).join('\n')
        return text?.trim() || run.message
    } catch {
        return run.message
    }
}

function board(ctx: Context, status: TeamStatus): string {
    return teamBoardUrl(ctx.team, status)
}

function agentPath(agentId: string | null, tab?: string): string {
    if (!agentId) return HOME_PATH
    return tab ? `?agent=${agentId}&tab=${tab}` : `?agent=${agentId}`
}

async function ideaContext(ctx: Context): Promise<{ company: string; context: string }> {
    const { data } = await selectMaybeSingle(ctx.supabase, 'workspace_onboarding', ['answers', 'agent_ideas'] as const, { workspace_id: ctx.workspaceId })
    const answers = (data?.answers ?? {}) as ForemanAnswers
    const ideas = (data?.agent_ideas as StoredAgentIdeas | null)?.ideas ?? []
    const company = companyNameFromAnswers(answers)

    const lines = [
        `Coworker: ${ctx.team[0]?.name ?? 'an AI coworker'}`,
        company && `Company: ${company}`,
        answers.company_description && `What the company does: ${answers.company_description}`,
        ...foremanUseCases(answers.foreman ?? {}).map(useCase => `Asked to take off their hands: ${useCase}`),
        ...(answers.foreman?.needs ?? []).map(need => `Need: ${need.job}, because ${need.pain}`),
        ...ideas.slice(0, 5).map(idea => `Idea already imagined for them: ${idea.name}, ${idea.hook}`),
        ...ctx.runs.filter(run => run.kind === 'done').slice(0, 3).map(run => `A job already done: ${run.message}`),
    ]
    return { company: company ?? UNNAMED_COMPANY, context: lines.filter(Boolean).join('\n') }
}

function lastChatDay(ctx: Context): string {
    const lastChat = ctx.runs.find(run => run.event === MANUAL_EVENT && run.source === null)
    return lastChat ? new Date(lastChat.created_at).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }) : NEVER_CHATTED
}

// Null when the message has nothing true and specific enough to say.
async function messageFor(ctx: Context, key: TrialMessageKey): Promise<WhatsAppMessage | null> {
    const voice = { firstName: ctx.firstName }
    const doneRuns = ctx.runs.filter(run => run.kind === 'done')

    switch (key) {
        case 'trial_first_job_done': {
            const run = doneRuns[0]
            const result = run && (await firstResultPhrase(await runOutput(ctx.workspaceId, run)))
            if (!run?.agent_id || !result) return null
            return trialFirstJobDoneMessage({ ...voice, imageUrl: board(ctx, { [run.agent_id]: 'working' }), result, path: agentPath(run.agent_id, 'scheduled') })
        }
        case 'trial_morning_report': {
            const run = doneRuns.find(candidate => candidate.event === SCHEDULE_EVENT)
            if (!run?.agent_id) return null
            const output = await runOutput(ctx.workspaceId, run)
            const [result, teaser] = await Promise.all([overnightResultPhrase(output), teaserPhrase(output)])
            if (!result || !teaser) return null
            return trialMorningReportMessage({ ...voice, imageUrl: board(ctx, { [run.agent_id]: 'working' }), result, teaser, path: `?notification=${run.id}` })
        }
        case 'trial_no_first_job': {
            const coworker = ctx.team[0]
            if (!coworker) return null
            return trialNoFirstJobMessage({ ...voice, imageUrl: board(ctx, {}), coworker: coworker.name, path: agentPath(coworker.id) })
        }
        case 'trial_idea_for_you': {
            const coworker = ctx.team[0]
            if (!coworker) return null
            const { company, context } = await ideaContext(ctx)
            const idea = await weeklyIdeaPhrase(context)
            if (!idea) return null
            return trialIdeaForYouMessage({ ...voice, imageUrl: board(ctx, {}), company, idea, path: agentPath(coworker.id) })
        }
        case 'trial_anything_blocking':
            return trialAnythingBlockingMessage({ ...voice, imageUrl: board(ctx, 'offline'), lastDay: lastChatDay(ctx), path: HOME_PATH })
        case 'trial_needs_your_ok': {
            const run = ctx.waiting
            const action = run && (await pendingActionPhrase(run.message))
            if (!run?.agent_id || !action) return null
            return trialNeedsYourOkMessage({ ...voice, imageUrl: board(ctx, { [run.agent_id]: 'waiting_human' }), action, path: `?notification=${run.id}` })
        }
        case 'trial_week_recap':
            return trialWeekRecapMessage({ ...voice, imageUrl: board(ctx, 'working'), taskCount: doneRuns.length, path: HOME_PATH })
    }
}

async function sweepWorkspace(supabase: Client, workspace: TrialWorkspace, now: Date): Promise<{ sent: TrialMessageKey } | { skipped: string } | null> {
    if (!workspace.trial_started_at || !workspace.trial_ends_at) return null
    const slot = openTrialSlot(new Date(workspace.trial_started_at), new Date(workspace.trial_ends_at), now)
    if (!slot) return null

    const userId = await ownerOf(supabase, workspace.id)
    if (!userId) return { skipped: 'no_owner' }
    // Checked before any model or engine is asked anything: most refusals are a missing number.
    const recipient = await loadWhatsAppRecipient(supabase, userId, 'marketing')
    if (!recipient.ok) return { skipped: recipient.reason }

    const team = await loadTeam(supabase, workspace.id)
    if (!team.length) return { skipped: 'no_coworker' }

    const { data: runLog } = await selectMany(
        supabase,
        'notifications',
        RUN_COLUMNS,
        { workspace_id: workspace.id, agent_id: { notNull: true }, created_at: { gte: slot.startedAt.toISOString() } },
        { column: 'created_at', ascending: false },
        RUN_LOG_LIMIT,
    )
    const runs: Run[] = runLog ?? []
    const waiting = await waitingRequest(supabase, team, runs)

    const signals = await signalsOf(supabase, { id: workspace.id, startedAt: slot.startedAt, cancelled: !!workspace.subscription_cancel_at }, userId, team, runs, waiting)
    const pick = pickTrialMessage(signals, slot, now)
    if ('skip' in pick) return pick.skip === 'nothing_to_say' || pick.skip === 'daily_cap' ? null : { skipped: pick.skip }

    const ctx: Context = { supabase, workspaceId: workspace.id, team, firstName: await loadFirstName(supabase, userId), runs, waiting }
    const message = await messageFor(ctx, pick.key)
    if (!message) return { skipped: `${pick.key}: no_phrase` }

    // One message per trial day, and one trial per workspace: `trial_ends_at` is never cleared and
    // gates a second one in basePlanCheckoutParams.
    const result = await deliverWhatsApp(supabase, { userId, workspaceId: workspace.id, message, language: 'en', dedupeKey: `trial:${workspace.id}:day${pick.day}` })
    if (result.sent) return { sent: pick.key }
    return result.reason === 'duplicate' ? null : { skipped: `${pick.key}: ${result.reason}` }
}

/**
 * Every workspace still in its trial whose daily slot is open gets at most one message, to its
 * owner. `only` narrows the sweep to a few workspaces, which is how it is tried by hand.
 */
export async function sweepTrialSequence(supabase: Client, now: Date, only?: number[]): Promise<TrialSequenceReport> {
    const { data } = await selectMany(
        supabase,
        'workspaces',
        ['id', 'trial_started_at', 'trial_ends_at', 'subscription_cancel_at', 'billing_provider'] as const,
        {
            subscription_status: 'trialing',
            is_sandbox: false,
            trial_started_at: { notNull: true },
            trial_ends_at: { gt: now.toISOString() },
            ...(only ? { id: only } : {}),
        },
        { column: 'trial_ends_at', ascending: false },
    )
    // A store's trial is the store's to remind of: its sequence sells the web's card form.
    const workspaces: TrialWorkspace[] = (data ?? []).filter(workspace => !isStoreProvider(workspace.billing_provider))
    const report: TrialSequenceReport = { considered: workspaces.length, sent: [], skipped: [] }

    for (const workspace of workspaces) {
        try {
            const outcome = await sweepWorkspace(supabase, workspace, now)
            if (!outcome) continue
            if ('sent' in outcome) report.sent.push({ workspaceId: workspace.id, key: outcome.sent })
            else report.skipped.push(`${workspace.id}: ${outcome.skipped}`)
        } catch (err) {
            report.skipped.push(`${workspace.id}: ${err instanceof Error ? err.message : String(err)}`)
        }
    }

    return report
}
