// Copy of the hub's apps/ui/lib/net/public-fetch.ts (plus a typed error and the caller's own abort
// signal): the engine has no runtime package shared with the hub, the two files are kept in step by hand.
import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'

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

export class NonPublicHostError extends Error {
    constructor(host: string) {
        super(`${host} is not a public host`)
        this.name = 'NonPublicHostError'
    }
}

export const isHttpUrl = (url: string): boolean => {
    try {
        return /^https?:$/.test(new URL(url).protocol)
    } catch {
        return false
    }
}

// The request leaves from our own network, so the host is judged by where it resolves, not by how
// it is spelled: a public name pointing at 169.254.169.254 is refused like the address itself.
export async function resolvesToPublicAddresses(hostname: string): Promise<boolean> {
    const host = hostname.replace(/^\[|\]$/g, '')
    try {
        const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true })
        return addresses.length > 0 && addresses.every(({ address, family }) => !NON_PUBLIC.check(address, family === 6 ? 'ipv6' : 'ipv4'))
    } catch {
        return false
    }
}

export async function assertPublicUrl(url: string): Promise<URL> {
    let parsed: URL
    try {
        parsed = new URL(url)
    } catch {
        throw new NonPublicHostError(url)
    }
    if (!/^https?:$/.test(parsed.protocol) || !(await resolvesToPublicAddresses(parsed.hostname))) throw new NonPublicHostError(parsed.host || url)
    return parsed
}

// Only GET and HEAD follow a redirect, each hop re-checked. A POST gets its 3xx back as is: a token
// or registration endpoint has no reason to redirect, and replaying the body elsewhere would leak it.
export async function fetchPublic(url: string, init: RequestInit = {}, { timeoutMs = FETCH_TIMEOUT_MS, maxRedirects = MAX_REDIRECTS }: { timeoutMs?: number; maxRedirects?: number } = {}): Promise<Response> {
    const method = (init.method ?? 'GET').toUpperCase()
    const followsRedirects = method === 'GET' || method === 'HEAD'
    let current = url
    for (let hop = 0; ; hop++) {
        await assertPublicUrl(current)
        const res = await fetch(current, { ...init, redirect: 'manual', signal: init.signal ?? AbortSignal.timeout(timeoutMs) })
        const location = res.headers.get('location')
        if (!followsRedirects || res.status < 300 || res.status >= 400 || !location || hop >= maxRedirects) return res
        current = new URL(location, current).toString()
    }
}
