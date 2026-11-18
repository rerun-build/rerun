import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-handover-'))
process.env.RERUN_API_KEY = ''

const { describe, expect, it } = await import('vitest')
const { handoverPath, saveHandover, wantsHandover } = await import('./handover.js')
const { sharedDir } = await import('../config/paths.js')
const { sharedTools } = await import('../tools/builtin/shared.js')

describe('wantsHandover', () => {
    it.each([
        ['claude', 'medium', true],
        ['claude', 'large', true],
        ['claude', 'small', false],
        ['claude', 'off', false],
        ['claude', undefined, false],
        ['codex', 'large', false],
        ['openrouter', 'medium', false],
    ] as const)('%s at %s is %s', (provider, size, expected) => {
        expect(wantsHandover(provider, size)).toBe(expected)
    })
})

describe('saveHandover', () => {
    it('writes the summary under shared/handover/<agent>/<run>-<n>.md and returns the shared-space path', async () => {
        const path = await saveHandover('boss', 'run42', 2, 'HANDOVER Boss run42 2\nDone: x')
        expect(path).toBe('handover/boss/run42-2.md')
        expect(path).toBe(handoverPath('boss', 'run42', 2))
        expect(readFileSync(resolve(sharedDir(), path), 'utf8')).toBe('HANDOVER Boss run42 2\nDone: x')
    })

    it('returns a path the shared read tool opens', async () => {
        const path = await saveHandover('boss', 'run43', 1, 'the note')
        const read = sharedTools({} as never).shared_read!.execute!
        await expect(read({ path }, { toolCallId: 't', messages: [] })).resolves.toBe('the note')
    })

    it.skipIf(process.platform === 'win32')('keeps the agent folder private', async () => {
        await saveHandover('scope', 'run1', 1, 'x')
        expect(statSync(resolve(sharedDir(), 'handover', 'scope')).mode & 0o777).toBe(0o700)
    })

    it('rejects an agent id that is not a single path segment', async () => {
        await expect(saveHandover('../x', 'run1', 1, 'x')).rejects.toThrow()
    })
})
