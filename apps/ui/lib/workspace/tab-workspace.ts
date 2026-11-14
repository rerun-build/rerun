import { WORKSPACE_HEADER, WORKSPACE_PARAM } from './workspace-header'

const TAB_WORKSPACE_KEY = 'rerun:tab-workspace'

export function readTabWorkspace(): number | null {
    try {
        const raw = sessionStorage.getItem(TAB_WORKSPACE_KEY)
        return raw && /^\d+$/.test(raw) ? Number(raw) : null
    } catch {
        return null
    }
}

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
