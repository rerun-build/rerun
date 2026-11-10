import { CHAT_ATTACHMENTS_DIR, uniqueAttachmentName } from '@rerun/contracts'

import { ApiError, clientHeader, hubHeaders } from '@/api/client'
import type { FileOwner } from '@/api/files'
import { environment } from '@/config/environment'
import { translatorFor } from '@/i18n/translator'

type Caller = { accessToken: string; workspaceId: number }

const randomToken = () => Math.random().toString(36).slice(2, 8)

async function bytesOf(uri: string): Promise<Blob> {
    return (await fetch(uri)).blob()
}

async function postBytes(caller: Caller, path: string, body: Blob): Promise<unknown> {
    const response = await fetch(`${environment.apiUrl}${path}`, { method: 'POST', headers: { ...hubHeaders(clientHeader, caller), 'Content-Type': 'application/octet-stream' }, body })
    const payload: unknown = await response.json().catch(() => null)
    if (!response.ok) throw new ApiError(response.status, (payload as { error?: string } | null)?.error ?? translatorFor('mobileCommon')('errors.uploadFailed', { status: response.status }), payload)
    return payload
}

// A photo goes to the coworker's own folder on its machine, under chat-uploads like the web's, and the
// message names its path.
export async function uploadChatFile(caller: Caller, agentId: string, uri: string, fileName: string): Promise<string> {
    const blob = await bytesOf(uri)
    const name = uniqueAttachmentName(fileName, randomToken())
    const query = new URLSearchParams({ agentId, name, size: String(blob.size), dir: CHAT_ATTACHMENTS_DIR })
    const { path } = (await postBytes(caller, `/api/files/stream?${query}`, blob)) as { path: string }
    return path
}

// A voice message's audio lands next to the conversation's other uploads, where the bubble plays it
// back from, on the phone as on the web.
export async function uploadVoiceRecording(caller: Caller, owner: FileOwner, uri: string): Promise<string> {
    const blob = await bytesOf(uri)
    const name = `${Date.now().toString(36)}-${randomToken()}-voice.m4a`
    const query = new URLSearchParams({ ...(owner.kind === 'agent' ? { agentId: owner.agentId } : { sessionId: owner.sessionId }), name, size: String(blob.size), dir: CHAT_ATTACHMENTS_DIR })
    const route = owner.kind === 'agent' ? '/api/files/stream' : '/api/foreman/files/stream'
    const { path } = (await postBytes(caller, `${route}?${query}`, blob)) as { path: string }
    return path
}

// The hub's transcription, the one the web's voice messages use. iOS records AAC in an m4a file.
export async function transcribeRecording(caller: Caller, uri: string): Promise<string> {
    const { text } = (await postBytes(caller, '/api/voice/transcribe?format=m4a', await bytesOf(uri))) as { text: string }
    return text
}
