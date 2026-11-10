'use client'

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { HandIcon, TriangleAlertIcon } from '../../icons'
import { buddyFootprintShare, hashUnit } from '../iso'
import type { TileStyle } from '../types'
import { useKitTranslations } from '../../locale'
import { tileStatusLabel } from '../status-label'
import { BUDDY_GEOMETRY, BUDDY_VIEW, BuddyArt } from './buddy/BuddyArt'
import { BUDDY_STATE_COLOR, buddyColor, buddyLook, buddyMood, type BuddyMood } from './buddy/buddy-look'

// A tile drawn as a buddy standing on its footprint. What keeps it from looking pasted on is what
// it does to the floor: it lights a pool of its colour around it and presses a contact shadow
// right under its base.

// How far above the block's back corner the hand and lock badges float.
export const BUDDY_BADGE_GAP = 10

// Which moods move the block. The motion itself lives in styles.css, keyed on `data-buddy-motion`.
const MOTION: Partial<Record<BuddyMood, 'bob' | 'shudder'>> = { working: 'bob', error: 'shudder' }

const POOL_MOTION: Partial<Record<BuddyMood, string>> = {
    working: 'iso-buddy-pool 1.2s cubic-bezier(0.3, 0, 0.3, 1) infinite',
    waiting: 'iso-buddy-pool 1.6s ease-in-out infinite',
    error: 'iso-buddy-pool 1.2s ease-in-out infinite',
}

// A buddy carries one label. With a pinned status it rolls between the name and the status instead
// of stacking a second pill under the first.
const LABEL_ROW_HEIGHT = 14
const LABEL_ROW = 'flex h-[14px] items-center justify-center px-1.5'
const LABEL_PILL = 'iso-buddy-label overflow-hidden rounded-[5px] text-[7.5px] font-medium tracking-tight whitespace-nowrap'
const LABEL_NAME_HOLD_MS = 3200
const LABEL_STATUS_HOLD_MS = 2200
const LABEL_SLIDE = '380ms cubic-bezier(0.22, 1, 0.36, 1)'
const STATE_MOODS: ReadonlySet<BuddyMood> = new Set(['working', 'error', 'waiting'])

const POOL_STRENGTH: Record<BuddyMood, number> = { idle: 0.32, working: 0.55, error: 0.5, waiting: 0.5, asleep: 0.06 }
// A resting buddy under the pointer or selected lights its floor the way a busy one does.
const ACTIVE_POOL_STRENGTH = 0.6
// How much taller a selected buddy stands, as a share of its depth. The motion lives in styles.css,
// keyed on `data-buddy-stretched`.
const SELECTED_STRETCH = 0.6

type TileBuddyProps = {
    id: string
    style: TileStyle
    width: number
    height: number
    // How far below the tile's box the floor sits: the box starts above the footprint by the flat
    // tile's thickness.
    floorOffset: number
    // Hovered or selected.
    active?: boolean
    // Selected: the buddy grows taller without leaving the floor.
    stretched?: boolean
    // Placement preview: one plain colour, eyes shut, nothing moving.
    ghost?: { valid: boolean }
    reducedMotion?: boolean
    paused?: boolean
}

