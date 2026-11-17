import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { mcpToolNameFor, type McpTool } from './mcp.js'
import { toolPayloadChars } from './payload.js'

// Above this, the schemas of an agent's MCP tools stop riding along on every step: the model is
// told which servers it has and loads the tools it needs. About 10k tokens, so an agent with one
// small server keeps its tools loaded and pays no search step.
export const MCP_EAGER_PAYLOAD_CHARS = 40_000
export const MCP_SEARCH_DEFAULT_LIMIT = 8
export const MCP_SEARCH_MAX_LIMIT = 20

export const MCP_SEARCH_TOOL = 'mcp_search'
const SERVER_LISTING_CAP = 200
const SUMMARY_CHARS = 200

export type McpCatalogEntry = { name: string; server: string; tool: string; description: string }
// What a run holds back: the tools it does not send, and the ones it loaded since.
export type DeferredMcpTools = { catalog: McpCatalogEntry[]; loaded: Set<string> }
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
            byName.set(name, { name, server: server.name, tool: tool.name, description: tool.description ?? '' })
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
        if (nameWords.includes(word)) score += NAME_WORD_SCORE
        else if (nameWords.some(nameWord => nameWord.includes(word))) score += NAME_PART_SCORE
        else if (descriptionWords.some(descriptionWord => descriptionWord.includes(word))) score += DESCRIPTION_SCORE
    }
    return score
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
    const wanted = query.trim().toLowerCase()
    if (!wanted) return { matches: [], total: 0 }
    const scoped = server?.trim() ? mcpServerTools(catalog, server) : catalog
    const names = wanted.split(/[\s,]+/).filter(Boolean)
    const named = scoped.filter(entry => names.includes(entry.name.toLowerCase()))
    const words = names.filter(piece => !named.some(entry => entry.name.toLowerCase() === piece))
    if (words.length === 0) return { matches: named.slice(0, limitOf(limit)), total: named.length }
    const queryWords = [...new Set(wordsOf(words.join(' ')))]
    const ranked = scoped
        .map((entry, position) => {
            const isNamed = named.includes(entry) || entry.tool.toLowerCase() === wanted
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

// The tools a step is sent: everything but the MCP tools the run has not loaded. The others stay in
// the set, so a tool called by its name without a search still runs.
export function activeToolNames(tools: ToolSet, deferred: DeferredMcpTools): string[] {
    const held = new Set(deferred.catalog.map(entry => entry.name))
    return Object.keys(tools).filter(name => !held.has(name) || deferred.loaded.has(name))
}

function summaryOf(description: string): string {
    const firstLine = description.trim().split('\n')[0] ?? ''
    return firstLine.length > SUMMARY_CHARS ? `${firstLine.slice(0, SUMMARY_CHARS - 1)}…` : firstLine
}

function serversLine(catalog: McpCatalogEntry[]): string {
    return [...mcpServerToolCounts(catalog)].map(([server, count]) => `${server} (${count} tools)`).join(', ')
}

export function mcpSearchTool(deferred: DeferredMcpTools): ToolSet {
    const { catalog, loaded } = deferred
    return {
        [MCP_SEARCH_TOOL]: tool({
            description:
                'Find and load the tools of your connected MCP servers. Their schemas are not sent to you until you load them. Give a few words of what you need, or exact tool names, with the server name when you know it: the tools found are loaded and you call them by their name from your next step. Give a server alone to list the names of its tools.',
            inputSchema: z.object({
                query: z.string().optional().describe('Words for the action you need ("create issue", "list channel messages"), or exact tool names.'),
                server: z.string().optional().describe('Name of a connected MCP server, to search or list only its tools.'),
                limit: z.number().int().min(1).max(MCP_SEARCH_MAX_LIMIT).optional().describe(`How many tools to load at most, ${MCP_SEARCH_DEFAULT_LIMIT} by default.`),
            }),
            execute: async ({ query, server, limit }) => {
                const scoped = server?.trim() ? mcpServerTools(catalog, server) : catalog
                if (server?.trim() && scoped.length === 0) return { loaded: [], note: `No connected server is named "${server.trim()}". Your servers: ${serversLine(catalog)}.` }
                if (!query?.trim()) {
                    if (!server?.trim()) return { loaded: [], note: `Give a query, or a server to list its tools. Your servers: ${serversLine(catalog)}.` }
                    const names = scoped.map(entry => entry.name)
                    return {
                        loaded: [],
                        tools: names.slice(0, SERVER_LISTING_CAP),
                        total: names.length,
                        note: 'These tools are listed, not loaded: call mcp_search again with the names or the words of the ones you need.',
                    }
                }
                const { matches, total } = searchMcpTools(catalog, { query, server, limit })
                for (const match of matches) loaded.add(match.name)
                if (matches.length === 0) return { loaded: [], note: `No tool matches these words. Try other words, or list a server's tools. Your servers: ${serversLine(catalog)}.` }
                return {
                    loaded: matches.map(match => ({ name: match.name, description: summaryOf(match.description) })),
                    total,
                    ...(total > matches.length ? { note: `${total - matches.length} more match: narrow the query or raise the limit to load them.` } : {}),
                }
            },
        }),
    }
}
