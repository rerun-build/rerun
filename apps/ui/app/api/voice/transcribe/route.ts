import { requireWorkspaceId } from '@/app/api/_auth/ownership'
import { transcribeAudio } from '@/lib/ai/transcribe'
import { refusal, refusalOf } from '@/lib/i18n/action-error'
import { TRANSCRIPTION_FORMATS } from '@/lib/voice/recording'

export const runtime = 'nodejs'

// The middleware tees request bodies and truncates them at 10 MB, so anything larger would
// reach us corrupted rather than whole. The composer caps recordings well below this.
const MAX_AUDIO_BYTES = 10 * 1024 * 1024

export async function POST(request: Request) {
    try {
        await requireWorkspaceId()
    } catch {
        return Response.json({ error: 'Unauthorized', code: 'notAuthenticated' }, { status: 401 })
    }

    const format = new URL(request.url).searchParams.get('format') ?? ''
    if (!TRANSCRIPTION_FORMATS.has(format)) {
        return Response.json(refusal('unsupportedAudioFormat'), { status: 400 })
    }

    const audio = new Uint8Array(await request.arrayBuffer())
    if (audio.byteLength === 0) return Response.json(refusal('emptyRecording'), { status: 400 })
    if (audio.byteLength > MAX_AUDIO_BYTES) return Response.json(refusal('recordingTooLarge'), { status: 413 })

    try {
        return Response.json({ text: await transcribeAudio(audio, format) })
    } catch (err) {
        return Response.json(refusalOf(err, 'transcriptionFailed'), { status: 502 })
    }
}
