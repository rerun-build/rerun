import { useEffect, useId, useState, type ReactNode } from 'react'
import { Pressable, View } from 'react-native'
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg'

import { AppText } from '@/components/ui/AppText'
import { Icon, type IconName } from '@/components/ui/Icon'
import { useTheme } from '@/theme/theme'
import { fonts, spacing } from '@/theme/tokens'

const WAVELENGTH = 12
const AMPLITUDE = 2
const WAVE_HEIGHT = AMPLITUDE * 2 + 2

function wavePath(width: number): string {
    const middle = WAVE_HEIGHT / 2
    let path = `M0 ${middle}`
    for (let x = 0; x < width; x += WAVELENGTH) path += ` Q ${x + WAVELENGTH / 4} ${middle - AMPLITUDE * 2} ${x + WAVELENGTH / 2} ${middle} T ${x + WAVELENGTH} ${middle}`
    return path
}

// The web's `ThreadDividerLine` (packages/ui/src/chat/ThreadDividerLine.tsx): a wave fading toward
// the edge on each side of the label. While the run it marks is still going, both halves flow toward
// the label.
function WaveLine({ side, flowing }: { side: 'left' | 'right'; flowing: boolean }) {
    const theme = useTheme()
    const gradientId = `wave${useId().replace(/[^a-zA-Z0-9]/g, '')}`
    const [width, setWidth] = useState(0)
    const shift = useSharedValue(0)
    useEffect(() => {
        if (!flowing) {
            cancelAnimation(shift)
            shift.value = 0
            return
        }
        shift.value = withRepeat(withTiming(side === 'left' ? WAVELENGTH : -WAVELENGTH, { duration: 1400, easing: Easing.linear }), -1, false)
        return () => cancelAnimation(shift)
    }, [flowing, shift, side])
    const flow = useAnimatedStyle(() => ({ transform: [{ translateX: shift.value - WAVELENGTH }] }))
    const drawn = width + WAVELENGTH * 2
    return (
        <View onLayout={event => setWidth(event.nativeEvent.layout.width)} style={{ flex: 1, minWidth: spacing.lg, height: WAVE_HEIGHT, overflow: 'hidden' }}>
            {width > 0 && (
                <Animated.View style={[{ width: drawn, height: WAVE_HEIGHT }, flow]}>
                    <Svg width={drawn} height={WAVE_HEIGHT}>
                        <Defs>
                            <LinearGradient id={gradientId} x1={0} y1={0} x2={drawn} y2={0} gradientUnits="userSpaceOnUse">
                                <Stop offset={0} stopColor={theme.border} stopOpacity={side === 'left' ? 0 : 1} />
                                <Stop offset={side === 'left' ? 0.7 : 0.3} stopColor={theme.border} stopOpacity={1} />
                                <Stop offset={1} stopColor={theme.border} stopOpacity={side === 'left' ? 1 : 0} />
                            </LinearGradient>
                        </Defs>
                        <Path d={wavePath(drawn)} fill="none" stroke={`url(#${gradientId})`} strokeWidth={1} />
                    </Svg>
                </Animated.View>
            )}
        </View>
    )
}

// What the divider reads, in the web's order: what happened, then names and links one dot apart.
export type DividerPiece = { kind: 'text'; text: string } | { kind: 'name'; text: string } | { kind: 'link'; text: string; onPress: () => void }

export function ThreadDivider({ symbol, symbolTint, flowing = false, pieces, accessory }: { symbol: IconName; symbolTint?: string; flowing?: boolean; pieces: DividerPiece[]; accessory?: ReactNode }) {
    const theme = useTheme()
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs }}>
            <WaveLine side="left" flowing={flowing} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
                {accessory ?? <Icon name={symbol} size={13} color={symbolTint ?? theme.mutedForeground} />}
                {pieces.map((piece, i) => (
                    <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: piece.kind === 'name' ? 1 : 0, minWidth: piece.kind === 'name' ? 64 : undefined }}>
                        {i > 0 && (
                            <AppText variant="caption" tone="muted" accessibilityElementsHidden>
                                ·
                            </AppText>
                        )}
                        {piece.kind === 'link' ? (
                            <Pressable onPress={piece.onPress} accessibilityRole="button" hitSlop={10}>
                                {({ pressed }) => (
                                    <AppText variant="caption" tone="muted" numberOfLines={1} style={{ textDecorationLine: 'underline', opacity: pressed ? 0.5 : 1 }}>
                                        {piece.text}
                                    </AppText>
                                )}
                            </Pressable>
                        ) : (
                            <AppText variant="caption" tone={piece.kind === 'name' ? 'default' : 'muted'} numberOfLines={1} style={piece.kind === 'name' ? { fontFamily: fonts.medium, flexShrink: 1 } : undefined}>
                                {piece.text}
                            </AppText>
                        )}
                    </View>
                ))}
            </View>
            <WaveLine side="right" flowing={flowing} />
        </View>
    )
}
