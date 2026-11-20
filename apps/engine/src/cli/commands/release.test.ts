import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-release-data-'))

const rootCalls = vi.hoisted(() => [] as Array<{ line: string; input?: string }>)

vi.mock('./exec.js', async importOriginal => ({
    ...(await importOriginal<typeof import('./exec.js')>()),
    asRoot: (command: string[], input?: string) => {
        rootCalls.push({ line: command.join(' '), input })
    },
}))

const { afterEach, beforeEach, describe, expect, it } = await import('vitest')
const {
    artifactArgs,
    cleanAptCache,
    currentLink,
    defaultLayoutOptions,
    downloadArtifact,
    extractArtifact,
    installLayout,
    layoutFiles,
    parseArtifactArgs,
    previousLink,
    pruneReleases,
    requireFreeSpace,
    rollbackRelease,
    ROOT_CACHE_DIRS,
    sweepLegacyCheckout,
    sweepRootCaches,
    switchCurrent,
    trimRootFilesystem,
    verifyRelease,
} = await import('./release.js')

const SHA = 'a'.repeat(64)
const COMMIT = 'abc1234def5678abc1234def5678abc1234def56'
const ARTIFACT = { url: 'https://releases.example/engine.tar.gz', sha256: SHA, commit: COMMIT }

const scratch: string[] = []

function root(): string {
    const dir = mkdtempSync(resolve(tmpdir(), 'rerun-release-'))
    scratch.push(dir)
    return dir
}

function release(dir: string, commit: string, info: Record<string, unknown> | null = { commit }): string {
    const path = resolve(dir, 'releases', commit)
    mkdirSync(resolve(path, 'dist', 'cli'), { recursive: true })
    writeFileSync(resolve(path, 'dist', 'cli', 'bin.js'), '')
    if (info) writeFileSync(resolve(path, 'build-info.json'), JSON.stringify(info))
    return path
}

const link = (path: string): string | null => (existsSync(path) ? readlinkSync(path) : null)

beforeEach(() => {
    rootCalls.length = 0
})

afterEach(() => {
    for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
    vi.restoreAllMocks()
})

describe('parseArtifactArgs', () => {
    it('is null when no artifact flag is given', () => {
        expect(parseArtifactArgs([])).toBeNull()
        expect(parseArtifactArgs(['--no-restart'])).toBeNull()
    })

    it('reads the four flags in any order', () => {
        expect(parseArtifactArgs(['--commit', COMMIT, '--bytes', '1024', '--artifact', ARTIFACT.url, '--sha256', SHA])).toEqual({ ...ARTIFACT, bytes: 1024 })
        expect(parseArtifactArgs(artifactArgs({ ...ARTIFACT, bytes: 7 }))).toEqual({ ...ARTIFACT, bytes: 7 })
        expect(parseArtifactArgs(artifactArgs(ARTIFACT))).toEqual({ ...ARTIFACT, bytes: undefined })
    })

    it('refuses a partial or malformed artifact', () => {
        expect(() => parseArtifactArgs(['--artifact', ARTIFACT.url])).toThrow('go together')
        expect(() => parseArtifactArgs(['--artifact', 'ftp://x', '--sha256', SHA, '--commit', COMMIT])).toThrow('http(s) URL')
        expect(() => parseArtifactArgs(['--artifact', ARTIFACT.url, '--sha256', 'abc', '--commit', COMMIT])).toThrow('64 hex')
        expect(() => parseArtifactArgs(['--artifact', ARTIFACT.url, '--sha256', SHA, '--commit', 'v1.2'])).toThrow('commit hash')
        expect(() => parseArtifactArgs([...artifactArgs(ARTIFACT), '--bytes', '-3'])).toThrow('positive integer')
    })
})

describe('requireFreeSpace', () => {
    it('passes for a small artifact and refuses one the disk cannot hold three times over', () => {
        const dir = root()
        expect(() => requireFreeSpace(dir, 1)).not.toThrow()
        expect(() => requireFreeSpace(dir, Number.MAX_SAFE_INTEGER / 4)).toThrow('not enough free space')
    })
})

