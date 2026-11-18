import { dynamicTool, jsonSchema } from 'ai'
import { describe, expect, it } from 'vitest'
import {
    MCP_EAGER_PAYLOAD_CHARS,
    MCP_SEARCH_DEFAULT_LIMIT,
    MCP_SEARCH_MAX_LIMIT,
    MCP_SEARCH_TOOL,
    mcpSearchTool,
    mcpServerToolCounts,
    mcpServerTools,
    mcpToolCatalog,
    mcpToolsAreDeferred,
    searchMcpTools,
    sentToolNames,
} from './mcp-search.js'

const tool = (name: string, description?: string) => ({ name, description, inputSchema: { type: 'object' as const } })

const catalog = mcpToolCatalog([
    {
        name: 'linear',
        tools: [
            tool('list_issues', 'List the issues of a team, filtered by state or assignee.'),
            tool('create_issue', 'Create an issue in a team.'),
            tool('list_teams', 'List the teams of the workspace.'),
            tool('save_comment', 'Post a comment on an issue.'),
        ],
    },
    {
        name: 'discord',
        tools: [tool('getChannelMessages', 'Read the latest messages of a channel.'), tool('send_message', 'Send a message to a channel.'), tool('list_guilds')],
    },
])

const namesOf = (query: Parameters<typeof searchMcpTools>[1]) => searchMcpTools(catalog, query).matches.map(entry => entry.name)

describe('mcpToolCatalog', () => {
    it('names each tool as the loop registers it and keeps its server', () => {
        expect(catalog[0]).toEqual({ name: 'linear_list_issues', server: 'linear', tool: 'list_issues', description: 'List the issues of a team, filtered by state or assignee.', inputSchema: { type: 'object' } })
        expect(catalog.map(entry => entry.name)).toEqual([
            'linear_list_issues',
            'linear_create_issue',
            'linear_list_teams',
            'linear_save_comment',
            'discord_getChannelMessages',
            'discord_send_message',
            'discord_list_guilds',
        ])
        expect(catalog.at(-1)?.description).toBe('')
    })

    it('keeps one entry, the last, for two servers whose tools get the same name', () => {
        const colliding = mcpToolCatalog([
            { name: 'a_b', tools: [tool('c', 'first')] },
            { name: 'a', tools: [tool('b_c', 'second')] },
        ])
        expect(colliding).toEqual([{ name: 'a_b_c', server: 'a', tool: 'b_c', description: 'second', inputSchema: { type: 'object' } }])
    })

    it('carries the schema and the description the model would get with the tool in its list', () => {
        const properties = { id: { type: 'string' }, url: { type: 'string' } }
        const union = { name: 'read_page', description: 'Read a page.', inputSchema: { type: 'object' as const, properties, oneOf: [{ required: ['id'] }, { required: ['url'] }] } }
        expect(mcpToolCatalog([{ name: 'notion', tools: [union] }])).toEqual([
            { name: 'notion_read_page', server: 'notion', tool: 'read_page', description: 'Read a page.\n\nProvide exactly one of: id, url.', inputSchema: { type: 'object', properties } },
        ])
    })
})

describe('searchMcpTools', () => {
    it('ranks a word of the name above the same word in a description', () => {
        expect(namesOf({ query: 'issue' })).toEqual(['linear_list_issues', 'linear_create_issue', 'linear_save_comment'])
    })

    it('adds up the words of the query, so the tool carrying most of them comes first', () => {
        expect(namesOf({ query: 'create an issue' })[0]).toBe('linear_create_issue')
        expect(namesOf({ query: 'send discord message' })[0]).toBe('discord_send_message')
    })

    it('reads camelCase names and plurals as the words they are', () => {
        expect(namesOf({ query: 'channel message' })).toEqual(['discord_getChannelMessages', 'discord_send_message'])
    })

    it('leaves the filler words of a sentence out, and looks for a short word whole', () => {
        expect(namesOf({ query: 'create an issue' })).toEqual(['linear_create_issue', 'linear_list_issues', 'linear_save_comment'])
        expect(namesOf({ query: 'send it to a channel' })).toEqual(['discord_send_message', 'discord_getChannelMessages'])
        expect(namesOf({ query: 'an' })).toEqual(['linear_create_issue', 'linear_save_comment'])
    })

    it('reads the camelCase of the query too, next to other words', () => {
        expect(namesOf({ query: 'getChannelMessages sendMessage' })).toEqual(['discord_getChannelMessages', 'discord_send_message'])
        expect(namesOf({ query: 'ListTeams' })[0]).toBe('linear_list_teams')
    })

    it('gives exactly the tools asked for by their full names', () => {
        expect(namesOf({ query: 'linear_list_teams' })).toEqual(['linear_list_teams'])
        expect(namesOf({ query: 'discord_send_message, LINEAR_SAVE_COMMENT' })).toEqual(['linear_save_comment', 'discord_send_message'])
    })

    it('puts a tool named like the query first, then the ones carrying its words', () => {
        expect(namesOf({ query: 'LIST_TEAMS' })).toEqual(['linear_list_teams', 'linear_list_issues', 'discord_list_guilds', 'linear_create_issue'])
        expect(namesOf({ query: 'linear_list_teams comment' }).slice(0, 2)).toEqual(['linear_list_teams', 'linear_save_comment'])
    })

    it('keeps the search inside a server, whatever its case', () => {
        expect(namesOf({ query: 'list', server: 'Discord' })).toEqual(['discord_list_guilds'])
        expect(namesOf({ query: 'list', server: 'nowhere' })).toEqual([])
    })

    it('finds nothing without a query', () => {
        expect(searchMcpTools(catalog, {})).toEqual({ matches: [], total: 0 })
        expect(searchMcpTools(catalog, { query: '   ', server: 'discord' })).toEqual({ matches: [], total: 0 })
    })

    it('finds nothing for words no tool carries', () => {
        expect(searchMcpTools(catalog, { query: 'invoice refund' })).toEqual({ matches: [], total: 0 })
    })

    it('caps the matches and still counts them all', () => {
        const wide = mcpToolCatalog([{ name: 'big', tools: Array.from({ length: 50 }, (_, i) => tool(`get_record_${i}`)) }])
        expect(searchMcpTools(wide, { query: 'record' })).toMatchObject({ total: 50, matches: { length: MCP_SEARCH_DEFAULT_LIMIT } })
        expect(searchMcpTools(wide, { query: 'record', limit: 3 }).matches).toHaveLength(3)
        expect(searchMcpTools(wide, { query: 'record', limit: 500 }).matches).toHaveLength(MCP_SEARCH_MAX_LIMIT)
        expect(searchMcpTools(wide, { query: 'record', limit: 0 }).matches).toHaveLength(1)
    })
})

