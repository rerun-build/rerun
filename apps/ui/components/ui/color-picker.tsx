'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'

import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type Hsv = { h: number; s: number; v: number }

function hexToHsv(hex: string): Hsv {
    const [r, g, b] = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
    const max = Math.max(r, g, b)
    const delta = max - Math.min(r, g, b)
    let h = 0
    if (delta) {
        if (max === r) h = ((g - b) / delta) % 6
        else if (max === g) h = (b - r) / delta + 2
        else h = (r - g) / delta + 4
    }
    return { h: (h * 60 + 360) % 360, s: max ? delta / max : 0, v: max }
}

function hsvToHex({ h, s, v }: Hsv) {
    const channel = (n: number) => {
        const k = (n + h / 60) % 6
        return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255)
    }
    return `#${[5, 3, 1].map(n => channel(n).toString(16).padStart(2, '0')).join('')}`
}

// `ff7a00`, `#FF7A00` or `#f70` become `#ff7a00`; anything else is not a colour yet.
function normalizeHex(input: string) {
    const raw = input.trim().replace(/^#/, '').toLowerCase()
    if (/^[0-9a-f]{3}$/.test(raw)) return `#${[...raw].map(char => char + char).join('')}`
    if (/^[0-9a-f]{6}$/.test(raw)) return `#${raw}`
    return null
}

const FULL_HEX = /^#?[0-9a-f]{6}$/i

const clamp = (value: number) => Math.min(1, Math.max(0, value))

// The pointer is captured so a drag keeps going outside the area.
function useDrag(onMove: (x: number, y: number) => void) {
    const ref = useRef<HTMLDivElement>(null)
    const move = (event: PointerEvent<HTMLDivElement>) => {
        const box = ref.current?.getBoundingClientRect()
        if (box) onMove(clamp((event.clientX - box.left) / box.width), clamp((event.clientY - box.top) / box.height))
    }
    return {
        ref,
        onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            move(event)
        },
        onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) move(event)
        },
    }
}

const STEP = 0.02
const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-STEP, 0], ArrowRight: [STEP, 0], ArrowUp: [0, -STEP], ArrowDown: [0, STEP] }

function onArrows(event: KeyboardEvent, apply: (dx: number, dy: number) => void) {
    const delta = ARROWS[event.key]
    if (!delta) return
    event.preventDefault()
    const boost = event.shiftKey ? 5 : 1
    apply(delta[0] * boost, delta[1] * boost)
}

const THUMB = 'pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.35),0_2px_6px_rgba(0,0,0,0.35)]'

type ColorPickerProps = {
    // `#rrggbb`.
    value: string
    onChange: (hex: string) => void
    disabled?: boolean
    className?: string
}

// Saturation and brightness in a square, the hue on a rail, the hex to paste one: every move is sent
// as it happens, so what it colours follows the drag.
export function ColorPicker({ value, onChange, disabled, className }: ColorPickerProps) {
    const t = useTranslations('ui.colorPicker')
    const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value))
    const [draft, setDraft] = useState(value)
    const lastSent = useRef(value)

    useEffect(() => {
        if (value === lastSent.current) return
        lastSent.current = value
        setHsv(hexToHsv(value))
        setDraft(value)
    }, [value])

    const send = (next: Hsv) => {
        setHsv(next)
        const hex = hsvToHex(next)
        lastSent.current = hex
        onChange(hex)
        return hex
    }
    const apply = (next: Hsv) => setDraft(send(next))

    // While typing, only a whole `#rrggbb` is sent and the field keeps what was typed: `0e9` is the
    // start of `0e9f8e`, not `#00ee99`. The short form is read once the field is left.
    const commitDraft = () => {
        const hex = normalizeHex(draft)
        if (hex) apply(hexToHsv(hex))
        else setDraft(current)
    }

    const area = useDrag((x, y) => apply({ ...hsv, s: x, v: 1 - y }))
    const rail = useDrag(x => apply({ ...hsv, h: x * 359.9 }))
    const current = hsvToHex(hsv)
    const pureHue = `hsl(${hsv.h} 100% 50%)`

    return (
        <div className={cn('flex flex-col gap-3', disabled && 'pointer-events-none opacity-60', className)}>
            <div
                {...area}
                role="slider"
                tabIndex={disabled ? -1 : 0}
                aria-label={t('saturationBrightness')}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(hsv.s * 100)}
                aria-valuetext={t('saturationBrightnessValue', { saturation: Math.round(hsv.s * 100), brightness: Math.round(hsv.v * 100) })}
                onKeyDown={event => onArrows(event, (dx, dy) => apply({ ...hsv, s: clamp(hsv.s + dx), v: clamp(hsv.v - dy) }))}
                className="relative h-36 w-full cursor-crosshair touch-none rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${pureHue})` }}
            >
                <span className={THUMB} style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: current }} />
            </div>
            <div
                {...rail}
                role="slider"
                tabIndex={disabled ? -1 : 0}
                aria-label={t('hue')}
                aria-valuemin={0}
                aria-valuemax={360}
                aria-valuenow={Math.round(hsv.h)}
                onKeyDown={event => onArrows(event, dx => apply({ ...hsv, h: Math.min(359.9, Math.max(0, hsv.h + dx * 360)) }))}
                className="relative h-3 w-full cursor-pointer touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={{ background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' }}
            >
                <span className={cn(THUMB, 'top-1/2')} style={{ left: `${(hsv.h / 360) * 100}%`, background: pureHue }} />
            </div>
            <div className="flex items-center gap-2">
                <span className="size-8 shrink-0 rounded-md ring-1 ring-foreground/10" style={{ background: current }} />
                <div className="min-w-0 flex-1">
                    <Input
                        aria-label={t('hex')}
                        hideRequired
                        value={draft}
                        spellCheck={false}
                        maxLength={7}
                        disabled={disabled}
                        onChange={event => {
                            setDraft(event.target.value)
                            const hex = FULL_HEX.test(event.target.value.trim()) && normalizeHex(event.target.value)
                            if (hex) send(hexToHsv(hex))
                        }}
                        onKeyDown={event => event.key === 'Enter' && commitDraft()}
                        onBlur={commitDraft}
                        className="h-8 font-mono text-xs uppercase"
                    />
                </div>
            </div>
        </div>
    )
}