describe('downloadArtifact', () => {
    const body = Buffer.from('engine tarball bytes')
    const digest = createHash('sha256').update(body).digest('hex')
    const fetchOk = () => Promise.resolve(new Response(body, { status: 200 }))

    it('streams to disk and checks the hash', async () => {
        const dest = resolve(root(), 'engine.tar.gz')
        expect(await downloadArtifact(ARTIFACT.url, dest, digest, fetchOk as typeof fetch)).toBe(body.length)
        expect(readFileSync(dest)).toEqual(body)
    })

    it('leaves nothing behind on a checksum mismatch', async () => {
        const dest = resolve(root(), 'engine.tar.gz')
        await expect(downloadArtifact(ARTIFACT.url, dest, SHA, fetchOk as typeof fetch)).rejects.toThrow('checksum mismatch')
        expect(existsSync(dest)).toBe(false)
    })

    it('fails on an HTTP error', async () => {
        const dest = resolve(root(), 'engine.tar.gz')
        const fetch403 = () => Promise.resolve(new Response('denied', { status: 403 }))
        await expect(downloadArtifact(ARTIFACT.url, dest, SHA, fetch403 as typeof fetch)).rejects.toThrow('HTTP 403')
    })
})

describe('extractArtifact and verifyRelease', () => {
    function tarball(dir: string, info: Record<string, unknown>): string {
        const src = resolve(dir, 'src')
        mkdirSync(resolve(src, 'dist', 'cli'), { recursive: true })
        writeFileSync(resolve(src, 'dist', 'cli', 'bin.js'), 'console.log(1)')
        writeFileSync(resolve(src, 'build-info.json'), JSON.stringify(info))
        const archive = resolve(dir, 'engine.tar.gz')
        execFileSync('tar', ['-czf', archive, '-C', src, '.'])
        return archive
    }

    it('unpacks a real tarball and accepts a release that matches', () => {
        const dir = root()
        const archive = tarball(dir, { commit: COMMIT, platform: process.platform, arch: process.arch })
        const out = resolve(dir, 'out')
        mkdirSync(out)
        extractArtifact(archive, out)
        expect(readFileSync(resolve(out, 'dist', 'cli', 'bin.js'), 'utf8')).toBe('console.log(1)')
        expect(() => verifyRelease(out, ARTIFACT)).not.toThrow()
        expect(() => verifyRelease(out, { ...ARTIFACT, commit: COMMIT.slice(0, 7) })).not.toThrow()
    })

    it('refuses a release built for another commit, platform or machine, or without its files', () => {
        const dir = root()
        expect(() => verifyRelease(release(dir, 'a', null), ARTIFACT)).toThrow('no build-info.json')
        expect(() => verifyRelease(release(dir, 'b', { commit: 'ffffff0' }), ARTIFACT)).toThrow('expected ' + COMMIT)
        expect(() => verifyRelease(release(dir, 'c', { commit: COMMIT, platform: 'win32' }), ARTIFACT)).toThrow('built for win32')
        expect(() => verifyRelease(release(dir, 'd', { commit: COMMIT, arch: 's390x' }), ARTIFACT)).toThrow('built for s390x')
        const noBin = release(dir, 'e', { commit: COMMIT })
        rmSync(resolve(noBin, 'dist'), { recursive: true })
        expect(() => verifyRelease(noBin, ARTIFACT)).toThrow('no dist/cli/bin.js')
    })
})

describe('switchCurrent and rollbackRelease', () => {
    it('points current at the release and keeps the old one as previous, relative to the root', () => {
        const dir = root()
        const first = release(dir, 'aaaaaaa')
        const second = release(dir, 'bbbbbbb')
        expect(switchCurrent(dir, first)).toBeNull()
        expect(link(currentLink(dir))).toBe('releases/aaaaaaa')
        expect(link(previousLink(dir))).toBeNull()

        expect(switchCurrent(dir, second)).toBe(realpathSync(first))
        expect(link(currentLink(dir))).toBe('releases/bbbbbbb')
        expect(link(previousLink(dir))).toBe('releases/aaaaaaa')

        expect(switchCurrent(dir, second)).toBe(realpathSync(second))
        expect(link(previousLink(dir))).toBe('releases/aaaaaaa')
    })

    it('swaps current and previous on rollback, and refuses without a previous release', () => {
        const dir = root()
        expect(() => rollbackRelease(dir)).toThrow('no previous release')
        const first = release(dir, 'aaaaaaa')
        const second = release(dir, 'bbbbbbb')
        switchCurrent(dir, first)
        switchCurrent(dir, second)
        expect(rollbackRelease(dir)).toBe(realpathSync(first))
        expect(link(currentLink(dir))).toBe('releases/aaaaaaa')
        expect(link(previousLink(dir))).toBe('releases/bbbbbbb')
    })

    it('refuses to roll back onto the release already serving', () => {
        const dir = root()
        const first = release(dir, 'aaaaaaa')
        switchCurrent(dir, first)
        symlinkSync('releases/aaaaaaa', previousLink(dir))
        expect(() => rollbackRelease(dir)).toThrow('already on the previous release')
    })
})

