import { CHAT_ATTACHMENTS_DIR, hubPath, mobileApi, uniqueAttachmentName, type HubPathParams, type HubQueryValues, type HubResponse } from '@rerun/contracts'

import { apiErrorOf, clientHeader, hubHeaders } from '@/api/client'
import type { FileOwner } from '@/api/files'
import { environment } from '@/config/environment'
import { translatorFor } from '@/i18n/translator'

type Caller = { accessToken: string; workspaceId: number }

const randomToken = () => Math.random().toString(36).slice(2, 8)

async function bytesOf(uri: string): Promise<Blob> {
    return (await fetch(uri)).blob()
}

type UploadEndpoint = typeof mobileApi.uploadAgentFile | typeof mobileApi.uploadForemanFile | typeof mobileApi.transcribeVoice

async function postBytes<E extends UploadEndpoint>(caller: Caller, endpoint: E, query: HubQueryValues, body: Blob): Promise<HubResponse<E>> {
    const response = await fetch(`${environment.apiUrl}${hubPath(endpoint, {} as HubPathParams<E>, query)}`, { method: 'POST', headers: { ...hubHeaders(clientHeader, caller), 'Content-Type': 'application/octet-stream' }, body })
    const payload: unknown = await response.json().catch(() => null)
    if (!response.ok) throw apiErrorOf(response.status, payload, translatorFor('mobileCommon')('errors.uploadFailed', { status: response.status }))
    return endpoint.response.parse(payload) as HubResponse<E>
}

// A photo goes to the coworker's own folder on its machine, under chat-uploads like the web's, and the
// message names its path.
export async function uploadChatFile(caller: Caller, agentId: string, uri: string, fileName: string): Promise<string> {
    const blob = await bytesOf(uri)
    const name = uniqueAttachmentName(fileName, randomToken())
    const { path } = await postBytes(caller, mobileApi.uploadAgentFile, { agentId, name, size: String(blob.size), dir: CHAT_ATTACHMENTS_DIR }, blob)
    return path
}

// A voice message's audio lands next to the conversation's other uploads, where the bubble plays it
// back from, on the phone as on the web.
export async function uploadVoiceRecording(caller: Caller, owner: FileOwner, uri: string): Promise<string> {
    const blob = await bytesOf(uri)
    const name = `${Date.now().toString(36)}-${randomToken()}-voice.m4a`
    const common = { name, size: String(blob.size), dir: CHAT_ATTACHMENTS_DIR }
    const uploaded = owner.kind === 'agent' ? postBytes(caller, mobileApi.uploadAgentFile, { agentId: owner.agentId, ...common }, blob) : postBytes(caller, mobileApi.uploadForemanFile, { sessionId: owner.sessionId, ...common }, blob)
    const { path } = await uploaded
    return path
}

// The hub's transcription, the one the web's voice messages use. iOS records AAC in an m4a file.
export async function transcribeRecording(caller: Caller, uri: string): Promise<string> {
    const { text } = await postBytes(caller, mobileApi.transcribeVoice, { format: 'm4a' }, await bytesOf(uri))
    return text
}
