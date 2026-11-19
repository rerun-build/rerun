import { humanizeToolSegment } from '@/lib/chat/connector-tools'
import type { EngineMcpServer } from '@/lib/engine/types'
import { siteDomain } from '@/lib/onboarding/site-favicon'
import { connectorMcpServerNames, type ServiceRegistry } from '@/lib/services/registry'
import type { CustomMcpServer, McpTransportKind } from '@/lib/services/types'

const BRIDGE_SERVER_NAME = 'rerun'

const TWO_LABEL_SUFFIXES = new Set(['co.uk', 'org.uk', 'ac.uk', 'com.au', 'net.au', 'co.nz', 'co.jp', 'co.kr', 'co.in', 'com.br', 'com.mx', 'com.tr', 'co.za', 'com.sg', 'com.cn'])

const SHARED_HOST_DOMAINS = new Set([
    'workers.dev',
    'pages.dev',
    'vercel.app',
    'netlify.app',
    'onrender.com',
    'fly.dev',
    'railway.app',
    'herokuapp.com',
    'github.io',
    'ngrok.io',
    'ngrok.app',
    'ngrok-free.app',
    'trycloudflare.com',
    'deno.dev',
    'replit.app',
    'robagentic.tech',
])

export function resolveMcpTransport(server: EngineMcpServer): McpTransportKind {
    if (server.transport) return server.transport
    if (server.command) return 'stdio'
    if (server.url) return server.url.replace(/\/+$/, '').endsWith('/sse') ? 'sse' : 'http'
    return 'stdio'
}

function literalHttpUrl(url: string | undefined): URL | null {
    if (!url || url.includes('${')) return null
    try {
        const parsed = new URL(url)
        return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed : null
    } catch {
        return null
    }
}

export function mcpServerHost(url: string | undefined): string | null {
    return literalHttpUrl(url)?.hostname ?? null
}

export function mcpIconDomain(host: string | null): string | null {
    const domain = host ? siteDomain(host) : null
    if (!domain) return null
    const labels = domain.split('.')
    const depth = TWO_LABEL_SUFFIXES.has(labels.slice(-2).join('.')) ? 3 : 2
    if (labels.length < depth) return null
    const registrable = labels.slice(-depth).join('.')
    return SHARED_HOST_DOMAINS.has(registrable) ? null : registrable
}

export function brandLabel(domain: string): string {
    const labels = domain.split('.')
    return labels[labels.length - (TWO_LABEL_SUFFIXES.has(labels.slice(-2).join('.')) ? 3 : 2)]
}

export function unclaimedMcpServers(servers: EngineMcpServer[], reg: ServiceRegistry): EngineMcpServer[] {
    const claimed = connectorMcpServerNames(reg)
    return servers.filter(server => server.name !== BRIDGE_SERVER_NAME && !claimed.has(server.name))
}

export function toCustomMcpServer(server: EngineMcpServer, look: { displayName?: string; icon: string | null }): CustomMcpServer {
    const transport = resolveMcpTransport(server)
    const remote = transport !== 'stdio'
    const url = remote ? literalHttpUrl(server.url) : null
    return {
        name: server.name,
        displayName: look.displayName ?? humanizeToolSegment(server.name),
        transport,
        host: url?.hostname ?? null,
        icon: look.icon,
        signInUrl: url?.href ?? null,
    }
}