describe('pruneReleases', () => {
    it('keeps current and previous, drops the rest and stale downloads only', () => {
        const dir = root()
        const first = release(dir, 'aaaaaaa')
        const second = release(dir, 'bbbbbbb')
        release(dir, 'ccccccc')
        switchCurrent(dir, first)
        switchCurrent(dir, second)
        const fresh = resolve(dir, 'releases', '.tmp-ddddddd')
        const stale = resolve(dir, 'releases', '.tmp-eeeeeee')
        mkdirSync(fresh)
        mkdirSync(stale)
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60_000)
        utimesSync(stale, twoHoursAgo, twoHoursAgo)

        expect(pruneReleases(dir).sort()).toEqual(['.tmp-eeeeeee', 'ccccccc'])
        expect(readdirSync(resolve(dir, 'releases')).sort()).toEqual(['.tmp-ddddddd', 'aaaaaaa', 'bbbbbbb'])
    })

    it('does nothing without a releases folder', () => {
        expect(pruneReleases(root())).toEqual([])
    })
})

describe('sweepLegacyCheckout', () => {
    it('removes the checkout and the caches around the release layout', () => {
        const dir = root()
        const home = root()
        for (const name of ['pnpm-workspace.yaml', 'package.json']) writeFileSync(resolve(dir, name), '')
        mkdirSync(resolve(dir, '.git'))
        writeFileSync(resolve(dir, '.git', 'config'), 'url = https://x-access-token:secret@github.com/org/repo.git')
        mkdirSync(resolve(dir, 'apps', 'engine', 'node_modules'), { recursive: true })
        release(dir, 'aaaaaaa')
        switchCurrent(dir, resolve(dir, 'releases', 'aaaaaaa'))
        mkdirSync(resolve(home, '.local', 'share', 'pnpm', 'store', 'v3'), { recursive: true })
        mkdirSync(resolve(home, '.cache', 'node', 'corepack'), { recursive: true })

        const removed = sweepLegacyCheckout(dir, home)
        expect(removed).toEqual(expect.arrayContaining([resolve(dir, '.git'), resolve(dir, 'apps'), resolve(dir, 'pnpm-workspace.yaml'), resolve(home, '.local', 'share', 'pnpm', 'store'), resolve(home, '.cache', 'node', 'corepack')]))
        expect(readdirSync(dir).sort()).toEqual(['current', 'releases'])
        expect(existsSync(resolve(home, '.local', 'share', 'pnpm'))).toBe(true)
        expect(existsSync(resolve(home, '.local', 'share', 'pnpm', 'store'))).toBe(false)
    })

    it('leaves a root that was never a checkout alone', () => {
        const dir = root()
        release(dir, 'aaaaaaa')
        writeFileSync(resolve(dir, 'notes.txt'), '')
        expect(sweepLegacyCheckout(dir, root())).toEqual([])
        expect(existsSync(resolve(dir, 'notes.txt'))).toBe(true)
    })
})

describe('sweepRootCaches', () => {
    it('removes root-owned caches in one rm, without looking for them first', () => {
        rootCalls.length = 0
        expect(sweepRootCaches(['/root/.npm', '/root/.cache'])).toEqual(['/root/.npm', '/root/.cache'])
        expect(rootCalls).toEqual([{ line: 'rm -rf /root/.npm /root/.cache', input: undefined }])
    })

    it('targets the pnpm store, the npm cache and the corepack cache of root by default', () => {
        rootCalls.length = 0
        sweepRootCaches()
        expect(rootCalls[0]?.line).toBe('rm -rf /root/.local/share/pnpm /root/.npm /root/.cache/node')
    })

    it('leaves the rest of /root/.cache alone: a service running as root keeps its Chromium there', () => {
        expect(ROOT_CACHE_DIRS).not.toContain('/root/.cache')
    })
})

describe('cleanAptCache', () => {
    it('lets apt drop its downloaded packages, as root', () => {
        rootCalls.length = 0
        cleanAptCache()
        expect(rootCalls).toEqual([{ line: 'apt-get clean', input: undefined }])
    })
})

describe('trimRootFilesystem', () => {
    it('discards the freed blocks of / as root', () => {
        rootCalls.length = 0
        trimRootFilesystem()
        expect(rootCalls).toEqual([{ line: 'fstrim --quiet-unsupported /', input: undefined }])
    })
})

