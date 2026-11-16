// Text-to-speech for the call prototype: what a coworker says, read by a real voice. ElevenLabs
// directly when Rerun holds a key for it, which lets a voice be told the language it speaks; the other
// voices go through OpenRouter like the transcription. The voices a caller may ask for are named
// here: the route never forwards a model or a voice it was handed.

const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/audio/speech'
const ELEVENLABS_ENDPOINT = 'https://api.elevenlabs.io/v1/text-to-speech'
const ELEVENLABS_MODEL = 'eleven_flash_v2_5'
const GROK_VOICE = 'x-ai/grok-voice-tts-1.0'

type CallVoice = { provider: 'elevenlabs'; voiceId: string } | { provider: 'openrouter'; model: string; voice: string }

export const CALL_VOICES: Record<string, CallVoice> = {
    sarah: { provider: 'elevenlabs', voiceId: 'EXAVITQu4vr4xnSDxMaL' },
    george: { provider: 'elevenlabs', voiceId: 'JBFqnCBsd6RMkjVDRZzb' },
    lily: { provider: 'elevenlabs', voiceId: 'pFZP5JQG7iQjIQuC4Bku' },
    will: { provider: 'elevenlabs', voiceId: 'bIHbv24MWmeRgasZH58o' },
    charlotte: { provider: 'elevenlabs', voiceId: 'XB0fDUnXU5powFXDhCwa' },
    leo: { provider: 'openrouter', model: GROK_VOICE, voice: 'leo' },
    eve: { provider: 'openrouter', model: GROK_VOICE, voice: 'eve' },
    marie: { provider: 'openrouter', model: 'mistralai/voxtral-mini-tts-3-0', voice: 'fr_marie_neutral' },
}

function speechRequest(text: string, voice: CallVoice, language: string | null): { url: string; init: RequestInit } {
    if (voice.provider === 'elevenlabs') {
        const apiKey = process.env.ELEVENLABS_API_KEY
        if (!apiKey) throw new Error('ELEVENLABS_API_KEY is not set')
        // Without the language, an English voice reads French with its own accent.
        const body = { text, model_id: ELEVENLABS_MODEL, ...(language && { language_code: language }) }
        return { url: `${ELEVENLABS_ENDPOINT}/${voice.voiceId}/stream?output_format=mp3_44100_128`, init: { method: 'POST', headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body) } }
    }
    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set')
    return { url: OPENROUTER_ENDPOINT, init: { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: voice.model, input: text, voice: voice.voice, response_format: 'mp3' }) } }
}

export async function speechStream(text: string, voice: CallVoice, language: string | null, signal?: AbortSignal): Promise<ReadableStream<Uint8Array>> {
    const { url, init } = speechRequest(text, voice, language)
    const res = await fetch(url, { ...init, signal })
    if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => '')
        throw new Error(`Speech failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`)
    }
    return res.body
}
