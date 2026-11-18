import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { mcpToolNameFor, modelReadyMcpTool, type McpTool } from './mcp.js'
import { toolPayloadChars } from './payload.js'

export const MCP_EAGER_PAYLOAD_CHARS = 40_000
export const MCP_SEARCH_DEFAULT_LIMIT = 8
export const MCP_SEARCH_MAX_LIMIT = 20

export const MCP_SEARCH_TOOL = 'mcp_search'
export const MCP_CALL_TOOL = 'mcp_call'
const SERVER_LISTING_CAP = 200
const PARTIAL_MATCH_MIN_CHARS = 4
const FILLER_WORDS = new Set(['an', 'the', 'to', 'of', 'in', 'on', 'for', 'and', 'or', 'with', 'from', 'by', 'at', 'my', 'me', 'is', 'are', 'it', 'its', 'that', 'into', 'as', 'be', 'all', 'any', 'some'])

export type McpCatalogEntry = { name: string; server: string; tool: string; description: string; inputSchema: McpTool['inputSchema'] }
export type McpSearch = { query?: string; server?: string; limit?: number }
export type McpSearchResult = { matches: McpCatalogEntry[]; total: number }

const NAME_WORD_SCORE = 4
const NAME_PART_SCORE = 3
const DESCRIPTION_SCORE = 1

export function mcpToolsAreDeferred(mcpTools: ToolSet): boolean {
    return toolPayloadChars(mcpTools) > MCP_EAGER_PAYLOAD_CHARS
}

export function mcpToolCatalog(servers: Array<{ name: string; tools: McpTool[] }>): McpCatalogEntry[] {
    const byName = new Map<string, McpCatalogEntry>()
    for (const server of servers) {
        for (const tool of server.tools) {
            const name = mcpToolNameFor(undefined, server.name, tool.name)
            const ready = modelReadyMcpTool(server.name, tool)
            byName.set(name, { name, server: server.name, tool: tool.name, description: ready.description ?? '', inputSchema: ready.inputSchema })
        }
    }
    return [...byName.values()]
}

function wordsOf(text: string): string[] {
    return text
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(word => word.length > 1)
        .map(word => (word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word))
}

function scoreOf(entry: McpCatalogEntry, queryWords: string[]): number {
    const nameWords = wordsOf(entry.name)
    const descriptionWords = wordsOf(entry.description)
    let score = 0
    for (const word of queryWords) {
        const carries = (candidate: string) => candidate === word || (word.length >= PARTIAL_MATCH_MIN_CHARS && candidate.includes(word))
        if (nameWords.includes(word)) score += NAME_WORD_SCORE
        else if (nameWords.some(carries)) score += NAME_PART_SCORE
        else if (descriptionWords.some(carries)) score += DESCRIPTION_SCORE
    }
    return score
}

function queryWordsOf(text: string): string[] {
    const words = [...new Set(wordsOf(text))]
    const meaningful = words.filter(word => !FILLER_WORDS.has(word))
    return meaningful.length > 0 ? meaningful : words
}

function limitOf(limit: number | undefined): number {
    if (limit === undefined || !Number.isFinite(limit)) return MCP_SEARCH_DEFAULT_LIMIT
    return Math.min(Math.max(Math.trunc(limit), 1), MCP_SEARCH_MAX_LIMIT)
}

export function mcpServerTools(catalog: McpCatalogEntry[], server: string): McpCatalogEntry[] {
    const wanted = server.trim().toLowerCase()
    return catalog.filter(entry => entry.server.toLowerCase() === wanted)
}

