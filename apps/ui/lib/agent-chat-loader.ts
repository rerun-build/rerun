import { isToolPart, toolNameOf } from '@rerun/contracts'
import { countSubRuns, isSubRunLive, pairSubRuns, subRunTroubleLabel, titledSubRun, type SubRunCopy } from '@/lib/chat/sub-run-progress'

// The `chat.activity` namespace, in the reader's language.
export type ActivityCopy = (
    key: 'thinking' | 'processing' | 'crafting' | 'writing' | 'runningTool' | 'waitingOn' | 'building' | 'buildingCoworkers' | 'waitingOnSubCoworkers',
    values?: Record<string, string | number>
) => string

// What the loader rotates through while the run has said nothing yet.
export const LOADING_ACTIVITIES = ['thinking', 'processing', 'crafting'] as const

export type LiveActivityCopy = { t: ActivityCopy; subRuns: SubRunCopy; toolLabel: (toolName: string, input?: unknown) => string }

const HITL_TOOLS = new Set(['ask_user', 'request_approval', 'suggest_service', 'request_secret', 'request_mcp_sign_in', 'request_takeover', 'request_spend'])
const TERMINAL_TOOL_STATES = new Set(['output-available', 'output-error', 'output-denied'])

type PartLike = { type: string; id?: string; state?: string; toolName?: string; toolCallId?: string; input?: unknown; data?: unknown }
type MessageLike = { role: string; parts: readonly PartLike[] }

const isRunningTool = (part: PartLike) => isToolPart(part) && !TERMINAL_TOOL_STATES.has(part.state ?? '')

/**
 * True while the message ends on a live step of its step group, which already shows the coworker
 * and what it is doing: the loader under the thread would only repeat it.
 */
export function stepGroupShowsActivity(message: MessageLike | undefined): boolean {
    if (!message || message.role !== 'assistant') return false
    const last = message.parts.findLast(part => !part.type.startsWith('data-'))
    if (!last) return false
    if (last.type === 'reasoning') return last.state === 'streaming'
    if (!isRunningTool(last) || last.state === 'approval-requested') return false
    const toolName = toolNameOf(last)
    if (HITL_TOOLS.has(toolName)) return false
    const progress = last.toolCallId ? pairSubRuns(message.parts).byToolCallId.get(last.toolCallId) : undefined
    return !progress
}

/**
 * What the run is doing right now, read off the streaming message. Null when the message says nothing
 * yet, which leaves the caller on its generic rotation.
 */
export function liveActivityLabel(message: MessageLike | undefined, { t, subRuns: tSubRuns, toolLabel }: LiveActivityCopy): string | null {
    if (!message || message.role !== 'assistant') return null

    const subRuns = pairSubRuns(message.parts).byToolCallId
    for (const part of message.parts) {
        if (!isRunningTool(part) || !part.toolCallId) continue
        const reported = subRuns.get(part.toolCallId)
        if (!reported || !reported.tasks.some(isSubRunLive)) continue
        const progress = titledSubRun(reported, tSubRuns)
        const counts = countSubRuns(progress.tasks)
        const trouble = subRunTroubleLabel(counts, tSubRuns)
        const done = counts.done + counts.failed
        if (progress.kind === 'call-agent') return `${t('waitingOn', { name: progress.tasks[0].title })}${trouble}`
        // The onboarding's build reports on a delegation's block, and it builds agents rather than waiting on them.
        if (part.type === 'tool-build_team') return counts.total === 1 ? t('building', { name: progress.tasks[0].title }) : `${t('buildingCoworkers', { count: counts.total, done })}${trouble}`
        return `${t('waitingOnSubCoworkers', { count: counts.total, done })}${trouble}`
    }

    const last = message.parts.findLast(part => !part.type.startsWith('data-'))
    if (!last) return null
    if (isRunningTool(last)) {
        const toolName = toolNameOf(last)
        return HITL_TOOLS.has(toolName) ? null : t('runningTool', { tool: toolLabel(toolName, last.input) })
    }
    if (last.type === 'reasoning' && last.state === 'streaming') return t('thinking')
    if (last.type === 'text' && last.state === 'streaming') return t('writing')
    return null
}
