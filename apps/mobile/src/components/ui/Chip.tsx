import { Pressable } from 'react-native'

import { AppText } from '@/components/ui/AppText'
import { useTheme } from '@/theme/theme'
import { fonts, mix, radius } from '@/theme/tokens'

export const CHIP_HEIGHT = 34

export function Chip({ label, onPress, selected = false }: { label: string; onPress: () => void; selected?: boolean }) {
    const theme = useTheme()
    return (
        <Pressable
            onPress={onPress}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            hitSlop={5}
            style={({ pressed }) => ({
                height: CHIP_HEIGHT,
                justifyContent: 'center',
                paddingHorizontal: 14,
                borderRadius: radius.pill,
                backgroundColor: selected ? theme.foreground : pressed ? mix(theme.muted, theme.foreground, 0.08) : theme.muted,
            })}
        >
            <AppText numberOfLines={1} maxFontSizeMultiplier={1.3} style={{ fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, color: selected ? theme.background : theme.mutedForeground }}>
                {label}
            </AppText>
        </Pressable>
    )
}
