'use client'

import { useEffect, useRef, useState } from 'react'
import type { AgentStatus } from '../presets'
import { usePrefersReducedMotion } from './usePrefersReducedMotion'

type LivingStatus = Extract<AgentStatus, 'working' | 'waiting_human' | 'idle'>

const WAKE_AFTER_LANDING = 250
const WAKE_SPREAD = 600

const rand = (min: number, max: number) => min + Math.random() * (max - min)
const pick = <T,>(items: T[]): T => items[Math.floor(Math.random() * items.length)]

function nextStatus(current: LivingStatus): LivingStatus {
    const roll = Math.random()
    if (current === 'idle') return roll < 0.8 ? 'working' : 'waiting_human'
    if (current === 'waiting_human') return 'working'
    if (roll < 0.45) return 'working'
    return roll < 0.8 ? 'idle' : 'waiting_human'
}

function dwell(status: LivingStatus, repeated: boolean) {
    if (status === 'idle') return rand(700, 1_800)
    if (status === 'waiting_human') return rand(1_400, 2_600)
    return repeated ? rand(900, 1_800) : rand(2_200, 4_200)
}

type LivingBoard = {
    statuses: Record<string, LivingStatus>
    hotLinks: Record<string, string | null>
}

const RESTING: LivingBoard = { statuses: {}, hotLinks: {} }

export function useLivingBoard({
    agentKeys,
    linkIdsByAgent,
    startDelays,
    enabled,
    paused,
}: {
    agentKeys: string[]
    linkIdsByAgent: Map<string, string[]>
    startDelays: Map<string, number>
    enabled: boolean
    paused: boolean
}): LivingBoard {
    const [board, setBoard] = useState<LivingBoard>(RESTING)
    const boardRef = useRef(board)
    boardRef.current = board
    const reducedMotion = usePrefersReducedMotion()

    const agentKeysRef = useRef(agentKeys)
    const linksRef = useRef(linkIdsByAgent)
    const startDelaysRef = useRef(startDelays)
    agentKeysRef.current = agentKeys
    linksRef.current = linkIdsByAgent
    startDelaysRef.current = startDelays

    const running = enabled && !reducedMotion && agentKeys.length > 0
    const keys = agentKeys.join(',')

    useEffect(() => {
        if (!running) {
            setBoard(RESTING)
            return
        }
        if (paused) return

        const timers = new Map<string, ReturnType<typeof setTimeout>>()

        const beat = (key: string, current: LivingStatus) => {
            const status = nextStatus(current)
            const links = status === 'working' ? (linksRef.current.get(key) ?? []) : []
            setBoard(previous => ({
                statuses: { ...previous.statuses, [key]: status },
                hotLinks: { ...previous.hotLinks, [key]: links.length > 0 ? pick(links) : null },
            }))
            timers.set(key, setTimeout(() => beat(key, status), dwell(status, status === current)))
        }

        for (const key of agentKeysRef.current) {
            const frozen = boardRef.current.statuses[key]
            if (frozen) {
                timers.set(key, setTimeout(() => beat(key, frozen), dwell(frozen, false)))
                continue
            }
            const wake = (startDelaysRef.current.get(key) ?? 0) + WAKE_AFTER_LANDING + Math.random() * WAKE_SPREAD
            timers.set(key, setTimeout(() => beat(key, 'idle'), wake))
        }

        return () => {
            for (const timer of timers.values()) clearTimeout(timer)
        }
    }, [running, paused, keys])

    return running ? board : RESTING
}
