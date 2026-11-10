'use client'

import { MAX_RECORDING_MS, RECORDING_BITS_PER_SECOND, markRecordingFormatBroken, pickBackupFormat, pickRecordingFormat, type RecordingFormat } from '@/lib/voice/recording'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'

// 20 samples a second: a 5-minute recording is 6000 amplitudes before they are downsampled to
// the 48 peaks kept in the message.
const SAMPLE_INTERVAL_MS = 50

export type VoiceRecording = { blob: Blob; durationMs: number; levels: number[]; format: RecordingFormat }

type Take = { recorder: MediaRecorder; format: RecordingFormat; chunks: Blob[]; failed: boolean }

function startTake(stream: MediaStream, format: RecordingFormat): Take {
    const recorder = new MediaRecorder(stream, { mimeType: format.mimeType, audioBitsPerSecond: RECORDING_BITS_PER_SECOND })
    const take: Take = { recorder, format, chunks: [], failed: false }
    recorder.addEventListener('dataavailable', event => {
        if (event.data.size > 0) take.chunks.push(event.data)
    })
    recorder.addEventListener('error', () => {
        take.failed = true
    })
    return take
}

function stopTake(take: Take) {
    return new Promise<void>(resolve => {
        if (take.recorder.state === 'inactive') return resolve()
        take.recorder.addEventListener('stop', () => resolve(), { once: true })
        take.recorder.stop()
    })
}

function startBackupTake(stream: MediaStream, primary: RecordingFormat): Take[] {
    const backup = pickBackupFormat(primary)
    if (!backup) return []
    try {
        return [startTake(stream, backup)]
    } catch {
        return []
    }
}

export type VoiceRecorderStatus = 'idle' | 'starting' | 'recording'

/** The recording bar's timer. Polled rather than pushed, so the chat around it does not re-render 20 times a second. */
export type VoiceLiveState = { durationMs: number }

type Options = {
    onError: (message: string) => void
    /** Fired once when the recording hits MAX_RECORDING_MS, so the caller can finish it as if the user had. */
    onLimitReached: () => void
}

/**
 * Microphone capture for the composer. Owns the MediaStream, the MediaRecorder and the analyser
 * feeding the live waveform, and hands back the finished blob together with the amplitudes
 * captured along the way (they become the waveform stored in the message).
 */
