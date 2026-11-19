import { describe, expect, it } from 'vitest'
import type { McpServer } from '@moldwright/contracts'
import { claudeMcpConfig, codexMcpConfig } from './providers.js'

const stdio = (extra: Partial<McpServer> = {}) => ({ name: 'x', transport: 'stdio', command: 'npx', args: ['srv'], env: {}, ...extra }) as McpServer
const http = (extra: Partial<McpServer> = {}) => ({ name: 'h', transport: 'http', url: 'https://h.example.com/mcp', headers: {}, ...extra }) as McpServer
const relayed = { relay: { name: 'x', tools: [], call: async () => ({ content: [] }) } } as never

describe('picked tools in provider configs', () => {
    it('allows the picked tools of a native claude server one by one', () => {
        const { allowedTools } = claudeMcpConfig(undefined, [stdio({ tools: ['a', 'b'] })])
        expect(allowedTools).toEqual(['mcp__x__a', 'mcp__x__b'])
        expect(allowedTools).not.toContain('mcp__x')
    })

    it('allows a relayed claude server whole, its list being filtered by the pool', () => {
        const { allowedTools } = claudeMcpConfig(undefined, [{ ...stdio({ tools: ['a'] }), ...relayed }])
        expect(allowedTools).toEqual(['mcp__x'])
    })

    it('allows a claude server with no picks whole, as before', () => {
        expect(claudeMcpConfig(undefined, [stdio()]).allowedTools).toEqual(['mcp__x'])
    })

    it('gives a codex stdio and a codex http server enabledTools when picked', () => {
        const servers = codexMcpConfig(undefined, [stdio({ tools: ['a', 'b'] }), http({ tools: ['c'] })])
        expect(servers.x).toMatchObject({ transport: 'stdio', command: 'npx', enabledTools: ['a', 'b'] })
        expect(servers.h).toMatchObject({ transport: 'http', url: 'https://h.example.com/mcp', enabledTools: ['c'] })
    })

    it('leaves a codex entry without picks exactly as it was', () => {
        const servers = codexMcpConfig(undefined, [stdio(), http()])
        expect(servers.x).toEqual({ transport: 'stdio', command: 'npx', args: ['srv'], env: {} })
        expect(servers.h).toEqual({ transport: 'http', url: 'https://h.example.com/mcp', httpHeaders: {} })
    })

    it('treats an empty list as no picks on both providers', () => {
        expect(claudeMcpConfig(undefined, [stdio({ tools: [] })]).allowedTools).toEqual(['mcp__x'])
        expect(codexMcpConfig(undefined, [stdio({ tools: [] })]).x).toEqual({ transport: 'stdio', command: 'npx', args: ['srv'], env: {} })
    })
})
