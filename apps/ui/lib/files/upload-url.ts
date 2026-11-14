import { withTabWorkspace } from '@/lib/workspace/tab-workspace'

export type UploadTarget = { kind: 'agent'; agentId: string } | { kind: 'shared' } | { kind: 'foreman'; sessionId: string }

export function uploadUrl(target: UploadTarget, dir: string, name: string, size: number): string {
    const query = new URLSearchParams({ name, size: String(size) })
    if (dir) query.set('dir', dir)
    if (target.kind === 'foreman') {
        query.set('sessionId', target.sessionId)
        return withTabWorkspace(`/api/foreman/files/stream?${query}`)
    }
    if (target.kind === 'agent') query.set('agentId', target.agentId)
    else query.set('scope', 'shared')
    return withTabWorkspace(`/api/files/stream?${query}`)
}
