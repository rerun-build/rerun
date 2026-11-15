import { asString } from '@/lib/mcp/args'
import type { ForemanNeed, ForemanPlanItem, ForemanProfile } from './phase'

export function readNeeds(raw: unknown): ForemanNeed[] {
    if (!Array.isArray(raw)) return []
    return raw.flatMap(entry => {
        const value = (entry ?? {}) as Record<string, unknown>
        const job = asString(value.job)?.trim()
        const pain = asString(value.pain)?.trim()
        if (!job || !pain) return []
        const today = asString(value.today)?.trim()
        return [today ? { job, pain, today } : { job, pain }]
    })
}

export function describeNeed({ job, pain, today }: ForemanNeed): string {
    return `${job}: ${pain}${today ? ` (today: ${today})` : ''}`
}

export type RevisedJob = Pick<ForemanProfile, 'useCases' | 'pain' | 'needs'>

const sameWords = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

export function revisedJob(foreman: ForemanProfile, item: ForemanPlanItem | undefined): RevisedJob | null {
    if (item?.kind !== 'agent' || !item.asked) return null
    const need = item.need?.trim()
    if (need && (foreman.needs ?? []).some(interview => sameWords(interview.pain, need))) return null
    return { useCases: [item.role], pain: item.role, needs: need && !sameWords(need, item.role) ? [{ job: item.role, pain: need }] : [] }
}
