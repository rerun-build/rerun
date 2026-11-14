import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ layout: 'monorepo' as 'monorepo' | 'release' | 'image', configured: '' as string | undefined }))

vi.mock('./layout.js', async importOriginal => ({
    ...(await importOriginal<typeof import('./layout.js')>()),
    detectLayout: () => ({ kind: state.layout, root: '/opt/rerun', packageDir: '/opt/rerun/current' }),
}))
vi.mock('../config/env.js', async importOriginal => ({
    ...(await importOriginal<typeof import('../config/env.js')>()),
    env: () => ({ RERUN_CODEX_PATH: state.configured }),
}))
vi.mock('node:child_process', () => ({
    execFileSync: (command: string, args: string[]) => (command === 'sh' && args[1] === 'command -v codex' ? '/usr/local/bin/codex\n' : ''),
}))

const { CODEX_VERSION, codexOffPin, codexPath, parseCodexVersion } = await import('./codex-cli.js')

const ENGINE_DIR = resolve(import.meta.dirname, '../..')
const BOX_INSTALLER = '../../cloud/infra/engine/install.sh'
const pinsIn = (file: string): string[] => [...readFileSync(resolve(ENGINE_DIR, file), 'utf8').matchAll(/@openai\/codex@([^"\s]+)/g)].map(match => match[1]!)

beforeEach(() => {
    state.layout = 'monorepo'
    state.configured = ''
})

describe('CODEX_VERSION', () => {
    it('is the exact version the image installs', () => {
        expect(pinsIn('Dockerfile')).toEqual([CODEX_VERSION])
    })

    it.skipIf(!existsSync(resolve(ENGINE_DIR, BOX_INSTALLER)))('is the exact version a new box installs', () => {
        expect(pinsIn(BOX_INSTALLER)).toEqual([CODEX_VERSION])
    })
})

describe('codexPath', () => {
    it("leaves a checkout on the provider's own copy: the global codex there is the developer's", () => {
        expect(codexPath()).toBeUndefined()
    })

    it('takes the configured path on any layout', () => {
        state.configured = '/srv/codex/bin/codex.js'
        expect(codexPath()).toBe('/srv/codex/bin/codex.js')
    })

    it('takes the global install update-cli-tools keeps at the pin on a release and an image', () => {
        state.layout = 'release'
        expect(codexPath()).toBe('/usr/local/bin/codex')
        state.layout = 'image'
        expect(codexPath()).toBe('/usr/local/bin/codex')
    })
})

describe('codexOffPin', () => {
    it('is only ever true of a version it could read', () => {
        expect(codexOffPin(null)).toBe(false)
        expect(codexOffPin(CODEX_VERSION)).toBe(false)
        expect(codexOffPin('0.159.3')).toBe(true)
    })
})

describe('parseCodexVersion', () => {
    it('reads the version from `codex --version` and from the app-server user agent', () => {
        expect(parseCodexVersion('codex-cli 0.166.0\n')).toBe('0.166.0')
        expect(parseCodexVersion('rerun-engine/0.159.3 (Ubuntu 24.4.0; x86_64) unknown (rerun-engine; 1)')).toBe('0.159.3')
        expect(parseCodexVersion('codex-cli 0.167.0-alpha.4')).toBe('0.167.0-alpha.4')
    })

    it('answers null for anything else', () => {
        expect(parseCodexVersion('')).toBeNull()
        expect(parseCodexVersion('command not found')).toBeNull()
    })
})
