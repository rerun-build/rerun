import { FOREMAN_AGENT_ID, FOREMAN_WAKE_BRIEF_TOOL, FOREMAN_WAKE_MARKER, foremanWakeBriefSchema, type ForemanWakeBrief, type ForemanWakeRequest } from '@rerun/contracts'
import { isUsable, resolveAutomationModel, resolveRunModel } from '../agents/availability.js'
import { getAgent } from '../agents/registry.js'
import type { LoadedAgent } from '../agents/types.js'
import { env } from '../config/env.js'
import { isCredentialRejected } from '../connections/credential-rejections.js'
import { isPlanLimitLatched } from '../connections/plan-limits.js'
import { createSession } from '../db/repos/sessions.js'
import { newId } from '../lib/ids.js'
import { logger } from '../lib/logger.js'
import { isBudgetLatched } from '../runtime/budget-latch.js'
import type { RunTrigger } from '../runtime/context.js'
import { startHeadlessRun } from '../runtime/headless-run.js'
import { sendNotification } from '../runtime/notify.js'
import { agentHasLiveRun, claimSession } from '../runtime/run-control.js'

const BRIEF_TIMEOUT_MS = 30_000

// Why a wake did not start. `deferred` stays due and is tried again soon, `skipped` waits longer:
// the hub said no, or nothing on the box can change before it says yes.
export type WakeOutcome =
    | { status: 'started'; sessionId: string; runId: string; memberId: string; timezone: string | null; settled: Promise<unknown> }
    | { status: 'deferred'; reason: 'busy' | 'budget' | 'limit' | 'credential' | 'no_model' | 'hub_unreachable' }
    | { status: 'skipped'; reason: string }

export class HubUnreachableError extends Error {}

// Asked on the box's key alone: the brief is what hands the run its token. A hub that predates
// wakes answers something that is not a brief, which reads as unreachable rather than as a yes.
export async function requestWakeBrief(request: ForemanWakeRequest): Promise<ForemanWakeBrief> {
    const { RERUN_HUB_BASE_URL: hub, RERUN_API_KEY: key } = env()
    if (!hub || !key) return { skip: 'no_hub' }
    let res: Response
    try {
        res = await fetch(`${hub.replace(/\/$/, '')}/api/hub`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, 'x-rerun-agent': FOREMAN_AGENT_ID },
            body: JSON.stringify({ tool: FOREMAN_WAKE_BRIEF_TOOL, args: request }),
            signal: AbortSignal.timeout(BRIEF_TIMEOUT_MS),
        })
    } catch (err) {
        throw new HubUnreachableError(err instanceof Error ? err.message : String(err))
    }
    if (!res.ok) throw new HubUnreachableError(`hub answered ${res.status}`)
    const parsed = foremanWakeBriefSchema.safeParse(await res.json().catch(() => null))
    if (!parsed.success) throw new HubUnreachableError('hub answered no brief')
    return parsed.data
}

// The first message of a wake, written by the box: why it is up, and what it found. Every client
// leaves it out of the conversation, the marker says so.
export function wakeMessage(reason: string, context: readonly string[] = []): string {
    return [FOREMAN_WAKE_MARKER, `Why you are awake: ${reason}`, ...context].filter(Boolean).join('\n\n')
}

// Nothing in a wake writes, so nothing that could is even built: no shell, no web (whose fetch is a
// way out for text read from a coworker's error), no browser, no sub-coworker. The CLI's own web
// search follows the same switch.
function readingOnly(agent: LoadedAgent, brief: Extract<ForemanWakeBrief, { brief: unknown }>['brief']): LoadedAgent {
    const tools = { ...agent.config.tools, shell: false, web: false, browser: false, delegate: false, callAgent: false }
    return { ...agent, brief, config: { ...agent.config, tools } }
}

export type WakeRequest = { reason: string; memberId?: string | null; lastWakeAt?: string | null; context?: readonly string[] }

export async function startForemanWake({ reason, memberId, lastWakeAt, context }: WakeRequest): Promise<WakeOutcome> {
    const agent = await getAgent(FOREMAN_AGENT_ID)
    // Someone is talking to it: the wake waits for the turn to end rather than writing beside it.
    if (agentHasLiveRun(FOREMAN_AGENT_ID)) return { status: 'deferred', reason: 'busy' }

    const override = await resolveAutomationModel(agent)
    const resolved = await resolveRunModel(agent, override)
    if (!isUsable(resolved.connection, resolved.model)) return { status: 'deferred', reason: 'no_model' }
    if (resolved.provider === 'rerun' && isBudgetLatched()) return { status: 'deferred', reason: 'budget' }
    if (resolved.connection && isPlanLimitLatched(resolved.connection.id)) return { status: 'deferred', reason: 'limit' }
    if (resolved.connection && isCredentialRejected(resolved.connection.id)) return { status: 'deferred', reason: 'credential' }
    // Codex keeps a file-writing tool Rerun cannot switch off: held back on the box too, whatever the hub says.
    if (resolved.provider === 'codex') return { status: 'skipped', reason: 'provider' }

    let answer: ForemanWakeBrief
    try {
        answer = await requestWakeBrief({ reason, memberId: memberId ?? null, provider: resolved.provider, lastWakeAt: lastWakeAt ?? null })
    } catch (err) {
        logger.warn({ err: String(err) }, 'foreman wake: no brief')
        return { status: 'deferred', reason: 'hub_unreachable' }
    }
    if ('skip' in answer) return { status: 'skipped', reason: answer.skip }

    const session = await createSession(FOREMAN_AGENT_ID, 'Check-in', undefined, 'wake')
    const runId = newId()
    claimSession(session.id, runId)
    const trigger: RunTrigger = { source: 'wake', reason, memberId: answer.memberId }
    await sendNotification({ event: 'agent.session.created', kind: 'info', agentId: FOREMAN_AGENT_ID, sessionId: session.id, runId: null, message: 'Check-in', title: 'Check-in', source: 'wake', metadata: { memberId: answer.memberId, wakeReason: reason } })
    const run = await startHeadlessRun(readingOnly(agent, answer.brief), session.id, wakeMessage(reason, context), override, trigger, runId)
    return { status: 'started', sessionId: session.id, runId: run.runId, memberId: answer.memberId, timezone: answer.timezone, settled: run.settled }
}