describe('mcpServerTools', () => {
    it('gives the tools of one server, whatever the case of its name', () => {
        expect(mcpServerTools(catalog, ' Discord ').map(entry => entry.tool)).toEqual(['getChannelMessages', 'send_message', 'list_guilds'])
        expect(mcpServerTools(catalog, 'nowhere')).toEqual([])
    })
})

describe('mcpToolsAreDeferred', () => {
    const toolsWeighing = (descriptionChars: number) => ({
        srv_tool: dynamicTool({ description: 'x'.repeat(descriptionChars), inputSchema: jsonSchema({ type: 'object' }), execute: async () => '' }),
    })

    it('leaves a light set loaded and defers a heavy one', () => {
        expect(mcpToolsAreDeferred({})).toBe(false)
        expect(mcpToolsAreDeferred(toolsWeighing(1_000))).toBe(false)
        expect(mcpToolsAreDeferred(toolsWeighing(MCP_EAGER_PAYLOAD_CHARS))).toBe(true)
    })
})

describe('mcpServerToolCounts', () => {
    it('counts the tools of each server', () => {
        expect([...mcpServerToolCounts(catalog)]).toEqual([
            ['linear', 4],
            ['discord', 3],
        ])
    })
})

describe('mcp_search', () => {
    function searchWith(entries = catalog) {
        const search = mcpSearchTool(entries)[MCP_SEARCH_TOOL] as unknown as { execute: (input: Record<string, unknown>, options: unknown) => Promise<Record<string, unknown>> }
        return (input: Record<string, unknown>) => search.execute(input, { toolCallId: 'c', messages: [] })
    }

    it('gives the name, the description and the input schema of the tools it finds', async () => {
        expect(await searchWith()({ query: 'send message', server: 'discord', limit: 1 })).toEqual({
            tools: [{ name: 'discord_send_message', description: 'Send a message to a channel.', inputSchema: { type: 'object' } }],
            total: 2,
            note: '1 more match: narrow the query or raise the limit to get them.',
        })
    })

    it('gives a description whole, whatever its length', async () => {
        const long = `${'a'.repeat(300)}\nSecond line.`
        const { tools } = (await searchWith(mcpToolCatalog([{ name: 'big', tools: [tool('export', long)] }]))({ query: 'export' })) as { tools: Array<{ description: string }> }
        expect(tools[0].description).toBe(long)
    })

    it('lists the names of a server, without their schemas', async () => {
        const listing = await searchWith()({ server: 'Discord' })
        expect(listing).toMatchObject({ names: ['discord_getChannelMessages', 'discord_send_message', 'discord_list_guilds'], total: 3 })
        expect(listing).not.toHaveProperty('tools')
    })

    it('names the servers when it is given nothing, an unknown server or words no tool carries', async () => {
        const run = searchWith()
        const servers = 'Your servers: linear (4 tools), discord (3 tools).'
        expect(await run({})).toEqual({ tools: [], note: `Give a query, or a server to list its tools. ${servers}` })
        expect(await run({ query: 'list', server: 'slack' })).toEqual({ tools: [], note: `No connected server is named "slack". ${servers}` })
        expect(await run({ query: 'invoice refund' })).toEqual({ tools: [], note: `No tool matches these words. Try other words, or list a server's tools. ${servers}` })
    })

    it('answers the same search the same way, keeping nothing from one call to the next', async () => {
        const run = searchWith()
        const first = await run({ query: 'linear_list_teams' })
        await run({ query: 'discord_list_guilds' })
        expect(await run({ query: 'linear_list_teams' })).toEqual(first)
    })
})

describe('sentToolNames', () => {
    const noop = dynamicTool({ description: 'x', inputSchema: jsonSchema({ type: 'object' }), execute: async () => '' })
    const tools = { fs_read: noop, linear_list_issues: noop, linear_create_issue: noop, [MCP_SEARCH_TOOL]: noop }

    it('leaves out every held-back tool, in the order of the set', () => {
        expect(sentToolNames(tools, catalog.filter(entry => entry.server === 'linear'))).toEqual(['fs_read', MCP_SEARCH_TOOL])
        expect(sentToolNames(tools, [])).toEqual(['fs_read', 'linear_list_issues', 'linear_create_issue', MCP_SEARCH_TOOL])
    })
})
