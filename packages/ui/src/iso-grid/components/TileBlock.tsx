'use client'

import { memo } from 'react'
import { HandIcon, LockIcon, TriangleAlertIcon } from '../../icons'
import { Badge } from '../../primitives/badge'
import { BLOCK_HEIGHT, DEFAULT_SPAN, DIAMOND, ISO_DIM_MS, ISO_DIM_OPACITY, ISO_HALO_COLOR, TILE_H, TILE_W, buddyFootprintShare, hashUnit, isoPosition, tileTopLift, tileZ } from '../iso'
import { TileHalo } from './TileHalo'
import { BUDDY_BADGE_GAP, TileBuddy } from './TileBuddy'
import { TileCountdownBadge } from './TileCountdownBadge'
import { buddyColor, buddyLook, buddyMood } from './buddy/buddy-look'
import type { Tile } from '../types'
import { useKitTranslations } from '../../locale'
import { tileStatusLabel } from '../status-label'

const BADGE_FADE_MS = 140
const BADGE_RETURN_DELAY_MS = 100

const shimmerGradient = (shade = 1) => {
    const white = Math.round(255 * shade)
    const sheen = (alpha: number) => `rgba(${white},${white},${white},${alpha})`
    return `linear-gradient(110deg, transparent 10%, ${sheen(0.08)} 20%, ${sheen(0.18)} 35%, ${sheen(0.25)} 50%, ${sheen(0.18)} 65%, ${sheen(0.08)} 80%, transparent 90%)`
}

const SIDE_SHADE = { left: 0.7, right: 0.5 }

const shaded = (color: string, shade: number) => `color-mix(in srgb, ${color} ${shade * 100}%, #000)`
const STRIPE_GRADIENT = 'repeating-linear-gradient(90deg, transparent 0, transparent 2px, rgb(var(--iso-tile-ink) / 0.1) 2px, rgb(var(--iso-tile-ink) / 0.1) 3px)'

type TileBlockProps = {
    tile: Tile
    selected: boolean
    hovered?: boolean
    isDragging?: boolean
    dragPosition?: { col: number; row: number }
    worldOffset: { left: number; top: number }
    ghost?: { valid: boolean }
    onSelect?: (id: string) => void
    reducedMotion?: boolean
    paused?: boolean
    justPlaced?: boolean
}

function ShimmerStrip({ animation, shade }: { animation: string | undefined; shade?: number }) {
    return (
        <div
            className="absolute inset-y-0 left-0"
            style={{
                width: '1500%',
                backgroundImage: shimmerGradient(shade),
                backgroundSize: '20% 100%',
                animation,
                willChange: animation ? 'transform' : undefined,
            }}
        />
    )
}

