import { describe, expect, it } from 'vitest'
import { mcpRegisterCardOf } from './mcp-register-card'

const input = { name: 'linear', url: 'https://mcp.linear.app/mcp' }

describe('mcpRegisterCardOf', () => {
    it('reads a connected registration as saved', () => {
        const output = 'Connected and registered MCP server "linear" (http). 2 tools now available: linear_a, linear_b. They are active from your next message onward, no restart needed.'
        expect(mcpRegisterCardOf('mcp_register', input, output)).toEqual({ name: 'linear', url: 'https://mcp.linear.app/mcp', outcome: 'saved' })
    })

    it('reads a registration waiting on a sign-in as saved', () => {
        const output = 'Registered MCP server "linear" (http), but it requires sign-in. Moldwright shows the user a Connect button for it right under this call.'
        expect(mcpRegisterCardOf('mcp_register', input, output)?.outcome).toBe('saved')
    })

    it('keeps only the reason of a failed registration', () => {
        const output = 'Could not connect to MCP server "linear" via http: fetch failed\nNothing was saved. Fix the url, transport, or auth headers and try again.'
        expect(mcpRegisterCardOf('mcp_register', input, output)).toEqual({ name: 'linear', url: 'https://mcp.linear.app/mcp', outcome: 'failed', failure: 'fetch failed' })
    })

    it('keeps the whole first line of a refusal that names no transport', () => {
        const output = 'The name "rerun" is reserved for the Moldwright bridge.\nNothing was saved.'
        expect(mcpRegisterCardOf('mcp_register', { name: 'rerun' }, output)?.failure).toBe('The name "rerun" is reserved for the Moldwright bridge.')
    })

    it('reads the output reloaded from history behind its envelope', () => {
        const output = { type: 'text', value: 'Could not connect to MCP server "linear" via sse: HTTP 404\nNothing was saved.' }
        expect(mcpRegisterCardOf('mcp_register', input, output)?.outcome).toBe('failed')
    })

    it('shows a sign-in started on a registered server', () => {
        expect(mcpRegisterCardOf('mcp_login', { name: 'linear' }, 'Ask the user to open this URL and sign in to "linear":\nhttps://x')).toEqual({ name: 'linear', outcome: 'saved' })
    })

    it('leaves the generic step for a sign-in on a server that is not there or cannot sign in', () => {
        expect(mcpRegisterCardOf('mcp_login', { name: 'nope' }, 'No MCP server named "nope" is registered. Register it first with mcp_register.')).toBeNull()
        expect(mcpRegisterCardOf('mcp_login', { name: 'fs' }, 'Server "fs" is stdio-based and does not use OAuth sign-in.')).toBeNull()
    })

    it('needs a server name', () => {
        expect(mcpRegisterCardOf('mcp_register', {}, 'Connected')).toBeNull()
    })
})
