import { z } from 'zod'

// The global search of the control center: every mention of a word on the workspace's machine.
// `agentId` is the engine's id of the coworker the hit belongs to, null for what the workspace shares.

export const WORKSPACE_SEARCH_MIN_CHARS = 2
export const WORKSPACE_SEARCH_MAX_CHARS = 200
export const WORKSPACE_SEARCH_HITS_PER_SOURCE = 20

export const workspaceSearchQuerySchema = z.object({
    q: z.string().trim().min(WORKSPACE_SEARCH_MIN_CHARS).max(WORKSPACE_SEARCH_MAX_CHARS),
    // Comma-separated: the coworkers whose soul, skills, files and tables the caller may read.
    agents: z
        .string()
        .optional()
        .transform(value => (value ? value.split(',').filter(Boolean) : [])),
})

const snippet = z.string()

export const workspaceSearchHitSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('coworker'), agentId: z.string(), field: z.literal('soul'), line: z.number().int(), snippet }),
    z.object({ kind: z.literal('skill'), agentId: z.string().nullable(), slug: z.string(), name: z.string(), snippet }),
    z.object({ kind: z.literal('file'), agentId: z.string().nullable(), path: z.string(), line: z.number().int().nullable(), snippet }),
    z.object({ kind: z.literal('brain'), slug: z.string(), title: z.string(), snippet }),
    z.object({ kind: z.literal('table'), agentId: z.string().nullable(), table: z.string(), rowId: z.number().int().nullable(), title: z.string(), snippet }),
])

export const workspaceSearchResultSchema = z.object({
    hits: z.array(workspaceSearchHitSchema),
    // The search ran out of time before every source was read.
    truncated: z.boolean(),
})

export type WorkspaceSearchHit = z.infer<typeof workspaceSearchHitSchema>
export type WorkspaceSearchKind = WorkspaceSearchHit['kind']
export type WorkspaceSearchResult = z.infer<typeof workspaceSearchResultSchema>

const SNIPPET_CHARS = 160
const SNIPPET_LEAD = 48

// One line of text cut around the first mention of `needle`, so the word is always in view.
export function snippetAround(text: string, needle: string): string {
    const flat = text.replace(/\s+/g, ' ').trim()
    const at = flat.toLowerCase().indexOf(needle.toLowerCase())
    if (flat.length <= SNIPPET_CHARS || at < SNIPPET_LEAD) return flat.length <= SNIPPET_CHARS ? flat : `${flat.slice(0, SNIPPET_CHARS).trimEnd()}…`
    const start = Math.max(0, Math.min(at - SNIPPET_LEAD, flat.length - SNIPPET_CHARS))
    const end = start + SNIPPET_CHARS
    return `…${flat.slice(start, end).trim()}${end < flat.length ? '…' : ''}`
}
