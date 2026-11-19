import { AppError } from '@/lib/i18n/action-error'

// Speech-to-text for the composer's voice messages. Whisper large v3 turbo through OpenRouter,
// asking for groq first: it is the lowest-latency of the two providers serving that model, and
// fallbacks stay on so a groq outage degrades speed rather than breaking the feature. Measured
// end to end at ~0.9s for 4s of speech. OpenRouter's transcription endpoint does not currently
// seem to act on `provider.order`; the field is kept because it costs nothing and states the
// intent for the day it does.
//
// Base64 JSON rather than the multipart form: it is the shape that carries the provider block.

const ENDPOINT = 'https://openrouter.ai/api/v1/audio/transcriptions'
const MODEL = process.env.RERUN_TRANSCRIBE_MODEL ?? 'openai/whisper-large-v3-turbo'

export async function transcribeAudio(audio: Uint8Array, format: string, signal?: AbortSignal): Promise<string> {
    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) throw new AppError('transcriptionNotConfigured')

    const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: MODEL,
            input_audio: { data: Buffer.from(audio).toString('base64'), format },
            provider: { order: ['groq'], allow_fallbacks: true },
        }),
        signal,
    })

    if (!res.ok) {
        const detail = await res.text().catch(() => '')
        throw detail ? new AppError('transcriptionFailedBecause', { status: res.status, detail: detail.slice(0, 200) }) : new AppError('transcriptionFailedStatus', { status: res.status })
    }

    const payload: unknown = await res.json()
    const text = (payload as { text?: unknown }).text
    if (typeof text !== 'string') throw new AppError('transcriptionReturnedNoText')
    return text.trim()
}
