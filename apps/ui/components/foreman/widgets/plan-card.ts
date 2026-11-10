// The organisation the foreman is proposing, read off a raw tool call and grouped by division.
//
// Pure, and kept out of the widget because the grouping is the only part of that card with rules:
// the sections follow the order the model wrote them in, an agent whose Box was never declared
// still has to appear somewhere, and a card drawn before divisions existed has to keep rendering.

import { asRecord } from '@rerun/contracts'
import { readBeats, readGets, type PlanBeats } from '@/lib/foreman/plan-items'

export type { PlanBeats }

export type PlanItem = { key: string; name: string; role: string; when: string; need?: string; beats?: PlanBeats; gets?: string[] }

export type PlanGroup = { key: string; name: string | null; role: string; items: PlanItem[] }

export type ShownPlan = { title: string; groups: PlanGroup[] }

function asText(value: unknown): string {
    return typeof value === 'string' ? value : ''
}

// A template is named by its title, a bespoke agent by its name, and a template whose title the
// model left out falls back to its slug rather than vanishing from the card.
function itemName(value: Record<string, unknown>): string {
    return asText(value.title) || asText(value.name) || asText(value.slug)
}

function readItems(input: unknown): { item: PlanItem; box: string }[] {
    const rows = Array.isArray(input) ? input : []
    return rows.flatMap((row, index) => {
        const value = asRecord(row)
        const name = itemName(value)
        if (!name) return []
        const need = asText(value.need).trim()
        const beats = readBeats(value.beats)
        const gets = readGets(value.gets)
        const item: PlanItem = { key: `${index}-${name}`, name, role: asText(value.role), when: asText(value.when), ...(need ? { need } : {}), ...(beats ? { beats } : {}), ...(gets.length ? { gets } : {}) }
        return [{ item, box: asText(value.box).trim() }]
    })
}

function readBoxes(input: unknown): { name: string; role: string }[] {
    const rows = Array.isArray(input) ? input : []
    return rows.flatMap(row => {
        const value = asRecord(row)
        const name = asText(value.name).trim()
        return name ? [{ name, role: asText(value.role) }] : []
    })
}

export function readPlan(input: unknown): ShownPlan {
    const args = asRecord(input)
    const title = asText(args.title)
    const entries = readItems(args.items)
    const boxes = readBoxes(args.boxes)

    // No division declared and none named by an agent: exactly the flat list this card drew before
    // organisations existed, which is what keeps a transcript written back then readable today. An
    // onboarding plan names its Boxes on the agents alone while it streams, and is grouped by them.
    if (!boxes.length && !entries.some(entry => entry.box)) {
        const items = entries.map(entry => entry.item)
        return { title, groups: items.length ? [{ key: 'all', name: null, role: '', items }] : [] }
    }

    const taken = new Set<number>()
    const groups: PlanGroup[] = boxes.map((box, index) => {
        const items = entries.flatMap((entry, position) => {
            if (taken.has(position) || entry.box.toLowerCase() !== box.name.toLowerCase()) return []
            taken.add(position)
            return [entry.item]
        })
        return { key: `box-${index}-${box.name}`, name: box.name, role: box.role, items }
    })

    // An agent the model filed under a division it never declared, and one it filed nowhere at all.
    // Both are its mistakes, and neither is a reason to drop the agent off the card.
    const orphans = new Map<string, PlanItem[]>()
    entries.forEach((entry, position) => {
        if (taken.has(position)) return
        const key = entry.box || ''
        orphans.set(key, [...(orphans.get(key) ?? []), entry.item])
    })

    for (const [name, items] of orphans) groups.push({ key: `extra-${name}`, name: name || null, role: '', items })

    return { title, groups }
}
