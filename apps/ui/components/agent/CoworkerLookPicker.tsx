'use client'

import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { HistoryIcon, RefreshCwIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { COWORKER_COLORS, COWORKER_EYES, COWORKER_MOUTHS, type CoworkerLook } from '@rerun/contracts'
import { AgentBuddy, BUDDY_FACE_CENTER, BUDDY_GEOMETRY, BuddyFace, hashedBuddyLook } from '@rerun/ui/iso-grid'
import { useTranslations } from 'next-intl'
import { useId, type ReactNode } from 'react'

type CoworkerColor = CoworkerLook['color']

const COLOR_NAMES: Record<CoworkerColor, 'blue' | 'lime' | 'rose' | 'violet' | 'pink' | 'indigo' | 'green' | 'purple'> = {
    '#0f52ff': 'blue',
    '#4fb800': 'lime',
    '#f0127f': 'rose',
    '#7a2cf5': 'violet',
    '#e935c1': 'pink',
    '#3b32e8': 'indigo',
    '#00b862': 'green',
    '#a81fe0': 'purple',
}
// From cold to warm, the way the eye reads a row of swatches.
const SWATCH_ORDER: CoworkerColor[] = ['#0f52ff', '#3b32e8', '#7a2cf5', '#a81fe0', '#e935c1', '#f0127f', '#4fb800', '#00b862']

const pick = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)]

const FACE_SIDE = 22
const FACE_DEPTH = BUDDY_GEOMETRY.depth

// The face alone, cut out of the buddy's wall: in a picker cell a whole block leaves its eyes a few
// pixels wide. The band on top is the colour its top wears.
function FaceSwatch({ look }: { look: CoworkerLook }) {
    const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
    return (
        <span className="flex size-full flex-col overflow-hidden rounded-md" style={{ background: 'var(--iso-buddy-mascot-body)' }}>
            <span className="h-[18%] shrink-0" style={{ background: look.color }} />
            <svg viewBox={`${BUDDY_FACE_CENTER - FACE_SIDE / 2} ${FACE_DEPTH / 2 - FACE_SIDE / 2} ${FACE_SIDE} ${FACE_SIDE}`} className="min-h-0 flex-1" aria-hidden>
                <BuddyFace uid={uid} eyes={look.eyes} mouth={look.mouth} mood="idle" depth={FACE_DEPTH} light={`color-mix(in srgb, ${look.color}, white 35%)`} lit tint={look.color} />
            </svg>
        </span>
    )
}

function Choice({ selected, label, disabled, onClick, children }: { selected: boolean; label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            aria-pressed={selected}
            disabled={disabled}
            onClick={onClick}
            className={cn('flex aspect-square items-center justify-center rounded-lg bg-muted/50 p-1 transition-colors disabled:pointer-events-none disabled:opacity-60', selected ? 'bg-brand/10 ring-2 ring-brand' : 'hover:bg-muted')}
        >
            {children}
        </button>
    )
}

type CoworkerLookPickerProps = {
    // The coworker, or the draft of one: the look it wears while `look` is null is hashed from it.
    agentId: string
    look: CoworkerLook | null
    onChange: (look: CoworkerLook | null) => void
    disabled?: boolean
    previewSize?: number
}

// The colour, the eyes and the mouth of a coworker's buddy, all in view under a preview of it. Each
// face is drawn in the colour chosen, so a choice is read on the face it will be.
export function CoworkerLookPicker({ agentId, look, onChange, disabled, previewSize = 64 }: CoworkerLookPickerProps) {
    const t = useTranslations('agent.coworkerLook')
    const shown = look ?? hashedBuddyLook(agentId)
    const choose = (patch: Partial<CoworkerLook>) => onChange({ ...shown, ...patch })

    return (
        <div className="flex w-full flex-col gap-4">
            <div className="flex flex-wrap items-center gap-4">
                <div className="flex shrink-0 items-center justify-center rounded-xl bg-muted/50 p-2">
                    <AgentBuddy agentId={agentId} look={shown} size={previewSize} alive />
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onChange({ eyes: pick(COWORKER_EYES), mouth: pick(COWORKER_MOUTHS), color: pick(COWORKER_COLORS) })}>
                        <RefreshCwIcon className="size-3.5" />
                        {t('shuffle')}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" disabled={disabled || look === null} onClick={() => onChange(null)}>
                        <HistoryIcon className="size-3.5" />
                        {t('reset')}
                    </Button>
                </div>
            </div>
            <Field label={t('color')}>
                <div className="flex flex-wrap gap-2">
                    {SWATCH_ORDER.map(color => {
                        const selected = shown.color === color
                        const label = t(`colors.${COLOR_NAMES[color]}`)
                        return (
                            <button
                                key={color}
                                type="button"
                                aria-label={label}
                                title={label}
                                aria-pressed={selected}
                                disabled={disabled}
                                onClick={() => choose({ color })}
                                className={cn('size-7 rounded-full ring-offset-2 ring-offset-background transition-shadow disabled:pointer-events-none disabled:opacity-60', selected ? 'ring-2 ring-foreground' : 'hover:ring-2 hover:ring-foreground/30')}
                                style={{ backgroundColor: color }}
                            />
                        )
                    })}
                </div>
            </Field>
            <Field label={t('eyes')}>
                <div className="grid grid-cols-6 gap-1.5">
                    {COWORKER_EYES.map(eyes => (
                        <Choice key={eyes} label={t(`eyesOptions.${eyes}`)} selected={shown.eyes === eyes} disabled={disabled} onClick={() => choose({ eyes })}>
                            <FaceSwatch look={{ ...shown, eyes }} />
                        </Choice>
                    ))}
                </div>
            </Field>
            <Field label={t('mouth')}>
                <div className="grid grid-cols-6 gap-1.5">
                    {COWORKER_MOUTHS.map(mouth => (
                        <Choice key={mouth} label={t(`mouthOptions.${mouth}`)} selected={shown.mouth === mouth} disabled={disabled} onClick={() => choose({ mouth })}>
                            <FaceSwatch look={{ ...shown, mouth }} />
                        </Choice>
                    ))}
                </div>
            </Field>
        </div>
    )
}
