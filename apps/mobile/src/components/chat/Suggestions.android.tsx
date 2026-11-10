import { Pressable, ScrollView } from 'react-native'

import { AppText } from '@/components/ui/AppText'
import { opaqueSurface } from '@/components/ui/surface'
import { useTheme } from '@/theme/theme'
import { radius, spacing, withAlpha } from '@/theme/tokens'

const HEIGHT = 36

// The iOS glass chips' Android twin: the same pills on an opaque surface, a ripple on press.
export function Suggestions({ items, onPick }: { items: string[]; onPick: (text: string) => void }) {
    const theme = useTheme()
    return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.xs }}>
            {items.map(item => (
                <Pressable
                    key={item}
                    onPress={() => onPick(item)}
                    accessibilityRole="button"
                    android_ripple={{ color: withAlpha(theme.foreground, 0.1), borderless: false }}
                    style={{ ...opaqueSurface(theme.scheme), height: HEIGHT, justifyContent: 'center', paddingHorizontal: spacing.lg, borderRadius: radius.pill, overflow: 'hidden' }}
                >
                    <AppText variant="callout" numberOfLines={1} maxFontSizeMultiplier={1.3}>
                        {item}
                    </AppText>
                </Pressable>
            ))}
        </ScrollView>
    )
}
