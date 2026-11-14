import type { UIMessage } from 'ai'

import { isKickoffText } from './kickoff-marker'
import { readStarterPackAnswer, SHOW_STARTER_PACK_TOOL, starterPackPlan } from './starter-pack'

export function lastShownPlan(messages: UIMessage[]): unknown | null {
    for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index]
        if (message.role !== 'assistant') continue
        for (let part = message.parts.length - 1; part >= 0; part--) {
            const candidate = message.parts[part] as { type: string; state?: string; input?: unknown }
            if (candidate.type !== 'tool-show_plan') continue
            if (candidate.state === 'input-streaming' || candidate.input == null) continue
            return candidate.input
        }
    }
    return null
}

const MAX_REVISION_ASK = 4000

export function planRevisionAsk(messages: UIMessage[]): string | null {
    const said: string[] = []
    let shown = false
    for (const message of messages) {
        for (const part of message.parts as { type: string; text?: unknown; output?: unknown }[]) {
            if (message.role === 'assistant' && part.type === 'tool-show_plan') shown = true
            if (!shown) continue
            if (message.role === 'assistant' && part.type === 'tool-ask_input') {
                const answers = (part.output as { answers?: unknown } | null)?.answers
                if (Array.isArray(answers)) said.push(...answers.filter((answer): answer is string => typeof answer === 'string'))
            }
            if (message.role === 'user' && part.type === 'text' && typeof part.text === 'string' && !isKickoffText(part.text)) said.push(part.text)
        }
    }
    const asked = said
        .map(text => text.trim())
        .filter(Boolean)
        .join('\n\n')
        .slice(0, MAX_REVISION_ASK)
    return asked || null
}

export function templateCardPlan(input: unknown, slug?: string): { items: { kind: 'template'; slug: string; title?: string; box?: string }[]; boxes: { name: string }[] } | null {
    const args = (input ?? {}) as { box?: unknown; boxes?: unknown; templates?: unknown }
    const templates = Array.isArray(args.templates) ? (args.templates as { slug?: unknown; title?: unknown }[]) : []
    const template = slug ? templates.find(candidate => candidate?.slug === slug) : templates.length === 1 ? templates[0] : undefined
    const picked = slug ?? (typeof template?.slug === 'string' ? template.slug : null)
    if (!picked) return null

    const box = typeof args.box === 'string' && args.box.trim() ? args.box.trim() : undefined
    const pinned = Array.isArray(args.boxes) ? (args.boxes as { name?: unknown }[]).flatMap(entry => (typeof entry?.name === 'string' && entry.name.trim() ? [{ name: entry.name.trim() }] : [])) : []
    return { items: [{ kind: 'template', slug: picked, title: typeof template?.title === 'string' ? template.title : undefined, box }], boxes: pinned.length ? pinned : box ? [{ name: box }] : [] }
}

export function lastShownTemplatePlan(messages: UIMessage[]): unknown | null {
    for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index]
        if (message.role !== 'assistant') continue
        for (let part = message.parts.length - 1; part >= 0; part--) {
            const candidate = message.parts[part] as { type: string; state?: string; input?: unknown }
            if (candidate.type !== 'tool-show_templates' || candidate.state === 'input-streaming') continue
            const plan = templateCardPlan(candidate.input)
            return plan?.boxes.length ? plan : null
        }
    }
    return null
}

export function lastShownStarterPlan(messages: UIMessage[]): unknown | null {
    for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index]
        if (message.role !== 'assistant') continue
        for (let part = message.parts.length - 1; part >= 0; part--) {
            const candidate = message.parts[part] as { type: string; state?: string; input?: unknown; output?: unknown }
            if (candidate.type !== `tool-${SHOW_STARTER_PACK_TOOL}` || candidate.state !== 'output-available') continue
            const answer = readStarterPackAnswer(candidate.output)
            if (!answer?.answered || !('chosen' in answer)) return null
            const plan = starterPackPlan(candidate.input, answer.chosen)
            return plan.items.length ? plan : null
        }
    }
    return null
}
