import { LAST_WORKSPACE_COOKIE, readWorkspaceId } from './host-workspace'
import { WORKSPACE_HEADER, WORKSPACE_PARAM } from './workspace-header'

// Each tab stays on the workspace it opened, whatever another tab switches to. `users.workspace_id`
// is only the last one picked anywhere, which a tab with no pin of its own (a new one, or one that
// just switched) opens on. sessionStorage is per tab, survives a reload and follows a duplicated tab.
const TAB_WORKSPACE_KEY = 'rerun:tab-workspace'

export function readTabWorkspace(): number | null {
    try {
        const raw = sessionStorage.getItem(TAB_WORKSPACE_KEY)
        return raw && /^\d+$/.test(raw) ? Number(raw) : null
    } catch {
        return null
    }
}

// A page load that names its workspace (`/?workspace=`): the landing of a flow that just moved
// `users.workspace_id` server-side, which the tab's own pin would otherwise override.
export function readUrlWorkspace(): number | null {
    try {
        const raw = new URL(window.location.href).searchParams.get(WORKSPACE_PARAM)
        return raw && /^\d+$/.test(raw) ? Number(raw) : null
    } catch {
        return null
    }
}

export function pinTabWorkspace(workspaceId: number) {
    try {
        sessionStorage.setItem(TAB_WORKSPACE_KEY, String(workspaceId))
    } catch {}
}

export function clearTabWorkspace() {
    try {
        sessionStorage.removeItem(TAB_WORKSPACE_KEY)
    } catch {}
}

const LAST_WORKSPACE_MAX_AGE = 365 * 24 * 60 * 60

// On an organization's address: the server reads it on the next page, which names no workspace. Kept to
// this very host, the cookie names one of its workspaces.
export function rememberHostWorkspace(workspaceId: number) {
    const secure = window.location.protocol === 'https:' ? '; secure' : ''
    document.cookie = `${LAST_WORKSPACE_COOKIE}=${workspaceId}; path=/; max-age=${LAST_WORKSPACE_MAX_AGE}; samesite=lax${secure}`
}

export function readLastHostWorkspace(): number | null {
    const prefix = `${LAST_WORKSPACE_COOKIE}=`
    const entry = document.cookie.split('; ').find(cookie => cookie.startsWith(prefix))
    return readWorkspaceId(entry?.slice(prefix.length))
}

export function withTabWorkspace(url: string): string {
    const workspaceId = readTabWorkspace()
    if (workspaceId === null) return url
    return `${url}${url.includes('?') ? '&' : '?'}${WORKSPACE_PARAM}=${workspaceId}`
}

function isSameOrigin(input: RequestInfo | URL) {
    const url = input instanceof Request ? input.url : String(input)
    try {
        return new URL(url, window.location.href).origin === window.location.origin
    } catch {
        return false
    }
}

const WRAPPED = Symbol.for('rerun.workspace-header')

// Server actions and RSC navigations go through the global fetch, so this is the one place every
// request to our own server can name the tab's workspace. Same-origin only: Supabase and third
// parties never see the header, nor pay a CORS preflight for it.
export function installWorkspaceHeader() {
    if (typeof window === 'undefined') return
    const original = window.fetch as typeof window.fetch & { [WRAPPED]?: true }
    if (original[WRAPPED]) return

    const wrapped = (input: RequestInfo | URL, init?: RequestInit) => {
        const workspaceId = readTabWorkspace()
        if (workspaceId === null || !isSameOrigin(input)) return original.call(window, input, init)
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
        if (!headers.has(WORKSPACE_HEADER)) headers.set(WORKSPACE_HEADER, String(workspaceId))
        return original.call(window, input, { ...init, headers })
    }
    window.fetch = Object.assign(wrapped, { [WRAPPED]: true as const })
}
