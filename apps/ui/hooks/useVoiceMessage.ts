'use client'

import type { UploadTarget } from '@/lib/files/upload-url'
import { useVoiceRecorder, type VoiceRecording } from '@/hooks/useVoiceRecorder'
import { transcribeVoiceRecording, uploadVoiceRecording } from '@/lib/voice/client'
import { appendVoiceMarker, buildVoiceMarker } from '@/lib/voice/marker'
import { nanoid } from 'nanoid'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

export type VoiceMessageStatus = 'idle' | 'starting' | 'recording' | 'processing' | 'failed'

type Options = {
    target: UploadTarget
    dir: string
    onSend: (text: string) => void | Promise<void>
}

type Pending = VoiceRecording & { path?: string }

export function useVoiceMessage({ target, dir, onSend }: Options) {
    const t = useTranslations('chat.voice')
    const [processing, setProcessing] = useState(false)
    const [failed, setFailed] = useState(false)
    const pendingRef = useRef<Pending | null>(null)

    const onSendRef = useRef(onSend)

    const finishRef = useRef<() => void>(() => {})

    const recorder = useVoiceRecorder({
        onError: message => toast.error(message),
        onLimitReached: () => finishRef.current(),
    })

    const process = useCallback(
        async (recording: Pending) => {
            pendingRef.current = recording
            setFailed(false)
            setProcessing(true)
            try {
                const name = `${Date.now().toString(36)}-${nanoid(6)}-voice.${recording.format.extension}`
                const [path, transcript] = await Promise.all([
                    recording.path ?? uploadVoiceRecording({ target, dir, name, blob: recording.blob }),
                    transcribeVoiceRecording(recording.blob, recording.format.transcriptionFormat),
                ])
                pendingRef.current = { ...recording, path }

                if (!transcript) {
                    setFailed(true)
                    toast.error(t('nothingHeard'))
                    return
                }

                await onSendRef.current(appendVoiceMarker(transcript, buildVoiceMarker({ src: path, durationMs: recording.durationMs, levels: recording.levels })))
                pendingRef.current = null
            } catch (err) {
                setFailed(true)
                toast.error(t('voiceMessageFailed'))
            } finally {
                setProcessing(false)
            }
        },
        [target, dir, t]
    )

    const { stop, cancel } = recorder

    const finish = useCallback(async () => {
        setProcessing(true)
        const recording = await stop()
        if (!recording) {
            setProcessing(false)
            toast.error(t('nothingRecorded'))
            return
        }
        await process(recording)
    }, [stop, process, t])

    useEffect(() => {
        onSendRef.current = onSend
        finishRef.current = () => void finish()
    })

    const retry = useCallback(() => {
        const pending = pendingRef.current
        if (pending) void process(pending)
    }, [process])

    const discard = useCallback(() => {
        pendingRef.current = null
        setFailed(false)
        cancel()
    }, [cancel])

    const status: VoiceMessageStatus = processing ? 'processing' : failed ? 'failed' : recorder.status

    return {
        status,
        stream: recorder.stream,
        getLiveState: recorder.getLiveState,
        start: recorder.start,
        finish,
        retry,
        discard,
    }
}
