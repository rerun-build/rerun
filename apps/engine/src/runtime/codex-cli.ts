import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { env } from '../config/env.js'
import { detectLayout } from './layout.js'

export const CODEX_VERSION = '0.166.0'

export type CodexCommand = { cmd: string; args: string[] }

let globalCodex: string | null = null

function codexOnPath(): string | null {
    if (globalCodex) return globalCodex
    try {
        globalCodex = execFileSync('sh', ['-c', 'command -v codex'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null
    } catch {
        globalCodex = null
    }
    return globalCodex
}

export function codexPath(): string | undefined {
    const configured = env().RERUN_CODEX_PATH
    if (configured) return configured
    return detectLayout().kind === 'monorepo' ? undefined : codexOnPath() || undefined
}

export function codexCommand(): CodexCommand {
    const path = codexPath()
    if (path) return /\.[cm]?js$/i.test(path) ? { cmd: 'node', args: [path] } : { cmd: path, args: [] }
    try {
        const require = createRequire(import.meta.url)
        const fromProvider = createRequire(require.resolve('ai-sdk-provider-codex-cli'))
        return { cmd: 'node', args: [join(dirname(fromProvider.resolve('@openai/codex/package.json')), 'bin', 'codex.js')] }
    } catch {
        return { cmd: 'codex', args: [] }
    }
}

export function codexOffPin(version: string | null): boolean {
    return version !== null && version !== CODEX_VERSION
}

export function parseCodexVersion(output: string): string | null {
    return output.match(/(\d+\.\d+\.\d+(?:-[\w.]+)?)/)?.[1] ?? null
}

export function installedCodexVersion(): string | null {
    const { cmd, args } = codexCommand()
    try {
        return parseCodexVersion(execFileSync(cmd, [...args, '--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 }))
    } catch {
        return null
    }
}
