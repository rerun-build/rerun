'use client'

import { cn } from '@/lib/utils'
import { useTheme } from 'next-themes'
import { useCallback, useEffect, useRef, useState } from 'react'

type VoiceWaveformProps = {
    peaks: readonly number[]
    progress?: number
    barWidth?: number
    barGap?: number
    barRadius?: number
    minBarHeight?: number
    height?: number
    className?: string
}

const PLAYED_ALPHA_FLOOR = 0.4
const PLAYED_ALPHA_RANGE = 0.6
const UNPLAYED_ALPHA_SCALE = 0.3

export function VoiceWaveform({ peaks, progress = 0, barWidth = 3, barGap = 1, barRadius = 1.5, minBarHeight = 4, height = 32, className }: VoiceWaveformProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const [width, setWidth] = useState(0)
    const [barColor, setBarColor] = useState('')
    const { resolvedTheme } = useTheme()

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
        observer.observe(canvas)
        return () => observer.disconnect()
    }, [])

    useEffect(() => {
        const canvas = canvasRef.current
        if (canvas) setBarColor(getComputedStyle(canvas).color)
    }, [resolvedTheme])

    const draw = useCallback(() => {
        const canvas = canvasRef.current
        if (!canvas || width <= 0 || !barColor) return

        const dpr = window.devicePixelRatio || 1
        canvas.width = width * dpr
        canvas.height = height * dpr

        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.scale(dpr, dpr)
        ctx.clearRect(0, 0, width, height)

        const step = barWidth + barGap
        const barCount = Math.max(1, Math.floor(width / step))
        const playedUntil = progress * barCount
        ctx.fillStyle = barColor

        for (let i = 0; i < barCount; i++) {
            const value = peaks.length > 0 ? (peaks[Math.floor((i / barCount) * peaks.length)] ?? 0) : 0
            const barHeight = Math.max(minBarHeight, value * height * 0.8)
            const alpha = PLAYED_ALPHA_FLOOR + value * PLAYED_ALPHA_RANGE

            ctx.globalAlpha = i < playedUntil ? alpha : alpha * UNPLAYED_ALPHA_SCALE
            ctx.beginPath()
            ctx.roundRect(i * step, (height - barHeight) / 2, barWidth, barHeight, barRadius)
            ctx.fill()
        }

        ctx.globalAlpha = 1
    }, [width, height, barWidth, barGap, barRadius, minBarHeight, peaks, progress, barColor])

    useEffect(draw, [draw])

    return <canvas ref={canvasRef} aria-hidden className={cn('block w-full min-w-0', className)} style={{ height }} />
}
