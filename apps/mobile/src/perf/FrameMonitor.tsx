import { useEffect, useState } from 'react'
import { Text, View } from 'react-native'
import { useFrameCallback, useSharedValue } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

import { PERF_LOG } from './timing'

// Frames the screen could have drawn and did not, each second, on the JavaScript thread (React's
// renders) and on the UI thread (scrolling, Reanimated). The refresh interval is the median gap of the
// second, so a 120 Hz screen counts its own frames and the jitter between two frames counts for nothing.
export type FrameWindow = { drawn: number; missed: number }
export type FrameReport = { js: FrameWindow; ui: FrameWindow }

const WINDOW_MS = 1000

// The JavaScript thread's frames, read off requestAnimationFrame: a long render holds the next one back.
function useJsFrames(enabled: boolean, onWindow: (window: FrameWindow) => void) {
    useEffect(() => {
        if (!enabled) return
        let frame = 0
        let last = performance.now()
        let windowStart = last
        let gaps: number[] = []
        // requestAnimationFrame's own timestamp runs on another clock than performance.now().
        const tick = () => {
            const now = performance.now()
            gaps.push(now - last)
            last = now
            if (now - windowStart >= WINDOW_MS) {
                onWindow(missedFrames(gaps))
                gaps = []
                windowStart = now
            }
            frame = requestAnimationFrame(tick)
        }
        frame = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(frame)
    }, [enabled, onWindow])
}

function useUiFrames(enabled: boolean, onWindow: (window: FrameWindow) => void) {
    const gaps = useSharedValue<number[]>([])
    const windowStart = useSharedValue(0)
    useFrameCallback(frame => {
        'worklet'
        if (frame.timeSincePreviousFrame === null) {
            windowStart.value = frame.timestamp
            return
        }
        const gap = frame.timeSincePreviousFrame
        gaps.modify(list => {
            'worklet'
            list.push(gap)
            return list
        })
        if (frame.timestamp - windowStart.value < WINDOW_MS) return
        scheduleOnRN(onWindow, missedFrames(gaps.value))
        gaps.value = []
        windowStart.value = frame.timestamp
    }, enabled)
}

export function missedFrames(gaps: number[]): FrameWindow {
    'worklet'
    if (gaps.length === 0) return { drawn: 0, missed: 0 }
    const sorted = [...gaps].sort((a, b) => a - b)
    const interval = Math.max(1000 / 120, sorted[Math.floor(sorted.length / 2)])
    let missed = 0
    for (const gap of gaps) missed += Math.max(0, Math.round(gap / interval) - 1)
    return { drawn: gaps.length, missed }
}

// The last second of both threads, refreshed every second while `enabled`.
export function useFrameReport(enabled: boolean): FrameReport {
    const [report, setReport] = useState<FrameReport>({ js: { drawn: 0, missed: 0 }, ui: { drawn: 0, missed: 0 } })
    const [onJs] = useState(() => (js: FrameWindow) => setReport(current => ({ ...current, js })))
    const [onUi] = useState(() => (ui: FrameWindow) => setReport(current => ({ ...current, ui })))
    useJsFrames(enabled, onJs)
    useUiFrames(enabled, onUi)
    return report
}

// With EXPO_PUBLIC_PERF=1, a second that missed frames is also printed in Metro's log.
export function FrameMonitor({ top }: { top: number }) {
    const { js, ui } = useFrameReport(true)
    useEffect(() => {
        if (PERF_LOG && js.missed + ui.missed > 0) console.log(`[perf] frames · JS ${js.drawn} drawn, ${js.missed} missed · UI ${ui.drawn} drawn, ${ui.missed} missed`)
    }, [js, ui])
    return (
        <View pointerEvents="none" style={{ position: 'absolute', top, right: 8, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.78)' }}>
            <Text style={{ color: js.missed > 0 ? '#fca5a5' : '#ffffff', fontSize: 11, fontVariant: ['tabular-nums'] }}>{`JS ${js.drawn} · ${js.missed} missed`}</Text>
            <Text style={{ color: ui.missed > 0 ? '#fca5a5' : '#ffffff', fontSize: 11, fontVariant: ['tabular-nums'] }}>{`UI ${ui.drawn} · ${ui.missed} missed`}</Text>
        </View>
    )
}
