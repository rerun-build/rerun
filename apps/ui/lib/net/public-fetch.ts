import dns from 'node:dns'
import { lookup } from 'node:dns/promises'
import { BlockList, isIP, type LookupFunction } from 'node:net'
import { Agent } from 'undici'

const FETCH_TIMEOUT_MS = 10_000
const MAX_REDIRECTS = 3

const NON_PUBLIC = new BlockList()
for (const [network, prefix] of [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.168.0.0', 16],
    ['224.0.0.0', 3],
] as const)
    NON_PUBLIC.addSubnet(network, prefix, 'ipv4')
for (const [network, prefix] of [
    ['::', 127],
    ['fc00::', 7],
    ['fe80::', 10],
    ['ff00::', 8],
] as const)
    NON_PUBLIC.addSubnet(network, prefix, 'ipv6')

function isPublicAddress(address: string, family: number): boolean {
    return !NON_PUBLIC.check(address, family === 6 ? 'ipv6' : 'ipv4')
}

// The request leaves from our own network, so the host is judged by where it resolves, not by how
// it is spelled: a public name pointing at 169.254.169.254 is refused like the address itself.
export async function resolvesToPublicAddresses(hostname: string): Promise<boolean> {
    const host = hostname.replace(/^\[|\]$/g, '')
    try {
        const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true })
        return addresses.length > 0 && addresses.every(({ address, family }) => isPublicAddress(address, family))
    } catch {
        return false
    }
}

export async function assertPublicUrl(url: string): Promise<URL> {
    const parsed = new URL(url)
    if (!/^https?:$/.test(parsed.protocol) || !(await resolvesToPublicAddresses(parsed.hostname))) throw new Error(`${parsed.host || url} is not a public host`)
    return parsed
}

// The check above resolves the name once, the connection resolves it again: a name that answers a
// public address to the first and a private one to the second would get through. The connection
// reads its own answer through this lookup, so whatever address it dials has passed the same check.
export const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
        if (err) return callback(err, '')
        if (addresses.length === 0 || !addresses.every(({ address, family }) => isPublicAddress(address, family))) {
            return callback(Object.assign(new Error(`${hostname} is not a public host`), { code: 'ENOTPUBLIC' }), '')
        }
        if (options.all) return callback(null, addresses)
        callback(null, addresses[0].address, addresses[0].family)
    })
}

const publicOnlyDispatcher = new Agent({ connect: { lookup: publicOnlyLookup } })

// Only GET and HEAD follow a redirect, each hop re-checked. A POST gets its 3xx back as is: a token
// or registration endpoint has no reason to redirect, and replaying the body elsewhere would leak it.
export async function fetchPublic(url: string, init: RequestInit = {}, { timeoutMs = FETCH_TIMEOUT_MS, maxRedirects = MAX_REDIRECTS }: { timeoutMs?: number; maxRedirects?: number } = {}): Promise<Response> {
    const method = (init.method ?? 'GET').toUpperCase()
    const followsRedirects = method === 'GET' || method === 'HEAD'
    let current = url
    for (let hop = 0; ; hop++) {
        await assertPublicUrl(current)
        const res = await fetch(current, { ...init, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), dispatcher: publicOnlyDispatcher } as RequestInit)
        const location = res.headers.get('location')
        if (!followsRedirects || res.status < 300 || res.status >= 400 || !location || hop >= maxRedirects) return res
        await res.body?.cancel().catch(() => {})
        current = new URL(location, current).toString()
    }
}
