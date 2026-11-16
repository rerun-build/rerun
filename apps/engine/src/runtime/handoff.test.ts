import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-handoff-'))
process.env.RERUN_API_KEY = ''

const { describe, expect, it } = await import('vitest')
const { appendMessage } = await import('../db/repos/messages.js')
const { buildHandoff, saveHandoff } = await import('./handoff.js')

const call = (toolCallId: string, toolName: string, input: unknown) => ({ type: 'tool-call' as const, toolCallId, toolName, input })
const result = (toolCallId: string, toolName: string, value: string) => ({ role: 'tool' as const, content: [{ type: 'tool-result' as const, toolCallId, toolName, output: { type: 'text' as const, value } }] })

async function seed(agent: string, session: string, finalText: string): Promise<void> {
    await appendMessage(agent, session, { role: 'user', content: 'Fix the parser bug in the importer' })
    await appendMessage(agent, session, { role: 'assistant', content: [call('c1', 'fs_read', { path: 'src/parser.ts' })] })
    await appendMessage(agent, session, result('c1', 'fs_read', 'R1 first result'))
    await appendMessage(agent, session, { role: 'assistant', content: [call('c2', 'shell_exec', { command: 'grep -n token lib/lexer.ts' })] })
    await appendMessage(agent, session, result('c2', 'shell_exec', 'R2 second result'))
    await appendMessage(agent, session, { role: 'assistant', content: [call('c3', 'fs_write', { path: 'notes/plan.md', content: 'x' })] })
    await appendMessage(agent, session, result('c3', 'fs_write', 'R3 third result'))
    await appendMessage(agent, session, { role: 'assistant', content: [call('c4', 'web_fetch', { url: 'https://example.test/a' })] })
    await appendMessage(agent, session, result('c4', 'web_fetch', '[200] https://example.test/a\nSaved whole: .rerun/pages/example.test/a.served.html (read it)\n\nbody'))
    await appendMessage(agent, session, { role: 'assistant', content: [call('c5', 'fs_read', { path: 'big.txt' })] })
    await appendMessage(agent, session, result('c5', 'fs_read', 'Z'.repeat(5000)))
    await appendMessage(agent, session, { role: 'assistant', content: [{ type: 'text', text: finalText }] })
}

describe('buildHandoff', () => {
    it('names the job, every file touched, the last results and the next step', async () => {
        await seed('ho', 's1', 'Next: run the importer tests.')
        const md = await buildHandoff('ho', 's1')
        expect(md).toContain('Fix the parser bug in the importer')
        for (const path of ['src/parser.ts', 'lib/lexer.ts', 'notes/plan.md', 'big.txt']) expect(md).toContain(path)
        expect(md).not.toContain('R1 first result')
        expect(md).not.toContain('R2 second result')
        expect(md).toContain('Saved whole: .rerun/pages/example.test/a.served.html')
        expect(md).toContain('Z'.repeat(2000))
        expect(md).not.toContain('Z'.repeat(2001))
        expect(md).toContain('Next: run the importer tests.')
    })

    it('copies the last assistant text verbatim', async () => {
        const text = '  Line one\n\n**bold** `code`\n- item  '
        await seed('ho', 's2', text)
        const md = await buildHandoff('ho', 's2')
        expect(md.endsWith(text) || md.includes(text)).toBe(true)
    })
})

describe('saveHandoff', () => {
    it('saves it under .rerun/handoff', async () => {
        await seed('ho', 's3', 'Done soon.')
        const path = await saveHandoff('ho', 's3')
        expect(path).toBe('.rerun/handoff/s3.md')
        const { resolveInWorkspace } = await import('../tools/sandbox.js')
        const file = await resolveInWorkspace('ho', path)
        expect(existsSync(file)).toBe(true)
        expect(readFileSync(file, 'utf8')).toBe(await buildHandoff('ho', 's3'))
    })
})
