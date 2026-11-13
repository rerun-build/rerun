import { Pressable, View } from 'react-native'
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated'
import { useTranslations } from 'use-intl'

import { AppText } from '@/components/ui/AppText'
import { Icon } from '@/components/ui/Icon'
import { EASE_OUT, MOTION } from '@/theme/motion'
import { useTheme } from '@/theme/theme'
import { HOME_GUTTER, ROW_LINE } from '@/components/home/CoworkerRow'
import { spacing } from '@/theme/tokens'

type SectionHeaderProps = {
    label: string
    count: number
    collapsed: boolean
    onToggle: () => void
    action?: { label: string; onPress: () => void }
}

// A group drawn as its label alone, its chevron right after it. The count is only read aloud.
export function SectionHeader({ label, count, collapsed, onToggle, action }: SectionHeaderProps) {
    const theme = useTheme()
    const t = useTranslations('mobileHome')
    const chevron = useAnimatedStyle(() => ({ transform: [{ rotate: withTiming(collapsed ? '-90deg' : '0deg', { duration: MOTION.fast, easing: EASE_OUT }) }] }))
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: HOME_GUTTER }}>
            {/* The action sits beside the toggle, not inside it, so VoiceOver reaches both. */}
            <View style={{ flex: 1, flexDirection: 'row' }}>
                <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: !collapsed }} accessibilityLabel={t('section.label', { label, count })} hitSlop={6} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', flexShrink: 1, gap: spacing.sm, paddingTop: 18, paddingBottom: spacing.sm, opacity: pressed ? 0.6 : 1 })}>
                    <AppText variant="callout" tone="muted" numberOfLines={1} maxFontSizeMultiplier={1.4} style={[ROW_LINE, { flexShrink: 1 }]}>
                        {label}
                    </AppText>
                    <Animated.View style={chevron}>
                        <Icon name="chevron-down" size={14} color={theme.mutedForeground} />
                    </Animated.View>
                </Pressable>
            </View>
            {action && (
                <Pressable onPress={action.onPress} accessibilityRole="button" hitSlop={10} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
                    <AppText variant="footnote" medium maxFontSizeMultiplier={1.4}>
                        {action.label}
                    </AppText>
                </Pressable>
            )}
        </View>
    )
}
