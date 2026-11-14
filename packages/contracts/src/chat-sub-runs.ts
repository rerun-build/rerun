import { isToolPart, toolNameOf } from './chat-tool-name.js'

export const SUB_RUN_STALLED_AFTER_MS = 3 * 60_000
export const SUB_RUN_FAILURE_STREAK = 3
export const SUB_RUN_LONG_CALL_MS = 20_000
export const SUB_RUN_PREVIEW_LENGTH = 600

export type SubRunStatus = 'queued' | 'running' | 'done' | 'error' | 'stopped' | 'dispatched'

export type SubRunCall = { tool: string; summary: string; failed?: boolean; durationMs?: number; elapsedMs?: number }

export type SubRunTask = {
    id?: string
    title: string
    status: SubRunStatus
    steps: number
    toolCalls?: number
    failures?: number
    calls?: SubRunCall[]
    activity?: string
    preview?: string
    idleMs?: number
    startedAt?: number
    finishedAt?: number
    error?: string
}

export const currentCall = (task: SubRunTask): SubRunCall | undefined => task.calls?.find(call => call.elapsedMs !== undefined)

export const isSubRunFailing = (task: SubRunTask) => task.status === 'running' && (task.failures ?? 0) >= SUB_RUN_FAILURE_STREAK

export type SubRunProgress = { kind: 'delegate' | 'call-agent'; tasks: SubRunTask[] }

type DelegatePartData = { tasks?: (Omit<SubRunTask, 'title'> & { title?: string })[] }
type CallAgentPartData = Omit<SubRunTask, 'title'> & { agentName?: string }

type PartLike = { type: string; id?: string; data?: unknown; toolName?: string; toolCallId?: string }

export const SUB_RUN_TOOL_NAMES: Record<SubRunProgress['kind'], string> = { delegate: 'delegate_tasks', 'call-agent': 'call_agent' }

export type SubRunCopy = (
    key:
        | 'untitledTask'
        | 'untitledAgent'
        | 'trouble.stalled'
        | 'trouble.failing'
        | 'progress.step'
        | 'progress.calls'
        | 'headline.messageSent'
        | 'headline.calling'
        | 'headline.callFailed'
        | 'headline.callAnswered'
        | 'headline.building'
        | 'headline.buildFailed'
        | 'headline.built'
        | 'headline.buildingTeam'
        | 'headline.delegating'
        | 'headline.doneOfTotal'
        | 'headline.coworkersBuilt'
        | 'headline.openFromBoard'
        | 'headline.tasksDone'
        | 'headline.doneAndFailed',
    values?: Record<string, string | number>
) => string

export function subRunProgressOf(part: PartLike): SubRunProgress | null {
    if (part.type === 'data-delegate') {
        const data = part.data as DelegatePartData
        return { kind: 'delegate', tasks: (data.tasks ?? []).map(task => ({ ...task, title: task.title || '' })) }
    }
    if (part.type === 'data-call-agent') {
        const { agentName, ...task } = part.data as CallAgentPartData
        return { kind: 'call-agent', tasks: [{ ...task, title: agentName || '' }] }
    }
    return null
}

export function titledSubRun(progress: SubRunProgress, t: SubRunCopy): SubRunProgress {
    if (progress.tasks.every(task => task.title)) return progress
    const untitled = (index: number) => (progress.kind === 'call-agent' ? t('untitledAgent') : t('untitledTask', { index: index + 1 }))
    return { ...progress, tasks: progress.tasks.map((task, index) => (task.title ? task : { ...task, title: untitled(index) })) }
}

export type SubRunPairing = {
    byToolCallId: Map<string, SubRunProgress>
    orphans: Map<string, SubRunProgress>
}

export function pairSubRuns(parts: readonly PartLike[]): SubRunPairing {
    const byToolCallId = new Map<string, SubRunProgress>()
    const orphans = new Map<string, SubRunProgress>()

    const progressById = new Map<string, SubRunProgress>()
    for (const part of parts) {
        const progress = part.id ? subRunProgressOf(part) : null
        if (progress) progressById.set(part.id!, progress)
    }

    const unpairedToolCallIds: Record<SubRunProgress['kind'], string[]> = { delegate: [], 'call-agent': [] }
    for (const part of parts) {
        if (!isToolPart(part) || !part.toolCallId) continue
        const exact = progressById.get(part.toolCallId)
        if (exact) {
            byToolCallId.set(part.toolCallId, exact)
            progressById.delete(part.toolCallId)
            continue
        }
        const toolName = toolNameOf(part)
        if (toolName === SUB_RUN_TOOL_NAMES.delegate) unpairedToolCallIds.delegate.push(part.toolCallId)
        else if (toolName === SUB_RUN_TOOL_NAMES['call-agent']) unpairedToolCallIds['call-agent'].push(part.toolCallId)
    }

    for (const [partId, progress] of progressById) {
        const toolCallId = unpairedToolCallIds[progress.kind].shift()
        if (toolCallId) byToolCallId.set(toolCallId, progress)
        else orphans.set(partId, progress)
    }
    return { byToolCallId, orphans }
}

