import { hubPath, mobileApi } from '@rerun/contracts'
import { Directory, File, Paths } from 'expo-file-system'

import { clientHeader, hubHeaders } from '@/api/client'
import { environment } from '@/config/environment'

type Caller = { accessToken: string; workspaceId: number }

export type FileRef = { agentId: string; path: string; scope?: 'agent' | 'shared' }

// Who holds a conversation's uploads: a coworker keeps them on its Box, the Foreman in a hub bucket
// keyed by conversation.
export type FileOwner = { kind: 'agent'; agentId: string } | { kind: 'foreman'; sessionId: string }

// The hub streams a file back from the Box; the shared folder of the workspace has no agent to name.
export function rawFileUrl({ agentId, path, scope = 'agent' }: FileRef): string {
    return `${environment.apiUrl}${hubPath(mobileApi.readAgentFile, {}, scope === 'shared' ? { scope: 'shared', path } : { agentId, path })}`
}

export function ownedFileUrl(owner: FileOwner, path: string): string {
    if (owner.kind === 'agent') return rawFileUrl({ agentId: owner.agentId, path })
    return `${environment.apiUrl}${hubPath(mobileApi.readForemanFile, {}, { sessionId: owner.sessionId, path })}`
}

// An image a card points at: a web address as is, a path on the Box through the hub, anything else
// (a data or file scheme the agent made up) nowhere.
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

// Only the hub's own file routes may see the person's token: the check is on the exact origin and
// path, since an agent's answer can point at any web address, including one shaped like ours.
export function isHubFileUrl(url: string): boolean {
    return HUB_FILE_PREFIXES.some(prefix => url.startsWith(prefix))
}

const HUB_FILE_PREFIXES = [mobileApi.readAgentFile, mobileApi.readForemanFile].map(endpoint => `${environment.apiUrl}${endpoint.path}?`)

export function fileHeadersFor(caller: Caller | null, url: string): Record<string, string> | undefined {
    return isHubFileUrl(url) ? fileHeaders(caller) : undefined
}

// A file fetched once into the cache and read from there, for what has to play or seek locally: the
// engine streams a file whole, with no ranges. A web address never sees the person's token, whoever
// the caller is.
export async function cachedFile(caller: Caller | null, url: string, name: string): Promise<string> {
    const folder = new Directory(Paths.cache, 'files', String(Date.now()))
    folder.create({ intermediates: true })
    const file = await File.downloadFileAsync(url, new File(folder, name.replace(/[/\\]/g, '_')), { headers: fileHeadersFor(caller, url), idempotent: true })
    return file.uri
}
