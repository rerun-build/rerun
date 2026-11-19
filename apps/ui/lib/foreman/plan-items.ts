import { asRecord } from '@moldwright/contracts'
import { TRIAL_ACTIVE_AGENTS } from '@moldwright/cloud/billing'
import { asString, asStringArray, requireString } from '@/lib/mcp/args'
import type { ForemanPlanBox, ForemanPlanItem } from './phase'
import type { PlanItemKind } from './tool-defs'

export type PlanBeats = { trigger: string; working: string; delivered: string }

const MAX_GETS = 3

export function readBeats(input: unknown): PlanBeats | undefined {
    const value = asRecord(input)
    const [trigger, working, delivered] = [value.trigger, value.working, value.delivered].map(line => (asString(line) ?? '').trim())
    return trigger && working && delivered ? { trigger, working, delivered } : undefined
}

export function readGets(input: unknown): string[] {
    return asStringArray(input)
        .flatMap(row => row.trim() || [])
        .slice(0, MAX_GETS)
}

function refuse(kind: PlanItemKind): never {
    throw new Error(`A plan item of kind "${kind}" is not available here: this team is designed, not installed. Write every item as kind coworker, with its name and the one job it does.`)
}

function planItem(raw: unknown, kinds: readonly PlanItemKind[]): ForemanPlanItem {
    const value = (raw ?? {}) as Record<string, unknown>
    const box = asString(value.box)

    if (value.kind === 'template') {
        if (!kinds.includes('template')) refuse('template')
        const focus = asString(value.focus)
        return { kind: 'template', slug: requireString(value.slug, 'items[].slug'), title: asString(value.title), ...(focus ? { focus } : {}), box }
    }
    if (value.kind === 'share') {
        if (!kinds.includes('share')) refuse('share')
        return { kind: 'share', token: requireString(value.token, 'items[].token'), name: asString(value.name), box }
    }
    const need = asString(value.need)?.trim()
    const gets = readGets(value.gets)
    const delivered = readBeats(value.beats)?.delivered
    return { kind: 'agent', name: requireString(value.name, 'items[].name'), role: requireString(value.role, 'items[].role'), ...(need ? { need } : {}), ...(gets.length ? { gets } : {}), ...(delivered ? { delivered } : {}), box }
}

export const MAX_PLAN_ITEMS = 1

export const MAX_READY_MADE_ITEMS = TRIAL_ACTIVE_AGENTS

export function readPlanItems(raw: unknown, kinds: readonly PlanItemKind[]): ForemanPlanItem[] {
    const items = Array.isArray(raw) ? raw.map(entry => planItem(entry, kinds)) : []
    const readyMade = items.some(item => item.kind !== 'agent')
    if (readyMade && items.some(item => item.kind === 'agent')) throw new Error('A plan that installs something ready-made holds nothing else: drop the coworker items. The rest of their team comes after it runs.')
    if (readyMade && items.length > MAX_READY_MADE_ITEMS) throw new Error(`A first plan installs ${MAX_READY_MADE_ITEMS} ready-made coworkers at most, the trial's ceiling, and this one has ${items.length}.`)
    if (!readyMade && items.length > MAX_PLAN_ITEMS) throw new Error(`A first plan holds one coworker, and this one has ${items.length}. Keep the one that goes after the job they picked, drop the others and show the card again: more coworkers come once this one works.`)
    return items
}


export const MAX_PLAN_BOXES = 5

export function readPlanBoxes(raw: unknown): ForemanPlanBox[] {
    const rows = Array.isArray(raw) ? raw : []
    const boxes = rows.flatMap(row => {
        const value = (row ?? {}) as Record<string, unknown>
        const name = asString(value.name)?.trim()
        return name ? [{ name, role: asString(value.role) }] : []
    })
    if (boxes.length > MAX_PLAN_BOXES) throw new Error(`A plan holds ${MAX_PLAN_BOXES} Boxes at most, and this one has ${boxes.length}. Merge or drop divisions down to three or four, then show the card again.`)
    return boxes
}
