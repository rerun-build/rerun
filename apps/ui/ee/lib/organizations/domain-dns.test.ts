import { afterEach, describe, expect, it, vi } from 'vitest'

import { readDomain, verificationName, type DnsResolver } from './domain-dns'

type Zone = Record<string, { cname?: string[]; a?: string[]; txt?: string[] } | 'down'>

function dns(zone: Zone): DnsResolver {
    const read = (kind: 'cname' | 'a' | 'txt') => async (name: string) => {
        const entry = zone[name]
        if (entry === 'down') throw Object.assign(new Error('SERVFAIL'), { code: 'ESERVFAIL' })
        return entry?.[kind] ?? []
    }
    return { cname: read('cname'), a: read('a'), txt: read('txt') }
}

const HOST = 'app.acme.com'
const EDGE = 'edge.rerun.work'
const read = (zone: Zone) => readDomain(dns(zone), { hostname: HOST, token: 'verify-abc', edge: EDGE })

afterEach(() => vi.unstubAllEnvs())

describe('where a domain points', () => {
    it.each<[string, Zone, string]>([
        ['here by a CNAME, whatever its spelling', { [HOST]: { cname: ['Edge.Rerun.Work.'] } }, 'here'],
        ['here by the addresses of the edge, flattened or bare', { [HOST]: { a: ['203.0.113.7'] }, [EDGE]: { a: ['203.0.113.7', '203.0.113.8'] } }, 'here'],
        ['here by a CNAME that ends at the edge', { [HOST]: { cname: ['lb.acme.com'], a: ['203.0.113.7'] }, [EDGE]: { a: ['203.0.113.7'] } }, 'here'],
        ['elsewhere when one of its addresses is not ours', { [HOST]: { a: ['203.0.113.7', '198.51.100.1'] }, [EDGE]: { a: ['203.0.113.7'] } }, 'elsewhere'],
        ['elsewhere by another CNAME', { [HOST]: { cname: ['acme.github.io'] } }, 'elsewhere'],
        ['elsewhere by a lookalike', { [HOST]: { cname: ['edge.rerun.work.evil.com'] } }, 'elsewhere'],
        ['nowhere yet', {}, 'none'],
        ['nobody knows where when the DNS does not answer', { [HOST]: 'down' }, 'unknown'],
        ['nobody knows where when the edge cannot be looked up', { [HOST]: { a: ['203.0.113.7'] }, [EDGE]: 'down' }, 'unknown'],
    ])('%s', async (_case, zone, routing) => {
        expect((await read(zone)).routing).toBe(routing)
    })

    it('reads the addresses of the edge from the environment when they are set', async () => {
        vi.stubEnv('ORGANIZATION_EDGE_IPS', '203.0.113.7, 203.0.113.8')
        expect((await read({ [HOST]: { a: ['203.0.113.8'] }, [EDGE]: 'down' })).routing).toBe('here')
    })
})

describe('whose a domain is', () => {
    it.each<[string, Zone, string]>([
        ['theirs with the token published', { [verificationName(HOST)]: { txt: ['something else', ' verify-abc '] } }, 'proven'],
        ['not theirs with another organization’s token', { [verificationName(HOST)]: { txt: ['verify-def'] } }, 'missing'],
        ['not theirs with a longer one', { [verificationName(HOST)]: { txt: ['verify-abcd'] } }, 'missing'],
        ['not theirs with nothing published', {}, 'missing'],
        ['unknown when the DNS does not answer', { [verificationName(HOST)]: 'down' }, 'unknown'],
    ])('%s', async (_case, zone, ownership) => {
        expect((await read(zone)).ownership).toBe(ownership)
    })
})
