import { Resolver } from 'node:dns/promises'

export type DnsResolver = { cname(name: string): Promise<string[]>; a(name: string): Promise<string[]>; txt(name: string): Promise<string[]> }

export type Routing = 'here' | 'elsewhere' | 'none' | 'unknown'
export type Ownership = 'proven' | 'missing' | 'unknown'
export type DomainReading = { routing: Routing; ownership: Ownership }

const NO_SUCH_RECORD = new Set(['ENOTFOUND', 'ENODATA', 'NXDOMAIN', 'NOTFOUND'])

// Public resolvers rather than the machine's, whose cache can hold what the domain said yesterday.
const SERVERS = ['1.1.1.1', '8.8.8.8']
const TIMEOUT_MS = 4_000

async function orNone(reading: Promise<string[]>): Promise<string[]> {
    try {
        return await reading
    } catch (err) {
        if (NO_SUCH_RECORD.has((err as { code?: string }).code ?? '')) return []
        throw err
    }
}

export function publicDns(): DnsResolver {
    const resolver = new Resolver({ timeout: TIMEOUT_MS, tries: 2 })
    resolver.setServers(SERVERS)
    return {
        cname: name => orNone(resolver.resolveCname(name)),
        a: name => orNone(resolver.resolve4(name)),
        txt: async name => orNone(resolver.resolveTxt(name).then(records => records.map(chunks => chunks.join('')))),
    }
}

const plain = (name: string): string => name.replace(/\.$/, '').toLowerCase()

export const verificationName = (hostname: string): string => `_verify.${hostname}`

// The edge's own addresses: the domain of a provider that flattens CNAMEs, or a bare one, can only
// point at those.
async function addressesOfEdge(dns: DnsResolver, edge: string): Promise<string[]> {
    const configured = (process.env.ORGANIZATION_EDGE_IPS ?? '').split(',').map(ip => ip.trim()).filter(Boolean)
    return configured.length ? configured : dns.a(edge)
}

async function readRouting(dns: DnsResolver, hostname: string, edge: string): Promise<Routing> {
    try {
        const aliases = await dns.cname(hostname)
        if (aliases.some(alias => plain(alias) === edge)) return 'here'
        const addresses = await dns.a(hostname)
        if (addresses.length === 0) return aliases.length ? 'elsewhere' : 'none'
        const ours = await addressesOfEdge(dns, edge)
        if (ours.length === 0) return 'unknown'
        return addresses.every(address => ours.includes(address)) ? 'here' : 'elsewhere'
    } catch {
        return 'unknown'
    }
}

async function readOwnership(dns: DnsResolver, hostname: string, token: string): Promise<Ownership> {
    try {
        const published = await dns.txt(verificationName(hostname))
        return published.some(value => value.trim() === token) ? 'proven' : 'missing'
    } catch {
        return 'unknown'
    }
}

export async function readDomain(dns: DnsResolver, domain: { hostname: string; token: string; edge: string }): Promise<DomainReading> {
    const [routing, ownership] = await Promise.all([readRouting(dns, domain.hostname, domain.edge), readOwnership(dns, domain.hostname, domain.token)])
    return { routing, ownership }
}
