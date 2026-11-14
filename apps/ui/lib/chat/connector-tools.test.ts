import { describe, expect, it } from 'vitest'
import { buildConnectorMap, humanizeToolSegment, parseMcpToolName, resolveConnectorTool } from './connector-tools'
import type { CustomMcpServer, InstalledService } from '@/lib/services/types'

function service(over: Partial<InstalledService>): InstalledService {
    return {
        key: 'getxapi',
        slug: 'getxapi',
        name: 'GetXAPI',
        icon: 'https://cdn.example.com/getxapi.svg',
        category: 'other',
        status: 'active',
        toolNames: ['getxapi'],
        installedAt: '2026-09-16T00:00:00.000Z',
        ...over,
    }
}

describe('buildConnectorMap', () => {
    it('carries the label of an extra account under its own server name', () => {
        const map = buildConnectorMap([service({ slug: 'gmail', key: 'gmail' }), service({ slug: 'gmail', key: 'gmail@k3x9ab', label: 'ops@acme.com', toolNames: ['gmail-k3x9ab'] })].map(s => ({ ...s, toolNames: s.key === 'gmail' ? ['gmail'] : s.toolNames })))
        expect(map.get('gmail')).not.toHaveProperty('label')
        expect(map.get('gmail-k3x9ab')).toMatchObject({ slug: 'gmail', label: 'ops@acme.com' })
    })

    it('keys every mcp server name of a connector', () => {
        const map = buildConnectorMap([service({ toolNames: ['getxapi', 'getxapi-admin'] })])
        expect([...map.keys()]).toEqual(['getxapi', 'getxapi-admin'])
        expect(map.get('getxapi-admin')?.slug).toBe('getxapi')
    })

    it('folds the oauth, managed and composio server names in', () => {
        const map = buildConnectorMap([
            service({ slug: 'notion', toolNames: [], oauth: { serverName: 'notion-oauth', url: 'https://mcp.notion.com' } }),
            service({ slug: 'gmail', toolNames: [], managed: { provider: 'google', serverName: 'gmail-managed' } }),
            service({ slug: 'canva', toolNames: [], composio: { toolkit: 'canva', serverName: 'canva-composio' } }),
        ])
        expect([...map.keys()]).toEqual(['notion-oauth', 'gmail-managed', 'canva-composio'])
    })

    it('tolerates a legacy entry with no footprint', () => {
        const map = buildConnectorMap([service({ toolNames: undefined as unknown as string[] })])
        expect(map.size).toBe(0)
    })

    it('keeps the first connector when two claim the same server name', () => {
        const map = buildConnectorMap([service({ slug: 'first' }), service({ slug: 'second' })])
        expect(map.get('getxapi')?.slug).toBe('first')
    })
})

describe('parseMcpToolName', () => {
    const known = ['getxapi', 'notion', 'my__server']

    it('splits the prefixed form', () => {
        expect(parseMcpToolName('mcp__getxapi__get_tweet_detail', known)).toEqual({ server: 'getxapi', tool: 'get_tweet_detail' })
    })

    it('splits the bare form Codex emits without prefix_mcp_tool_names', () => {
        expect(parseMcpToolName('getxapi__get_tweet_detail', known)).toEqual({ server: 'getxapi', tool: 'get_tweet_detail' })
    })

    it('ignores a bare name whose server is unknown', () => {
        expect(parseMcpToolName('stripe__create_customer', known)).toBeNull()
    })

    it('cuts on the longest known server name', () => {
        expect(parseMcpToolName('mcp__my__server__do_thing', known)).toEqual({ server: 'my__server', tool: 'do_thing' })
    })

    it('keeps a hyphenated tool segment intact', () => {
        expect(parseMcpToolName('mcp__notion__notion-fetch', known)).toEqual({ server: 'notion', tool: 'notion-fetch' })
    })

    it('never reads a bridged builtin as a connector tool', () => {
        expect(parseMcpToolName('mcp__rerun__shell_exec', [...known, 'rerun'])).toBeNull()
        expect(parseMcpToolName('rerun__ask_user', [...known, 'rerun'])).toBeNull()
    })

    it('ignores a builtin name', () => {
        expect(parseMcpToolName('shell_exec', known)).toBeNull()
        expect(parseMcpToolName('rerun_hub_service_search', known)).toBeNull()
    })
})

