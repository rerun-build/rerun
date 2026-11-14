'use client'

import { useReducedMotion } from 'motion/react'
import { useEffect, useState } from 'react'

import type { StageFrame, StageScript, StageStatus } from './auth-stage-board'

export type StagePlayback = {
    statuses: Record<string, StageStatus>
    hotLinks: Record<string, string[]>
}

const RESTING: StagePlayback = { statuses: {}, hotLinks: {} }

export function stagePlaybackAt(script: StageScript, time: number): StagePlayback {
    if (script.frames.length === 0 || time < 0) return RESTING

    const statuses: Record<string, StageStatus> = {}
    const hotLinks: Record<string, string[]> = {}

    const apply = (frame: StageFrame) => {
        for (const change of frame.changes) {
            if (change.status !== undefined) statuses[change.agent] = change.status
            if (change.links !== undefined) hotLinks[change.agent] = change.links
        }
    }

    const phase = time % script.period
    if (time >= script.period) for (const frame of script.frames) apply(frame)
    for (const frame of script.frames) {
        if (frame.at > phase) break
        apply(frame)
    }

    return { statuses, hotLinks }
}

export function msToNextFrame(script: StageScript, time: number): number {
    const first = script.frames[0]
    if (!first) return script.period
    if (time < 0) return first.at - time

    const phase = time % script.period
    const next = script.frames.find(frame => frame.at > phase)
    return next ? next.at - phase : script.period - phase + first.at
}

function sameLinks(a: string[] | undefined, b: string[] | undefined) {
    if (a === b) return true
    if (!a || !b || a.length !== b.length) return false
    return a.every((link, index) => link === b[index])
}

function samePlayback(a: StagePlayback, b: StagePlayback) {
    const agents = new Set([...Object.keys(a.statuses), ...Object.keys(b.statuses), ...Object.keys(a.hotLinks), ...Object.keys(b.hotLinks)])
    for (const agent of agents) {
        if (a.statuses[agent] !== b.statuses[agent]) return false
        if (!sameLinks(a.hotLinks[agent], b.hotLinks[agent])) return false
    }
    return true
}

export function useStageScript({ script, enabled }: { script: StageScript; enabled: boolean }): StagePlayback {
    const [playback, setPlayback] = useState<StagePlayback>(RESTING)
    const reducedMotion = useReducedMotion() ?? false

    const running = enabled && !reducedMotion && script.frames.length > 0

    useEffect(() => {
        if (!running) return

        let played = -script.startAt
        let resumedAt = Date.now()
        let paused = document.visibilityState === 'hidden'
        let timer: ReturnType<typeof setTimeout> | undefined

        const scriptTime = () => (paused ? played : played + (Date.now() - resumedAt))

        const play = () => {
            const time = scriptTime()
            const next = stagePlaybackAt(script, time)
            setPlayback(previous => (samePlayback(previous, next) ? previous : next))
            timer = setTimeout(play, Math.max(16, msToNextFrame(script, time)))
        }

        const onVisibility = () => {
            const hidden = document.visibilityState === 'hidden'
            if (hidden === paused) return
            if (hidden) {
                played = played + (Date.now() - resumedAt)
                paused = true
                clearTimeout(timer)
                return
            }
            paused = false
            resumedAt = Date.now()
            play()
        }

        if (!paused) play()
        document.addEventListener('visibilitychange', onVisibility)

        return () => {
            clearTimeout(timer)
            document.removeEventListener('visibilitychange', onVisibility)
        }
    }, [running, script])

    return running ? playback : RESTING
}
