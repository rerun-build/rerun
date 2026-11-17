import { remoteJobStateSchema, type RemoteJobState } from './remote-computer.js'

// The ways a run starts without the user typing: a webhook, a routine, a guided install, the end of
// a job on a linked computer. Each one is a marker in the run's user message; every client draws a
// divider for it instead of a bubble.

export type TriggerPayload = {
    prompt: string
    slug: string
    method: string
    receivedAt: string
    query?: string
    contentType?: string
    bytes: number
    truncated: boolean
    body: string
    isJson: boolean
}

// Mirrors buildTriggerMessage in apps/engine/src/triggers/message.ts: the block is appended at the
// very end of the run's first user message. Attribute values are always quoted and their inner
// quotes are already escaped, so a value carrying a `>` cannot end the tag early.
const TRIGGER_BLOCK = /\n*<trigger_payload ((?:[^>"]|"[^"]*")*)>\n?([\s\S]*?)\n?<\/trigger_payload>\s*$/
const TRIGGER_ATTRIBUTE = /([\w-]+)="([^"]*)"/g

export function parseTriggerPayload(text: string): TriggerPayload | null {
    const match = TRIGGER_BLOCK.exec(text)
    if (!match) return null

    const attributes = new Map<string, string>()
    for (const [, name, value] of match[1].matchAll(TRIGGER_ATTRIBUTE)) {
        attributes.set(name, value.replaceAll('&quot;', '"'))
    }

    const slug = attributes.get('trigger')
    const method = attributes.get('method')
    if (!slug || !method) return null

    const raw = match[2]
    const contentType = attributes.get('content-type')

    return {
        prompt: text.slice(0, match.index).trim(),
        slug,
        method,
        receivedAt: attributes.get('received') ?? '',
        query: attributes.get('query') || undefined,
        contentType: contentType || undefined,
        bytes: Number(attributes.get('bytes') ?? 0) || 0,
        truncated: attributes.get('truncated') === 'true',
        body: raw === '(no payload)' ? '' : raw.replaceAll('<\\/trigger_payload>', '</trigger_payload>'),
        isJson: !!contentType?.includes('json'),
    }
}

export type ScheduledRun = { slug: string; name: string; prompt: string }

// Mirrors buildScheduledRunMessage in apps/engine/src/schedules/message.ts. The block is the entire
// message, so a user who merely quotes the tag is never mistaken for a scheduled run. A run fired
// by an engine older than the marker carries the bare prompt and stays an ordinary bubble.
const SCHEDULED_BLOCK = /^<scheduled_run schedule="([^"]*)" name="([^"]*)">\n?([\s\S]*?)\n?<\/scheduled_run>$/
const SCHEDULED_CLOSING_TAG = '</scheduled_run>'
const ESCAPED_SCHEDULED_CLOSING_TAG = '<\\/scheduled_run>'

function unescapeScheduledAttribute(value: string): string {
    return value.replaceAll('&quot;', '"').replaceAll('&amp;', '&')
}

export function parseScheduledRun(text: string): ScheduledRun | null {
    const match = SCHEDULED_BLOCK.exec(text.trim())
    if (!match) return null
    const slug = unescapeScheduledAttribute(match[1])
    return {
        slug,
        name: unescapeScheduledAttribute(match[2]) || slug,
        prompt: match[3].replaceAll(ESCAPED_SCHEDULED_CLOSING_TAG, SCHEDULED_CLOSING_TAG),
    }
}

export type InstallMessage = { agentName: string; guide: string }

// The guided install travels as the run's first user message: the agent reads its whole guide, and
// the chat draws a setup block instead of the guide as if the user had typed it. The block is the
// entire message, so a user who merely quotes the tag is never mistaken for an install.
const INSTALL_BLOCK = /^<agent_install agent="([^"]*)">\n?([\s\S]*?)\n?<\/agent_install>$/
const INSTALL_CLOSING_TAG = '</agent_install>'
const ESCAPED_INSTALL_CLOSING_TAG = '<\\/agent_install>'

export function parseInstallMessage(text: string): InstallMessage | null {
    const match = INSTALL_BLOCK.exec(text.trim())
    if (!match) return null
    return {
        agentName: match[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&'),
        guide: match[2].replaceAll(ESCAPED_INSTALL_CLOSING_TAG, INSTALL_CLOSING_TAG),
    }
}

export type JobEnd = { computer: string; jobId: string; state: RemoteJobState; label: string | null; report: string }

// The end of a job a coworker started on a linked computer wakes it in the conversation it started
// the job from. The message is the engine's, not the user's: every client draws a divider for it.
// The block is the entire message, like a scheduled run's.
const JOB_END_BLOCK = /^<job_end computer="([^"]*)" job="([^"]*)" state="([^"]*)"(?: label="([^"]*)")?>\n?([\s\S]*?)\n?<\/job_end>$/
const JOB_END_CLOSING_TAG = '</job_end>'
const ESCAPED_JOB_END_CLOSING_TAG = '<\\/job_end>'

const escapeAttribute = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
const unescapeAttribute = (value: string) => value.replaceAll('&quot;', '"').replaceAll('&amp;', '&')

export function buildJobEndMessage({ computer, jobId, state, label, report }: JobEnd): string {
    const labelAttribute = label ? ` label="${escapeAttribute(label)}"` : ''
    const body = report.trim().replaceAll(JOB_END_CLOSING_TAG, ESCAPED_JOB_END_CLOSING_TAG)
    return `<job_end computer="${escapeAttribute(computer)}" job="${escapeAttribute(jobId)}" state="${state}"${labelAttribute}>\n${body}\n${JOB_END_CLOSING_TAG}`
}

export function parseJobEnd(text: string): JobEnd | null {
    const match = JOB_END_BLOCK.exec(text.trim())
    if (!match) return null
    const state = remoteJobStateSchema.safeParse(match[3])
    if (!state.success) return null
    return {
        computer: unescapeAttribute(match[1]),
        jobId: unescapeAttribute(match[2]),
        state: state.data,
        label: match[4] ? unescapeAttribute(match[4]) : null,
        report: match[5].replaceAll(ESCAPED_JOB_END_CLOSING_TAG, JOB_END_CLOSING_TAG),
    }
}
