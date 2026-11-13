import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, statfsSync, symlinkSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { basename, relative, resolve } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { dataDir } from '../../config/paths.js'
import { readBuildInfo } from '../../runtime/build-info.js'
import { BUILD_INFO_FILE } from '../../runtime/layout.js'
import { asRoot, run } from './exec.js'

// A prebuilt engine, as the hub names it: where to fetch it, what it must hash to, which commit it is.
export type Artifact = { url: string; sha256: string; commit: string; bytes?: number }

export function parseArtifactArgs(args: string[]): Artifact | null {
    const value = (flag: string): string | undefined => {
        const i = args.indexOf(flag)
        return i >= 0 ? args[i + 1] : undefined
    }
    const url = value('--artifact')
    const sha256 = value('--sha256')
    const commit = value('--commit')
    const bytes = value('--bytes')
    if (url === undefined && sha256 === undefined && commit === undefined) return null
    if (!url || !sha256 || !commit) throw new Error('--artifact, --sha256 and --commit go together')
    if (!/^https?:\/\//.test(url)) throw new Error('--artifact must be an http(s) URL')
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error('--sha256 must be 64 hex characters')
    if (!/^[0-9a-f]{7,40}$/.test(commit)) throw new Error('--commit must be a git commit hash')
    const parsedBytes = bytes === undefined ? undefined : Number(bytes)
    if (parsedBytes !== undefined && (!Number.isInteger(parsedBytes) || parsedBytes <= 0)) throw new Error('--bytes must be a positive integer')
    return { url, sha256, commit, bytes: parsedBytes }
}

export function artifactArgs(artifact: Artifact): string[] {
    return ['--artifact', artifact.url, '--sha256', artifact.sha256, '--commit', artifact.commit, ...(artifact.bytes ? ['--bytes', String(artifact.bytes)] : [])]
}

export const releasesDir = (root: string): string => resolve(root, 'releases')
export const releaseDir = (root: string, commit: string): string => resolve(releasesDir(root), commit)
export const currentLink = (root: string): string => resolve(root, 'current')
export const previousLink = (root: string): string => resolve(root, 'previous')
export const releaseBin = (dir: string): string => resolve(dir, 'dist', 'cli', 'bin.js')

const DEFAULT_ARTIFACT_BYTES = 150 * 1024 * 1024
const FREE_SPACE_MARGIN = 1024 ** 3
const toMb = (bytes: number): number => Math.round(bytes / 1024 / 1024)

// The tarball, the tree it unpacks to, and room left for the engine to keep working.
export function requireFreeSpace(dir: string, bytes: number = DEFAULT_ARTIFACT_BYTES): void {
    const stats = statfsSync(dir)
    const available = Number(stats.bavail) * Number(stats.bsize)
    const needed = bytes * 3 + FREE_SPACE_MARGIN
    if (available < needed) throw new Error(`not enough free space in ${dir}: ${toMb(available)} MB available, ${toMb(needed)} MB needed`)
}

const DOWNLOAD_TIMEOUT_MS = 15 * 60_000

// Streams to disk while hashing, so a 100 MB artifact never sits in memory; a wrong checksum leaves nothing behind.
export async function downloadArtifact(url: string, dest: string, sha256: string, fetchImpl: typeof fetch = fetch): Promise<number> {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
    if (!res.ok || !res.body) throw new Error(`artifact download failed: HTTP ${res.status}`)
    const hash = createHash('sha256')
    let bytes = 0
    const tap = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
            hash.update(chunk)
            bytes += chunk.length
            callback(null, chunk)
        },
    })
    await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), tap, createWriteStream(dest))
    const digest = hash.digest('hex')
    if (digest !== sha256) {
        rmSync(dest, { force: true })
        throw new Error(`artifact checksum mismatch: expected ${sha256}, got ${digest}`)
    }
    return bytes
}

// GNU tar: present on every Debian, and the archive is built by the same tar.
export function extractArtifact(tarball: string, dir: string): void {
    run('tar', ['-xzf', tarball, '-C', dir, '--no-same-owner', '--no-same-permissions'])
}

