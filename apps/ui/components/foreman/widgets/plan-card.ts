import { asRecord } from '@rerun/contracts'
import { readBeats, readGets, type PlanBeats } from '@/lib/foreman/plan-items'

export type { PlanBeats }

export type PlanItem = { key: string; name: string; role: string; when: string; need?: string; beats?: PlanBeats; gets?: string[] }

export type PlanGroup = { key: string; name: string | null; role: string; items: PlanItem[] }

export type ShownPlan = { title: string; groups: PlanGroup[] }

function asText(value: unknown): string {
    return typeof value === 'string' ? value : ''
}

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

    const orphans = new Map<string, PlanItem[]>()
    entries.forEach((entry, position) => {
        if (taken.has(position)) return
        const key = entry.box || ''
        orphans.set(key, [...(orphans.get(key) ?? []), entry.item])
    })

    for (const [name, items] of orphans) groups.push({ key: `extra-${name}`, name: name || null, role: '', items })

    return { title, groups }
}
