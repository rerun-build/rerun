'use client'

import { VoiceRecorderBar } from '@/components/chat/VoiceRecorderBar'
import { useVoiceRecorder } from '@/hooks/useVoiceRecorder'
import { transcribeVoiceRecording } from '@/lib/voice/client'
import type { QuestionVoice, QuestionVoiceStatus } from '@rerun/ui/chat'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

/**
 * Answering a coworker's question out loud. Unlike the composer's voice message, nothing is kept:
 * the audio is transcribed and dropped, and the words land in the answer field as if they had been
 * typed, so the answer travels as the text the question asked for.
 */
export function useQuestionVoice(): QuestionVoice {
    const t = useTranslations('chat.voice')
    const [transcribing, setTranscribing] = useState(false)
    const deliverRef = useRef<((transcript: string) => void) | null>(null)

    // The recorder calls finish when it hits its length cap, and finish needs the recorder to stop.
    const finishRef = useRef<() => void>(() => {})
    const recorder = useVoiceRecorder({
        onError: message => toast.error(message),
        onLimitReached: () => finishRef.current(),
    })
    const { start: startRecording, stop, cancel, stream, getLiveState } = recorder

    const start = useCallback(
        (deliver: (transcript: string) => void) => {
            deliverRef.current = deliver
            void startRecording()
        },
        [startRecording]
    )

    const finish = useCallback(async () => {
        setTranscribing(true)
        try {
            // Null when the recording was stopped before the microphone came up: nothing was said.
            const recording = await stop()
            if (!recording) return
            const transcript = await transcribeVoiceRecording(recording.blob, recording.format.transcriptionFormat)
            if (!transcript) {
                toast.error(t('nothingHeard'))
                return
            }
            deliverRef.current?.(transcript)
        } catch (err) {
            toast.error(err instanceof Error ? err.message : t('startFailed'))
        } finally {
            deliverRef.current = null
            setTranscribing(false)
        }
    }, [stop, t])

    useEffect(() => {
        finishRef.current = () => void finish()
    })

    const discard = useCallback(() => {
        deliverRef.current = null
        setTranscribing(false)
        cancel()
    }, [cancel])

    const status: QuestionVoiceStatus = transcribing ? 'transcribing' : recorder.status

    return {
        status,
        start,
        finish: () => void finish(),
        discard,
        render: () => (status === 'idle' ? null : <VoiceRecorderBar size="answer" status={status} stream={stream} getLiveState={getLiveState} />),
    }
}