describe('humanizeToolSegment', () => {
    it('titles underscored and hyphenated segments', () => {
        expect(humanizeToolSegment('get_tweet_detail')).toBe('Get Tweet Detail')
        expect(humanizeToolSegment('notion-fetch')).toBe('Notion Fetch')
        expect(humanizeToolSegment('Send_Email')).toBe('Send Email')
    })
})

describe('resolveConnectorTool', () => {
    const map = buildConnectorMap([service({})])

    it('labels a mapped tool with the tool name alone', () => {
        expect(resolveConnectorTool('mcp__getxapi__get_tweet_detail', map)).toEqual({
            label: 'Get Tweet Detail',
            service: { slug: 'getxapi', name: 'GetXAPI', icon: 'https://cdn.example.com/getxapi.svg', category: 'other' },
        })
    })

    it('returns null for an unmapped server so the caller keeps the generic rendering', () => {
        expect(resolveConnectorTool('mcp__stripe__create_customer', map)).toBeNull()
    })
})

function custom(over: Partial<CustomMcpServer>): CustomMcpServer {
    return { name: 'linear', displayName: 'Linear', transport: 'http', host: 'mcp.linear.app', icon: 'https://favicon/linear.png', signInUrl: 'https://mcp.linear.app/mcp', ...over }
}

describe('custom servers in the connector map', () => {
    it('adds a custom server under its own name, and an app keeps a name it already holds', () => {
        const map = buildConnectorMap([service({})], [custom({}), custom({ name: 'getxapi', displayName: 'Impostor' })])
        expect(map.get('linear')).toEqual({ slug: 'mcp:linear', name: 'Linear', icon: 'https://favicon/linear.png', category: 'custom', custom: true })
        expect(map.get('getxapi')?.name).toBe('GetXAPI')
    })

    it('keeps the server name in the label of a custom tool', () => {
        const map = buildConnectorMap([], [custom({})])
        expect(resolveConnectorTool('mcp__linear__list_issues', map)?.label).toBe('Linear · List Issues')
    })

    it('reads the single underscore the engine own providers write', () => {
        const map = buildConnectorMap([service({})], [custom({})])
        expect(resolveConnectorTool('linear_list_issues', map)?.label).toBe('Linear · List Issues')
        expect(resolveConnectorTool('getxapi_get_tweet', map)?.label).toBe('Get Tweet')
    })

    it('prefers the double underscore when a name reads both ways', () => {
        expect(parseMcpToolName('gh__search', ['gh'])).toEqual({ server: 'gh', tool: 'search' })
    })

    it('never takes a builtin for a tool of a server sharing its prefix', () => {
        const map = buildConnectorMap([], [custom({ name: 'memory', displayName: 'Memory' })])
        expect(resolveConnectorTool('memory_write', map, name => name === 'memory_write')).toBeNull()
        expect(resolveConnectorTool('memory_recall_all', map, name => name === 'memory_write')?.label).toBe('Memory · Recall All')
    })
})

describe('a tool a paid app runs from its directory', () => {
    const map = buildConnectorMap([service({ key: 'linkedin-pro', slug: 'linkedin-pro', name: 'LinkedIn Pro', toolNames: ['linkedin_pro'] })])

    it('is named after the tool that ran, with or without the server prefix', () => {
        expect(resolveConnectorTool('linkedin_pro_run_tool', map, undefined, { tool: 'sales_nav_search_people', arguments: { keyword: 'cto' } })?.label).toBe('Sales Nav Search People')
        expect(resolveConnectorTool('mcp__linkedin_pro__run_tool', map, undefined, { tool: 'linkedin_pro_recruiter_list_jobs' })?.label).toBe('Recruiter List Jobs')
    })

    it('keeps the name of the call while its input has not streamed in', () => {
        expect(resolveConnectorTool('linkedin_pro_run_tool', map)?.label).toBe('Run Tool')
        expect(resolveConnectorTool('linkedin_pro_run_tool', map, undefined, { tool: '' })?.label).toBe('Run Tool')
    })

    it('leaves every other tool named after itself, whatever its input holds', () => {
        expect(resolveConnectorTool('linkedin_pro_get_profile', map, undefined, { tool: 'send_message' })?.label).toBe('Get Profile')
    })
})