export const TileBlock = memo(function TileBlock({ tile, selected, hovered, isDragging, dragPosition, worldOffset, ghost, onSelect, reducedMotion, paused, justPlaced }: TileBlockProps) {
    const t = useKitTranslations()
    const s = tile.style
    const span = tile.span ?? DEFAULT_SPAN
    const AW = span * TILE_W
    const AH = span * TILE_H
    const blockHeight = s.depth ?? BLOCK_HEIGHT
    const buddy = !!s.buddy
    const rise = tileTopLift(s, span) - blockHeight

    const renderPos = dragPosition ?? tile.position
    const pos = isoPosition(renderPos.col, renderPos.row)

    const color = ghost ? (ghost.valid ? 'var(--iso-tile-muted)' : '#ef4444') : s.color
    const blockOpacity = ghost ? 0.5 : (s.opacity ?? 1) * (tile.dimmed ? ISO_DIM_OPACITY : 1)
    const restingBuddy = buddy && buddyMood(s) === 'idle'
    const glow = ghost
        ? ghost.valid
            ? 'rgba(148,163,184,0.55)'
            : 'rgba(239,68,68,0.6)'
        : restingBuddy
          ? `color-mix(in srgb, ${buddyColor(tile.id, buddyLook(s))} 60%, transparent)`
          : s.glow ?? 'transparent'
    const glowing = selected || !!ghost
    const lifted = (selected && !buddy) || !!ghost
    const showStripes = s.stripes === true || (s.stripes === 'hover' && (selected || !!hovered)) || !!ghost
    const highlighted = !!tile.highlighted && !ghost
    const haloColor = s.haloColor ?? (s.glow && s.glow !== 'transparent' ? s.glow : ISO_HALO_COLOR)

    const anim = (value: string) => (reducedMotion ? undefined : value)
    const interactive = !ghost && tile.selectable !== false
    const dropIn = !!justPlaced && !ghost && !isDragging && !reducedMotion
    const status = ghost ? null : s.status ?? null
    const pinnedStatus = status?.pinned ?? null
    const pingCycle = pinnedStatus?.count ?? 0
    const PinnedIcon = pinnedStatus?.icon === 'hand' ? HandIcon : pinnedStatus?.icon === 'warning' ? TriangleAlertIcon : null
    const statusBubbleShowing = !ghost && !!hovered && !!s.status
    const badgeTop = buddy ? (AH / 2) * (1 - buddyFootprintShare(s)) - rise - BUDDY_BADGE_GAP : -18

    return (
        <div
            role={interactive ? 'button' : undefined}
            tabIndex={interactive ? 0 : undefined}
            aria-label={interactive ? tile.ariaLabel : undefined}
            onKeyDown={
                interactive
                    ? e => {
                          if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              onSelect?.(tile.id)
                          }
                      }
                    : undefined
            }
            data-ink={ghost ? undefined : s.ink}
            className={`iso-tile absolute focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/70 ${ghost ? 'pointer-events-none' : isDragging ? 'pointer-events-auto cursor-grabbing' : 'pointer-events-auto cursor-pointer'}`}
            style={{
                left: pos.left + worldOffset.left - (AW - TILE_W) / 2,
                top: pos.top + worldOffset.top - blockHeight,
                width: AW,
                height: AH + blockHeight,
                zIndex: isDragging ? 99998 : tileZ(renderPos.col, renderPos.row, span),
                opacity: blockOpacity,
                transform: isDragging ? 'translateY(-12px) scale(1.05)' : lifted ? 'translateY(-6px)' : undefined,
                transition: isDragging
                    ? 'transform 150ms ease-out, left 150ms cubic-bezier(0.2, 0, 0, 1), top 150ms cubic-bezier(0.2, 0, 0, 1)'
                    : `transform 200ms ease-out, left 150ms ease-out, top 150ms ease-out, opacity ${ISO_DIM_MS}ms ease`,
                filter: glowing ? `drop-shadow(0 0 8px ${glow}) drop-shadow(0 0 16px ${glow})` : undefined,
                animation: dropIn ? `agent-drop-in 1s linear ${tile.dropDelay ?? 0}ms backwards` : undefined,
            }}
        >
            {highlighted && <TileHalo side="back" width={AW} height={AH} depth={blockHeight + rise} offsetTop={-rise} color={haloColor} phase={hashUnit(tile.id, 11)} reducedMotion={reducedMotion} />}

            {s.badge === 'hand' && (
                <div className="absolute left-1/2 -translate-x-1/2 flex items-center justify-center" style={{ top: badgeTop, opacity: statusBubbleShowing ? 0 : 1, transition: `opacity ${BADGE_FADE_MS}ms ease ${statusBubbleShowing ? 0 : BADGE_RETURN_DELAY_MS}ms` }}>
                    <span className="flex" style={{ animation: anim('agent-waiting-dot 1.5s ease-in-out 2.5') }}>
                        <HandIcon className="size-3 text-cyan-400" />
                    </span>
                </div>
            )}

            {s.badge === 'lock' && (
                <div className="absolute left-1/2 -translate-x-1/2 flex items-center justify-center" style={{ top: badgeTop, opacity: statusBubbleShowing ? 0 : 1, transition: `opacity ${BADGE_FADE_MS}ms ease ${statusBubbleShowing ? 0 : BADGE_RETURN_DELAY_MS}ms` }}>
                    <LockIcon className="size-3 text-neutral-400" />
                </div>
            )}

            {(s.countdown || s.results) && !s.badge && !ghost && (
                <div className="absolute inset-x-0 flex justify-center" style={{ top: badgeTop, transform: 'translateY(-50%)', opacity: statusBubbleShowing ? 0 : 1, transition: `opacity ${BADGE_FADE_MS}ms ease ${statusBubbleShowing ? 0 : BADGE_RETURN_DELAY_MS}ms` }}>
                    <TileCountdownBadge countdown={s.countdown} results={s.results} />
                </div>
            )}

            {buddy ? (
                <TileBuddy id={tile.id} style={s} width={AW} height={AH} floorOffset={blockHeight} active={selected || !!hovered} stretched={selected && !ghost} ghost={ghost} reducedMotion={reducedMotion} paused={paused} />
            ) : (
                <>
                <div
                    className="absolute"
                    style={{
                        width: AW,
                        height: AH,
                        top: 0,
                        left: 0,
                        clipPath: DIAMOND,
                        backgroundColor: color,
                        overflow: 'hidden',
                    }}
                >
                    {s.shimmer && <ShimmerStrip animation={anim('agent-shimmer 4s ease-in-out infinite')} />}
                    {s.sheen && !ghost && <div className="absolute inset-0 pointer-events-none" style={{ background: 'var(--iso-tile-sheen)' }} />}
                    <div
                        className="absolute inset-0 pointer-events-none"
                        style={{
                            background: STRIPE_GRADIENT,
                            opacity: showStripes ? 1 : 0,
                            transition: 'opacity 200ms ease',
                        }}
                    />
                </div>

                <div
                    className="absolute"
                    style={{
                        width: AW / 2,
                        height: blockHeight,
                        top: AH / 2,
                        left: 0,
                        transform: 'skewY(26.565deg)',
                        transformOrigin: 'top left',
                        backgroundColor: shaded(color, SIDE_SHADE.left),
                        isolation: 'isolate',
                        overflow: 'hidden',
                    }}
                >
                    {s.shimmer && <ShimmerStrip animation={anim('agent-shimmer 4s ease-in-out infinite 0.5s')} shade={SIDE_SHADE.left} />}
                </div>

                <div
                    className="absolute"
                    style={{
                        width: AW / 2,
                        height: blockHeight,
                        top: AH / 2,
                        left: AW / 2,
                        transform: 'skewY(-26.565deg)',
                        transformOrigin: 'top right',
                        backgroundColor: shaded(color, SIDE_SHADE.right),
                        isolation: 'isolate',
                        overflow: 'hidden',
                    }}
                >
                    {s.shimmer && <ShimmerStrip animation={anim('agent-shimmer 4s ease-in-out infinite 1s')} shade={SIDE_SHADE.right} />}
                </div>

                <svg className="absolute pointer-events-none" style={{ top: 0, left: 0, width: AW, height: AH + blockHeight }} viewBox={`0 0 ${AW} ${AH + blockHeight}`} fill="none">
                    <polygon points={`${AW / 2},0 ${AW},${AH / 2} ${AW / 2},${AH} 0,${AH / 2}`} stroke="rgb(var(--iso-tile-ink) / 0.2)" strokeWidth="1" />
                    <line x1={0} y1={AH / 2} x2={0} y2={AH / 2 + blockHeight} stroke="rgb(var(--iso-tile-ink) / 0.15)" strokeWidth="1" />
                    <line x1={AW / 2} y1={AH} x2={AW / 2} y2={AH + blockHeight} stroke="rgb(var(--iso-tile-ink) / 0.15)" strokeWidth="1" />
                    <line x1={AW} y1={AH / 2} x2={AW} y2={AH / 2 + blockHeight} stroke="rgb(var(--iso-tile-ink) / 0.15)" strokeWidth="1" />
                    <line x1={0} y1={AH / 2 + blockHeight} x2={AW / 2} y2={AH + blockHeight} stroke="rgb(var(--iso-tile-ink) / 0.15)" strokeWidth="1" />
                    <line x1={AW / 2} y1={AH + blockHeight} x2={AW} y2={AH / 2 + blockHeight} stroke="rgb(var(--iso-tile-ink) / 0.15)" strokeWidth="1" />
                </svg>

                {s.image != null && (
                    <div className="absolute left-0 top-0 flex items-center justify-center pointer-events-none select-none" style={{ width: AW, height: AH }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={s.image}
                            alt=""
                            draggable={false}
                            style={{
                                width: AW * 0.38,
                                height: AW * 0.38,
                                objectFit: 'contain',
                                transform: 'rotateX(60deg) rotateZ(-45deg)',
                                filter: s.imageFilter,
                            }}
                        />
                    </div>
                )}

                {(s.label != null || pinnedStatus) && (
                    <div className="absolute left-0 top-0 flex flex-col items-center justify-center pointer-events-none select-none" style={{ width: AW, height: AH }}>
                        {s.label != null && (
                            <span
                                className="text-[8px] font-normal tracking-tight whitespace-nowrap"
                                style={{ color: 'rgb(var(--iso-tile-ink) / 0.85)', filter: 'drop-shadow(0 1px 1.5px rgb(var(--iso-tile-ink-shadow) / 0.85))' }}
                            >
                                {s.label}
                            </span>
                        )}
                        {pinnedStatus && status && (
                            <Badge tone={status.tone} size="xs" fill="media" animated={false} className="mt-px gap-0.5 bg-black/20 px-1.5 py-px text-[7px]">
                                {pinnedStatus.spinner && (
                                    <span
                                        className="size-[5px] shrink-0 rounded-full border border-current border-t-transparent"
                                        style={{ animation: anim('iso-status-spin 0.8s linear infinite') }}
                                    />
                                )}
                                {PinnedIcon && <PinnedIcon className="size-[8px] shrink-0" />}
                                {pinnedStatus.count != null && <span className="tabular-nums">{pinnedStatus.count}</span>}
                                {tileStatusLabel(pinnedStatus, t)}
                            </Badge>
                        )}
                    </div>
                )}
                </>
            )}

            {s.errorPulse && !buddy && (
                <div
                    className="absolute"
                    style={{
                        width: AW,
                        height: AH,
                        top: 0,
                        left: 0,
                        clipPath: DIAMOND,
                        backgroundColor: 'rgba(239, 68, 68, 0.3)',
                        animation: anim('agent-error-pulse 0.8s ease-in-out 4.5 forwards'),
                        pointerEvents: 'none',
                    }}
                />
            )}

            {s.pingRings && (
                <>
                    <div
                        key={`ping-a-${pingCycle}`}
                        className="absolute pointer-events-none"
                        style={{
                            width: AW + 8,
                            height: AH + 4,
                            top: -2 - rise,
                            left: -4,
                            clipPath: DIAMOND,
                            border: '1.5px solid rgba(6, 182, 212, 0.5)',
                            animation: anim('agent-ping 2s cubic-bezier(0, 0, 0.2, 1) 3 both'),
                        }}
                    />
                    <div
                        key={`ping-b-${pingCycle}`}
                        className="absolute pointer-events-none"
                        style={{
                            width: AW + 8,
                            height: AH + 4,
                            top: -2 - rise,
                            left: -4,
                            clipPath: DIAMOND,
                            border: '1.5px solid rgba(6, 182, 212, 0.5)',
                            animation: anim('agent-ping 2s cubic-bezier(0, 0, 0.2, 1) 0.6s 3 both'),
                        }}
                    />
                </>
            )}

            {highlighted && <TileHalo side="front" width={AW} height={AH} depth={blockHeight + rise} offsetTop={-rise} color={haloColor} phase={hashUnit(tile.id, 11)} reducedMotion={reducedMotion} />}
        </div>
    )
})
