import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const FULL = 'abc1234def5678abc1234def5678abc1234def56'
const REPO_ROOT = resolve(import.meta.dirname, '../../../..')

function releaseDir(info: Record<string, unknown> | string): string {
    const dir = mkdtempSync(resolve(tmpdir(), 'rerun-build-info-'))
    mkdirSync(resolve(dir, 'dist'))
    writeFileSync(resolve(dir, 'build-info.json'), typeof info === 'string' ? info : JSON.stringify(info))
    return dir
}

async function loadWithLayout(layout: { kind: string; root: string; packageDir: string }) {
    vi.resetModules()
    vi.doMock('./layout.js', async importOriginal => ({ ...(await importOriginal<typeof import('./layout.js')>()), detectLayout: () => layout }))
    return import('./build-info.js')
}

afterEach(() => {
    vi.doUnmock('./layout.js')
    vi.resetModules()
})

describe('build info', () => {
    it('reports a short commit hash or null outside a git checkout', async () => {
        const { buildCommit } = await import('./build-info.js')
        const commit = buildCommit()
        if (commit !== null) expect(commit).toMatch(/^[0-9a-f]{4,40}$/)
    })

    it('reports a stable process start time', async () => {
        const { processStartedAt } = await import('./build-info.js')
        const startedAt = processStartedAt()
        expect(Number.isNaN(Date.parse(startedAt))).toBe(false)
        expect(Date.parse(startedAt)).toBeLessThanOrEqual(Date.now())
        expect(processStartedAt()).toBe(startedAt)
    })

    it('reads the commit a release was built from, short for callers and full for the record', async () => {
        const dir = releaseDir({ commit: FULL, channel: 'master', builtAt: '2026-11-02T10:00:00.000Z', node: 'v22.0.0', platform: 'linux', arch: 'x64' })
        const { buildCommit, buildCommitFull, buildInfo, isBuildCommit } = await loadWithLayout({ kind: 'release', root: resolve(dir, '..'), packageDir: dir })
        expect(buildCommit()).toBe('abc1234')
        expect(buildCommitFull()).toBe(FULL)
        expect(buildInfo()).toMatchObject({ channel: 'master', platform: 'linux' })
        expect(isBuildCommit('abc1234')).toBe(true)
        expect(isBuildCommit(FULL)).toBe(true)
        expect(isBuildCommit('abc1234def5678abc1234def5678abc1234def57')).toBe(false)
        expect(isBuildCommit('ffffff0')).toBe(false)
    })

    it('reports no commit for an image without build-info, and never asks git there', async () => {
        const dir = releaseDir('not json')
        const { buildCommit, buildCommitFull, buildInfo, isBuildCommit } = await loadWithLayout({ kind: 'image', root: dir, packageDir: dir })
        expect(buildCommit()).toBeNull()
        expect(buildCommitFull()).toBeNull()
        expect(buildInfo()).toBeNull()
        expect(isBuildCommit('abc1234')).toBe(false)
    })

    it.skipIf(!existsSync(resolve(REPO_ROOT, '.git')))('asks git in a checkout', async () => {
        const dir = releaseDir({ commit: FULL })
        const { buildCommit, buildInfo } = await loadWithLayout({ kind: 'monorepo', root: REPO_ROOT, packageDir: dir })
        expect(buildInfo()).toBeNull()
        expect(buildCommit()).toMatch(/^[0-9a-f]{7}$/)
    })

    it('rejects a build-info whose commit is not a hash', async () => {
        const dir = releaseDir({ commit: 'release-1' })
        const { readBuildInfo } = await import('./build-info.js')
        expect(readBuildInfo(dir)).toBeNull()
    })
})