export function searchMcpTools(catalog: McpCatalogEntry[], { query = '', server, limit }: McpSearch): McpSearchResult {
    const asked = query.trim()
    if (!asked) return { matches: [], total: 0 }
    const scoped = server?.trim() ? mcpServerTools(catalog, server) : catalog
    const pieces = asked.split(/[\s,]+/).filter(Boolean)
    const askedNames = new Set(pieces.map(piece => piece.toLowerCase()))
    const named = scoped.filter(entry => askedNames.has(entry.name.toLowerCase()))
    const foundNames = new Set(named.map(entry => entry.name.toLowerCase()))
    const words = pieces.filter(piece => !foundNames.has(piece.toLowerCase()))
    if (words.length === 0) return { matches: named.slice(0, limitOf(limit)), total: named.length }
    const queryWords = queryWordsOf(words.join(' '))
    const ranked = scoped
        .map((entry, position) => {
            const isNamed = named.includes(entry) || entry.tool.toLowerCase() === asked.toLowerCase()
            return { entry, position, score: isNamed ? Number.POSITIVE_INFINITY : scoreOf(entry, queryWords) }
        })
        .filter(candidate => candidate.score > 0)
        .sort((a, b) => (a.score === b.score ? a.position - b.position : b.score - a.score))
    return { matches: ranked.slice(0, limitOf(limit)).map(candidate => candidate.entry), total: ranked.length }
}

export function mcpServerToolCounts(catalog: McpCatalogEntry[]): Map<string, number> {
    const counts = new Map<string, number>()
    for (const entry of catalog) counts.set(entry.server, (counts.get(entry.server) ?? 0) + 1)
    return counts
}

export function sentToolNames(tools: ToolSet, catalog: McpCatalogEntry[]): string[] {
    const held = new Set(catalog.map(entry => entry.name))
    return Object.keys(tools).filter(name => !held.has(name))
}

function serversLine(catalog: McpCatalogEntry[]): string {
    return [...mcpServerToolCounts(catalog)].map(([server, count]) => `${server} (${count} tools)`).join(', ')
}

export function mcpSearchTool(catalog: McpCatalogEntry[]): ToolSet {
    return {
        [MCP_SEARCH_TOOL]: tool({
            description: `Find the tools of your connected MCP servers. They are not in your tool list: give a few words of what you need, or exact tool names, with the server name when you know it, and you get the name, the description and the input schema of the tools found. Run one with ${MCP_CALL_TOOL}. Give a server alone to list the names of its tools.`,
            inputSchema: z.object({
                query: z.string().optional().describe('Words for the action you need ("create issue", "list channel messages"), or exact tool names.'),
                server: z.string().optional().describe('Name of a connected MCP server, to search or list only its tools.'),
                limit: z.number().int().min(1).max(MCP_SEARCH_MAX_LIMIT).optional().describe(`How many tools to return at most, ${MCP_SEARCH_DEFAULT_LIMIT} by default.`),
            }),
            execute: async ({ query, server, limit }) => {
                const scoped = server?.trim() ? mcpServerTools(catalog, server) : catalog
                if (server?.trim() && scoped.length === 0) return { tools: [], note: `No connected server is named "${server.trim()}". Your servers: ${serversLine(catalog)}.` }
                if (!query?.trim()) {
                    if (!server?.trim()) return { tools: [], note: `Give a query, or a server to list its tools. Your servers: ${serversLine(catalog)}.` }
                    const names = scoped.map(entry => entry.name)
                    return {
                        names: names.slice(0, SERVER_LISTING_CAP),
                        total: names.length,
                        note: `Names only: call ${MCP_SEARCH_TOOL} again with the names or the words of the ones you need to get their input schema.`,
                    }
                }
                const { matches, total } = searchMcpTools(catalog, { query, server, limit })
                if (matches.length === 0) return { tools: [], note: `No tool matches these words. Try other words, or list a server's tools. Your servers: ${serversLine(catalog)}.` }
                return {
                    tools: matches.map(match => ({ name: match.name, description: match.description, inputSchema: match.inputSchema })),
                    total,
                    ...(total > matches.length ? { note: `${total - matches.length} more match: narrow the query or raise the limit to get them.` } : {}),
                }
            },
        }),
    }
}
