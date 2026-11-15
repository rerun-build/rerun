import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { hasCommand } from './exec.js'

describe.skipIf(process.platform === 'win32')('hasCommand', () => {
    it('finds a command on the PATH', () => {
        expect(hasCommand('sh')).toBe(true)
    })

    it('answers false for a command that is not there', () => {
        expect(hasCommand('no-such-command-for-rerun')).toBe(false)
    })

    it('never runs what the name carries', () => {
        const marker = resolve(mkdtempSync(resolve(tmpdir(), 'rerun-has-command-')), 'ran')
        expect(hasCommand(`sh; touch ${marker}`)).toBe(false)
        expect(existsSync(marker)).toBe(false)
    })
})
