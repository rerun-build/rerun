'use client'

import { VoiceRecorderBar } from '@/components/chat/VoiceRecorderBar'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { usePushToTalk } from '@/hooks/usePushToTalk'
import { useVoiceRecorder } from '@/hooks/useVoiceRecorder'
import { desktopShell } from '@/lib/desktop-shell/client'
import { handOverQuickAsk, QUICK_ASK_MAX_LENGTH } from '@/lib/desktop-shell/quick-ask'
import { shouldPushToTalk } from '@/lib/foreman/push-to-talk'
import { CheckIcon, MicIcon, XIcon } from '@/lib/icons'
import { transcribeVoiceRecording } from '@/lib/voice/client'
import { Badge } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'

type Step = 'text' | 'listening' | 'transcribing' | 'sent' | 'micDenied'
// `hold`: Space held in the field, letting go sends. `toggle`: the voice shortcut, pressed again (or
// Enter) to send.
type ListenMode = 'hold' | 'toggle'

// Long enough to read "Sent", short enough not to wait for it.
const SENT_MS = 900

// Keeps the window up while it listens: the system's microphone prompt takes the focus from it.
function holdWindow(busy: boolean) {
    desktopShell('quickAskVoice')?.quickAsk.hold(busy)
}

// One field for the Chief of Staff, over whatever the person is doing. Enter sends: the text is handed
// to the main window, which opens a new conversation with it; Escape puts the window away. Space held
// in the empty field records the question instead, and letting go sends its transcript; the voice
// shortcut opens the window listening, and a second press sends.
export function QuickAskComposer() {
    const t = useTranslations('desktopShell.quickAsk')
    const field = useRef<HTMLTextAreaElement>(null)
    const [text, setText] = useState('')
    const [step, setStep] = useState<Step>('text')
    const [notice, setNotice] = useState<string | null>(null)
    const [mode, setMode] = useState<ListenMode>('hold')
    const textRef = useRef(text)
    useEffect(() => {
        textRef.current = text
    })

    useEffect(() => {
        if (step !== 'text') return
        const focus = () => field.current?.focus()
        focus()
        window.addEventListener('focus', focus)
        return () => window.removeEventListener('focus', focus)
    }, [step])

    const handOver = useCallback((message: string) => {
        const shell = desktopShell('quickAsk')
        if (!shell) return
        handOverQuickAsk(message)
        shell.quickAsk.sent('/')
    }, [])

    const finishRef = useRef<() => void>(() => {})
    const recorder = useVoiceRecorder({
        onError: (message, reason) => {
            setStep(reason === 'denied' ? 'micDenied' : 'text')
            if (reason !== 'denied') setNotice(message)
            holdWindow(false)
        },
        onLimitReached: () => finishRef.current(),
    })
    const { start, stop, cancel } = recorder

    const listen = useCallback((how: ListenMode) => {
        setNotice(null)
        setMode(how)
        setStep('listening')
        holdWindow(true)
        void start()
    }, [start])

    // Escape while a recording is written out moves this on: its transcript is no longer wanted.
    const transcription = useRef(0)

    const finish = useCallback(async () => {
        const wanted = ++transcription.current
        setStep('transcribing')
        try {
            // Null when Space was let go before the microphone came up: there is nothing to send.
            const recording = await stop()
            const transcript = recording ? await transcribeVoiceRecording(recording.blob, recording.format.transcriptionFormat) : ''
            if (wanted !== transcription.current) return
            if (!transcript) {
                setNotice(t('nothingHeard'))
                setStep('text')
                holdWindow(false)
                return
            }
            setStep('sent')
            setTimeout(() => {
                handOver(transcript)
                setStep('text')
            }, SENT_MS)
        } catch {
            if (wanted !== transcription.current) return
            setNotice(t('transcriptionFailed'))
            setStep('text')
            holdWindow(false)
        }
    }, [stop, t, handOver])

    useEffect(() => {
        finishRef.current = () => void finish()
    })

    // Also reached when the hold ends because the step moved on (the microphone was refused): only
    // a recording in progress goes back to the field.
    const abort = useCallback(() => {
        cancel()
        setStep(current => (current === 'listening' ? 'text' : current))
        holdWindow(false)
    }, [cancel])

    usePushToTalk({
        enabled: step === 'text' || (step === 'listening' && mode === 'hold'),
        accepts: event => !textRef.current && shouldPushToTalk(event, { focusHeld: false, overlayOpen: false }),
        onStart: () => listen('hold'),
        onRelease: () => void finish(),
        onAbort: abort,
    })

    const voiceShortcut = useRef<() => void>(() => {})
    useEffect(() => {
        voiceShortcut.current = () => {
            if (step === 'text' || step === 'micDenied') listen('toggle')
            else if (step === 'listening' && mode === 'toggle') void finish()
        }
    })
    useEffect(() => desktopShell('quickAskVoiceShortcut')?.quickAsk.onShortcut(kind => kind === 'voice' && voiceShortcut.current()), [])

    // The shell put the window away (the text shortcut, the tray, a click elsewhere): nothing keeps
    // listening behind it, and it comes back on its field. The shell has to say so, a window it
    // hides does not get `visibilitychange`.
    const putAway = useRef<() => void>(() => {})
    useEffect(() => {
        putAway.current = () => {
            if (step === 'listening') abort()
            else if (step === 'micDenied') setStep('text')
        }
    })
    useEffect(() => desktopShell('quickAskVoiceShortcut')?.quickAsk.onHidden(() => putAway.current()), [])

    useEffect(() => {
        if (step !== 'transcribing' && step !== 'micDenied') return
        const onKeyDown = (event: globalThis.KeyboardEvent) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            if (step === 'micDenied') {
                desktopShell('quickAsk')?.quickAsk.close()
                return
            }
            transcription.current++
            setStep('text')
            holdWindow(false)
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [step])

    useEffect(() => {
        if (step !== 'listening' || mode !== 'toggle') return
        const onKeyDown = (event: globalThis.KeyboardEvent) => {
            if (event.key === 'Enter') {
                event.preventDefault()
                void finish()
            }
            if (event.key === 'Escape') {
                event.preventDefault()
                abort()
            }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [step, mode, finish, abort])

    const send = () => {
        const message = text.trim()
        if (!message || !desktopShell('quickAsk')) return
        handOver(message)
        // Only what was typed leaves the field: a draft outlives a question asked out loud.
        setText('')
    }

    const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === 'Escape') {
            event.preventDefault()
            desktopShell('quickAsk')?.quickAsk.close()
        }
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            send()
        }
    }

    const microphoneSettings = desktopShell('quickAskVoice')
    const canOpenSettings = microphoneSettings !== null && microphoneSettings.platform !== 'linux'

    return (
        <main data-quick-ask data-step={step} className="flex h-dvh w-full items-stretch p-2">
            <div className="flex w-full flex-col gap-2 rounded-2xl border bg-popover p-3 text-popover-foreground shadow-2xl">
                {step === 'text' && (
                    <>
                        <textarea
                            ref={field}
                            value={text}
                            onChange={event => {
                                setText(event.target.value)
                                setNotice(null)
                            }}
                            onKeyDown={onKeyDown}
                            maxLength={QUICK_ASK_MAX_LENGTH}
                            placeholder={t('placeholder')}
                            aria-label={t('placeholder')}
                            className="min-h-0 flex-1 resize-none bg-transparent text-base outline-none placeholder:text-muted-foreground"
                        />
                        <div className="flex items-center justify-between gap-2">
                            {notice ? (
                                <span role="status" className="truncate text-xs text-muted-foreground">
                                    {notice}
                                </span>
                            ) : (
                                <span className="flex min-w-0 items-center gap-2 truncate text-xs text-muted-foreground">
                                    <span className="truncate">{t('hint')}</span>
                                    {!text && (
                                        <span className="flex shrink-0 items-center gap-1">
                                            {t.rich('holdToTalk', {
                                                key: chunks => (
                                                    <Kbd className="h-5 gap-1 px-1 font-sans text-[11px]">
                                                        <MicIcon className="size-2.5" />
                                                        {chunks}
                                                    </Kbd>
                                                ),
                                            })}
                                        </span>
                                    )}
                                </span>
                            )}
                            <Button size="sm" onClick={send} disabled={!text.trim()}>
                                {t('send')}
                            </Button>
                        </div>
                    </>
                )}

                {(step === 'listening' || step === 'transcribing') && (
                    <>
                        <div className="flex min-h-0 flex-1 items-center">
                            <VoiceRecorderBar status={step === 'transcribing' ? 'transcribing' : recorder.status === 'recording' ? 'recording' : 'starting'} stream={recorder.stream} getLiveState={recorder.getLiveState} />
                        </div>
                        <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-xs text-muted-foreground">{step === 'listening' ? (mode === 'toggle' ? t('toggleHint') : t('releaseToSend')) : ''}</span>
                            <span className="flex shrink-0 items-center gap-1">
                                {step === 'listening' && mode === 'toggle' && (
                                    <Button size="icon-sm" variant="ghost" aria-label={t('cancel')} onClick={abort}>
                                        <XIcon />
                                    </Button>
                                )}
                                <Button size="sm" disabled={step !== 'listening' || mode !== 'toggle'} onClick={() => void finish()}>
                                    {t('send')}
                                </Button>
                            </span>
                        </div>
                    </>
                )}

                {step === 'sent' && (
                    <div role="status" className="flex flex-1 items-center justify-center">
                        <Badge tone="brand" size="md" leading={<CheckIcon className="size-4" />}>
                            {t('sent')}
                        </Badge>
                    </div>
                )}

                {step === 'micDenied' && (
                    <>
                        <div className="flex min-h-0 flex-1 flex-col justify-center gap-1">
                            <span className="text-sm font-medium">{t('micDeniedTitle')}</span>
                            <span className="text-sm text-muted-foreground">{t('micDeniedBody')}</span>
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-2">
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                    holdWindow(false)
                                    setStep('text')
                                }}
                            >
                                {t('typeInstead')}
                            </Button>
                            {canOpenSettings && (
                                <Button
                                    size="sm"
                                    onClick={() => {
                                        holdWindow(false)
                                        void microphoneSettings?.quickAsk.openMicrophoneSettings()
                                    }}
                                >
                                    {t('openSettings')}
                                </Button>
                            )}
                        </div>
                    </>
                )}
            </div>
        </main>
    )
}
