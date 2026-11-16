import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-cli-redact-'))
process.env.RERUN_API_KEY = ''

const state = vi.hoisted(() => ({ calls: [] as string[][] }))

vi.mock('../../datadir/ladder.js', () => ({ prepareDataDir: async () => undefined }))
vi.mock('../../agents/loader.js', () => ({ agentExists: (id: string) => id === 'a1' }))
vi.mock('../../db/repos/redact.js', () => ({
    redactValue: async (id: string, value: string) => {
        state.calls.push([id, value])
        return { messages: 2, searchRows: 1, toolCalls: 1, runs: 0, checkpoints: 0 }
    },
}))

const { afterEach, beforeEach, describe, expect, it } = await import('vitest')
const { readFile, stat } = await import('node:fs/promises')
const { dataDir } = await import('../../config/paths.js')
const { redactCommand } = await import('./redact.js')

const VALUE = 'sk-live-0123456789'
let out = ''

beforeEach(() => {
    out = ''
    vi.spyOn(process.stdout, 'write').mockImplementation(((s: string) => {
        out += s
        return true
    }) as never)
})
afterEach(() => vi.restoreAllMocks())

describe('redact command', () => {
    it('redacts the value read from stdin and writes one audit line without the value', async () => {
        await redactCommand(['a1'], async () => VALUE)
        expect(state.calls).toEqual([['a1', VALUE]])
        expect(out).toBe('Redacted from a1: messages 2, search rows 1, tool calls 1, runs 0, checkpoints 0\n')
        const log = resolve(dataDir(), 'redactions.log')
        const text = await readFile(log, 'utf8')
        expect(text).toMatch(/^\S+Z agent=a1 sha256=74978375b3a4 messages=2 searchRows=1 toolCalls=1 runs=0 checkpoints=0\n$/)
        expect(text).not.toContain(VALUE)
        expect((await stat(log)).mode & 0o777).toBe(0o600)
    })

    it('refuses an unknown coworker and touches nothing', async () => {
        await expect(redactCommand(['nope'], async () => VALUE)).rejects.toThrow('Usage: rerun redact <agentId>')
        expect(state.calls).toHaveLength(1)
    })
})
