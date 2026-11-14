import { requireWorkspaceId } from '@/app/api/_auth/ownership'
import { transcribeAudio } from '@/lib/ai/transcribe'
import { TRANSCRIPTION_FORMATS } from '@/lib/voice/recording'

export const runtime = 'nodejs'

const MAX_AUDIO_BYTES = 10 * 1024 * 1024

export async function POST(request: Request) {
    try {
        await requireWorkspaceId()
    } catch {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const format = new URL(request.url).searchParams.get('format') ?? ''
    if (!TRANSCRIPTION_FORMATS.has(format)) {
        return Response.json({ error: 'Unsupported audio format' }, { status: 400 })
    }

    const audio = new Uint8Array(await request.arrayBuffer())
    if (audio.byteLength === 0) return Response.json({ error: 'Empty recording' }, { status: 400 })
    if (audio.byteLength > MAX_AUDIO_BYTES) return Response.json({ error: 'Recording too large' }, { status: 413 })

    try {
        return Response.json({ text: await transcribeAudio(audio, format) })
    } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : 'Transcription failed' }, { status: 502 })
    }
}
