import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const launcher = resolve(here, '../..', 'docker-entrypoint.sh')
const KEY = 'file-key-0123456789'
const linux = process.platform === 'linux'

let dir: string

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rerun-keyfile-'))
})

afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
})

function launch(env: Record<string, string>) {
    const result = spawnSync('sh', [launcher, 'sh', '-c', 'cat <&3; echo; env'], {
        env: { PATH: process.env.PATH ?? '', ...env },
        encoding: 'utf8',
    })
    const [firstLine = '', ...rest] = result.stdout.split('\n')
    return { status: result.status, stderr: result.stderr, key: firstLine, environment: rest.join('\n') }
}

describe.skipIf(!linux)('image launcher with a key file', () => {
    it.each([
        ['with a trailing newline', `${KEY}\n`],
        ['without a trailing newline', KEY],
    ])('hands the key from the file to descriptor 3, %s', (_label, content) => {
        const file = join(dir, 'key')
        writeFileSync(file, content)
        const out = launch({ RERUN_API_KEY_FILE: file })
        expect(out.status).toBe(0)
        expect(out.key).toBe(KEY)
        expect(out.environment).toContain('RERUN_KEY_FD=3')
        expect(out.environment).not.toMatch(/^RERUN_API_KEY/m)
        expect(out.environment).not.toContain(KEY)
    })

    it('prefers the file over the variable and drops both from the environment', () => {
        const file = join(dir, 'key')
        writeFileSync(file, KEY)
        const out = launch({ RERUN_API_KEY_FILE: file, RERUN_API_KEY: 'variable-key-0123456789' })
        expect(out.key).toBe(KEY)
        expect(out.environment).not.toMatch(/^RERUN_API_KEY/m)
        expect(out.environment).not.toContain('variable-key')
    })

    it('still takes the key from the variable when no file is named', () => {
        const out = launch({ RERUN_API_KEY: 'variable-key-0123456789' })
        expect(out.status).toBe(0)
        expect(out.key).toBe('variable-key-0123456789')
        expect(out.environment).not.toMatch(/^RERUN_API_KEY/m)
    })

    it('refuses to start when the named file is missing', () => {
        const out = launch({ RERUN_API_KEY_FILE: join(dir, 'absent') })
        expect(out.status).toBe(1)
        expect(out.stderr).toContain('RERUN_API_KEY_FILE')
        expect(out.key).toBe('')
        expect(out.environment).toBe('')
    })

    it('refuses to start when the named file is empty', () => {
        const file = join(dir, 'key')
        writeFileSync(file, '')
        const out = launch({ RERUN_API_KEY_FILE: file, RERUN_API_KEY: 'variable-key-0123456789' })
        expect(out.status).toBe(1)
        expect(out.stderr).toContain('RERUN_API_KEY_FILE')
        expect(out.environment).toBe('')
    })
})
