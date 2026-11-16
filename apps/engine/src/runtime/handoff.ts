import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { visibleText } from '@rerun/contracts'
import { extractText, listMessages } from '../db/repos/messages.js'
import { resolveInWorkspace } from '../tools/sandbox.js'

const RESULT_LIMIT = 2_000
const RESULT_COUNT = 3
const PATH_TOOLS = /^(fs|shared|agent_files)_(read|write|list|edit|search)$/

type Part = { type?: unknown; toolCallId?: unknown; toolName?: unknown; input?: unknown; output?: unknown }

function parts(contentJson: string): Part[] {
    const content: unknown = JSON.parse(contentJson)
    return Array.isArray(content) ? content.filter((p): p is Part => !!p && typeof p === 'object') : []
}

function shellPaths(command: string): string[] {
    return command
        .split(/\s+/)
        .map(token => token.replace(/^["'`(]+|["'`);,]+$/g, ''))
        .filter(token => token && !token.startsWith('-') && !token.includes('://') && (token.includes('/') || /^[\w.-]+\.[A-Za-z0-9]{1,5}$/.test(token)))
}

function pathsOf(part: Part): string[] {
    const input = part.input as { path?: unknown; command?: unknown } | undefined
    if (typeof part.toolName !== 'string' || !input) return []
    if (PATH_TOOLS.test(part.toolName) && typeof input.path === 'string') return [input.path]
    if (part.toolName === 'shell_exec' && typeof input.command === 'string') return shellPaths(input.command)
    return []
}

function resultText(part: Part): string {
    const output = part.output as { type?: unknown; value?: unknown } | undefined
    if (!output) return ''
    return typeof output.value === 'string' ? output.value : JSON.stringify(output.value ?? '')
}

function resultBlock(part: Part): string {
    const text = resultText(part)
    const saved = /^Saved whole: .*$/m.exec(text)?.[0]
    return `### ${String(part.toolName)}\n${saved ?? text.slice(0, RESULT_LIMIT)}`
}

export async function buildHandoff(agentId: string, sessionId: string): Promise<string> {
    const rows = await listMessages(agentId, sessionId)
    const job = rows.filter(r => r.role === 'user').map(r => extractText(JSON.parse(r.contentJson))).find(Boolean) ?? ''
    const paths = new Set<string>()
    const results: Part[] = []
    for (const row of rows) {
        for (const part of parts(row.contentJson)) {
            if (part.type === 'tool-call') pathsOf(part).forEach(p => paths.add(p))
            if (part.type === 'tool-result') results.push(part)
        }
    }
    const next = rows.filter(r => r.role === 'assistant').map(r => visibleText(JSON.parse(r.contentJson), '\n')).filter(Boolean).at(-1) ?? ''
    return [
        '# Handoff',
        '## Job',
        job,
        '## Files touched',
        [...paths].map(p => `- ${p}`).join('\n') || '(none)',
        '## Last results',
        results.slice(-RESULT_COUNT).map(resultBlock).join('\n\n') || '(none)',
        '## Next step',
        next,
    ].join('\n\n')
}

export async function saveHandoff(agentId: string, sessionId: string): Promise<string> {
    const relative = `.rerun/handoff/${sessionId}.md`
    const file = await resolveInWorkspace(agentId, relative)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, await buildHandoff(agentId, sessionId), 'utf8')
    return relative
}
