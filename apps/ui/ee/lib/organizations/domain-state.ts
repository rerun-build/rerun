import type { DomainReading } from './domain-dns'

export type DomainStatus = 'pending' | 'active' | 'error'

export const DOMAIN_PROBLEMS = ['noRecord', 'elsewhere', 'noToken', 'taken', 'lookupFailed'] as const
export type DomainProblem = (typeof DOMAIN_PROBLEMS)[number]

export type DomainState = { status: DomainStatus; problem: DomainProblem | null; failing_since: string | null }

// How long a domain that stopped pointing here stays served: a record being moved, or a provider's
// bad day, does not sign anybody out.
export const FAILING_FOR_MS = 24 * 60 * 60 * 1000

export function toDomainStatus(value: string): DomainStatus {
    return value === 'active' || value === 'error' ? value : 'pending'
}

export function toDomainProblem(value: string | null): DomainProblem | null {
    return DOMAIN_PROBLEMS.find(problem => problem === value) ?? null
}

function problemOf({ routing, ownership }: DomainReading): DomainProblem | null {
    if (routing === 'none') return 'noRecord'
    if (routing === 'elsewhere') return 'elsewhere'
    if (ownership === 'missing') return 'noToken'
    return routing === 'unknown' || ownership === 'unknown' ? 'lookupFailed' : null
}

// What a check makes of a domain. One not served yet needs both records: a name pointing here proves
// nothing about who asks for it, whoever held it before may have left the record behind. One being
// served only has to keep pointing here, and a DNS that does not answer is not one that says no.
export function nextDomainState(domain: { status: DomainStatus; failing_since: string | null }, reading: DomainReading, now: Date): DomainState {
    if (domain.status !== 'active') {
        const problem = problemOf(reading)
        return { status: problem ? domain.status : 'active', problem, failing_since: null }
    }
    if (reading.routing === 'here') return { status: 'active', problem: null, failing_since: null }
    if (reading.routing === 'unknown') return { status: 'active', problem: 'lookupFailed', failing_since: domain.failing_since }
    const failingSince = domain.failing_since ?? now.toISOString()
    const lost = now.getTime() - Date.parse(failingSince) >= FAILING_FOR_MS
    return { status: lost ? 'error' : 'active', problem: problemOf(reading), failing_since: lost ? null : failingSince }
}
