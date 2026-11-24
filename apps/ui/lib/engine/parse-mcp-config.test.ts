import { describe, expect, it } from 'vitest'

import { parseMcpConfig, type McpConfigParse } from './parse-mcp-config'

const TICKET = `{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_7Hq2xYv9LmN4pR8sT1uW3zA6bC0dE5fG" }
    },
    "linear": { "url": "https://mcp.linear.app/sse", "headers": { "Authorization": "Bearer lin_api_9f8e7d6c5b4a" } }
  }
}`

function servers(result: McpConfigParse) {
    if (!result.ok) throw new Error(`expected a parse, got ${JSON.stringify(result.error)}`)
    return result.servers
}

function error(result: McpConfigParse) {
    if (result.ok) throw new Error('expected an error')
    return result.error
}

describe('parseMcpConfig', () => {
    it('reads the full mcpServers block of the ticket', () => {
        expect(servers(parseMcpConfig(TICKET))).toEqual([
            {
                name: 'github',
                nameProposed: false,
                transport: 'stdio',
                transportGuessed: false,
                command: 'npx',
                args: ['-y', '@modelcontextprotocol/server-github'],
                url: undefined,
                env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_7Hq2xYv9LmN4pR8sT1uW3zA6bC0dE5fG' },
                headers: {},
            },
            {
                name: 'linear',
                nameProposed: false,
                transport: 'sse',
                transportGuessed: true,
                command: undefined,
                args: [],
                url: 'https://mcp.linear.app/sse',
                env: {},
                headers: { Authorization: 'Bearer lin_api_9f8e7d6c5b4a' },
            },
        ])
    })

    it('reads a single named server', () => {
        const [server] = servers(parseMcpConfig('{ "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/rerun/files"] } }'))
        expect(server).toMatchObject({ name: 'filesystem', nameProposed: false, transport: 'stdio', args: ['-y', '@modelcontextprotocol/server-filesystem', '/home/rerun/files'] })
    })

    it('proposes a name for a bare server, from its address or its package', () => {
        const [remote] = servers(parseMcpConfig('{ "url": "https://mcp.notion.com/mcp", "headers": { "Authorization": "Bearer ntn_x" } }'))
        expect(remote).toMatchObject({ name: 'notion', nameProposed: true, transport: 'http', transportGuessed: true })
        const [local] = servers(parseMcpConfig('{ "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"] }'))
        expect(local).toMatchObject({ name: 'github', nameProposed: true, command: 'npx' })
        const [script] = servers(parseMcpConfig('{ "command": "node", "args": ["/opt/servers/weather.js"] }'))
        expect(script.name).toBe('weather')
    })

    it('reads the VS Code shape, its declared transports, trailing commas and ignored fields', () => {
        const text = `{
  // copied from settings.json
  "servers": {
    "playwright": { "type": "stdio", "command": "npx", "args": ["@playwright/mcp@latest"] },
    "context7": { "type": "http", "url": "https://mcp.context7.com/mcp", },
    "sentry": { "type": "sse", "url": "https://mcp.sentry.dev/sse", "disabled": false }, /* off for now */
  }
}`
        expect(servers(parseMcpConfig(text)).map(s => [s.name, s.transport, s.transportGuessed])).toEqual([
            ['playwright', 'stdio', false],
            ['context7', 'http', false],
            ['sentry', 'sse', false],
        ])
        expect(servers(parseMcpConfig('{ "mcp": { "servers": { "a": { "url": "https://a.dev/mcp", "transport": "streamable-http" } } } }'))[0].transport).toBe('http')
    })

    it('splits a command pasted as one line', () => {
        const [server] = servers(parseMcpConfig('{ "fetch": { "command": "uvx  mcp-server-fetch --verbose" } }'))
        expect(server).toMatchObject({ command: 'uvx', args: ['mcp-server-fetch', '--verbose'] })
    })

    it('keeps the // of an address when it removes trailing commas', () => {
        const [server] = servers(parseMcpConfig('{ "a": { "url": "https://a.dev/mcp", }, }'))
        expect(server.url).toBe('https://a.dev/mcp')
    })

    it('keeps a comma before a bracket inside a text when it removes trailing commas', () => {
        const [server] = servers(parseMcpConfig('{ "a": { "command": "npx", "args": ["x, ]", "{\\"b\\": 1, }"], }, }'))
        expect(server.args).toEqual(['x, ]', '{"b": 1, }'])
    })

    it('proposes a usable name for a container, a runner, an IP address and a name cut short', () => {
        const nameOf = (config: object) => servers(parseMcpConfig(JSON.stringify(config)))[0].name
        expect(nameOf({ command: 'docker', args: ['run', '-i', '--rm', '-e', 'GITHUB_TOKEN', 'ghcr.io/github/github-mcp-server'] })).toBe('github')
        expect(nameOf({ command: 'docker', args: ['run', '-i', '-v', '/data:/data', 'mcp/postgres:latest', 'postgresql://db/app'] })).toBe('postgres')
        expect(nameOf({ command: 'uv', args: ['run', 'weather.py'] })).toBe('weather')
        expect(nameOf({ url: 'http://127.0.0.1:8080/mcp' })).toBe('server-1')
        expect(nameOf({ url: 'http://[::1]:8080/mcp' })).toBe('server-1')
        expect(nameOf({ command: 'npx', args: ['-y', `${'a'.repeat(63)}--b`] })).toBe('a'.repeat(63))
    })

    it('refuses a reference only another client resolves, and keeps the ones Rerun does', () => {
        const headers = { Authorization: 'Bearer ${input:token}' }
        expect(error(parseMcpConfig(JSON.stringify({ servers: { gh: { url: 'https://a.dev/mcp', headers } } })))).toEqual({ code: 'unresolvedRef', scope: 'named', server: 'gh', field: 'Authorization', ref: '${input:token}' })
        expect(error(parseMcpConfig('{ "a": { "command": "npx", "env": { "T": "${env:T}" } } }'))).toMatchObject({ code: 'unresolvedRef', field: 'T' })
        expect(error(parseMcpConfig('{ "a": { "command": "npx", "args": ["${input:key}"] } }'))).toMatchObject({ code: 'unresolvedRef', field: 'args' })
        expect(error(parseMcpConfig('{ "a": { "url": "https://a.dev/${T:-x}" } }'))).toMatchObject({ code: 'unresolvedRef', field: 'url' })
        expect(servers(parseMcpConfig('{ "a": { "command": "npx", "env": { "T": "${T}" } } }'))[0].env).toEqual({ T: '${T}' })
    })

    it('refuses a value on several lines, not one that ends with a line break', () => {
        expect(error(parseMcpConfig(JSON.stringify({ a: { command: 'npx', env: { PEM: '-----BEGIN-----\nabc=\n-----END-----' } } })))).toEqual({ code: 'multiline', scope: 'named', server: 'a', field: 'PEM' })
        expect(error(parseMcpConfig(JSON.stringify({ a: { command: 'sh', args: ['-c', 'one\ntwo'] } })))).toMatchObject({ code: 'multiline', field: 'args' })
        expect(servers(parseMcpConfig(JSON.stringify({ a: { command: 'npx', env: { T: 'x\n' } } })))).toHaveLength(1)
    })

    it('treats an empty paste as nothing, not an error', () => {
        expect(parseMcpConfig('   ')).toEqual({ ok: true, servers: [] })
    })

    it('refuses broken JSON with the parser message', () => {
        const broken = error(parseMcpConfig('{ "mcpServers": { "github": { "command": "npx"\n "args": [] } } }'))
        expect(broken.code).toBe('invalidJson')
        expect(broken.code === 'invalidJson' && broken.detail.length).toBeGreaterThan(0)
    })

    it('names the unknown field and its server', () => {
        expect(error(parseMcpConfig('{ "mcpServers": { "stripe": { "command": "npx", "secrets": ["STRIPE_KEY"] } } }'))).toEqual({ code: 'unknownField', scope: 'named', server: 'stripe', fields: '"secrets"' })
    })

    it('refuses what it cannot turn into a server', () => {
        expect(error(parseMcpConfig('[1, 2]')).code).toBe('notAnObject')
        expect(error(parseMcpConfig('{ "hello": "world" }')).code).toBe('noServer')
        expect(error(parseMcpConfig('{ "mcpServers": {} }')).code).toBe('emptyContainer')
        expect(error(parseMcpConfig('{ "mcpServers": [] }')).code).toBe('containerNotObject')
        expect(error(parseMcpConfig('{ "a": { "command": "npx", "url": "https://a.dev" } }')).code).toBe('commandAndUrl')
        expect(error(parseMcpConfig('{ "a": { "url": "https://a.dev", "type": "websocket" } }'))).toMatchObject({ code: 'unknownTransport', transport: 'websocket' })
        expect(error(parseMcpConfig('{ "mcpServers": { "a": { "type": "sse" } } }')).code).toBe('needsUrl')
        expect(error(parseMcpConfig('{ "mcpServers": { "a": { "type": "stdio", "env": {} } } }')).code).toBe('needsCommand')
        expect(error(parseMcpConfig('{ "a": { "command": "npx", "args": "-y" } }')).code).toBe('argsNotList')
        expect(error(parseMcpConfig('{ "a": { "command": "npx", "env": ["A=1"] } }'))).toMatchObject({ code: 'notMap', field: 'env' })
        expect(error(parseMcpConfig('{ "mcpServers": { "my server": { "command": "npx" } } }'))).toMatchObject({ code: 'invalidName', server: 'my server' })
    })
})
