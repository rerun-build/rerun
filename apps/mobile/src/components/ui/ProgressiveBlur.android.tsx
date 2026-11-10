import { useId } from 'react'
import { StyleSheet, View } from 'react-native'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'

import { useTheme } from '@/theme/theme'

// Android blurs only what sits inside a BlurTargetView, and a blur masked by a gradient redraws the
// screen under it on every frame: the twin keeps the fade alone, the background rising to near opaque at
// the bar. Over a see-through backdrop (`veiled` off) it stops lighter, so the backdrop still shows.
export function ProgressiveBlur({ height, veiled = true }: { height: number; veiled?: boolean }) {
    const theme = useTheme()
    const id = `fade-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
    const stops: [offset: number, opacity: number][] = veiled
        ? [
              [0, 0],
              [0.45, 0.75],
              [1, 0.95],
          ]
        : [
              [0, 0],
              [0.5, 0.45],
              [1, 0.7],
          ]
    return (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { top: undefined, height }]}>
            <Svg width="100%" height={height}>
                <Defs>
                    <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                        {stops.map(([offset, opacity]) => (
                            <Stop key={offset} offset={offset} stopColor={theme.background} stopOpacity={opacity} />
                        ))}
                    </LinearGradient>
                </Defs>
                <Rect width="100%" height="100%" fill={`url(#${id})`} />
            </Svg>
        </View>
    )
}
