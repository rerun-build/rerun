import { execFileSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { compareShellVersions } from '@rerun/contracts'
import { env } from '../config/env.js'
import { detectLayout } from './layout.js'

// The one Codex every box runs, installed by `rerun update-cli-tools` from the release that names it.
// The installer of Rerun Cloud's boxes and the Dockerfile carry the same version (codex-cli.test.ts holds them to it).
// The subscription is only ever as capable as this binary: a model it has never heard of is refused.
export const CODEX_VERSION = '0.170.0'

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

// The configured path, then on a release or an image the global install `update-cli-tools` keeps at
// the pin. Undefined leaves the provider on the copy it carries as an optional dependency, an older
// Codex than the pin. On a checkout that copy runs unless RERUN_CODEX_PATH says otherwise: the global
// `codex` there is the developer's own, at whatever version.
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

// A version that could not be read says nothing about the binary: only a read one is off the pin.
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

// `[agents].enabled`, the switch that closes Codex's own sub-agents, exists from this version on. An
// older Codex reads `agents` as a table of roles and refuses to start on a boolean there.
const CODEX_AGENTS_SWITCH_SINCE = '0.145.0'

const versionByBinary = new Map<string, string>()

// `--version` costs a process, so it is asked once per binary and again when an update replaces the
// file. A read that failed is not kept: it says nothing about the next one.
function runningCodexVersion(): string | null {
    const { cmd, args } = codexCommand()
    const file = args[0] ?? cmd
    const info = statSync(file, { throwIfNoEntry: false })
    const key = `${file}:${info?.ino ?? 0}:${info?.ctimeMs ?? 0}`
    const known = versionByBinary.get(key)
    if (known) return known
    const version = installedCodexVersion()
    if (version) versionByBinary.set(key, version)
    return version
}

export function codexHasAgentsSwitch(version: string | null = runningCodexVersion()): boolean {
    return version !== null && compareShellVersions(version, CODEX_AGENTS_SWITCH_SINCE) >= 0
}
