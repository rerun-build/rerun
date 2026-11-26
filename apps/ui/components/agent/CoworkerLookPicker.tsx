'use client'

import { Button } from '@/components/ui/button'
import { ColorPicker } from '@/components/ui/color-picker'
import { Field } from '@/components/ui/field'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { HistoryIcon, PlusIcon, RefreshCwIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { COWORKER_EYES, COWORKER_MATERIALS, COWORKER_MOUTHS, COWORKER_PALETTE, coworkerColorDistance, type CoworkerLook } from '@rerun/contracts'
import { AgentBuddy, BUDDY_FACE_CENTER, BUDDY_GEOMETRY, BuddyFace, hashedBuddyLook } from '@rerun/ui/iso-grid'
import { BUDDY_STATE_COLOR } from '@rerun/ui/iso-grid/buddy-look'
import { useTranslations } from 'next-intl'
import { useId, useState, type CSSProperties, type ReactNode } from 'react'

type ColorName = 'sky' | 'blue' | 'indigo' | 'violet' | 'purple' | 'pink' | 'rose' | 'orange' | 'brown' | 'lime' | 'green' | 'teal' | 'graphite'

// From cold to warm, the way the eye reads a row of swatches: two rows of seven with the free colour.
// Keyed by the palette, so a colour added to it without its swatch does not compile.
const SWATCH_NAMES = {
    '#2b9bf4': 'sky',
    '#0f52ff': 'blue',
    '#3b32e8': 'indigo',
    '#7a2cf5': 'violet',
    '#a81fe0': 'purple',
    '#e935c1': 'pink',
    '#f0127f': 'rose',
    '#ff6a13': 'orange',
    '#8d5a3b': 'brown',
    '#4fb800': 'lime',
    '#00b862': 'green',
    '#0e9f8e': 'teal',
    '#5d6778': 'graphite',
} satisfies Record<(typeof COWORKER_PALETTE)[number], ColorName>
const SWATCHES = Object.entries(SWATCH_NAMES).map(([color, name]) => ({ color, name }))

const PALETTE = new Set<string>(COWORKER_PALETTE)
const RAINBOW = 'conic-gradient(from 180deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)'

// Under this distance a body in the colour and one in a state's read as the same at board size.
const STATE_TOO_CLOSE = 0.085
const STATES = ['working', 'error', 'waiting'] as const
type State = (typeof STATES)[number]

function stateTooClose(color: string): State | null {
    let closest: { state: State; distance: number } | null = null
    for (const state of STATES) {
        const distance = coworkerColorDistance(color, BUDDY_STATE_COLOR[state])
        if (distance < STATE_TOO_CLOSE && (!closest || distance < closest.distance)) closest = { state, distance }
    }
    return closest?.state ?? null
}

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

type SectionProps = { agentId: string; look: CoworkerLook; choose: (patch: Partial<CoworkerLook>) => void; disabled?: boolean }

function ColorChoices({ look, choose, disabled }: SectionProps) {
    const t = useTranslations('agent.coworkerLook')
    const { color } = look
    const custom = !PALETTE.has(color)
    const [pickerOpen, setPickerOpen] = useState(custom)
    const tooClose = stateTooClose(color)
    const swatchClass = (selected: boolean) =>
        cn('relative size-8 justify-self-center rounded-full ring-offset-2 ring-offset-(--look-surface) transition-shadow disabled:pointer-events-none disabled:opacity-60', selected ? 'ring-2 ring-foreground' : 'hover:ring-2 hover:ring-foreground/30')

    return (
        <div className="flex flex-col gap-3">
            <div className="grid grid-cols-7 gap-y-2.5">
                {SWATCHES.map(swatch => {
                    const label = t(`colors.${swatch.name}`)
                    return (
                        <button
                            key={swatch.color}
                            type="button"
                            aria-label={label}
                            title={label}
                            aria-pressed={color === swatch.color}
                            disabled={disabled}
                            onClick={() => choose({ color: swatch.color })}
                            className={swatchClass(color === swatch.color)}
                            style={{ background: swatch.color }}
                        />
                    )
                })}
                <button
                    type="button"
                    aria-label={t('customColor')}
                    title={t('customColor')}
                    aria-expanded={pickerOpen}
                    aria-pressed={custom}
                    disabled={disabled}
                    onClick={() => setPickerOpen(open => !open)}
                    className={cn(swatchClass(custom), 'flex items-center justify-center p-[3px]')}
                    style={{ background: RAINBOW }}
                >
                    <span className="flex size-full items-center justify-center rounded-full" style={{ background: custom ? color : 'var(--look-surface)' }}>
                        {!custom && <PlusIcon className="size-3.5 text-foreground" />}
                    </span>
                </button>
            </div>
            {pickerOpen && <ColorPicker value={color} onChange={next => choose({ color: next })} disabled={disabled} />}
            {tooClose && (
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <span className="mt-0.5 size-2.5 shrink-0 rounded-full" style={{ background: BUDDY_STATE_COLOR[tooClose] }} />
                    <span>{t(`tooClose.${tooClose}`)}</span>
                </p>
            )}
        </div>
    )
}

function MaterialChoices({ agentId, look, choose, disabled, size }: SectionProps & { size: number }) {
    const t = useTranslations('agent.coworkerLook')
    return (
        <div className="grid grid-cols-5 gap-1.5">
            {COWORKER_MATERIALS.map(material => (
                <Choice key={material} label={t(`materialOptions.${material}`)} selected={(look.material ?? 'classic') === material} disabled={disabled} onClick={() => choose({ material })}>
                    <AgentBuddy agentId={agentId} look={{ ...look, material }} size={size} animated={false} />
                </Choice>
            ))}
        </div>
    )
}

function EyesChoices({ look, choose, disabled }: SectionProps) {
    const t = useTranslations('agent.coworkerLook')
    return (
        <div className="grid grid-cols-6 gap-1.5">
            {COWORKER_EYES.map(eyes => (
                <Choice key={eyes} label={t(`eyesOptions.${eyes}`)} selected={look.eyes === eyes} disabled={disabled} onClick={() => choose({ eyes })}>
                    <FaceSwatch look={{ ...look, eyes }} />
                </Choice>
            ))}
        </div>
    )
}

function MouthChoices({ look, choose, disabled }: SectionProps) {
    const t = useTranslations('agent.coworkerLook')
    return (
        <div className="grid grid-cols-6 gap-1.5">
            {COWORKER_MOUTHS.map(mouth => (
                <Choice key={mouth} label={t(`mouthOptions.${mouth}`)} selected={look.mouth === mouth} disabled={disabled} onClick={() => choose({ mouth })}>
                    <FaceSwatch look={{ ...look, mouth }} />
                </Choice>
            ))}
        </div>
    )
}

type CoworkerLookPickerProps = {
    // The coworker: the look it wears while `look` is null is hashed from it.
    agentId: string
    look: CoworkerLook | null
    onChange: (look: CoworkerLook | null) => void
    disabled?: boolean
    // `stacked` shows everything under a preview of its own; `tabs` keeps a popover short and leaves
    // the preview to the buddy it dresses, right above it.
    layout?: 'stacked' | 'tabs'
}

// The colour, the material, the eyes and the mouth of a coworker's buddy. `--look-surface` is what
// the swatches stand on, for the gap of their selection ring. Each material is the buddy
// itself made of it, and each face is drawn in the colour chosen, so a choice is read on the buddy
// it will be.
export function CoworkerLookPicker({ agentId, look, onChange, disabled, layout = 'stacked' }: CoworkerLookPickerProps) {
    const t = useTranslations('agent.coworkerLook')
    const shown = look ?? hashedBuddyLook(agentId)
    const section: SectionProps = { agentId, look: shown, choose: patch => onChange({ ...shown, ...patch }), disabled }
    const actions = (
        <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onChange({ eyes: pick(COWORKER_EYES), mouth: pick(COWORKER_MOUTHS), color: pick(COWORKER_PALETTE), material: pick(COWORKER_MATERIALS) })}>
                <RefreshCwIcon className="size-3.5" />
                {t('shuffle')}
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={disabled || look === null} onClick={() => onChange(null)}>
                <HistoryIcon className="size-3.5" />
                {t('reset')}
            </Button>
        </div>
    )

    if (layout === 'tabs') {
        return (
            <Tabs defaultValue="color" className="flex w-full flex-col gap-3" style={{ '--look-surface': 'var(--popover)' } as CSSProperties}>
                <TabsList className="w-full">
                    <TabsTrigger value="color" className="flex-1">
                        {t('color')}
                    </TabsTrigger>
                    <TabsTrigger value="material" className="flex-1">
                        {t('material')}
                    </TabsTrigger>
                    <TabsTrigger value="face" className="flex-1">
                        {t('face')}
                    </TabsTrigger>
                </TabsList>
                <TabsContent value="color">
                    <ColorChoices {...section} />
                </TabsContent>
                <TabsContent value="material">
                    <MaterialChoices {...section} size={44} />
                </TabsContent>
                <TabsContent value="face" className="flex flex-col gap-3">
                    <EyesChoices {...section} />
                    <MouthChoices {...section} />
                </TabsContent>
                {actions}
            </Tabs>
        )
    }

    return (
        <div className="flex w-full flex-col gap-4" style={{ '--look-surface': 'var(--background)' } as CSSProperties}>
            <div className="flex flex-wrap items-center gap-4">
                <div className="flex shrink-0 items-center justify-center rounded-xl bg-muted/50 p-2">
                    <AgentBuddy agentId={agentId} look={shown} size={80} alive />
                </div>
                {actions}
            </div>
            <Field label={t('color')}>
                <ColorChoices {...section} />
            </Field>
            <Field label={t('material')}>
                <MaterialChoices {...section} size={52} />
            </Field>
            <Field label={t('eyes')}>
                <EyesChoices {...section} />
            </Field>
            <Field label={t('mouth')}>
                <MouthChoices {...section} />
            </Field>
        </div>
    )
}