export function useVoiceRecorder({ onError, onLimitReached }: Options) {
    const t = useTranslations('chat.voice')
    const [status, setStatus] = useState<VoiceRecorderStatus>('idle')
    // Handed to the waveform so it draws off the microphone we already hold instead of opening
    // a second capture of the same voice.
    const [stream, setStream] = useState<MediaStream | null>(null)

    const onErrorRef = useRef(onError)
    const onLimitReachedRef = useRef(onLimitReached)
    useEffect(() => {
        onErrorRef.current = onError
        onLimitReachedRef.current = onLimitReached
    })

    // The primary take is AAC where the browser offers it, so the iOS app can play the message.
    // The backup records the same stream in the next format, because a browser can claim AAC and
    // still fail to encode it: the backup is only sent when the primary comes back empty.
    const takesRef = useRef<Take[]>([])
    const streamRef = useRef<MediaStream | null>(null)
    const audioContextRef = useRef<AudioContext | null>(null)
    const analyserRef = useRef<AnalyserNode | null>(null)
    const allLevelsRef = useRef<number[]>([])
    const startedAtRef = useRef(0)
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
    const limitFiredRef = useRef(false)
    // Bumped by every start and every settle, so a recording cancelled while the permission prompt
    // is still open does not quietly come to life once the user allows it.
    const sessionRef = useRef(0)

    const releaseHardware = useCallback(() => {
        if (intervalRef.current) {
            clearInterval(intervalRef.current)
            intervalRef.current = null
        }
        analyserRef.current = null
        audioContextRef.current?.close().catch(() => {})
        audioContextRef.current = null
        for (const track of streamRef.current?.getTracks() ?? []) track.stop()
        streamRef.current = null
        setStream(null)
    }, [])

    // The mic indicator must go out even if the chat unmounts mid-recording.
    useEffect(() => releaseHardware, [releaseHardware])

    const sample = useCallback(() => {
        const analyser = analyserRef.current
        if (analyser) {
            const buffer = new Uint8Array(analyser.fftSize)
            analyser.getByteTimeDomainData(buffer)
            let sum = 0
            for (const value of buffer) {
                const centered = (value - 128) / 128
                sum += centered * centered
            }
            // RMS is quiet by nature for speech, so it is scaled up and clamped: the waveform is
            // there to show the voice moving, not to be a calibrated meter.
            allLevelsRef.current.push(Math.min(1, Math.sqrt(sum / buffer.length) * 3))
        }

        if (Date.now() - startedAtRef.current >= MAX_RECORDING_MS && !limitFiredRef.current) {
            limitFiredRef.current = true
            onLimitReachedRef.current()
        }
    }, [])

    const getLiveState = useCallback((): VoiceLiveState => ({ durationMs: startedAtRef.current ? Date.now() - startedAtRef.current : 0 }), [])

    const start = useCallback(async () => {
        if (takesRef.current.length > 0) return
        const session = ++sessionRef.current

        const format = pickRecordingFormat()
        if (!format || typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
            onErrorRef.current(t('unsupported'))
            return
        }

        setStatus('starting')
        let stream: MediaStream
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
        } catch (err) {
            if (session === sessionRef.current) setStatus('idle')
            const denied = err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError')
            onErrorRef.current(denied ? t('microphoneBlocked') : t('noMicrophone'))
            return
        }

        if (session !== sessionRef.current) {
            for (const track of stream.getTracks()) track.stop()
            return
        }

        try {
            const takes = [startTake(stream, format), ...startBackupTake(stream, format)]
            allLevelsRef.current = []
            limitFiredRef.current = false

            const audioContext = new AudioContext()
            const analyser = audioContext.createAnalyser()
            analyser.fftSize = 1024
            audioContext.createMediaStreamSource(stream).connect(analyser)
            // Built a tick after the click that granted the microphone, so it can come up
            // suspended: a suspended analyser reads as silence and the stored peaks come out flat.
            void audioContext.resume().catch(() => {})

            streamRef.current = stream
            setStream(stream)
            audioContextRef.current = audioContext
            analyserRef.current = analyser
            takesRef.current = takes
            startedAtRef.current = Date.now()

            for (const take of takes) take.recorder.start()
            setStatus('recording')
            intervalRef.current = setInterval(sample, SAMPLE_INTERVAL_MS)
        } catch {
            for (const track of stream.getTracks()) track.stop()
            takesRef.current = []
            setStatus('idle')
            onErrorRef.current(t('startFailed'))
        }
    }, [sample, t])

    const settle = useCallback(
        async (keep: boolean): Promise<VoiceRecording | null> => {
            sessionRef.current++
            const takes = takesRef.current
            takesRef.current = []

            const durationMs = startedAtRef.current ? Date.now() - startedAtRef.current : 0
            const levels = allLevelsRef.current

            await Promise.all(takes.map(stopTake))
            releaseHardware()
            setStatus('idle')

            const [primary] = takes
            if (primary?.failed) markRecordingFormatBroken(primary.format.mimeType)
            if (!keep) return null

            const usable = takes.find(take => !take.failed && take.chunks.length > 0)
            if (!usable) return null
            const blob = new Blob(usable.chunks, { type: usable.format.mimeType })
            return blob.size > 0 ? { blob, durationMs, levels, format: usable.format } : null
        },
        [releaseHardware]
    )

    /** Stops and returns the recording. Null when nothing usable was captured. */
    const stop = useCallback(() => settle(true), [settle])

    /** Stops and throws the recording away. */
    const cancel = useCallback(() => {
        void settle(false)
    }, [settle])

    return { status, stream, getLiveState, start, stop, cancel }
}
