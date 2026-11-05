import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'
import { BUILD_INFO_FILE, detectLayout } from './layout.js'

// Written by the build that produced a prebuilt artifact, next to `dist/`. A git checkout has none
// and asks git instead.
export const buildInfoSchema = z.object({
    commit: z.string().regex(/^[0-9a-f]{7,40}$/),
    channel: z.string().optional(),
    builtAt: z.string().optional(),
    node: z.string().optional(),
    platform: z.string().optional(),
    arch: z.string().optional(),
})
export type BuildInfo = z.infer<typeof buildInfoSchema>

export function readBuildInfo(packageDir: string): BuildInfo | null {
    try {
        return buildInfoSchema.parse(JSON.parse(readFileSync(resolve(packageDir, BUILD_INFO_FILE), 'utf8')))
    } catch {
        return null
    }
}

const SHORT_COMMIT_LENGTH = 7

const startedAt = new Date().toISOString()

const layout = detectLayout()

const info: BuildInfo | null = layout.kind === 'monorepo' ? null : readBuildInfo(layout.packageDir)

let commitFull: string | null = info?.commit ?? null
if (!commitFull && layout.kind === 'monorepo') {
    try {
        commitFull = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: layout.root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null
    } catch {
        commitFull = null
    }
}

// Short on purpose: archives, pairing and the fleet view compare it, and a git checkout only ever
// knew the short form.
export function buildCommit(): string | null {
    return commitFull ? commitFull.slice(0, SHORT_COMMIT_LENGTH) : null
}

export function buildCommitFull(): string | null {
    return commitFull
}

export function buildInfo(): BuildInfo | null {
    return info
}

export function processStartedAt(): string {
    return startedAt
}

// Whether `commit` names this build: either side may be the short form.
export function isBuildCommit(commit: string): boolean {
    if (!commitFull) return false
    return commit.length <= commitFull.length ? commitFull.startsWith(commit) : commit.startsWith(commitFull)
}

// How the engine names itself to OpenCode, which sees every box behind one product.
export function opencodeUserAgent(): string {
    return `rerun-engine/${buildCommit() ?? 'dev'}`
}
