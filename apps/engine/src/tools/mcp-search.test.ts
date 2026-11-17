import { dynamicTool, jsonSchema } from 'ai'
import { describe, expect, it } from 'vitest'
import { MCP_EAGER_PAYLOAD_CHARS, MCP_SEARCH_DEFAULT_LIMIT, MCP_SEARCH_MAX_LIMIT, mcpServerTools, mcpToolCatalog, mcpToolsAreDeferred, searchMcpTools } from './mcp-search.js'

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
        expect(catalog[0]).toEqual({ name: 'linear_list_issues', server: 'linear', tool: 'list_issues', description: 'List the issues of a team, filtered by state or assignee.' })
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
        expect(colliding).toEqual([{ name: 'a_b_c', server: 'a', tool: 'b_c', description: 'second' }])
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

    it('puts a tool asked for by its name first, with or without its server prefix', () => {
        expect(namesOf({ query: 'linear_list_teams' })[0]).toBe('linear_list_teams')
        expect(namesOf({ query: 'LIST_TEAMS' })[0]).toBe('linear_list_teams')
    })

    it('takes several names in one query', () => {
        expect(namesOf({ query: 'discord_send_message, linear_save_comment' }).slice(0, 2)).toEqual(['linear_save_comment', 'discord_send_message'])
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
