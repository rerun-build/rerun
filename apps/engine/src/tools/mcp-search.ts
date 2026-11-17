import type { ToolSet } from 'ai'
import { mcpToolNameFor, type McpTool } from './mcp.js'
import { toolPayloadChars } from './payload.js'

// Above this, the schemas of an agent's MCP tools stop riding along on every step: the model is
// told which servers it has and loads the tools it needs. About 10k tokens, so an agent with one
// small server keeps its tools loaded and pays no search step.
export const MCP_EAGER_PAYLOAD_CHARS = 40_000
export const MCP_SEARCH_DEFAULT_LIMIT = 8
export const MCP_SEARCH_MAX_LIMIT = 20

export type McpCatalogEntry = { name: string; server: string; tool: string; description: string }
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

// The tools asked for by their name come first, then the tools ranked by the words of the query
// they carry, a word of the name weighing more than one of the description.
export function searchMcpTools(catalog: McpCatalogEntry[], { query = '', server, limit }: McpSearch): McpSearchResult {
    const wanted = query.trim().toLowerCase()
    if (!wanted) return { matches: [], total: 0 }
    const names = wanted.split(/[\s,]+/)
    const queryWords = [...new Set(wordsOf(wanted))]
    const ranked = (server?.trim() ? mcpServerTools(catalog, server) : catalog)
        .map((entry, position) => {
            const named = names.includes(entry.name.toLowerCase()) || entry.tool.toLowerCase() === wanted
            return { entry, position, score: named ? Number.POSITIVE_INFINITY : scoreOf(entry, queryWords) }
        })
        .filter(candidate => candidate.score > 0)
        .sort((a, b) => (a.score === b.score ? a.position - b.position : b.score - a.score))
    return { matches: ranked.slice(0, limitOf(limit)).map(candidate => candidate.entry), total: ranked.length }
}
