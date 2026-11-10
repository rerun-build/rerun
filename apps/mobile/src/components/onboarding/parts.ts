import { asRecord } from '@rerun/contracts'
import type { UIMessage } from 'ai'

// Reading the onboarding conversation the hub streams: which cards it carries, what they hold and
// how they were answered. Pure, the same reading as the web's widgets, so a card redraws from the
// transcript alone after a relaunch.

export const ONBOARDING_WIDGETS = ['ask_choice', 'ask_input', 'ask_either', 'show_starter_pack', 'show_plan', 'open_checkout', 'build_team'] as const

export type OnboardingWidget = (typeof ONBOARDING_WIDGETS)[number]

export type WidgetPart = { widget: OnboardingWidget; toolCallId: string; input: unknown; output: unknown; answered: boolean }

type LoosePart = { type: string; toolCallId?: string; state?: string; input?: unknown; output?: unknown; id?: string; data?: unknown }

const asText = (value: unknown): string => (typeof value === 'string' ? value : '')
const asTexts = (value: unknown): string[] => (Array.isArray(value) ? value.filter((row): row is string => typeof row === 'string' && row.trim().length > 0) : [])

function isWidget(name: string): name is OnboardingWidget {
    return (ONBOARDING_WIDGETS as readonly string[]).includes(name)
}

export function widgetOf(part: { type: string }): WidgetPart | null {
    const loose = part as LoosePart
    if (!loose.type.startsWith('tool-') || !loose.toolCallId) return null
    const name = loose.type.slice('tool-'.length)
    if (!isWidget(name)) return null
    return { widget: name, toolCallId: loose.toolCallId, input: loose.input, output: loose.output, answered: loose.state === 'output-available' || loose.state === 'output-error' }
}

// The card the conversation is stopped on: the last message is the hub's and still carries one nothing
// has answered. While it waits the composer steps aside, as on the web.
export function pendingWidget(messages: UIMessage[]): WidgetPart | null {
    const last = messages.at(-1)
    if (!last || last.role !== 'assistant') return null
    for (const part of [...last.parts].reverse()) {
        const widget = widgetOf(part)
        if (widget && !widget.answered && widget.widget !== 'build_team') return widget
    }
    return null
}

export type QuestionInput = { question: string; options: string[]; multiple: boolean }

export function readQuestion(widget: 'ask_choice' | 'ask_input', input: unknown): QuestionInput {
    const args = asRecord(input)
    return { question: asText(args.question), options: widget === 'ask_choice' ? asTexts(args.options) : [], multiple: widget === 'ask_choice' && args.multiple === true }
}

export type EitherInput = { title: string; description: string; options: string[] }

export function readEither(input: unknown): EitherInput {
    const args = asRecord(input)
    return { title: asText(args.title), description: asText(args.description), options: asTexts(args.options).slice(0, 2) }
}

export type QuestionOutput = { answered: true; question: string; answers: string[] } | { answered: false; reason: 'dismissed' | 'neither' | 'typed' }

export function readQuestionOutput(output: unknown): QuestionOutput | null {
    const value = asRecord(output)
    if (value.answered === true) return { answered: true, question: asText(value.question), answers: asTexts(value.answers) }
    if (value.answered === false) return { answered: false, reason: value.reason === 'neither' ? 'neither' : value.reason === 'typed' ? 'typed' : 'dismissed' }
    return null
}

export type StarterCard = { slug: string; promise: string; line: string; title: string; agent: string; image: { src: string; lightSrc: string | null } | null }

export function readStarterPack(input: unknown): StarterCard[] {
    const rows = Array.isArray(asRecord(input).cards) ? (asRecord(input).cards as unknown[]) : []
    return rows.flatMap(row => {
        const value = asRecord(row)
        const slug = asText(value.slug)
        const promise = asText(value.promise)
        if (!slug || !promise) return []
        const image = asRecord(value.image)
        const src = asText(image.src)
        return [{ slug, promise, line: asText(value.line), title: asText(value.title) || slug, agent: asText(value.agent), image: src ? { src, lightSrc: asText(image.lightSrc) || null } : null }]
    })
}

export type StarterPackOutput = { answered: true; chosen: string[] } | { answered: true; custom: string } | { answered: false }

export function readStarterPackOutput(output: unknown): StarterPackOutput | null {
    const value = asRecord(output)
    if (value.answered === false) return { answered: false }
    if (value.answered !== true) return null
    return typeof value.custom === 'string' ? { answered: true, custom: value.custom } : { answered: true, chosen: asTexts(value.chosen) }
}

export type PlanAgent = { name: string; role: string; when: string; gets: string[] }

