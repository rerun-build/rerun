const ENDPOINT = 'https://openrouter.ai/api/v1/audio/transcriptions'
const MODEL = process.env.RERUN_TRANSCRIBE_MODEL ?? 'openai/whisper-large-v3-turbo'

export async function transcribeAudio(audio: Uint8Array, format: string, signal?: AbortSignal): Promise<string> {
    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set')

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
        throw new Error(`Transcription failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`)
    }

    const payload: unknown = await res.json()
    const text = (payload as { text?: unknown }).text
    if (typeof text !== 'string') throw new Error('Transcription returned no text')
    return text.trim()
}