// The artifact's own build-info has to agree with what the hub announced and with this machine.
export function verifyRelease(dir: string, artifact: Artifact): void {
    const info = readBuildInfo(dir)
    if (!info) throw new Error(`artifact has no ${BUILD_INFO_FILE}`)
    if (!(info.commit.startsWith(artifact.commit) || artifact.commit.startsWith(info.commit))) throw new Error(`artifact is commit ${info.commit}, expected ${artifact.commit}`)
    if (info.platform && info.platform !== process.platform) throw new Error(`artifact built for ${info.platform}, this machine is ${process.platform}`)
    if (info.arch && info.arch !== process.arch) throw new Error(`artifact built for ${info.arch}, this machine is ${process.arch}`)
    if (!existsSync(releaseBin(dir))) throw new Error('artifact has no dist/cli/bin.js')
}

function linkTarget(link: string): string | null {
    try {
        return realpathSync(link)
    } catch {
        return null
    }
}

// A symlink cannot be rewritten in place: a fresh one renamed over the old is what readers see atomically.
function replaceSymlink(link: string, target: string): void {
    const tmp = `${link}.tmp`
    rmSync(tmp, { force: true })
    symlinkSync(target, tmp)
    renameSync(tmp, link)
}

// `current` moves to the new release in one rename; whatever it pointed at becomes `previous`.
export function switchCurrent(root: string, dir: string): string | null {
    const base = realpathSync(root)
    const old = linkTarget(currentLink(root))
    const next = realpathSync(dir)
    if (old && old !== next) replaceSymlink(previousLink(root), relative(base, old))
    replaceSymlink(currentLink(root), relative(base, next))
    return old
}

export function rollbackRelease(root: string): string {
    const previous = linkTarget(previousLink(root))
    if (!previous) throw new Error('no previous release to roll back to')
    const current = linkTarget(currentLink(root))
    if (current === previous) throw new Error('already on the previous release')
    const base = realpathSync(root)
    replaceSymlink(currentLink(root), relative(base, previous))
    if (current) replaceSymlink(previousLink(root), relative(base, current))
    return previous
}

const STALE_TMP_MS = 60 * 60_000

// Keeps the release that serves and the one to roll back to; a half-downloaded folder older than an hour is a leftover.
export function pruneReleases(root: string, now: number = Date.now()): string[] {
    const dir = releasesDir(root)
    if (!existsSync(dir)) return []
    const keep = new Set([linkTarget(currentLink(root)), linkTarget(previousLink(root))].filter((path): path is string => path !== null).map(path => basename(path)))
    const removed: string[] = []
    for (const name of readdirSync(dir)) {
        const path = resolve(dir, name)
        if (name.startsWith('.tmp-')) {
            if (now - statSync(path).mtimeMs < STALE_TMP_MS) continue
        } else if (keep.has(name)) continue
        rmSync(path, { recursive: true, force: true })
        removed.push(name)
    }
    return removed
}

const RELEASE_LAYOUT_ENTRIES = new Set(['releases', 'current', 'previous', 'current.tmp', 'previous.tmp'])

// A box born as a git checkout keeps that checkout beside `releases/` until a release has booted and
// served: then the checkout, its node_modules, the pnpm store and the corepack cache only cost disk.
export function sweepLegacyCheckout(root: string, home: string = homedir()): string[] {
    if (!existsSync(resolve(root, 'pnpm-workspace.yaml')) || !existsSync(resolve(root, '.git'))) return []
    const removed: string[] = []
    for (const name of readdirSync(root)) {
        if (RELEASE_LAYOUT_ENTRIES.has(name)) continue
        rmSync(resolve(root, name), { recursive: true, force: true })
        removed.push(resolve(root, name))
    }
    for (const cache of [resolve(home, '.local', 'share', 'pnpm', 'store'), resolve(home, '.cache', 'node', 'corepack')]) {
        if (!existsSync(cache)) continue
        rmSync(cache, { recursive: true, force: true })
        removed.push(cache)
    }
    return removed
}

// The git-era installer ran pnpm and npm as root, and `update-cli-tools` still fills root's npm
// cache: ~2.4 GiB a box never reads again. Only the node caches of /root/.cache go: when the service
// runs as root, /root/.cache is its own home and holds the patchright Chromium (ms-playwright).
// There is no existence check, `rm -rf` is the check.
export const ROOT_CACHE_DIRS = ['/root/.local/share/pnpm', '/root/.npm', '/root/.cache/node'] as const

export function sweepRootCaches(dirs: readonly string[] = ROOT_CACHE_DIRS): string[] {
    asRoot(['rm', '-rf', ...dirs])
    return [...dirs]
}

