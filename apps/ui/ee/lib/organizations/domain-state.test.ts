import { describe, expect, it } from 'vitest'

import { FAILING_FOR_MS, nextDomainState, toDomainProblem, toDomainStatus } from './domain-state'

const NOW = new Date('2026-11-24T12:00:00Z')
const HOUR = 60 * 60 * 1000
const since = (hours: number) => new Date(NOW.getTime() - hours * HOUR).toISOString()

describe('a domain not served yet', () => {
    it.each(['pending', 'error'] as const)('%s becomes active with both records', status => {
        expect(nextDomainState({ status, failing_since: null }, { routing: 'here', ownership: 'proven' }, NOW)).toEqual({ status: 'active', problem: null, failing_since: null })
    })

    it.each([
        [{ routing: 'here', ownership: 'missing' }, 'noToken'],
        [{ routing: 'none', ownership: 'missing' }, 'noRecord'],
        [{ routing: 'none', ownership: 'proven' }, 'noRecord'],
        [{ routing: 'elsewhere', ownership: 'proven' }, 'elsewhere'],
        [{ routing: 'unknown', ownership: 'proven' }, 'lookupFailed'],
        [{ routing: 'here', ownership: 'unknown' }, 'lookupFailed'],
    ] as const)('stays as it is on %j, and says why', (reading, problem) => {
        for (const status of ['pending', 'error'] as const) expect(nextDomainState({ status, failing_since: null }, reading, NOW)).toEqual({ status, problem, failing_since: null })
    })
})

describe('a domain being served', () => {
    it('no longer needs the proof it gave', () => {
        expect(nextDomainState({ status: 'active', failing_since: since(3) }, { routing: 'here', ownership: 'missing' }, NOW)).toEqual({ status: 'active', problem: null, failing_since: null })
    })

    it.each(['elsewhere', 'none'] as const)('is served a day more once it points %s', routing => {
        const problem = routing === 'none' ? 'noRecord' : 'elsewhere'
        expect(nextDomainState({ status: 'active', failing_since: null }, { routing, ownership: 'proven' }, NOW)).toEqual({ status: 'active', problem, failing_since: NOW.toISOString() })
        expect(nextDomainState({ status: 'active', failing_since: since(23) }, { routing, ownership: 'proven' }, NOW)).toEqual({ status: 'active', problem, failing_since: since(23) })
        expect(nextDomainState({ status: 'active', failing_since: since(24) }, { routing, ownership: 'proven' }, NOW)).toEqual({ status: 'error', problem, failing_since: null })
    })

    it('is never lost to a DNS that does not answer', () => {
        expect(nextDomainState({ status: 'active', failing_since: since(1000) }, { routing: 'unknown', ownership: 'unknown' }, NOW)).toEqual({ status: 'active', problem: 'lookupFailed', failing_since: since(1000) })
        expect(FAILING_FOR_MS).toBe(24 * HOUR)
    })
})

it('reads a status and a problem of another version as the least they can be', () => {
    expect(toDomainStatus('verified')).toBe('pending')
    expect(toDomainProblem('gone')).toBeNull()
    expect(toDomainProblem('taken')).toBe('taken')
})
