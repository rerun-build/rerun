import { Directory, File, Paths } from 'expo-file-system'

import { clientHeader, hubHeaders } from '@/api/client'
import { environment } from '@/config/environment'

type Caller = { accessToken: string; workspaceId: number }

export type FileRef = { agentId: string; path: string; scope?: 'agent' | 'shared' }

export type FileOwner = { kind: 'agent'; agentId: string } | { kind: 'foreman'; sessionId: string }

export function rawFileUrl({ agentId, path, scope = 'agent' }: FileRef): string {
    const params = scope === 'shared' ? `scope=shared&path=${encodeURIComponent(path)}` : `agentId=${encodeURIComponent(agentId)}&path=${encodeURIComponent(path)}`
    return `${environment.apiUrl}/api/files/raw?${params}`
}

export function ownedFileUrl(owner: FileOwner, path: string): string {
    if (owner.kind === 'agent') return rawFileUrl({ agentId: owner.agentId, path })
    return `${environment.apiUrl}/api/foreman/files/raw?sessionId=${encodeURIComponent(owner.sessionId)}&path=${encodeURIComponent(path)}`
}

export function mediaUrl(src: unknown, agentId: string): string | null {
    if (typeof src !== 'string') return null
    const value = src.trim()
    if (!value) return null
    if (/^https?:\/\//i.test(value)) return value
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null
    return rawFileUrl({ agentId, path: value })
}

export function fileHeaders(caller: Caller | null): Record<string, string> {
    return hubHeaders(clientHeader, { accessToken: caller?.accessToken, workspaceId: caller?.workspaceId })
}

export function isHubFileUrl(url: string): boolean {
    return HUB_FILE_PREFIXES.some(prefix => url.startsWith(prefix))
}

const HUB_FILE_PREFIXES = [`${environment.apiUrl}/api/files/raw?`, `${environment.apiUrl}/api/foreman/files/raw?`]

export function fileHeadersFor(caller: Caller | null, url: string): Record<string, string> | undefined {
    return isHubFileUrl(url) ? fileHeaders(caller) : undefined
}

export async function cachedFile(caller: Caller | null, url: string, name: string): Promise<string> {
    const folder = new Directory(Paths.cache, 'files', String(Date.now()))
    folder.create({ intermediates: true })
    const file = await File.downloadFileAsync(url, new File(folder, name.replace(/[/\\]/g, '_')), { headers: fileHeadersFor(caller, url), idempotent: true })
    return file.uri
}
