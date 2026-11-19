import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { newId } from '../../lib/ids.js'
import { resolveInWorkspace } from '../sandbox.js'
import { fileSafe, pruneSavedFiles, READ_BUDGET } from './saved-files.js'

// A tool result lands in the conversation and is sent again on every later step of the run, so no
// tool, whatever answers it (a native tool, the hub, an MCP server), hands the model more than this.
// What lies beyond is kept whole in the coworker's workspace, out of any capture or share of it, and
// read back a page at a time.
export const TOOL_RESULT_CHAR_LIMIT = 40_000
export const TOOL_RESULTS_DIR = '.rerun/tool-results'
export const TOOL_RESULT_READ_TOOL = 'tool_result_read'

// paid_data keeps its own answers whole and shows their outline, under this limit already.
const SELF_CAPPED_TOOLS = new Set(['paid_data', TOOL_RESULT_READ_TOOL])

export const toolResultText = (result: unknown): string => (typeof result === 'string' ? result : (JSON.stringify(result) ?? ''))

// Best effort: a full disk or an unwritable workspace leaves the result cut, only unsaved.
async function saveToolResult(agentId: string, toolName: string, text: string): Promise<string | null> {
    try {
        const dir = await resolveInWorkspace(agentId, TOOL_RESULTS_DIR)
        await mkdir(dir, { recursive: true })
        const name = `${fileSafe(toolName)}-${new Date().toISOString().slice(0, 10)}-${newId()}.txt`
        await writeFile(join(dir, name), text)
        await pruneSavedFiles(dir, name, '.txt')
        return `${TOOL_RESULTS_DIR}/${name}`
    } catch {
        return null
    }
}

export async function capToolResult(agentId: string, toolName: string, text: string): Promise<string> {
    if (text.length <= TOOL_RESULT_CHAR_LIMIT) return text
    const head = text.slice(0, TOOL_RESULT_CHAR_LIMIT)
    const saved = await saveToolResult(agentId, toolName, text)
    const note = saved
        ? `[Cut at ${TOOL_RESULT_CHAR_LIMIT} of ${text.length} characters. The whole result of ${toolName} is saved at ${saved}: read on with ${TOOL_RESULT_READ_TOOL} from offset ${TOOL_RESULT_CHAR_LIMIT}, or grep / jq it through shell_exec. Do not call ${toolName} again for it.]`
        : `[Cut at ${TOOL_RESULT_CHAR_LIMIT} of ${text.length} characters, and the rest could not be saved: ask ${toolName} for less (fewer items, a narrower query) rather than retrying as is.]`
    return `${head}\n…\n${note}`
}

// Every tool of the set, wrapped: a result under the limit comes back untouched, objects included,
// a bigger one as its first characters and where the rest is.
export function capToolSet(tools: ToolSet, agentId: string): ToolSet {
    const capped: ToolSet = {}
    for (const [name, t] of Object.entries(tools)) {
        const execute = t.execute
        if (!execute || SELF_CAPPED_TOOLS.has(name)) {
            capped[name] = t
            continue
        }
        capped[name] = {
            ...t,
            execute: async (input: unknown, options: Parameters<typeof execute>[1]) => {
                const result: unknown = await execute(input as never, options)
                const text = toolResultText(result)
                return text.length <= TOOL_RESULT_CHAR_LIMIT ? result : capToolResult(agentId, name, text)
            },
        } as typeof t
    }
    return capped
}

export type ToolResultRead = { saved: string; total: number; offset: number; text: string; next?: number }

export async function readToolResult(agentId: string, saved: string, offset = 0, limit = READ_BUDGET): Promise<ToolResultRead> {
    const name = saved.slice(TOOL_RESULTS_DIR.length + 1)
    if (!saved.startsWith(`${TOOL_RESULTS_DIR}/`) || name !== basename(name) || name.startsWith('.')) throw new Error(`Not a saved tool result: ${saved}. Pass the path a cut result gave.`)
    let text: string
    try {
        text = await readFile(await resolveInWorkspace(agentId, saved), 'utf8')
    } catch {
        throw new Error(`No saved tool result at ${saved}: it may be older than 30 days.`)
    }
    const end = Math.min(text.length, offset + Math.min(limit, READ_BUDGET))
    return { saved, total: text.length, offset, text: text.slice(offset, end), ...(end < text.length ? { next: end } : {}) }
}

// The page goes out as text: inside an object its quotes and line breaks would be escaped again, past
// the limit. The note comes last, where compaction looks for the path, after anything the page quotes.
function pageText({ saved, total, offset, text, next }: ToolResultRead): string {
    const following = next === undefined ? 'this is the end' : `read on with ${TOOL_RESULT_READ_TOOL} from offset ${next}`
    return `${text}\n[Characters ${offset} to ${offset + text.length} of ${total} of the result saved at ${saved}: ${following}.]`
}

export function toolResultReadTool(agentId: string): ToolSet {
    return {
        [TOOL_RESULT_READ_TOOL]: tool({
            description: `Read more of a tool result cut at ${TOOL_RESULT_CHAR_LIMIT} characters, from an offset.`,
            inputSchema: z.object({
                saved: z.string().min(1).describe('Path the cut result gave.'),
                offset: z.number().int().min(0).optional(),
                limit: z.number().int().min(1).optional().describe(`At most ${READ_BUDGET}.`),
            }),
            execute: async ({ saved, offset, limit }) => pageText(await readToolResult(agentId, saved, offset, limit)),
        }),
    }
}
