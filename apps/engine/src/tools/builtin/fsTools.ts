import { existsSync } from 'node:fs'
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { resolveWithin } from '../sandbox.js'
import * as store from '../../files/store.js'

type FsToolsOptions = {
    prefix: string
    label: string
    rootDir: string | ((input: Record<string, unknown>) => Promise<string>)
    // Extra input fields that pick the root, read by a rootDir function.
    scope?: z.ZodRawShape
    // Called once a file landed through `<prefix>_write`.
    onWrite?: (path: string) => Promise<void>
}

export function makeFsTools({ prefix, label, rootDir, scope = {}, onWrite }: FsToolsOptions): ToolSet {
    const rootOf = async (input: Record<string, unknown>) => (typeof rootDir === 'string' ? rootDir : rootDir(input))
    return {
        [`${prefix}_read`]: tool({
            description: `Read a UTF-8 file from the ${label}.`,
            inputSchema: z.object({ ...scope, path: z.string().describe('Path relative to the root') }),
            execute: async input => {
                const content = await store.readText(await rootOf(input), input.path)
                return content.slice(0, 100_000)
            },
        }),
        [`${prefix}_write`]: tool({
            description: `Write a UTF-8 file in the ${label}, creating parent directories as needed.`,
            inputSchema: z.object({ ...scope, path: z.string(), content: z.string() }),
            execute: async input => {
                const { path, content } = input
                await store.writeText(await rootOf(input), path, content)
                await onWrite?.(path)
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
            description: `Make a surgical edit to a ${label} file by replacing an exact string. Prefer this over ${prefix}_write for changing part of an existing file. By default oldString must match exactly once.`,
            inputSchema: z.object({
                ...scope,
                path: z.string().describe('Path relative to the root'),
                oldString: z.string().describe('The exact text to replace'),
                newString: z.string().describe('The text to insert in its place'),
                replaceAll: z.boolean().default(false).describe('Replace every occurrence instead of requiring a unique match'),
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
            description: `Search ${label} file contents with a regular expression. Returns matching lines as path:line: content. Skips node_modules and .git.`,
            inputSchema: z.object({
                ...scope,
                pattern: z.string().describe('JavaScript regular expression to match against each line'),
                path: z.string().default('.').describe('Directory to search, relative to the root'),
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
                const hits = await store.searchText(rootDir, path, pattern, maxResults)
                if (hits.length === 0) return 'No matches.'
                const truncated = hits.length >= maxResults ? `\n(truncated at ${maxResults} results)` : ''
                return hits.join('\n') + truncated
            },
        }),
    }
}
