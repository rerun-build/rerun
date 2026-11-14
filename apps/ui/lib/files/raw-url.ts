import { withTabWorkspace } from '@/lib/workspace/tab-workspace'

export type RawUrlFor = (path: string) => string

export function agentFileRawUrl(agentId: string, path: string): string {
    return withTabWorkspace(`/api/files/raw?agentId=${encodeURIComponent(agentId)}&path=${encodeURIComponent(path)}`)
}

export function sharedFileRawUrl(path: string): string {
    return withTabWorkspace(`/api/files/raw?scope=shared&path=${encodeURIComponent(path)}`)
}

export function foremanFileRawUrl(sessionId: string, path: string): string {
    return withTabWorkspace(`/api/foreman/files/raw?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`)
}

export function rawUrlResolver(agentId?: string, override?: RawUrlFor): RawUrlFor | null {
    if (override) return override
    return agentId ? path => agentFileRawUrl(agentId, path) : null
}
