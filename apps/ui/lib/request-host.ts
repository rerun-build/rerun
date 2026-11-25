import { organizationRootDomain } from '@/lib/brand/root-domain'

type HeaderReader = { get(name: string): string | null }

// Each proxy on the way may append its own value.
const firstValue = (value: string | null): string | null => value?.split(',')[0].trim().toLowerCase() || null

export function hostnameOf(host: string): string {
    if (host.startsWith('[')) return host.slice(0, host.indexOf(']') + 1)
    return host.split(':')[0].replace(/\.$/, '').toLowerCase()
}

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/

// What no visitor types: a loopback, an address, a container name.
export function isInternalHostname(hostname: string): boolean {
    return !hostname.includes('.') || hostname.startsWith('[') || IPV4.test(hostname) || hostname.endsWith('.localhost')
}

// The host a request was made to, the one answer for the proxy, the brand, the OAuth helpers and the
// redirects. A self-hosted install sits behind a reverse proxy we know nothing about, which may only
// say it in X-Forwarded-Host. Where organizations are served it decides whose app answers, so it comes
// from Host, which Traefik and the edge both pass along untouched and no caller can dress up as
// another; the forwarded one counts only under a Host no visitor could have typed (the server calling
// itself, an edge that dials the container).
export function requestHost(headers: HeaderReader): string | null {
    const host = firstValue(headers.get('host'))
    const forwarded = firstValue(headers.get('x-forwarded-host'))
    if (!organizationRootDomain()) return forwarded ?? host
    return host && !isInternalHostname(hostnameOf(host)) ? host : (forwarded ?? host)
}

export function requestProtocol(headers: HeaderReader, fallback: 'http' | 'https'): string {
    return firstValue(headers.get('x-forwarded-proto')) ?? fallback
}

const DEV_HOST = 'localhost:3000'

export function requestOrigin(headers: HeaderReader): string {
    const host = requestHost(headers) ?? DEV_HOST
    const local = host.startsWith('localhost') || host.startsWith('127.')
    return `${requestProtocol(headers, local ? 'http' : 'https')}://${host}`
}