export const isSubRunLive = (task: SubRunTask) => task.status === 'running' || task.status === 'queued'

export const isSubRunStalled = (task: SubRunTask) => task.status === 'running' && (task.idleMs ?? 0) >= SUB_RUN_STALLED_AFTER_MS

export type SubRunCounts = { total: number; done: number; failed: number; live: number; stalled: number; failing: number }

export function countSubRuns(tasks: readonly SubRunTask[]): SubRunCounts {
    return {
        total: tasks.length,
        done: tasks.filter(t => t.status === 'done').length,
        failed: tasks.filter(t => t.status === 'error' || t.status === 'stopped').length,
        live: tasks.filter(isSubRunLive).length,
        stalled: tasks.filter(isSubRunStalled).length,
        failing: tasks.filter(isSubRunFailing).length,
    }
}

export function subRunTroubleLabel(counts: SubRunCounts, t: SubRunCopy): string {
    const stalled = counts.stalled > 0 ? ` · ${t('trouble.stalled', { count: counts.stalled })}` : ''
    const failing = counts.failing > 0 ? ` · ${t('trouble.failing', { count: counts.failing })}` : ''
    return `${stalled}${failing}`
}

export function subRunDurationSeconds(tasks: readonly SubRunTask[]): number | undefined {
    const starts = tasks.flatMap(t => (t.startedAt === undefined ? [] : [t.startedAt]))
    const ends = tasks.flatMap(t => (t.finishedAt === undefined ? [] : [t.finishedAt]))
    if (!starts.length || !ends.length) return undefined
    return Math.max(0, (Math.max(...ends) - Math.min(...starts)) / 1000)
}

const HEADING = /^#{1,6}\s/

const plainLine = (line: string) =>
    line
        .replace(/^(#{1,6}|[-*>]|\d+\.)\s+/, '')
        .replace(/\*\*|__|`/g, '')
        .trim()

export function subRunOutcome(preview?: string): string | undefined {
    let text = preview?.trim() ?? ''
    if (preview && preview.length >= SUB_RUN_PREVIEW_LENGTH) {
        const boundary = text.match(/[.!?]\s+|\n/)
        if (boundary?.index !== undefined) text = text.slice(boundary.index + boundary[0].length)
    }
    const lines = text
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
    const line = lines.find(candidate => !HEADING.test(candidate)) ?? lines[0]
    if (!line) return undefined
    return plainLine(line).split(/(?<=[.!?])\s/)[0] || undefined
}

export function formatElapsed(seconds: number): string {
    if (seconds < 10) return `${seconds.toFixed(1)}s`
    if (seconds < 60) return `${Math.floor(seconds)}s`
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}m ${String(s).padStart(2, '0')}s`
}

const progressLabel = (task: SubRunTask, t: SubRunCopy) => (task.toolCalls === undefined ? t('progress.step', { steps: task.steps }) : t('progress.calls', { count: task.toolCalls }))

export type SubRunHeadline = { label: string; summary?: string }

export function subRunHeadline(progress: SubRunProgress, live: boolean, toolName: string, t: SubRunCopy): SubRunHeadline {
    const { kind, tasks } = titledSubRun(progress, t)
    const counts = countSubRuns(tasks)
    const trouble = subRunTroubleLabel(counts, t)
    const seconds = subRunDurationSeconds(tasks)
    const duration = seconds === undefined ? '' : ` · ${formatElapsed(seconds)}`

    if (kind === 'call-agent') {
        const [call] = tasks
        const name = call.title
        if (call.status === 'dispatched') return { label: t('headline.messageSent', { name }) }
        if (live) return { label: t('headline.calling', { name }), summary: `${progressLabel(call, t)}${trouble}` }
        return { label: `${t(call.status === 'error' ? 'headline.callFailed' : 'headline.callAnswered', { name })}${duration}` }
    }

    const building = toolName === 'build_team'
    if (building && tasks.length === 1) {
        const name = tasks[0].title
        if (live) return { label: t('headline.building', { name }) }
        return { label: `${t(counts.failed ? 'headline.buildFailed' : 'headline.built', { name })}${duration}` }
    }
    if (live) return { label: t(building ? 'headline.buildingTeam' : 'headline.delegating', { count: counts.total }), summary: `${t('headline.doneOfTotal', { done: counts.done + counts.failed, total: counts.total })}${trouble}` }
    if (counts.failed === 0) return building ? { label: `${t('headline.coworkersBuilt', { count: counts.total })}${duration}`, summary: t('headline.openFromBoard') } : { label: `${t('headline.tasksDone', { count: counts.total })}${duration}` }
    return { label: `${t('headline.doneAndFailed', { done: counts.done, failed: counts.failed })}${duration}` }
}
