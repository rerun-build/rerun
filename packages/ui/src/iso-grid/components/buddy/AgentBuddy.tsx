'use client'

import { useId, type CSSProperties, type ReactNode } from 'react'
import { cn } from '../../../cn'
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion'
import { hashUnit } from '../../iso'
import type { BuddyEyes, BuddyLook } from '../../types'
import { BUDDY_GEOMETRY, BuddyArt } from './BuddyArt'
import { buddyEyes, type BuddyMood } from './buddy-look'
import type { BoxGeometry } from './RoundedBox'

const SMALL_BELOW = 40
const SMALL_GEOMETRY: BoxGeometry = { ...BUDDY_GEOMETRY, depth: 30 }
const SMALL_FACE_SCALE = 1.6
const SMALL_EYES: Partial<Record<BuddyEyes, BuddyEyes>> = { glasses: 'round', shades: 'visor', line: 'pill', dot: 'round' }
const FULL_LOOK: BuddyLook = {}

function smallLook(agentId: string): BuddyLook {
    const eyes = buddyEyes(agentId, FULL_LOOK)
    return { mouth: 'none', eyes: SMALL_EYES[eyes] ?? eyes }
}

const MARGIN = 2
const MOTION: Partial<Record<BuddyMood, 'bob' | 'shudder'>> = { working: 'bob', error: 'shudder' }

type AgentBuddyProps = {
    agentId: string
    mood?: BuddyMood
    size: number
    animated?: boolean
    alive?: boolean
    facing?: 'left' | 'right'
    badge?: ReactNode
    className?: string
}

export function AgentBuddy({ agentId, mood = 'idle', size, animated = true, alive = false, facing = 'left', badge, className }: AgentBuddyProps) {
    const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
    const reducedMotion = usePrefersReducedMotion()
    const small = size < SMALL_BELOW
    const geometry = small ? SMALL_GEOMETRY : BUDDY_GEOMETRY
    const moving = animated && !reducedMotion

    const side = geometry.halfW * 2 + MARGIN * 2
    const blockCentreY = geometry.base.y - geometry.depth / 2
    const viewBox = `${geometry.base.x - side / 2} ${blockCentreY - side / 2} ${side} ${side}`

    return (
        <span
            aria-hidden
            data-buddy-motion={moving ? MOTION[mood] : undefined}
            data-buddy-alive={moving && alive ? '' : undefined}
            data-buddy-still={moving ? undefined : ''}
            className={cn('relative inline-flex shrink-0', className)}
            style={
                {
                    width: size,
                    height: size,
                    '--iso-buddy-body': 'var(--iso-buddy-mascot-body)',
                    '--buddy-depth': geometry.depth,
                    '--buddy-delay': `${(-hashUnit(agentId, 7) * 4).toFixed(2)}s`,
                    '--buddy-blink-delay': `${(-hashUnit(agentId, 9) * 4.6).toFixed(2)}s`,
                    filter: mood === 'asleep' ? 'saturate(0.2) brightness(0.75)' : undefined,
                } as CSSProperties
            }
        >
            <svg viewBox={viewBox} width="100%" height="100%" style={{ overflow: 'visible', transform: facing === 'right' ? 'scaleX(-1)' : undefined }}>
                <BuddyArt uid={uid} id={agentId} mood={mood} look={small ? smallLook(agentId) : FULL_LOOK} geometry={geometry} lit={!small} faceScale={small ? SMALL_FACE_SCALE : 1} />
            </svg>
            {badge && <span className={cn('absolute -bottom-1 flex', facing === 'right' ? '-left-1' : '-right-1')}>{badge}</span>}
        </span>
    )
}
