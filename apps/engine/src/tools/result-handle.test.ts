import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-result-handle-'))

const { afterAll, describe, expect, it } = await import('vitest')
const { workspaceDir } = await import('../config/paths.js')
const { wrapToolsWithResultHandle } = await import('./result-handle.js')

afterAll(() => rmSync(process.env.RERUN_DATA_DIR!, { recursive: true, force: true }))

const LIMIT = 20_000

function lineText(count: number, width: number): string {
    return Array.from({ length: count }, (_, i) => `line ${i + 1} ${'x'.repeat(width)}`).join('\n')
}

async function run(output: unknown, limit = LIMIT, toolCallId = 'call-1') {
    const tools = wrapToolsWithResultHandle({ probe: { description: 'probe', execute: async () => output } } as never, { agentId: 'agent-a', runId: 'run-1', limit }) as Record<string, { execute: (input: unknown, options: unknown) => Promise<unknown> }>
    return tools.probe.execute({}, { toolCallId, messages: [] })
}

describe('wrapToolsWithResultHandle', () => {
    it('keeps a 100_000-character result whole on disk and returns head, tail and the handle', async () => {
        const original = lineText(1000, 90)
        expect(original.length).toBeGreaterThan(90_000)
        const out = (await run(original)) as string
        const file = resolve(workspaceDir('agent-a'), '.rerun/results/run-1/call-1.txt')
        expect(readFileSync(file, 'utf8')).toBe(original)
        const lines = original.split('\n')
        const outLines = out.split('\n')
        const marker = outLines.findIndex(l => /^\[\.\.\. lines \d+-\d+ kept whole \.\.\.\]$/.test(l))
        expect(marker).toBeGreaterThan(0)
        const head = outLines.slice(0, marker)
        expect(head).toEqual(lines.slice(0, head.length))
        expect(head.join('\n').length).toBeLessThanOrEqual(8_000)
        const handle = outLines.length - 1
        expect(outLines[handle]).toBe('Saved whole: .rerun/results/run-1/call-1.txt, lines 1-1000')
        const tail = outLines.slice(marker + 1, handle)
        expect(tail).toEqual(lines.slice(lines.length - tail.length))
        expect(tail.join('\n').length).toBeLessThanOrEqual(4_000)
        const [, a, b] = /lines (\d+)-(\d+) kept whole/.exec(outLines[marker])!
        expect(Number(a)).toBe(head.length + 1)
        expect(Number(b)).toBe(lines.length - tail.length)
        expect(out.length).toBeLessThan(13_000)
    })

    it('passes a result at the size unchanged', async () => {
        const text = 'a'.repeat(LIMIT)
        expect(await run(text, LIMIT, 'call-2')).toBe(text)
        expect(existsSync(resolve(workspaceDir('agent-a'), '.rerun/results/run-1/call-2.txt'))).toBe(false)
    })

    it('passes non-text results unchanged', async () => {
        const value = { rows: Array.from({ length: 5000 }, (_, i) => `row ${i}`) }
        expect(await run(value, LIMIT, 'call-3')).toBe(value)
    })

    it('is off at 0', async () => {
        const text = lineText(1000, 90)
        expect(await run(text, 0, 'call-4')).toBe(text)
        expect(existsSync(resolve(workspaceDir('agent-a'), '.rerun/results/run-1/call-4.txt'))).toBe(false)
    })

    it('never changes a line of a diff in head or tail', async () => {
        const diff = Array.from({ length: 800 }, (_, i) => (i % 3 === 0 ? `+  added ${i}\t trailing  ` : i % 3 === 1 ? `-removed ${i} ${'y'.repeat(60)}` : `@@ -${i},3 +${i},4 @@  `)).join('\n')
        const out = (await run(diff, LIMIT, 'call-5')) as string
        const lines = new Set(diff.split('\n'))
        const outLines = out.split('\n')
        const kept = outLines.filter(l => !l.startsWith('[... lines') && !l.startsWith('Saved whole:'))
        expect(kept.length).toBeGreaterThan(0)
        for (const l of kept) expect(lines.has(l)).toBe(true)
    })
})
