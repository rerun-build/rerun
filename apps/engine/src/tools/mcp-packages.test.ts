import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-mcp-packages-'))
process.env.RERUN_LOG_LEVEL = 'fatal'
process.env.RERUN_API_KEY = 'engine-key'

// A fake npm: it lays the tree `npm install --prefix <dir> <spec>` would, or fails as told.
const npm = vi.hoisted(() => ({
    runs: [] as string[],
    envs: [] as Array<Record<string, string> | undefined>,
    missing: false,
    fail: null as string | null,
    bins: { 'mcp-tool': 'cli.js' } as string | Record<string, string>,
    gate: null as Promise<void> | null,
}))

vi.mock('node:child_process', async () => {
    const { EventEmitter } = await import('node:events')
    const { mkdirSync, writeFileSync } = await import('node:fs')
    const { resolve: join } = await import('node:path')
    return {
        spawn: (_cmd: string, args: string[], options: { env?: Record<string, string> }) => {
            const child = Object.assign(new EventEmitter(), { stderr: new EventEmitter(), kill: () => {} })
            const dir = args[args.indexOf('--prefix') + 1]!
            const spec = args.at(-1)!
            npm.runs.push(spec)
            npm.envs.push(options.env)
            void (async () => {
                await new Promise(r => setImmediate(r))
                if (npm.gate) await npm.gate
                if (npm.missing) return child.emit('error', new Error('spawn npm ENOENT'))
                if (npm.fail) {
                    child.stderr.emit('data', npm.fail)
                    return child.emit('close', 1)
                }
                const name = 'mcp-tool'
                mkdirSync(join(dir, 'node_modules', '.bin'), { recursive: true })
                mkdirSync(join(dir, 'node_modules', name), { recursive: true })
                writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { [name]: spec } }))
                writeFileSync(join(dir, 'node_modules', name, 'package.json'), JSON.stringify({ name, bin: npm.bins }))
                for (const bin of typeof npm.bins === 'string' ? [name] : Object.keys(npm.bins)) writeFileSync(join(dir, 'node_modules', '.bin', bin), '')
                child.emit('close', 0)
            })()
            return child
        },
    }
})

const { afterEach, beforeEach, describe, expect, it } = await import('vitest')
const { readdir, readFile, rm, writeFile } = await import('node:fs/promises')
const { mcpPackagesDir } = await import('../config/paths.js')
const { INSTALL_RETRY_MS, PACKAGE_REFRESH_MS, installInBackground, isPinnedSpec, parseNpxLaunch, withInstalledPackage } = await import('./mcp-packages.js')

const npx = (...args: string[]) => ({ name: 'tool', command: 'npx', args, env: { KEY: 'k' }, headers: {} })

async function currentOf(): Promise<{ bin: string; installedAt: number; installId: string }> {
    const [dir] = await readdir(mcpPackagesDir())
    return JSON.parse(await readFile(resolve(mcpPackagesDir(), dir!, 'current.json'), 'utf8'))
}

beforeEach(async () => {
    await rm(mcpPackagesDir(), { recursive: true, force: true })
    npm.runs.length = 0
    npm.envs.length = 0
    npm.fail = null
    npm.missing = false
    npm.bins = { 'mcp-tool': 'cli.js' }
    npm.gate = null
})

afterEach(() => {
    vi.useRealTimers()
})

describe('parseNpxLaunch', () => {
    it('reads the package and the arguments of the plain catalog form', () => {
        expect(parseNpxLaunch(npx('-y', 'mcp-discord', '--config', 'T'))).toEqual({ spec: 'mcp-discord', rest: ['--config', 'T'] })
        expect(parseNpxLaunch(npx('--yes', '-y', '@getxapi/mcp@latest'))).toEqual({ spec: '@getxapi/mcp@latest', rest: [] })
        expect(parseNpxLaunch({ ...npx('pkg'), command: '/usr/bin/npx' })).toEqual({ spec: 'pkg', rest: [] })
    })

    it('leaves alone what is not a plain npx launch', () => {
        expect(parseNpxLaunch(npx('-p', 'pkg', 'bin'))).toBeNull()
        expect(parseNpxLaunch(npx('-y'))).toBeNull()
        expect(parseNpxLaunch({ ...npx('pkg'), command: 'uvx' })).toBeNull()
        expect(parseNpxLaunch({ name: 'http', args: [], env: {}, headers: {}, url: 'https://x.io/mcp' })).toBeNull()
    })
})

describe('isPinnedSpec', () => {
    it.each([
        ['mcp-discord@1.4.1', true],
        ['@scope/pkg@2.0.0-beta.1', true],
        ['github:Rerun-build/mcp-discord#v1.4.1-rerun.1', true],
        ['@getxapi/mcp@latest', false],
        ['pkg@^1.2.0', false],
        ['@scope/pkg', false],
        ['pkg', false],
        ['github:owner/repo', false],
        ['github:owner/repo#', false],
    ])('%s pinned: %s', (spec, pinned) => {
        expect(isPinnedSpec(spec)).toBe(pinned)
    })
})

