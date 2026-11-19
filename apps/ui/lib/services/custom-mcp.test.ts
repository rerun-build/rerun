import { describe, expect, it } from 'vitest'
import { brandLabel, mcpIconDomain, mcpServerHost, resolveMcpTransport, toCustomMcpServer, unclaimedMcpServers } from './custom-mcp'
import type { EngineMcpServer } from '@/lib/engine/types'
import type { RegistryEntry } from '@/lib/services/registry'

function server(over: Partial<EngineMcpServer>): EngineMcpServer {
    return { name: 'srv', args: [], env: {}, headers: {}, ...over }
}

function entry(over: Partial<RegistryEntry>): RegistryEntry {
    return { status: 'active', config: {}, mcpServers: [], envKeys: [], skills: [], installedAt: '2026-10-12T00:00:00.000Z', ...over }
}

describe('unclaimedMcpServers', () => {
    it('keeps only the servers no app claims, and never the bridge', () => {
        const servers = ['linear', 'stripe', 'gmail', 'notion', 'legacy', 'rerun'].map(name => server({ name }))
        const reg = {
            services: {
                stripe: entry({ mcpServers: ['stripe'] }),
                gmail: entry({ mcpServers: [], managed: { provider: 'google', serverName: 'gmail' } }),
                notion: entry({ mcpServers: [], oauth: { serverName: 'notion', url: 'https://mcp.notion.com/mcp' } }),
                old: { ...entry({}), mcpServers: undefined, toolNames: ['legacy'] } as unknown as RegistryEntry,
            },
        }
        expect(unclaimedMcpServers(servers, reg).map(s => s.name)).toEqual(['linear'])
    })
})

describe('resolveMcpTransport', () => {
    it('follows the engine: explicit, then command, then the url ending', () => {
        expect(resolveMcpTransport(server({ transport: 'sse', url: 'https://x.io/mcp' }))).toBe('sse')
        expect(resolveMcpTransport(server({ command: 'npx' }))).toBe('stdio')
        expect(resolveMcpTransport(server({ url: 'https://x.io/sse/' }))).toBe('sse')
        expect(resolveMcpTransport(server({ url: 'https://x.io/mcp' }))).toBe('http')
    })
})

describe('mcpServerHost', () => {
    it('reads the host of a literal url only', () => {
        expect(mcpServerHost('https://mcp.linear.app/mcp')).toBe('mcp.linear.app')
        expect(mcpServerHost('https://${HOST}/mcp')).toBeNull()
        expect(mcpServerHost('not a url')).toBeNull()
        expect(mcpServerHost(undefined)).toBeNull()
    })
})

describe('mcpIconDomain', () => {
    it.each([
        ['mcp.linear.app', 'linear.app'],
        ['www.notion.so', 'notion.so'],
        ['api.acme.co.uk', 'acme.co.uk'],
        ['acme.com', 'acme.com'],
    ])('reads %s as %s', (host, domain) => {
        expect(mcpIconDomain(host)).toBe(domain)
    })

    it.each(['localhost', '127.0.0.1', 'my-mcp.workers.dev', 'thing.vercel.app', 'x.up.railway.app', 'moldwright.robagentic.tech', 'co.uk'])('draws no brand for %s', host => {
        expect(mcpIconDomain(host)).toBeNull()
    })

    it('has nothing to read without a host', () => {
        expect(mcpIconDomain(null)).toBeNull()
    })
})

describe('brandLabel', () => {
    it('keeps the label a catalog slug would carry', () => {
        expect(brandLabel('linear.app')).toBe('linear')
        expect(brandLabel('acme.co.uk')).toBe('acme')
    })
})

describe('toCustomMcpServer', () => {
    it('offers a sign-in only on a literal remote url', () => {
        expect(toCustomMcpServer(server({ name: 'linear_mcp', url: 'https://mcp.linear.app/mcp' }), { icon: null })).toEqual({
            name: 'linear_mcp',
            displayName: 'Linear Mcp',
            transport: 'http',
            host: 'mcp.linear.app',
            icon: null,
            signInUrl: 'https://mcp.linear.app/mcp',
        })
        expect(toCustomMcpServer(server({ url: 'https://api.x.io/mcp?key=${KEY}' }), { icon: null }).signInUrl).toBeNull()
        expect(toCustomMcpServer(server({ command: 'npx', url: 'https://x.io/mcp' }), { icon: null })).toMatchObject({ transport: 'stdio', host: null, signInUrl: null })
    })

    it('takes the name and icon of the catalog app it matched', () => {
        expect(toCustomMcpServer(server({ name: 'lin', url: 'https://mcp.linear.app/mcp' }), { displayName: 'Linear', icon: 'https://cdn/linear.png' })).toMatchObject({ displayName: 'Linear', icon: 'https://cdn/linear.png' })
    })
})
