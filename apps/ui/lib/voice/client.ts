import { uploadUrl, type UploadTarget } from '@/lib/files/upload-url'

async function errorFrom(res: Response, fallback: string): Promise<Error> {
    try {
        const payload: unknown = await res.json()
        const message = (payload as { error?: unknown }).error
        if (typeof message === 'string' && message) return new Error(message)
    } catch {
    }
    return new Error(fallback)
}

export async function uploadVoiceRecording({ target, dir, name, blob }: { target: UploadTarget; dir: string; name: string; blob: Blob }): Promise<string> {
    const res = await fetch(uploadUrl(target, dir, name, blob.size), {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: blob,
    })
    if (!res.ok) throw await errorFrom(res, 'Could not save your voice message.')

    const payload: unknown = await res.json()
    const path = (payload as { path?: unknown }).path
    if (typeof path !== 'string' || !path) throw new Error('Could not save your voice message.')
    return path
}

export async function transcribeVoiceRecording(blob: Blob, format: string): Promise<string> {
    const res = await fetch(`/api/voice/transcribe?format=${encodeURIComponent(format)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: blob,
    })
    if (!res.ok) throw await errorFrom(res, 'Could not transcribe your voice message.')

    const payload: unknown = await res.json()
    const text = (payload as { text?: unknown }).text
    return typeof text === 'string' ? text.trim() : ''
}
