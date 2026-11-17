import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OutputBuffer } from '../src/worker/output-buffer'
import { parseEnvBlock, resolveLoginEnv, withoutAppVariables } from '../src/worker/login-env'
import { runCommand, shellFor } from '../src/worker/shell'

const posix = process.platform !== 'win32'
const sh = shellFor(process.platform, { SHELL: '/bin/sh' })
const dir = mkdtempSync(join(tmpdir(), 'rerun-shell-'))

function alive(pid: number): boolean {
    try {
        process.kill(pid, 0)
        return true
    } catch {
        return false
    }
}

describe('OutputBuffer', () => {
    it('keeps everything a short output says', () => {
        const buffer = new OutputBuffer(10, 10)
        buffer.push(new TextEncoder().encode('hello'))
        expect([buffer.text(), buffer.truncated]).toEqual(['hello', false])
    })

    it('keeps the start and the end of a long output, and says how much it left out', () => {
        const buffer = new OutputBuffer(5, 5)
        for (let i = 0; i < 1000; i++) buffer.push(new TextEncoder().encode('abcdefghij'))
        const text = buffer.text()
        expect(text.startsWith('abcde\n[… ')).toBe(true)
        expect(text.endsWith('…]\nfghij')).toBe(true)
        expect(buffer.truncated).toBe(true)
    })

    it('decodes a character split across two chunks', () => {
        const buffer = new OutputBuffer()
        const bytes = new TextEncoder().encode('été')
        buffer.push(bytes.slice(0, 1))
        buffer.push(bytes.slice(1))
        expect(buffer.text()).toBe('été')
    })

    it('stays flat on a huge output', () => {
        const buffer = new OutputBuffer(1000, 1000)
        const chunk = new TextEncoder().encode('x'.repeat(64 * 1024))
        for (let i = 0; i < 1024; i++) buffer.push(chunk)
        expect(buffer.text().length).toBeLessThan(2100)
    })
})

describe('the login environment', () => {
    it('reads the environment after the marker, past what the shell printed before', () => {
        expect(parseEnvBlock('Welcome!\n__RERUN_LOGIN_ENV__PATH=/opt/homebrew/bin:/usr/bin\0HOME=/Users/c\0')).toEqual({ PATH: '/opt/homebrew/bin:/usr/bin', HOME: '/Users/c' })
        expect(parseEnvBlock('no marker')).toBeNull()
        expect(parseEnvBlock('__RERUN_LOGIN_ENV__')).toBeNull()
    })

    it('never hands a command the variables of the app', () => {
        expect(withoutAppVariables({ PATH: '/bin', ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--inspect', RERUN_DESKTOP_USER_DATA: '/x', HOME: '/h' })).toEqual({ PATH: '/bin', HOME: '/h' })
    })

    it.runIf(posix)('asks the login shell, and falls back to the usual folders when it hangs', async () => {
        const banner = join(dir, 'banner-shell')
        writeFileSync(banner, '#!/bin/sh\necho "Last login: today"\nexec /bin/sh -c "$2"\n')
        chmodSync(banner, 0o755)
        const env = await resolveLoginEnv('linux', { SHELL: banner, PATH: '/usr/bin:/bin', FOO: 'bar', ELECTRON_RUN_AS_NODE: '1' })
        expect(env.FOO).toBe('bar')
        expect(env.SHELL).toBe(banner)
        expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined()

        const hanging = join(dir, 'hanging-shell')
        writeFileSync(hanging, '#!/bin/sh\nsleep 30\n')
        chmodSync(hanging, 0o755)
        const fallback = await resolveLoginEnv('darwin', { SHELL: hanging, PATH: '/usr/bin' }, 300)
        expect(fallback.PATH?.split(':')).toEqual(expect.arrayContaining(['/usr/bin', '/opt/homebrew/bin', '/usr/local/bin']))
    })

    it('keeps the app environment as is on Windows, less its own variables', async () => {
        expect(await resolveLoginEnv('win32', { Path: 'C:\\Windows', ELECTRON_RUN_AS_NODE: '1' })).toEqual({ Path: 'C:\\Windows' })
    })
})

describe('shellFor', () => {
    it('runs PowerShell on Windows with its output in UTF-8, the person\'s shell elsewhere', () => {
        const win = shellFor('win32', {})
        expect(win.program).toBe('powershell.exe')
        expect(win.args('Get-ChildItem').at(-1)).toMatch(/UTF8.*Get-ChildItem$/)
        expect(shellFor('darwin', { SHELL: '/opt/homebrew/bin/fish' }).name).toBe('fish')
        expect(shellFor('darwin', {}).program).toBe('/bin/zsh')
        expect(shellFor('linux', { SHELL: 'zsh; rm -rf /' }).program).toBe('/bin/sh')
    })
})

describe.runIf(posix)('runCommand', () => {
    it('runs a command in its folder and hands back what it printed, accents included', async () => {
        const result = await runCommand({ command: 'printf "Vidéos été 2026\\n"; pwd; echo oops >&2; exit 3', cwd: dir, env: process.env, shell: sh, timeoutMs: 5_000 })
        expect(result.stdout).toContain('Vidéos été 2026')
        expect(result.stdout).toContain(dir.split('/').pop())
        expect(result).toMatchObject({ stderr: 'oops\n', exitCode: 3, timedOut: false, truncated: false })
    })

    it('kills the whole tree of a command past its time limit, grandchildren included', async () => {
        const pids = join(dir, 'pids')
        const script = `sh -c 'sh -c "sleep 60 & echo \\$! >> ${pids}; wait" & echo \\$! >> ${pids}; wait' & echo $! >> ${pids}; wait`
        const result = await runCommand({ command: script, cwd: dir, env: process.env, shell: sh, timeoutMs: 500 })
        expect(result.timedOut).toBe(true)
        const { readFileSync } = await import('node:fs')
        const started = readFileSync(pids, 'utf8').trim().split('\n').map(Number)
        expect(started).toHaveLength(3)
        await new Promise(done => setTimeout(done, 500))
        expect(started.filter(alive)).toEqual([])
    })

    it('stops on an abort', async () => {
        const abort = new AbortController()
        const running = runCommand({ command: 'sleep 30', cwd: dir, env: process.env, shell: sh, timeoutMs: 60_000, signal: abort.signal })
        setTimeout(() => abort.abort(), 100)
        const result = await running
        expect(result.timedOut).toBe(false)
        expect(result.durationMs).toBeLessThan(5_000)
    })

    it('keeps memory flat on a command that prints a lot', async () => {
        const result = await runCommand({ command: 'head -c 50000000 /dev/zero | tr "\\0" "x"', cwd: dir, env: process.env, shell: sh, timeoutMs: 30_000 })
        expect(result.truncated).toBe(true)
        expect(result.stdout.length).toBeLessThan(110_000)
    })

    it('fails when the shell itself cannot start', async () => {
        await expect(runCommand({ command: 'true', cwd: dir, env: process.env, shell: { program: '/nonexistent/shell', args: c => ['-c', c], name: 'x' }, timeoutMs: 1_000 })).rejects.toThrow()
    })
})
