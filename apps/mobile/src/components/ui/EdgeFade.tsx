import { StyleSheet, View } from 'react-native'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'

import { useTheme } from '@/theme/theme'

// The background fading in at a screen edge, so content scrolling under a floating bar dissolves
// instead of being cut. `solid` keeps that much of it fully opaque from the edge, for a bar that hides
// what passes under it instead of letting it show through.
export function EdgeFade({ edge, height, solid }: { edge: 'top' | 'bottom'; height: number; solid?: number }) {
    const theme = useTheme()
    const id = `fade-${edge}`
    const stops: [offset: number, opacity: number][] = solid
        ? [
              [0, 1],
              [Math.min(solid / height, 1), 1],
              [1, 0],
          ]
        : [
              [0, 1],
              [0.55, 0.85],
              [1, 0],
          ]
    return (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, edge === 'top' ? { bottom: undefined } : { top: undefined }, { height }]}>
            <Svg width="100%" height="100%">
                <Defs>
                    <LinearGradient id={id} x1="0" y1={edge === 'top' ? '0' : '1'} x2="0" y2={edge === 'top' ? '1' : '0'}>
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
