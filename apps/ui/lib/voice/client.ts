import { RefusalError, type Refusal } from '@/hooks/useErrorText'
import { uploadUrl, type UploadTarget } from '@/lib/files/upload-url'

const SAVE_FAILED: Refusal = { error: 'Could not save your voice message.', code: 'saveVoiceFailed' }
const TRANSCRIBE_FAILED: Refusal = { error: 'Could not transcribe your voice message.', code: 'transcribeVoiceFailed' }

async function errorFrom(res: Response, fallback: Refusal): Promise<RefusalError> {
    try {
        const payload = (await res.json()) as Refusal
        if (typeof payload.error === 'string' && payload.error) return new RefusalError({ error: payload.error, code: payload.code, params: payload.params })
    } catch {
        // A non-JSON body is the normal shape of a proxy-level rejection.
    }
    return new RefusalError(fallback)
}

/** Drops the recording where the conversation keeps its files and returns the path to open it by. */
export async function uploadVoiceRecording({ target, dir, name, blob }: { target: UploadTarget; dir: string; name: string; blob: Blob }): Promise<string> {
    const res = await fetch(uploadUrl(target, dir, name, blob.size), {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: blob,
    })
    if (!res.ok) throw await errorFrom(res, SAVE_FAILED)

    const payload: unknown = await res.json()
    const path = (payload as { path?: unknown }).path
    if (typeof path !== 'string' || !path) throw new RefusalError(SAVE_FAILED)
    return path
}

export async function transcribeVoiceRecording(blob: Blob, format: string): Promise<string> {
    const res = await fetch(`/api/voice/transcribe?format=${encodeURIComponent(format)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: blob,
    })
    if (!res.ok) throw await errorFrom(res, TRANSCRIBE_FAILED)

    const payload: unknown = await res.json()
    const text = (payload as { text?: unknown }).text
    return typeof text === 'string' ? text.trim() : ''
}