// Only the downloaded .deb files go: an `rm` of the apt folders would leave apt without the
// directories it expects.
export function cleanAptCache(): void {
    asRoot(['apt-get', 'clean'])
}

// A box only hands freed blocks back to the host's thin volume on a discard: without it, the
// release just pruned stays allocated on the host until the guest's weekly fstrim. A filesystem
// without discard (a VPS, LVM without issue_discards) is not an error worth a line at every update.
export function trimRootFilesystem(): void {
    asRoot(['fstrim', '--quiet-unsupported', '/'])
}

export type LayoutOptions = { service: string; user: string; config: string; node: string }

// The installer runs as root and names the account the service runs under; an update runs as that
// account itself.
export function defaultLayoutOptions(): LayoutOptions {
    return { service: process.env.RERUN_SERVICE ?? 'rerun', user: process.env.RERUN_SERVICE_USER ?? userInfo().username, config: resolve(dataDir(), 'config.env'), node: process.execPath }
}

export type LayoutFile = { path: string; content: string; mode: string }

// The files outside `root` that point at `current`: the launcher, the unit and its rollback.
export function layoutFiles(root: string, options: LayoutOptions): LayoutFile[] {
    const current = currentLink(root)
    const rollbackScript = '/usr/local/bin/rerun-rollback'
    return [
        {
            path: '/usr/local/bin/rerun',
            mode: '755',
            content: `#!/bin/sh\nexec "${options.node}" "${releaseBin(current)}" "$@"\n`,
        },
        {
            path: rollbackScript,
            mode: '755',
            content: [
                '#!/bin/sh',
                `# Runs once when ${options.service}.service gives up on a release: the previous one comes back.`,
                'set -eu',
                `ROOT="${root}"`,
                `SERVICE="${options.service}"`,
                '[ -L "$ROOT/previous" ] || exit 0',
                'PREVIOUS=$(readlink "$ROOT/previous")',
                'CURRENT=$(readlink "$ROOT/current" 2>/dev/null || true)',
                '[ "$PREVIOUS" != "$CURRENT" ] || exit 0',
                'ln -sfn "$PREVIOUS" "$ROOT/current.tmp"',
                'mv -Tf "$ROOT/current.tmp" "$ROOT/current"',
                // Gone on purpose: a second failure must not swap back and forth forever.
                'rm -f "$ROOT/previous"',
                'echo "rolled $SERVICE back to $PREVIOUS"',
                'systemctl reset-failed "$SERVICE" || true',
                'systemctl start "$SERVICE"',
                '',
            ].join('\n'),
        },
        {
            path: `/etc/systemd/system/${options.service}.service`,
            mode: '644',
            content: [
                '[Unit]',
                'Description=rerun-engine',
                'After=network.target',
                'StartLimitIntervalSec=300',
                'StartLimitBurst=5',
                `OnFailure=${options.service}-rollback.service`,
                '',
                '[Service]',
                'Type=simple',
                `User=${options.user}`,
                `WorkingDirectory=${current}`,
                `EnvironmentFile=-${options.config}`,
                `ExecStart=${options.node} ${releaseBin(current)} run`,
                'Restart=always',
                'RestartSec=3',
                '',
                '[Install]',
                'WantedBy=multi-user.target',
                '',
            ].join('\n'),
        },
        {
            path: `/etc/systemd/system/${options.service}-rollback.service`,
            mode: '644',
            content: ['[Unit]', `Description=rerun-engine rollback to the previous release`, '', '[Service]', 'Type=oneshot', `ExecStart=${rollbackScript}`, ''].join('\n'),
        },
    ]
}

function readText(path: string): string | null {
    try {
        return readFileSync(path, 'utf8')
    } catch {
        return null
    }
}

// Writes only what differs, so an update on a box already in the release layout touches nothing as root.
export function installLayout(root: string, options: LayoutOptions = defaultLayoutOptions(), readExisting: (path: string) => string | null = readText): string[] {
    const written: string[] = []
    for (const file of layoutFiles(root, options)) {
        if (readExisting(file.path) === file.content) continue
        asRoot(['sh', '-c', 'cat > "$1" && chmod "$2" "$1"', 'sh', file.path, file.mode], file.content)
        written.push(file.path)
    }
    if (written.length > 0) asRoot(['systemctl', 'daemon-reload'])
    return written
}
