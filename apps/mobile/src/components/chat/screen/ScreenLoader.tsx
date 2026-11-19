import { sweepIntensity } from '@moldwright/contracts'
import { useEffect, useState } from 'react'
import { View, type LayoutChangeEvent } from 'react-native'
import { useReducedMotion } from 'react-native-reanimated'
import Svg, { Path } from 'react-native-svg'

import { useTheme } from '@/theme/theme'

const CELL = { size: 6, gap: 2, radius: 1.5 }
const PITCH = CELL.size + CELL.gap
const OPACITY_STEPS = 6
const PEAK_OPACITY = 0.09
const FRAME_MS = 1000 / 15
const STILL_SECONDS = 4

function roundedCell(x: number, y: number): string {
    const { size, radius: r } = CELL
    const side = size - 2 * r
    return `M${x + r} ${y}h${side}a${r} ${r} 0 0 1 ${r} ${r}v${side}a${r} ${r} 0 0 1 ${-r} ${r}h${-side}a${r} ${r} 0 0 1 ${-r} ${-r}v${-side}a${r} ${r} 0 0 1 ${r} ${-r}z`
}

function shadesAt(width: number, height: number, seconds: number): string[] {
    const cols = Math.ceil(width / PITCH) + 1
    const rows = Math.ceil(height / PITCH) + 1
    const left = (width - (cols * PITCH - CELL.gap)) / 2
    const top = (height - (rows * PITCH - CELL.gap)) / 2
    const paths = Array.from({ length: OPACITY_STEPS + 1 }, () => '')
    for (let col = 0; col < cols; col++) {
        for (let row = 0; row < rows; row++) {
            const step = Math.round(sweepIntensity(col, row, seconds, cols, rows) * OPACITY_STEPS)
            if (step > 0) paths[step] += roundedCell(left + col * PITCH, top + row * PITCH)
        }
    }
    return paths
}

export function ScreenLoader() {
    const theme = useTheme()
    const still = useReducedMotion()
    const [size, setSize] = useState<{ width: number; height: number } | null>(null)
    const [seconds, setSeconds] = useState(STILL_SECONDS)

    useEffect(() => {
        if (still) return
        const timer = setInterval(() => setSeconds(performance.now() / 1000), FRAME_MS)
        return () => clearInterval(timer)
    }, [still])

    const onLayout = ({ nativeEvent }: LayoutChangeEvent) => setSize({ width: nativeEvent.layout.width, height: nativeEvent.layout.height })
    const shades = size ? shadesAt(size.width, size.height, seconds) : []

    return (
        <View pointerEvents="none" onLayout={onLayout} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
            {size && (
                <Svg width={size.width} height={size.height}>
                    {shades.map((d, step) => (d ? <Path key={step} d={d} fill={theme.foreground} fillOpacity={(step / OPACITY_STEPS) * PEAK_OPACITY} /> : null))}
                </Svg>
            )}
        </View>
    )
}
