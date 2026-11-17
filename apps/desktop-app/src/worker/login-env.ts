import { execFile } from 'node:child_process'

const MARKER = '__RERUN_LOGIN_ENV__'
const TIMEOUT_MS = 5_000

// The variables that belong to the app, not to the person: a command never inherits them.
const APP_ONLY = /^(ELECTRON_|CHROME_|GOOGLE_API_KEY$|NODE_OPTIONS$|RERUN_DESKTOP_)/

// Where the package managers put programs, for when the login shell cannot be read.
const KNOWN_BIN_DIRS = ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', '/usr/local/sbin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']

export function parseEnvBlock(output: string): Record<string, string> | null {
    const at = output.lastIndexOf(MARKER)
    if (at === -1) return null
    const env: Record<string, string> = {}
    for (const entry of output.slice(at + MARKER.length).split('\0')) {
        const equals = entry.indexOf('=')
        if (equals > 0) env[entry.slice(0, equals)] = entry.slice(equals + 1)
    }
    return Object.keys(env).length > 0 ? env : null
}

export function withoutAppVariables(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    return Object.fromEntries(Object.entries(env).filter(([key]) => !APP_ONLY.test(key)))
}

function withKnownDirs(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const path = (env.PATH ?? '').split(':').filter(Boolean)
    for (const dir of KNOWN_BIN_DIRS) if (!path.includes(dir)) path.push(dir)
    return { ...env, PATH: path.join(':') }
}

// An app opened from the Dock or a launcher gets a bare PATH: `ffmpeg` installed by Homebrew is not
// on it. The person's login shell is asked once, interactively so their rc files run, for the
// environment a terminal of theirs would have. What it prints before the marker (a banner) is ignored;
// a shell that hangs or fails leaves the app's own environment with the usual folders added.
export function resolveLoginEnv(platform: NodeJS.Platform = process.platform, base: NodeJS.ProcessEnv = process.env, timeoutMs = TIMEOUT_MS): Promise<NodeJS.ProcessEnv> {
    if (platform === 'win32') return Promise.resolve(withoutAppVariables(base))
    const shell = base.SHELL && /^\/[\w./-]+$/.test(base.SHELL) ? base.SHELL : platform === 'darwin' ? '/bin/zsh' : '/bin/sh'
    return new Promise(resolve => {
        execFile(shell, ['-ilc', `printf '${MARKER}'; command env -0`], { env: { ...base, TERM: 'dumb' }, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' }, (_err, stdout) => {
            const env = parseEnvBlock(stdout ?? '')
            resolve(withoutAppVariables(env ? { ...env, SHELL: shell } : withKnownDirs(base)))
        })
    })
}
