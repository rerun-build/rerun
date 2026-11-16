import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ToolSet } from 'ai'
import { RESULT_HANDLE_CHARS } from '../runtime/compaction/config.js'
import { resolveInWorkspace } from './sandbox.js'

const RESULTS_DIR = '.rerun/results'
const HEAD_CHARS = 8_000
const TAIL_CHARS = 4_000

export interface ResultHandleOptions {
    agentId: string
    runId: string
    limit?: number
}

function safeSegment(value: string): string {
    return value.replace(/[^A-Za-z0-9._-]/g, '_') || '_'
}

function takeHead(lines: string[], budget: number): number {
    let used = 0
    let count = 0
    for (const line of lines) {
        const next = used + line.length + (count > 0 ? 1 : 0)
        if (next > budget) break
        used = next
        count += 1
    }
    return count
}

function takeTail(lines: string[], budget: number, floor: number): number {
    let used = 0
    let count = 0
    for (let i = lines.length - 1; i >= floor; i--) {
        const next = used + lines[i].length + (count > 0 ? 1 : 0)
        if (next > budget) break
        used = next
        count += 1
    }
    return count
}

async function handleResult(text: string, toolCallId: string, options: ResultHandleOptions): Promise<string> {
    const lines = text.split('\n')
    const headCount = takeHead(lines, HEAD_CHARS)
    const tailCount = takeTail(lines, TAIL_CHARS, headCount)
    if (headCount + tailCount >= lines.length) return text
    const relative = `${RESULTS_DIR}/${safeSegment(options.runId)}/${safeSegment(toolCallId)}.txt`
    try {
        const file = await resolveInWorkspace(options.agentId, relative)
        await mkdir(dirname(file), { recursive: true })
        await writeFile(join(file), text)
    } catch {
        return text
    }
    const parts = [
        ...lines.slice(0, headCount),
        `[... lines ${headCount + 1}-${lines.length - tailCount} kept whole ...]`,
        ...lines.slice(lines.length - tailCount),
        `Saved whole: ${relative}, lines 1-${lines.length}`,
    ]
    return parts.join('\n')
}

export function wrapToolsWithResultHandle<T extends ToolSet>(tools: T, options: ResultHandleOptions): T {
    const limit = options.limit ?? RESULT_HANDLE_CHARS
    if (limit <= 0) return tools
    const wrapped: Record<string, unknown> = {}
    for (const [name, tool] of Object.entries(tools)) {
        const execute = (tool as { execute?: (input: unknown, callOptions: { toolCallId?: string }) => unknown }).execute
        if (typeof execute !== 'function') {
            wrapped[name] = tool
            continue
        }
        wrapped[name] = {
            ...tool,
            execute: async (input: unknown, callOptions: { toolCallId?: string }) => {
                const result = await execute.call(tool, input, callOptions)
                if (typeof result !== 'string' || result.length <= limit) return result
                return handleResult(result, callOptions?.toolCallId ?? 'call', options)
            },
        }
    }
    return wrapped as T
}
