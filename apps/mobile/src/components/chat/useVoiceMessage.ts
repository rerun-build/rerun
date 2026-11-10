import { appendVoiceMarker, buildVoiceMarker, MAX_RECORDING_MS } from '@rerun/contracts'
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from 'expo-audio'
import { useCallback, useEffect, useRef, useState } from 'react'

export type VoiceMessageStatus = 'idle' | 'starting' | 'recording' | 'processing' | 'failed'

export type VoiceMessageError = 'silent' | 'sendFailed'

// What a recording needs from its conversation to leave: a place for the audio, what was said, the send.
export type VoiceSender = {
    upload: (uri: string) => Promise<string>
    transcribe: (uri: string) => Promise<string>
    send: (text: string) => Promise<void>
}

export type VoiceLiveState = { level: number; durationMs: number }

type Recording = { uri: string; durationMs: number; levels: number[]; path?: string }

const SAMPLE_MS = 50
// Metering is in dBFS: speech sits roughly between -55 (quiet room) and -5 (close and loud).
const FLOOR_DB = -55
const RANGE_DB = 50

function levelOf(metering: number | undefined) {
    if (metering === undefined) return 0
    return Math.min(1, Math.max(0, (metering - FLOOR_DB) / RANGE_DB))
}

// The composer's voice message, as on the web: record, upload the audio next to the conversation's
// files while it is transcribed, then send the transcript with the marker that turns the bubble back
// into a player. A recording that fails on its way out is kept for a retry.
export function useVoiceMessage(sender: VoiceSender | undefined) {
    const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true })
    const [status, setStatus] = useState<VoiceMessageStatus>('idle')
    const [error, setError] = useState<VoiceMessageError | null>(null)
    const levelsRef = useRef<number[]>([])
    const liveRef = useRef<VoiceLiveState>({ level: 0, durationMs: 0 })
    const pendingRef = useRef<Recording | null>(null)
    const senderRef = useRef(sender)
    const finishRef = useRef<() => void>(() => {})
    // Bumped by every start, stop and discard: an await that wakes up to a newer one gives up.
    const takeRef = useRef(0)

    const process = useCallback(async (recording: Recording) => {
        const current = senderRef.current
        if (!current) return
        pendingRef.current = recording
        setError(null)
        setStatus('processing')
        try {
            // A retry after a failed transcription reuses the file already uploaded instead of leaving an orphan copy.
            const [path, transcript] = await Promise.all([
                recording.path ??
                    current.upload(recording.uri).then(path => {
                        recording.path = path
                        return path
                    }),
                current.transcribe(recording.uri),
            ])
            if (!transcript.trim()) {
                setError('silent')
                setStatus('failed')
                return
            }
            await current.send(appendVoiceMarker(transcript, buildVoiceMarker({ src: path, durationMs: recording.durationMs, levels: recording.levels })))
            pendingRef.current = null
            setStatus('idle')
        } catch {
            setError('sendFailed')
            setStatus('failed')
        }
    }, [])

    const stopRecorder = useCallback(async () => {
        await recorder.stop()
        await setAudioModeAsync({ allowsRecording: false })
        return recorder.uri
    }, [recorder])

    // Entering 'processing' before awaiting the recorder keeps the composer from flashing back to its
    // text field for a frame between the last bar and the transcription.
    const finish = useCallback(async () => {
        const take = ++takeRef.current
        setStatus('processing')
        const uri = await stopRecorder()
        if (take !== takeRef.current) return
        if (!uri) {
            setStatus('idle')
            return
        }
        await process({ uri, durationMs: liveRef.current.durationMs, levels: levelsRef.current })
    }, [stopRecorder, process])

    useEffect(() => {
        senderRef.current = sender
        finishRef.current = () => void finish()
    })

    useEffect(() => {
        if (status !== 'recording') return
        const timer = setInterval(() => {
            const { metering, durationMillis } = recorder.getStatus()
            const level = levelOf(metering)
            levelsRef.current.push(level)
            liveRef.current = { level, durationMs: durationMillis }
            if (durationMillis >= MAX_RECORDING_MS) {
                clearInterval(timer)
                finishRef.current()
            }
        }, SAMPLE_MS)
        return () => clearInterval(timer)
    }, [status, recorder])

    const start = useCallback(async () => {
        const take = ++takeRef.current
        setStatus('starting')
        const { granted } = await requestRecordingPermissionsAsync()
        if (!granted) {
            setStatus('idle')
            return false
        }
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
        await recorder.prepareToRecordAsync()
        if (take !== takeRef.current) {
            await setAudioModeAsync({ allowsRecording: false })
            return false
        }
        recorder.record()
        levelsRef.current = []
        liveRef.current = { level: 0, durationMs: 0 }
        setStatus('recording')
        return true
    }, [recorder])

    const retry = useCallback(() => {
        const pending = pendingRef.current
        if (pending) void process(pending)
    }, [process])

    const discard = useCallback(async () => {
        takeRef.current++
        const wasRecording = status === 'recording'
        pendingRef.current = null
        setError(null)
        setStatus('idle')
        if (wasRecording) await stopRecorder()
    }, [status, stopRecorder])

    const getLiveState = useCallback(() => liveRef.current, [])

    return { status, error, getLiveState, start, finish, retry, discard }
}
