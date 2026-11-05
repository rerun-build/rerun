import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import type { McpServer } from '../agents/types.js'
import { mcpPackagesDir } from '../config/paths.js'
import { childProcessEnv } from '../lib/child-env.js'
import { logger } from '../lib/logger.js'

// `npx -y <spec>` checks the registry, or clones a `github:` spec, every time it starts, which is on
// every message for a CLI provider. The package is installed once instead, and the server launched
// straight from its bin. Until the first install lands the run keeps `npx`, never waiting on npm.

export const PACKAGE_REFRESH_MS = 24 * 60 * 60 * 1000
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000

type NpxLaunch = { spec: string; rest: string[] }
type Installed = { installId: string; spec: string; installedAt: number; bin: string }

const NPX_YES_FLAGS = new Set(['-y', '--yes'])

// Only the plain form the catalog uses: yes flags, the package, then the server's own arguments.
// Anything else (`-p`, `--package`, `--`, `-c`) keeps going through npx as declared.
export function parseNpxLaunch(server: McpServer): NpxLaunch | null {
    if (!server.command || basename(server.command) !== 'npx') return null
    let index = 0
    while (index < server.args.length && NPX_YES_FLAGS.has(server.args[index]!)) index++
    const spec = server.args[index]
    if (!spec || spec.startsWith('-')) return null
    return { spec, rest: server.args.slice(index + 1) }
}

// A spec that names an exact version or a git ref installs the same tree forever. Anything else
// (`@latest`, a range, a bare name) is refreshed once a day, as npx would have picked it up.
export function isPinnedSpec(spec: string): boolean {
    const hashAt = spec.indexOf('#')
    if (hashAt > 0) return hashAt < spec.length - 1
    const versionAt = spec.lastIndexOf('@')
    if (versionAt <= 0) return false
    return /^\d+\.\d+\.\d+(?:[-+][\w.+-]*)?$/.test(spec.slice(versionAt + 1))
}

const specDir = (spec: string) => resolve(mcpPackagesDir(), createHash('sha256').update(spec).digest('hex').slice(0, 24))
const currentPath = (spec: string) => resolve(specDir(spec), 'current.json')

function readInstalled(spec: string): Installed | null {
    try {
        const installed = JSON.parse(readFileSync(currentPath(spec), 'utf8')) as Installed
        return installed.spec === spec && existsSync(installed.bin) ? installed : null
    } catch {
        return null
    }
}

// npx runs the bin named after the package when it has several, the only one otherwise.
function binOf(installDir: string): string | null {
    const manifest = JSON.parse(readFileSync(resolve(installDir, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> }
    const name = Object.keys(manifest.dependencies ?? {})[0]
    if (!name) return null
    const pkg = JSON.parse(readFileSync(resolve(installDir, 'node_modules', name, 'package.json'), 'utf8')) as { bin?: string | Record<string, string> }
    const bins = typeof pkg.bin === 'string' ? { [name.split('/').pop()!]: pkg.bin } : (pkg.bin ?? {})
    const names = Object.keys(bins)
    const picked = names.length === 1 ? names[0] : names.find(bin => bin === name.split('/').pop())
    return picked ? resolve(installDir, 'node_modules', '.bin', picked) : null
}

// The package's install scripts run with the same environment as the server itself: native addons
// still build, the engine's configuration is out of reach.
function npmInstall(spec: string, installDir: string): Promise<void> {
    return new Promise((done, fail) => {
        const child = spawn('npm', ['install', '--prefix', installDir, '--no-audit', '--no-fund', '--loglevel=error', spec], { stdio: ['ignore', 'ignore', 'pipe'], env: childProcessEnv({}) })
        let stderr = ''
        child.stderr.on('data', chunk => (stderr = (stderr + String(chunk)).slice(-2000)))
        const timer = setTimeout(() => child.kill('SIGKILL'), INSTALL_TIMEOUT_MS)
        child.on('error', err => {
            clearTimeout(timer)
            fail(err)
        })
        child.on('close', code => {
            clearTimeout(timer)
            if (code === 0) done()
            else fail(new Error(stderr.trim() || `npm install exited with ${code}`))
        })
    })
}

// Each install lands in its own folder and `current.json` is swapped last, so a server still running
// from the previous tree keeps its files. Only that previous tree is kept beside the new one.
async function install(spec: string): Promise<void> {
    const root = specDir(spec)
    const previous = readInstalled(spec)?.installId
    const installId = `${Date.now()}-${randomBytes(3).toString('hex')}`
    const installDir = resolve(root, installId)
    await mkdir(installDir, { recursive: true })
    try {
        await npmInstall(spec, installDir)
        const bin = binOf(installDir)
        if (!bin || !existsSync(bin)) throw new Error('the package has no bin to launch')
        const tmp = `${currentPath(spec)}.tmp`
        await writeFile(tmp, JSON.stringify({ installId, spec, installedAt: Date.now(), bin } satisfies Installed), 'utf8')
        await rename(tmp, currentPath(spec))
    } catch (err) {
        await rm(installDir, { recursive: true, force: true })
        throw err
    }
    for (const entry of await readdir(root)) {
        if (entry !== installId && entry !== previous && entry !== 'current.json') await rm(resolve(root, entry), { recursive: true, force: true })
    }
}

// A spec that failed to install (no bin to launch, a native build the box cannot do, a registry
// outage) is not tried again on every message: each attempt is a full `npm install`, up to five
// minutes of network and CPU, and the server keeps running through npx in the meantime.
export const INSTALL_RETRY_MS = 60 * 60 * 1000

const installing = new Map<string, Promise<void>>()
const failedAt = new Map<string, number>()

export function installInBackground(spec: string): Promise<void> {
    const running = installing.get(spec)
    if (running) return running
    const started = Date.now()
    const job = install(spec)
        .then(() => {
            failedAt.delete(spec)
            logger.info({ spec, ms: Date.now() - started }, 'mcp package installed')
        })
        .catch(err => {
            failedAt.set(spec, Date.now())
            logger.warn({ spec, err: String(err) }, 'mcp package install failed, npx stays')
        })
        .finally(() => installing.delete(spec))
    installing.set(spec, job)
    return job
}

export function withInstalledPackage(server: McpServer): McpServer {
    const launch = parseNpxLaunch(server)
    if (!launch) return server
    const installed = readInstalled(launch.spec)
    const wanted = !installed || (!isPinnedSpec(launch.spec) && Date.now() - installed.installedAt > PACKAGE_REFRESH_MS)
    const retryDue = Date.now() - (failedAt.get(launch.spec) ?? 0) >= INSTALL_RETRY_MS
    if (wanted && retryDue) void installInBackground(launch.spec)
    return installed ? { ...server, command: installed.bin, args: launch.rest } : server
}
