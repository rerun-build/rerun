import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { mcpToolNameFor, modelReadyMcpTool, type McpTool } from './mcp.js'
import { toolPayloadChars } from './payload.js'

// Above this, an agent's MCP tools are no longer sent to the model: it is told which servers it has,
// reads the schema of the tools it needs in the result of a search, and runs them through one
// generic call. The list of tools it is sent then never changes, so a search costs no prompt cache.
// About 10k tokens, so an agent with one small server keeps its tools in the list and pays no search step.
export const MCP_EAGER_PAYLOAD_CHARS = 40_000
export const MCP_SEARCH_DEFAULT_LIMIT = 8
export const MCP_SEARCH_MAX_LIMIT = 20

export const MCP_SEARCH_TOOL = 'mcp_search'
// The one tool every held-back tool is run through, see `mcp-wire.ts`.
export const MCP_CALL_TOOL = 'mcp_call'
const SERVER_LISTING_CAP = 200
// A word this short is only looked for whole: `in` is not found in `linear`, nor `an` in `channel`.
const PARTIAL_MATCH_MIN_CHARS = 4
const FILLER_WORDS = new Set(['an', 'the', 'to', 'of', 'in', 'on', 'for', 'and', 'or', 'with', 'from', 'by', 'at', 'my', 'me', 'is', 'are', 'it', 'its', 'that', 'into', 'as', 'be', 'all', 'any', 'some'])

// `description` and `inputSchema` are the ones the model would get with the tool in its list.
export type McpCatalogEntry = { name: string; server: string; tool: string; description: string; inputSchema: McpTool['inputSchema'] }
export type McpSearch = { query?: string; server?: string; limit?: number }
export type McpSearchResult = { matches: McpCatalogEntry[]; total: number }

const NAME_WORD_SCORE = 4
const NAME_PART_SCORE = 3
const DESCRIPTION_SCORE = 1

export function mcpToolsAreDeferred(mcpTools: ToolSet): boolean {
    return toolPayloadChars(mcpTools) > MCP_EAGER_PAYLOAD_CHARS
}

// One entry per tool under the name the loop registers it. Two servers whose tools end up with the
// same name leave one entry, the last, as they leave one tool in the set.
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

// `listIssues` and `list_issues` are the same two words, and `issues` finds `issue`.
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

// "create an issue in linear" is asked with `create`, `issue` and `linear`. A query made of filler
// words only is kept as it is.
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

// Full names give exactly those tools. Otherwise the tools are ranked by the words of the query they
// carry, a word of the name weighing more than one of the description, the tool named like the query first.
export function searchMcpTools(catalog: McpCatalogEntry[], { query = '', server, limit }: McpSearch): McpSearchResult {
    const asked = query.trim()
    if (!asked) return { matches: [], total: 0 }
    const scoped = server?.trim() ? mcpServerTools(catalog, server) : catalog
    // The pieces keep their case: `getChannelMessages` is still three words once it is not a full name.
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

// The tools the model is sent, the same on every step of every run of the conversation: everything
// but the MCP tools held back. Those stay in the set, so a call that names one still runs.
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