describe('withInstalledPackage', () => {
    it('keeps npx until the package is installed, then launches its bin with the same arguments', async () => {
        const server = npx('-y', 'mcp-tool@1.0.0', '--flag')
        expect(withInstalledPackage(server)).toBe(server)
        await installInBackground('mcp-tool@1.0.0')

        const launched = withInstalledPackage(server)
        expect(launched).toEqual({ ...server, command: (await currentOf()).bin, args: ['--flag'] })
        expect(launched.command).toMatch(/node_modules\/\.bin\/mcp-tool$/)
        expect(npm.runs).toEqual(['mcp-tool@1.0.0'])
    })

    it('runs npm, and the install scripts of the package with it, without the engine configuration', async () => {
        await installInBackground('mcp-tool@1.0.0')
        const [env] = npm.envs
        expect(env?.PATH).toBe(process.env.PATH)
        expect(env).not.toHaveProperty('RERUN_API_KEY')
        expect(env).not.toHaveProperty('RERUN_DATA_DIR')
    })

    it('installs a spec once however many runs ask for it at the same time', async () => {
        let release!: () => void
        npm.gate = new Promise(r => (release = r))
        withInstalledPackage(npx('-y', 'mcp-tool@1.0.0'))
        withInstalledPackage(npx('-y', 'mcp-tool@1.0.0'))
        const job = installInBackground('mcp-tool@1.0.0')
        release()
        await job
        expect(npm.runs).toEqual(['mcp-tool@1.0.0'])
    })

    it('refreshes an unpinned spec once a day, never a pinned one', async () => {
        for (const spec of ['mcp-tool@latest', 'mcp-tool@1.0.0']) await installInBackground(spec)
        const stale = Date.now() - PACKAGE_REFRESH_MS - 1
        for (const dir of await readdir(mcpPackagesDir())) {
            const path = resolve(mcpPackagesDir(), dir, 'current.json')
            await writeFile(path, JSON.stringify({ ...JSON.parse(await readFile(path, 'utf8')), installedAt: stale }))
        }
        npm.runs.length = 0
        withInstalledPackage(npx('-y', 'mcp-tool@latest'))
        withInstalledPackage(npx('-y', 'mcp-tool@1.0.0'))
        await installInBackground('mcp-tool@latest')
        expect(npm.runs).toEqual(['mcp-tool@latest'])
    })

    it('keeps the previous tree beside the new one, and only that one', async () => {
        await installInBackground('mcp-tool@latest')
        const first = (await currentOf()).installId
        await installInBackground('mcp-tool@latest')
        const second = (await currentOf()).installId
        await installInBackground('mcp-tool@latest')
        const [dir] = await readdir(mcpPackagesDir())
        expect((await readdir(resolve(mcpPackagesDir(), dir!))).sort()).toEqual([second, (await currentOf()).installId, 'current.json'].sort())
        expect(first).not.toBe(second)
    })

    it('keeps npx and leaves nothing behind when the install fails', async () => {
        npm.fail = 'ERR 404 not found'
        await installInBackground('mcp-tool@9.9.9')
        const [dir] = await readdir(mcpPackagesDir())
        expect(await readdir(resolve(mcpPackagesDir(), dir!))).toEqual([])
        const server = npx('-y', 'mcp-tool@9.9.9')
        expect(withInstalledPackage(server)).toBe(server)
    })

    // Every message prepares the server again: a spec that just failed must not cost a full npm
    // install each time, only once the retry spell is over.
    it('does not retry a failed install before the retry spell', async () => {
        npm.fail = 'ERR 404 not found'
        const server = npx('-y', 'mcp-tool@7.7.7')
        withInstalledPackage(server)
        await installInBackground('mcp-tool@7.7.7')
        expect(npm.runs).toEqual(['mcp-tool@7.7.7'])

        // npm is only spawned once the install folder exists: the runs list fills a tick later.
        const settle = () => new Promise(resolve => setTimeout(resolve, 50))
        npm.runs.length = 0
        withInstalledPackage(server)
        withInstalledPackage(server)
        await settle()
        expect(npm.runs).toEqual([])

        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(Date.now() + INSTALL_RETRY_MS)
        withInstalledPackage(server)
        await settle()
        expect(npm.runs).toEqual(['mcp-tool@7.7.7'])
    })

    it('keeps npx when npm itself cannot be started', async () => {
        npm.missing = true
        await installInBackground('mcp-tool@1.0.0')
        const server = npx('-y', 'mcp-tool@1.0.0')
        expect(withInstalledPackage(server)).toBe(server)
    })

    it('picks the bin named after the package among several, and refuses a package with none to launch', async () => {
        npm.bins = { other: 'o.js', 'mcp-tool': 'cli.js' }
        await installInBackground('mcp-tool@1.0.0')
        expect((await currentOf()).bin).toMatch(/\.bin\/mcp-tool$/)

        await rm(mcpPackagesDir(), { recursive: true, force: true })
        npm.bins = { a: 'a.js', b: 'b.js' }
        await installInBackground('mcp-tool@1.0.0')
        const server = npx('-y', 'mcp-tool@1.0.0')
        expect(withInstalledPackage(server)).toBe(server)
    })

    it('reads a single string bin under the package name', async () => {
        npm.bins = 'cli.js'
        await installInBackground('mcp-tool@1.0.0')
        expect((await currentOf()).bin).toMatch(/\.bin\/mcp-tool$/)
    })
})
