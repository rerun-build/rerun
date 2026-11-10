import { Pressable, View } from 'react-native'

import { AppText } from '@/components/ui/AppText'
import type { SegmentedControlProps } from '@/components/ui/segmented-types'
import { useTheme } from '@/theme/theme'
import { mix, withAlpha } from '@/theme/tokens'

const HEIGHT = 36
const INSET = 2

// The iOS segmented picker's Android twin, drawn by the app rather than Material's outlined buttons:
// a muted track, the chosen segment on a raised card, a ripple on press.
export function SegmentedControl<Value extends string>({ options, value, onChange }: SegmentedControlProps<Value>) {
    const theme = useTheme()
    return (
        <View accessibilityRole="tablist" style={{ alignSelf: 'stretch', flexDirection: 'row', height: HEIGHT, padding: INSET, borderRadius: HEIGHT / 2, backgroundColor: theme.muted }}>
            {options.map(option => {
                const selected = option.value === value
                return (
                    <Pressable
                        key={option.value}
                        onPress={() => onChange(option.value)}
                        accessibilityRole="tab"
                        accessibilityState={{ selected }}
                        android_ripple={{ color: withAlpha(theme.foreground, 0.08), borderless: false }}
                        style={{
                            flex: 1,
                            alignItems: 'center',
                            justifyContent: 'center',
                            overflow: 'hidden',
                            borderRadius: (HEIGHT - 2 * INSET) / 2,
                            backgroundColor: selected ? (theme.scheme === 'dark' ? mix(theme.muted, theme.foreground, 0.16) : theme.card) : 'transparent',
                            boxShadow: selected ? `0 1px 3px ${withAlpha('#000000', theme.scheme === 'dark' ? 0.4 : 0.12)}` : undefined,
                        }}
                    >
                        <AppText variant="footnote" medium={selected} tone={selected ? 'default' : 'muted'} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                            {option.label}
                        </AppText>
                    </Pressable>
                )
            })}
        </View>
    )
}
