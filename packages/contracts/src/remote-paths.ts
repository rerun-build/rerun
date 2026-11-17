import type { RemoteOs } from './remote-computer.js'

// Paths on a linked computer, read the same way by the engine (to know when to ask) and by the
// computer's worker (which checks the real path, links followed, before touching anything).

// Where secrets live: keys, keychains, browser profiles, wallets, password managers, cloud
// credentials. A file there always asks, even on a computer in full access.
const SENSITIVE_UNDER_HOME = [
    '.ssh', '.gnupg', '.aws', '.azure', '.kube', '.docker', '.config/gcloud', '.config/gh', '.config/op', '.netrc', '.npmrc', '.pypirc', '.git-credentials', '.password-store', '.local/share/keyrings',
    '.mozilla', '.config/google-chrome', '.config/chromium', '.config/BraveSoftware', '.config/microsoft-edge', '.bitcoin', '.ethereum', '.electrum', '.config/Exodus', '.zsh_history', '.bash_history',
    'Library/Keychains', 'Library/Cookies', 'Library/Application Support/Google/Chrome', 'Library/Application Support/Firefox', 'Library/Application Support/BraveSoftware', 'Library/Application Support/Microsoft Edge',
    'Library/Application Support/1Password', 'Library/Application Support/Exodus', 'Library/Application Support/Electrum', 'Library/Group Containers/2BUA8C4S2C.com.1password', 'Library/Messages', 'Library/Mail',
    'AppData/Local/Google/Chrome/User Data', 'AppData/Local/Microsoft/Edge/User Data', 'AppData/Local/BraveSoftware', 'AppData/Roaming/Mozilla', 'AppData/Roaming/Microsoft/Credentials', 'AppData/Local/Microsoft/Credentials',
    'AppData/Roaming/Microsoft/Protect', 'AppData/Local/1Password', 'AppData/Roaming/Exodus', 'AppData/Roaming/Electrum', 'AppData/Roaming/Bitcoin',
]

const SENSITIVE_ANYWHERE = [/^\/etc\/(shadow|gshadow|sudoers)/i, /^[a-z]:\/windows\/system32\/config(\/|$)/i, /\/\.env(\.[\w-]+)?$/i, /\/id_(rsa|ed25519|ecdsa|dsa)(\.pub)?$/i, /\.(pem|p12|pfx|key|kdbx|keychain-db)$/i]

// Forward slashes, no trailing one, `~` expanded, lower case on Windows and macOS where the disk ignores case.
export function normalizeRemotePath(path: string, os: RemoteOs, home: string): string {
    let value = path.trim().replace(/\\/g, '/')
    if (value === '~' || value.startsWith('~/')) value = `${home.replace(/\\/g, '/')}${value.slice(1)}`
    const parts: string[] = []
    const absolute = value.startsWith('/') ? '/' : ''
    const drive = /^[a-z]:/i.exec(value)?.[0] ?? ''
    const unc = value.startsWith('//') ? '//' : ''
    const rest = value.slice(unc ? 2 : drive ? drive.length : absolute.length)
    for (const part of rest.split('/')) {
        if (!part || part === '.') continue
        if (part === '..') parts.pop()
        else parts.push(part)
    }
    const joined = `${unc || (drive ? `${drive}/` : absolute)}${parts.join('/')}`
    return os === 'linux' ? joined : joined.toLowerCase()
}

export function isInsideRemote(path: string, root: string, os: RemoteOs, home: string): boolean {
    const target = normalizeRemotePath(path, os, home)
    const base = normalizeRemotePath(root, os, home)
    return target === base || target.startsWith(base.endsWith('/') ? base : `${base}/`)
}

export function isSensitiveRemotePath(path: string, os: RemoteOs, home: string): boolean {
    const target = normalizeRemotePath(path, os, home)
    if (SENSITIVE_ANYWHERE.some(pattern => pattern.test(target))) return true
    return SENSITIVE_UNDER_HOME.some(folder => isInsideRemote(target, `${home.replace(/\\/g, '/')}/${folder}`, os, home))
}

// A path Windows reserves (CON, NUL, COM1…) or a UNC share: never something a coworker writes to.
export function isReservedWindowsPath(path: string): boolean {
    const value = path.replace(/\\/g, '/')
    if (value.startsWith('//')) return true
    const name = value.split('/').pop() ?? ''
    return /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i.test(name)
}

// A path the coworker gave, made absolute against the computer's working folder.
export function resolveRemotePath(path: string, workDir: string, os: RemoteOs, home: string): string {
    const value = path.trim().replace(/\\/g, '/')
    const absolute = value.startsWith('/') || value.startsWith('~') || /^[a-z]:\//i.test(value) || value.startsWith('//')
    const joined = absolute ? value : `${workDir.replace(/\\/g, '/')}/${value}`
    const normalized = normalizeRemotePath(joined, 'linux', home)
    return os === 'win' ? normalized.replace(/\//g, '\\') : normalized
}

// The folder a path sits in, written the way the path is.
export function remoteParentOf(path: string): string {
    const separator = path.includes('\\') && !path.includes('/') ? '\\' : '/'
    const at = path.replace(/[\\/]+$/, '').lastIndexOf(separator)
    if (at <= 0) return path.slice(0, at + 1) || path
    return /^[a-z]:$/i.test(path.slice(0, at)) ? path.slice(0, at + 1) : path.slice(0, at)
}
