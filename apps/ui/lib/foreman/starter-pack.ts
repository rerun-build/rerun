import { asRecord } from '@rerun/contracts'
import type { TemplateCardImage } from '@/lib/templates/card-image'
import { MAX_STARTER_PICKS } from '@/lib/onboarding/starter-packs'
import { asString, asStringArray } from '@/lib/mcp/args'

// What `show_starter_pack` carries and what it is answered with. The app writes the card itself
// (scripted.ts), already resolved against the library, so the widget draws it without a fetch and
// a reload redraws it from the transcript alone. Pure, so the server and the widget read it alike.

export const SHOW_STARTER_PACK_TOOL = 'show_starter_pack'

export type StarterPackCard = {
    slug: string
    promise: string
    line: string
    focus?: string
    title: string
    // The coworker the template lands, named on the card's art.
    agent: string
    image: TemplateCardImage | null
    connectors: string[]
}

export type StarterPackInput = { cards: StarterPackCard[]; box?: string; boxes: { name: string }[] }

export type StarterPackAnswer = { answered: true; chosen: string[] } | { answered: true; custom: string } | { answered: false }

function readImage(value: unknown): TemplateCardImage | null {
    const image = asRecord(value)
    const src = asString(image.src)
    if (!src || (image.kind !== 'board' && image.kind !== 'cover')) return null
    return { src, lightSrc: asString(image.lightSrc) ?? null, alt: asString(image.alt) ?? '', kind: image.kind }
}

export function readStarterPack(input: unknown): StarterPackInput {
    const args = asRecord(input)
    const rows = Array.isArray(args.cards) ? args.cards : []
    const cards = rows.flatMap(row => {
        const value = asRecord(row)
        const slug = asString(value.slug)
        const promise = asString(value.promise)
        if (!slug || !promise) return []
        const focus = asString(value.focus)
        const title = asString(value.title) ?? slug
        return [{ slug, promise, line: asString(value.line) ?? '', ...(focus ? { focus } : {}), title, agent: asString(value.agent) ?? title, image: readImage(value.image), connectors: asStringArray(value.connectors) }]
    })
    const boxes = (Array.isArray(args.boxes) ? args.boxes : []).flatMap(row => {
        const name = asString(asRecord(row).name)?.trim()
        return name ? [{ name }] : []
    })
    return { cards, box: asString(args.box), boxes }
}

export function readStarterPackAnswer(output: unknown): StarterPackAnswer | null {
    if (!output || typeof output !== 'object') return null
    const value = output as Record<string, unknown>
    if (value.answered !== true) return { answered: false }
    const custom = asString(value.custom)?.trim()
    if (custom) return { answered: true, custom }
    const chosen = asStringArray(value.chosen)
    return chosen.length ? { answered: true, chosen } : { answered: false }
}

/**
 * The cards they picked, read as the plan they become: each template in the Box the card was laid
 * into, with the skill its install starts on. A slug the card never offered is dropped rather than
 * trusted, and past the trial's ceiling the rest is dropped too.
 */
export function starterPackPlan(input: unknown, chosen: string[]): { items: { kind: 'template'; slug: string; title: string; focus?: string; box?: string }[]; boxes: { name: string }[] } {
    const { cards, box, boxes } = readStarterPack(input)
    const picked = cards.filter(card => chosen.includes(card.slug)).slice(0, MAX_STARTER_PICKS)
    return { items: picked.map(card => ({ kind: 'template', slug: card.slug, title: card.agent, ...(card.focus ? { focus: card.focus } : {}), box })), boxes }
}

const FOCUS_HEADING = '## Start with:'

/**
 * The template's own install, opened on the skill the card sold. They hired it for that one use case,
 * so that is what it gets working first; the rest of its install follows as its author wrote it.
 * Written once: an install that already opens on a focus is left as it is.
 */
export function installWithFocus(install: string, focus: string): string {
    if (install.trimStart().startsWith(FOCUS_HEADING)) return install
    return `${FOCUS_HEADING} ${focus}\n\nThey hired you from a card that promised this, so get it working first, on their real company, before anything else this guide sets up.\n\n${install.trimStart()}`
}