export function TileBuddy({ id, style, width, height, floorOffset, active, stretched, ghost, reducedMotion, paused }: TileBuddyProps) {
    const t = useKitTranslations()
    const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
    const look = buddyLook(style)
    const mood = ghost ? 'asleep' : buddyMood(style)
    const plain = ghost ? (ghost.valid ? 'var(--iso-tile-muted)' : '#ef4444') : undefined
    const light = plain ?? (mood === 'idle' ? buddyColor(id, look) : BUDDY_STATE_COLOR[mood])
    const delay = `${(-hashUnit(id, 7) * 4).toFixed(2)}s`

    const blockWidth = BUDDY_GEOMETRY.halfW * 2
    const unit = (width * buddyFootprintShare(style)) / blockWidth
    const artSize = BUDDY_VIEW.w * unit
    const floor = { x: width / 2, y: floorOffset + height / 2 }
    const anchor = BUDDY_GEOMETRY.base
    const artLeft = floor.x - (anchor.x - BUDDY_VIEW.x) * unit
    const artTop = floor.y - (anchor.y - BUDDY_VIEW.y) * unit
    const shadowWidth = blockWidth * unit * 1.02
    const labelTop = floor.y - BUDDY_GEOMETRY.depth * unit * (stretched ? 1 + SELECTED_STRETCH : 1)

    const motion = reducedMotion ? undefined : MOTION[mood]
    const poolMotion = reducedMotion ? undefined : POOL_MOTION[mood]
    const poolStrength = active && mood === 'idle' ? ACTIVE_POOL_STRENGTH : POOL_STRENGTH[mood]
    const pinned = ghost ? null : style.status?.pinned ?? null
    const PinnedIcon = pinned?.icon === 'hand' ? HandIcon : pinned?.icon === 'warning' ? TriangleAlertIcon : null

    const stateColor = STATE_MOODS.has(mood) ? BUDDY_STATE_COLOR[mood] : undefined
    const statusRow = pinned ? (
        <span className={`${LABEL_ROW} gap-0.5`}>
            {pinned.spinner && (
                <span
                    className="size-[5px] shrink-0 rounded-full border border-current border-t-transparent"
                    style={{ color: stateColor, animation: reducedMotion ? undefined : 'iso-status-spin 0.8s linear infinite' }}
                />
            )}
            {PinnedIcon && <PinnedIcon className="size-[8px] shrink-0" style={{ color: stateColor }} />}
            {pinned.count != null && <span className="tabular-nums">{pinned.count}</span>}
            {tileStatusLabel(pinned, t)}
        </span>
    ) : null
    return (
        <>
            <div
                className="iso-buddy-pool absolute pointer-events-none rounded-[50%]"
                style={{
                    left: floor.x - width * 0.62,
                    top: floor.y - height * 0.62,
                    width: width * 1.24,
                    height: height * 1.24,
                    background: `radial-gradient(closest-side, color-mix(in srgb, ${light} ${Math.round(poolStrength * 100)}%, transparent), color-mix(in srgb, ${light} ${Math.round(poolStrength * 30)}%, transparent) 55%, transparent)`,
                    transition: 'background 200ms ease',
                    animation: poolMotion ? `${poolMotion} ${delay}` : undefined,
                }}
            />

            <div
                className="absolute pointer-events-none rounded-[50%]"
                style={{
                    left: floor.x - shadowWidth * 0.52,
                    top: floor.y - shadowWidth * 0.15 + 1,
                    width: shadowWidth * 1.04,
                    height: shadowWidth * 0.32,
                    background: 'radial-gradient(closest-side, rgb(0 0 0 / calc(0.7 * var(--iso-buddy-shadow-alpha))), rgb(0 0 0 / calc(0.35 * var(--iso-buddy-shadow-alpha))) 55%, transparent)',
                }}
            />

            <div
                className="absolute pointer-events-none"
                data-buddy-motion={motion}
                data-buddy-stretched={stretched ? '' : undefined}
                style={{
                    ['--buddy-stretch' as string]: SELECTED_STRETCH,
                    left: artLeft,
                    top: artTop,
                    width: artSize,
                    height: artSize,
                    ['--buddy-depth' as string]: BUDDY_GEOMETRY.depth,
                    ['--buddy-delay' as string]: delay,
                    ['--buddy-blink-delay' as string]: `${(-hashUnit(id, 9) * 4.6).toFixed(2)}s`,
                    filter: mood === 'asleep' && !ghost ? 'saturate(0.2) brightness(0.75)' : undefined,
                }}
            >
                <svg viewBox={`${BUDDY_VIEW.x} ${BUDDY_VIEW.y} ${BUDDY_VIEW.w} ${BUDDY_VIEW.h}`} width="100%" height="100%" style={{ overflow: 'visible' }}>
                    <BuddyArt uid={uid} id={id} mood={mood} look={look} plain={plain} />
                </svg>
            </div>

            {(style.label != null || statusRow) && (
                <div className="absolute flex justify-center pointer-events-none select-none" style={{ left: 0, width, top: labelTop, transform: 'translateY(-50%)', transition: 'top 200ms ease-out' }}>
                    <BuddyLabel id={id} name={style.label ?? null} status={statusRow} maxWidth={width * 1.15} reducedMotion={reducedMotion} paused={paused} />
                </div>
            )}
        </>
    )
}

