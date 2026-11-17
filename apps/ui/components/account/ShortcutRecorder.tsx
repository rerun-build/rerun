'use client'

import { Kbd } from '@/components/ui/kbd'
import { acceleratorKeycaps, modifierKeycaps, primaryModifierKeycap, readRecordedKeys, shortcutKeycaps, shortcutProblem, type ShortcutOwner } from '@/lib/desktop-shell/shortcut'
import { cn } from '@/lib/utils'
import { formatAccelerator, type DesktopShellPlatform, type ShortcutModifier } from '@rerun/contracts'
import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'

export type ShortcutChangeStatus = 'ok' | 'taken' | 'invalid'

type ShortcutRecorderProps = {
    id?: string
    value: string | null
    platform: DesktopShellPlatform
    // While true, the desktop app keeps the current shortcut from firing.
    onRecordingChange: (recording: boolean) => void
    onChange: (accelerator: string | null) => Promise<ShortcutChangeStatus>
}

type Problem = { kind: 'needsModifier' } | { kind: 'reserved'; keys: string; owner: ShortcutOwner } | { kind: 'taken'; keys: string }

/** A field that shows a global shortcut as keycaps; clicked, it records the next one. ⌫ clears it. */
export function ShortcutRecorder({ id, value, platform, onRecordingChange, onChange }: ShortcutRecorderProps) {
    const t = useTranslations('desktopShell.settings.shortcut')
    const [recording, setRecording] = useState(false)
    const [held, setHeld] = useState<ShortcutModifier[]>([])
    const [problem, setProblem] = useState<Problem | null>(null)
    const saving = useRef(false)
    const callbacks = useRef({ onRecordingChange, onChange })
    useEffect(() => {
        callbacks.current = { onRecordingChange, onChange }
    })

    useEffect(() => {
        if (!recording) return
        const stop = () => {
            setRecording(false)
            setHeld([])
            setProblem(null)
            callbacks.current.onRecordingChange(false)
        }
        const save = async (accelerator: string | null, keys: string) => {
            saving.current = true
            const status = await callbacks.current.onChange(accelerator)
            saving.current = false
            if (status === 'ok') return stop()
            setHeld([])
            setProblem(status === 'taken' ? { kind: 'taken', keys } : { kind: 'needsModifier' })
            // The desktop app put the previous shortcut back when it answered: keep it quiet while recording goes on.
            callbacks.current.onRecordingChange(true)
        }
        const onKeyDown = (event: KeyboardEvent) => {
            event.preventDefault()
            event.stopPropagation()
            if (saving.current || event.repeat) return
            const read = readRecordedKeys(event, platform)
            if (read.kind === 'cancel') return stop()
            if (read.kind === 'clear') return void save(null, '')
            if (read.kind === 'held') return setHeld(read.modifiers)
            const keys = shortcutKeycaps(read.shortcut, platform).join(' ')
            const found = shortcutProblem(read.shortcut, platform)
            if (found) {
                setHeld([])
                setProblem(found.problem === 'reserved' ? { kind: 'reserved', keys, owner: found.owner } : { kind: 'needsModifier' })
                return
            }
            void save(formatAccelerator(read.shortcut), keys)
        }
        const onKeyUp = (event: KeyboardEvent) => {
            if (saving.current) return
            const read = readRecordedKeys(event, platform)
            setHeld(read.kind === 'held' ? read.modifiers : [])
        }
        window.addEventListener('keydown', onKeyDown, true)
        window.addEventListener('keyup', onKeyUp, true)
        return () => {
            window.removeEventListener('keydown', onKeyDown, true)
            window.removeEventListener('keyup', onKeyUp, true)
        }
    }, [recording, platform])

    // Leaving the dialog mid-recording gives the shortcut back at once.
    useEffect(() => () => callbacks.current.onRecordingChange(false), [])

    const start = () => {
        if (recording) return
        setProblem(null)
        setHeld([])
        setRecording(true)
        onRecordingChange(true)
    }

    const cancel = () => {
        if (!recording || saving.current) return
        setRecording(false)
        setHeld([])
        setProblem(null)
        onRecordingChange(false)
    }

    const caps = value ? acceleratorKeycaps(value, platform) : []
    const problemText =
        problem?.kind === 'needsModifier'
            ? t('needsModifier', { key: primaryModifierKeycap(platform) })
            : problem?.kind === 'reserved'
              ? t('reserved', { keys: problem.keys, owner: problem.owner })
              : problem?.kind === 'taken'
                ? t('taken', { keys: problem.keys })
                : null

    return (
        <span className="flex max-w-full flex-col items-end gap-1">
            <button
                id={id}
                type="button"
                onClick={start}
                onBlur={cancel}
                aria-label={recording ? t('typing') : value ? t('change', { keys: caps.join(' ') }) : t('record')}
                aria-describedby={problemText && id ? `${id}-problem` : undefined}
                className={cn(
                    'flex h-8 min-w-36 max-w-full items-center justify-center gap-1 rounded-md border bg-background px-2 text-sm outline-none transition-[border-color,box-shadow]',
                    'hover:border-foreground/30 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
                    recording && !problem && 'border-ring ring-[3px] ring-ring/50',
                    problem && 'border-destructive ring-[3px] ring-destructive/20 focus-visible:border-destructive focus-visible:ring-destructive/20'
                )}
            >
                {recording ? (
                    held.length > 0 ? (
                        <Keycaps caps={modifierKeycaps(held, platform)} />
                    ) : (
                        <span className="truncate text-muted-foreground">{problem ? t('tryAnother') : t('typing')}</span>
                    )
                ) : caps.length > 0 ? (
                    <Keycaps caps={caps} />
                ) : (
                    <span className="truncate text-muted-foreground">{t('record')}</span>
                )}
            </button>
            {problemText ? (
                <span id={id ? `${id}-problem` : undefined} role="alert" className="text-right text-xs text-destructive">
                    {problemText}
                </span>
            ) : (
                recording && <span className="text-right text-xs text-muted-foreground">{t('recordingHint')}</span>
            )}
        </span>
    )
}

function Keycaps({ caps }: { caps: string[] }) {
    return (
        <span className="flex items-center gap-1">
            {caps.map((cap, index) => (
                <Kbd key={`${cap}-${index}`} className="h-5 min-w-5 px-1 font-sans text-[11px]">
                    {cap}
                </Kbd>
            ))}
        </span>
    )
}
