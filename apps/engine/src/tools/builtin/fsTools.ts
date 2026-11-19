import { existsSync } from 'node:fs'
import { isAbsolute, sep } from 'node:path'
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { resolveWithin } from '../sandbox.js'
import * as store from '../../files/store.js'

type FsToolsOptions = {
    prefix: string
    label: string
    rootDir: string | ((input: Record<string, unknown>) => Promise<string>)
    scope?: z.ZodRawShape
    extraRoots?: string[]
}

function isWithin(root: string, path: string): boolean {
    try {
        resolveWithin(root, path)
        return true
    } catch {
        return false
    }
}

const READ_CHARS = 100_000

export function makeFsTools({ prefix, label: baseLabel, rootDir, scope = {}, extraRoots = [] }: FsToolsOptions): ToolSet {
    const extraRootOf = (path: unknown) => (typeof path === 'string' && isAbsolute(path) ? extraRoots.find(root => isWithin(root, path)) : undefined)
    const rootOf = async (input: Record<string, unknown>) => extraRootOf(input.path) ?? (typeof rootDir === 'string' ? rootDir : rootDir(input))
    const extra = extraRoots.join(' or ')
    const label = extraRoots.length ? `${baseLabel} (or, by absolute path, a job folder under ${extra})` : baseLabel
    const pathNote = extraRoots.length ? `Path relative to the workspace, or an absolute path under ${extra}` : 'Path relative to the root'
    return {
        [`${prefix}_read`]: tool({
            description: `Read a UTF-8 file from the ${label}. Optional 1-based startLine, endLine.`,
            inputSchema: z.object({
                ...scope,
                path: z.string().describe(pathNote),
                startLine: z.number().int().min(1).optional(),
                endLine: z.number().int().min(1).optional(),
            }),
            execute: async input => {
                const content = await store.readText(await rootOf(input), input.path)
                if (input.startLine === undefined && input.endLine === undefined) return content.slice(0, READ_CHARS)
                const lines = content === '' ? [] : content.split('\n')
                if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
                const total = lines.length
                const start = input.startLine ?? 1
                if (start > total) return `startLine ${start} is past the end of ${input.path} (${total} lines)`
                const end = Math.min(input.endLine ?? total, total)
                if (end < start) return `endLine ${end} is before startLine ${start}`
                const taken: string[] = []
                let used = 0
                for (let i = start - 1; i < end; i++) {
                    const cost = (taken.length ? 1 : 0) + lines[i].length
                    if (used + cost > READ_CHARS) break
                    taken.push(lines[i])
                    used += cost
                }
                if (taken.length === 0) taken.push(lines[start - 1].slice(0, READ_CHARS))
                return [`lines ${start}-${start + taken.length - 1} of ${total}`, ...taken].join('\n')
            },
        }),
        [`${prefix}_write`]: tool({
            description: `Write a UTF-8 file in the ${label}, creating parent directories as needed.`,
            inputSchema: z.object({ ...scope, path: z.string(), content: z.string() }),
            execute: async input => {
                const { path, content } = input
                await store.writeText(await rootOf(input), path, content)
                return `Wrote ${content.length} bytes to ${path}`
            },
        }),
        [`${prefix}_list`]: tool({
            description: `List entries in a ${label} directory.`,
            inputSchema: z.object({ ...scope, path: z.string().default('.') }),
            execute: async input => {
                const entries = await store.listEntries(await rootOf(input), input.path)
                return entries.map(e => (e.type === 'dir' ? `${e.name}/` : e.name)).join('\n') || '(empty)'
            },
        }),
        [`${prefix}_edit`]: tool({
            description: `Replace an exact string in a ${label} file instead of rewriting it with ${prefix}_write; oldString must match once unless replaceAll.`,
            inputSchema: z.object({
                ...scope,
                path: z.string().describe(pathNote),
                oldString: z.string(),
                newString: z.string(),
                replaceAll: z.boolean().default(false),
            }),
            execute: async input => {
                const { path, oldString, newString, replaceAll } = input
                const rootDir = await rootOf(input)
                if (!existsSync(resolveWithin(rootDir, path))) return `File not found: ${path}`
                if (oldString === newString) return 'oldString and newString are identical; nothing to do.'
                const content = await store.readText(rootDir, path)
                const occurrences = content.split(oldString).length - 1
                if (occurrences === 0) return `oldString not found in ${path}`
                if (occurrences > 1 && !replaceAll) return `oldString matches ${occurrences} times in ${path}; pass replaceAll or provide a more specific string.`
                const next = replaceAll ? content.split(oldString).join(newString) : content.replace(oldString, newString)
                await store.writeText(rootDir, path, next)
                return `Edited ${path} (${occurrences} replacement${occurrences === 1 ? '' : 's'})`
            },
        }),
        [`${prefix}_search`]: tool({
            description: `Regex search of ${label} file contents; returns path:line: content.`,
            inputSchema: z.object({
                ...scope,
                pattern: z.string().describe('JavaScript regular expression to match against each line'),
                path: z.string().default('.').describe(extraRoots.length ? `Directory to search, relative to the workspace or absolute under ${extra}` : 'Directory to search, relative to the root'),
                maxResults: z.number().int().positive().max(1000).default(200),
            }),
            execute: async input => {
                const { pattern, path, maxResults } = input
                try {
                    new RegExp(pattern)
                } catch (e) {
                    return `Invalid regular expression: ${(e as Error).message}`
                }
                const rootDir = await rootOf(input)
                if (!existsSync(resolveWithin(rootDir, path))) return `Path not found: ${path}`
                const found = await store.searchText(rootDir, path, pattern, maxResults)
                const hits = extraRootOf(path) ? found.map(hit => `${rootDir}${sep}${hit}`) : found
                if (hits.length === 0) return 'No matches.'
                const truncated = hits.length >= maxResults ? `\n(truncated at ${maxResults} results)` : ''
                return hits.join('\n') + truncated
            },
        }),
    }
}