type BuddyLabelProps = {
    id: string
    name: string | null
    status: ReactNode
    maxWidth: number
    reducedMotion?: boolean
    // Holds the roll where it is. The slide is a CSS animation the paused board freezes, the
    // pill's width a transition it cannot: a turn taken meanwhile would resize the pill around a
    // row that no longer moves.
    paused?: boolean
}

function BuddyLabel({ id, name, status, maxWidth, reducedMotion, paused }: BuddyLabelProps) {
    const nameRef = useRef<HTMLSpanElement>(null)
    const statusRef = useRef<HTMLSpanElement>(null)
    const [widths, setWidths] = useState<{ name: number; status: number } | null>(null)
    // Even turns show the name, odd turns the status. One counter moves both the rows and the
    // pill's width, so they cannot drift apart.
    const [turn, setTurn] = useState(0)
    const rolls = name != null && status != null && !reducedMotion
    const showsStatus = rolls && turn % 2 === 1

    useEffect(() => {
        if (!rolls) {
            setTurn(0)
            return
        }
        if (paused) return
        // The first hold is cut short by a share of its own: a board of busy buddies would
        // otherwise flip all at once.
        const hold = turn === 0 ? LABEL_NAME_HOLD_MS * (0.25 + hashUnit(id, 11)) : showsStatus ? LABEL_STATUS_HOLD_MS : LABEL_NAME_HOLD_MS
        const timer = setTimeout(() => setTurn(current => current + 1), hold)
        return () => clearTimeout(timer)
    }, [rolls, paused, turn, showsStatus, id])

    // offsetWidth ignores the board's zoom transform.
    useLayoutEffect(() => {
        const nameRow = nameRef.current
        const statusRow = statusRef.current
        if (!rolls || !nameRow || !statusRow) return
        const measure = () =>
            setWidths(prev => (prev?.name === nameRow.offsetWidth && prev.status === statusRow.offsetWidth ? prev : { name: nameRow.offsetWidth, status: statusRow.offsetWidth }))
        measure()
        const observer = new ResizeObserver(measure)
        observer.observe(nameRow)
        observer.observe(statusRow)
        return () => observer.disconnect()
    }, [rolls])

    const nameRow = name != null ? (
        <span className={`${LABEL_ROW} min-w-0`}>
            <span className="min-w-0 truncate">{name}</span>
        </span>
    ) : null

    if (!rolls) {
        return (
            <span className={LABEL_PILL} style={{ maxWidth, height: LABEL_ROW_HEIGHT }}>
                {nameRow ?? status}
            </span>
        )
    }

    const slot = (ref: React.Ref<HTMLSpanElement>, current: boolean, row: ReactNode) => (
        <span ref={ref} className="absolute top-0 left-1/2" style={{ width: 'max-content', maxWidth, transform: 'translateX(-50%)' }}>
            <span
                className="block"
                style={{
                    visibility: turn === 0 && !current ? 'hidden' : undefined,
                    animation: turn === 0 ? undefined : `${current ? 'iso-buddy-label-in' : 'iso-buddy-label-out'} ${LABEL_SLIDE} both`,
                }}
            >
                {row}
            </span>
        </span>
    )

    return (
        <span
            className={`${LABEL_PILL} relative`}
            style={{
                height: LABEL_ROW_HEIGHT,
                width: widths ? (showsStatus ? widths.status : widths.name) : undefined,
                transition: turn === 0 ? undefined : `width ${LABEL_SLIDE}`,
            }}
        >
            {slot(nameRef, !showsStatus, nameRow)}
            {slot(statusRef, showsStatus, status)}
        </span>
    )
}