export type PlanBox = { name: string | null; agents: PlanAgent[] }

// `title` is null when the assistant gave none: the card then reads its own default.
export type ShownPlan = { title: string | null; boxes: PlanBox[] }

// Grouped the way the web card groups it: the declared Boxes in their order, then an agent filed under a
// Box nobody declared, so no agent ever drops off the card. A Box nobody works in has nothing to say.
export function readPlan(input: unknown): ShownPlan {
    const args = asRecord(input)
    const entries = (Array.isArray(args.items) ? args.items : []).flatMap(row => {
        const value = asRecord(row)
        const name = asText(value.title) || asText(value.name) || asText(value.slug)
        return name ? [{ box: asText(value.box).trim(), agent: { name, role: asText(value.role), when: asText(value.when), gets: asTexts(value.gets).slice(0, 3) } }] : []
    })
    const declared = (Array.isArray(args.boxes) ? args.boxes : []).map(row => asText(asRecord(row).name).trim()).filter(Boolean)
    const order = [...declared, ...entries.map(entry => entry.box).filter(box => !declared.some(name => name.toLowerCase() === box.toLowerCase()))]
    const names = order.filter((name, index) => order.findIndex(other => other.toLowerCase() === name.toLowerCase()) === index)
    const boxes = names.map(name => ({ name: name || null, agents: entries.filter(entry => entry.box.toLowerCase() === name.toLowerCase()).map(entry => entry.agent) }))
    return { title: asText(args.title) || null, boxes: boxes.filter(box => box.agents.length > 0) }
}

export type PlanOutput = { answered: true; confirmed: boolean } | { answered: false }

export function readPlanOutput(output: unknown): PlanOutput | null {
    const value = asRecord(output)
    if (value.answered === true) return { answered: true, confirmed: value.confirmed === true }
    return value.answered === false ? { answered: false } : null
}

// What the trial card answers. The app never sells, so the only outcomes are a workspace that is on, one
// whose trial is spent (the web takes it from there), and a hiccup the card retries.
export type TrialOutput = { ok: true; status: 'entitled' } | { ok: false; reason: 'trial_refused' | 'dismissed' | 'pending' }

export function readTrialOutput(output: unknown): TrialOutput | null {
    const value = asRecord(output)
    if (value.ok === true) return { ok: true, status: 'entitled' }
    if (value.ok !== false) return null
    return { ok: false, reason: value.reason === 'trial_refused' ? 'trial_refused' : value.reason === 'pending' ? 'pending' : 'dismissed' }
}

export type BuildTaskStatus = 'queued' | 'running' | 'done' | 'error' | 'stopped' | 'dispatched'

export type BuildTask = { title: string; status: BuildTaskStatus }

// The live progress of the build rides in `data-delegate` parts keyed on the build's call, each one the
// whole list as it stands: the last one is the truth.
export function buildTasks(message: UIMessage, toolCallId: string): BuildTask[] {
    const parts = message.parts as LoosePart[]
    const last = parts.filter(part => part.type === 'data-delegate' && part.id === toolCallId).at(-1)
    const rows = Array.isArray(asRecord(last?.data).tasks) ? (asRecord(last?.data).tasks as unknown[]) : []
    return rows.flatMap(row => {
        const value = asRecord(row)
        const title = asText(value.title)
        const status = asText(value.status) as BuildTaskStatus
        return title ? [{ title, status: ['queued', 'running', 'done', 'error', 'stopped', 'dispatched'].includes(status) ? status : 'queued' }] : []
    })
}

export type BuildResult = { lead: { agentId: string; name: string } | null; agents: number; failed: string[] }

export function readBuildResult(output: unknown): BuildResult | null {
    const value = asRecord(output)
    if (!('lead' in value) && !('agents' in value)) return null
    const lead = asRecord(value.lead)
    const failed = Array.isArray(value.failed) ? value.failed.map(row => asText(asRecord(row).name)).filter(Boolean) : []
    return { lead: asText(lead.agentId) ? { agentId: asText(lead.agentId), name: asText(lead.name) } : null, agents: Array.isArray(value.agents) ? value.agents.length : 0, failed }
}

// `[[foreman:start…]]` is the app opening the conversation, never something the person wrote.
export function isKickoff(message: UIMessage): boolean {
    return message.role === 'user' && message.parts.some(part => part.type === 'text' && part.text.trim().startsWith('[[foreman:start'))
}

export function textOf(message: UIMessage): string {
    return message.parts
        .flatMap(part => (part.type === 'text' ? [part.text] : []))
        .join('\n\n')
        .trim()
}
