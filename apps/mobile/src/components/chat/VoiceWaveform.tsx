import { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { useTranslations } from 'use-intl'

const BAR_WIDTH = 3
const BAR_GAP = 1
const BAR_RADIUS = 1.5
const MIN_BAR_HEIGHT = 4
const STEP = BAR_WIDTH + BAR_GAP
const FRAME_MS = 30
const EDGE_FADE = 24
const MIN_LEVEL = 0.05

const barHeightOf = (value: number, height: number) => Math.max(MIN_BAR_HEIGHT, value * height * 0.8)
const alphaOf = (value: number) => 0.4 + value * 0.6
const clampLevel = (value: number) => Math.max(MIN_LEVEL, Math.min(1, value))

function edgeFade(index: number, count: number) {
    const fade = Math.min(EDGE_FADE, count * STEP * 0.3)
    if (fade <= 0) return 1
    const left = index * STEP + BAR_WIDTH / 2
    const right = count * STEP - left
    return Math.min(1, left / fade, right / fade)
}

function liveFrame(previous: number[], count: number, level: number, time: number) {
    const half = Math.max(1, count / 2)
    return Array.from({ length: count }, (_, i) => {
        const position = Math.abs(i + 0.5 - half) / half
        const envelope = 1 - position * 0.65
        const breath = 0.7 + 0.3 * Math.sin(time * (2.1 + (i % 7) * 0.37) + i * 1.7)
        const target = clampLevel(level * 1.3 * envelope * breath)
        return (previous[i] ?? MIN_LEVEL) * 0.55 + target * 0.45
    })
}

function processingFrame(last: number[], count: number, time: number, transition: number) {
    const half = Math.max(1, Math.floor(count / 2))
    return Array.from({ length: count }, (_, i) => {
        const position = (i - half) / half
        const centerWeight = 1 - Math.abs(position) * 0.4
        const wave = Math.sin(time * 1.5 + position * 3) * 0.25 + Math.sin(time * 0.8 - position * 2) * 0.2 + Math.cos(time * 2 + position) * 0.15
        const value = (0.2 + wave) * centerWeight
        const from = last[Math.min(i, last.length - 1)]
        return clampLevel(from === undefined || transition >= 1 ? value : from * (1 - transition) + value * transition)
    })
}

type LiveWaveformProps = {
    processing: boolean
    getLevel: () => number
    color: string
    height?: number
}

export function LiveWaveform({ processing, getLevel, color, height = 48 }: LiveWaveformProps) {
    const t = useTranslations('mobileChat.voice')
    const [width, setWidth] = useState(0)
    const [bars, setBars] = useState<number[]>([])
    const lastLiveRef = useRef<number[]>([])
    const getLevelRef = useRef(getLevel)
    const count = Math.max(0, Math.floor(width / STEP))

    useEffect(() => {
        getLevelRef.current = getLevel
    })

    useEffect(() => {
        if (count === 0) return
        let time = 0
        let transition = 0
        const timer = setInterval(() => {
            time += processing ? 0.03 * (FRAME_MS / 16) : FRAME_MS / 1000
            if (processing) {
                transition = Math.min(1, transition + 0.02 * (FRAME_MS / 16))
                setBars(processingFrame(lastLiveRef.current, count, time, transition))
                return
            }
            setBars(previous => {
                const next = liveFrame(previous, count, getLevelRef.current(), time)
                lastLiveRef.current = next
                return next
            })
        }, FRAME_MS)
        return () => clearInterval(timer)
    }, [processing, count])

    return (
        <View accessibilityLabel={processing ? t('sending') : t('recording')} onLayout={event => setWidth(event.nativeEvent.layout.width)} style={{ flex: 1, height, flexDirection: 'row', alignItems: 'center', gap: BAR_GAP }}>
            {bars.slice(0, count).map((value, i) => (
                <View key={i} style={{ width: BAR_WIDTH, height: barHeightOf(value, height), borderRadius: BAR_RADIUS, backgroundColor: color, opacity: alphaOf(value) * edgeFade(i, count) }} />
            ))}
        </View>
    )
}

const UNPLAYED_ALPHA_SCALE = 0.3

type VoiceWaveformProps = {
    peaks: readonly number[]
    progress: number
    color: string
    width: number
    height?: number
}

export function VoiceWaveform({ peaks, progress, color, width, height = 32 }: VoiceWaveformProps) {
    const count = Math.max(1, Math.floor(width / STEP))
    const playedUntil = progress * count
    return (
        <View style={{ width, height, flexDirection: 'row', alignItems: 'center', gap: BAR_GAP }}>
            {Array.from({ length: count }, (_, i) => {
                const value = peaks.length > 0 ? (peaks[Math.floor((i / count) * peaks.length)] ?? 0) : 0
                const alpha = alphaOf(value)
                return <View key={i} style={{ width: BAR_WIDTH, height: barHeightOf(value, height), borderRadius: BAR_RADIUS, backgroundColor: color, opacity: i < playedUntil ? alpha : alpha * UNPLAYED_ALPHA_SCALE }} />
            })}
        </View>
    )
}