describe('defaultLayoutOptions', () => {
    it('names the account it runs as, unless the installer says which account the service runs under', () => {
        vi.stubEnv('RERUN_SERVICE_USER', undefined)
        vi.stubEnv('RERUN_SERVICE', undefined)
        expect(defaultLayoutOptions()).toMatchObject({ service: 'rerun', user: userInfo().username, node: process.execPath, config: resolve(process.env.RERUN_DATA_DIR!, 'config.env') })
        vi.stubEnv('RERUN_SERVICE_USER', 'rerun')
        vi.stubEnv('RERUN_SERVICE', 'rerun-staging')
        expect(defaultLayoutOptions()).toMatchObject({ service: 'rerun-staging', user: 'rerun' })
        vi.unstubAllEnvs()
    })
})

describe('layoutFiles and installLayout', () => {
    const options = { service: 'rerun', user: 'rerun', config: '/home/rerun/rerun/config.env', node: '/usr/bin/node' }

    it('points the launcher and the unit at current, and arms a one-shot rollback', () => {
        const files = layoutFiles('/opt/rerun', options)
        expect(files.map(file => file.path)).toEqual(['/usr/local/bin/rerun', '/usr/local/bin/rerun-rollback', '/etc/systemd/system/rerun.service', '/etc/systemd/system/rerun-rollback.service'])
        const [launcher, rollback, unit, rollbackUnit] = files
        expect(launcher.content).toBe('#!/bin/sh\nexec "/usr/bin/node" "/opt/rerun/current/dist/cli/bin.js" "$@"\n')
        expect(launcher.mode).toBe('755')
        expect(unit.content).toContain('WorkingDirectory=/opt/rerun/current\n')
        expect(unit.content).toContain('ExecStart=/usr/bin/node /opt/rerun/current/dist/cli/bin.js run\n')
        expect(unit.content).toContain('EnvironmentFile=-/home/rerun/rerun/config.env\n')
        expect(unit.content).toContain('User=rerun\n')
        expect(unit.content).toContain('OnFailure=rerun-rollback.service\n')
        expect(unit.content).toContain('StartLimitBurst=5\n')
        expect(rollback.content).toContain('ROOT="/opt/rerun"')
        expect(rollback.content).toContain('rm -f "$ROOT/previous"')
        expect(rollback.content).toContain('systemctl start "$SERVICE"')
        expect(rollbackUnit.content).toContain('ExecStart=/usr/local/bin/rerun-rollback\n')
    })

    it('names the service everywhere when it is not the default', () => {
        const files = layoutFiles('/srv/rerun', { ...options, service: 'rerun-staging' })
        expect(files.map(file => file.path)).toEqual(['/usr/local/bin/rerun', '/usr/local/bin/rerun-rollback', '/etc/systemd/system/rerun-staging.service', '/etc/systemd/system/rerun-staging-rollback.service'])
        expect(files[2].content).toContain('OnFailure=rerun-staging-rollback.service')
        expect(files[1].content).toContain('SERVICE="rerun-staging"')
    })

    it('writes every file through root and reloads systemd', () => {
        expect(installLayout('/opt/rerun', options)).toEqual(['/usr/local/bin/rerun', '/usr/local/bin/rerun-rollback', '/etc/systemd/system/rerun.service', '/etc/systemd/system/rerun-rollback.service'])
        expect(rootCalls.map(call => call.line)).toEqual([
            'sh -c cat > "$1" && chmod "$2" "$1" sh /usr/local/bin/rerun 755',
            'sh -c cat > "$1" && chmod "$2" "$1" sh /usr/local/bin/rerun-rollback 755',
            'sh -c cat > "$1" && chmod "$2" "$1" sh /etc/systemd/system/rerun.service 644',
            'sh -c cat > "$1" && chmod "$2" "$1" sh /etc/systemd/system/rerun-rollback.service 644',
            'systemctl daemon-reload',
        ])
        expect(rootCalls[2].input).toContain('ExecStart=/usr/bin/node /opt/rerun/current/dist/cli/bin.js run')
    })

    it('touches nothing when every file already has its content', () => {
        const files = layoutFiles('/opt/rerun', options)
        const existing = (path: string): string | null => files.find(file => file.path === path)?.content ?? null
        expect(installLayout('/opt/rerun', options, existing)).toEqual([])
        expect(rootCalls).toEqual([])
    })

    it('rewrites only the file that drifted', () => {
        const files = layoutFiles('/opt/rerun', options)
        const existing = (path: string): string | null => (path === '/usr/local/bin/rerun' ? '#!/bin/sh\nexec node /opt/rerun/apps/engine/dist/cli/bin.js "$@"\n' : files.find(file => file.path === path)?.content ?? null)
        expect(installLayout('/opt/rerun', options, existing)).toEqual(['/usr/local/bin/rerun'])
        expect(rootCalls.map(call => call.line)).toEqual(['sh -c cat > "$1" && chmod "$2" "$1" sh /usr/local/bin/rerun 755', 'systemctl daemon-reload'])
    })
})
