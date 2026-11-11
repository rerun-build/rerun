import { Pressable, View } from 'react-native'
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated'
import { useTranslations } from 'use-intl'

import { AppText } from '@/components/ui/AppText'
import { Icon } from '@/components/ui/Icon'
import { EASE_OUT, MOTION } from '@/theme/motion'
import { useTheme } from '@/theme/theme'
import { HOME_GUTTER } from '@/components/home/CoworkerRow'
import { spacing } from '@/theme/tokens'

type SectionHeaderProps = {
    label: string
    count: number
    collapsed: boolean
    onToggle: () => void
    divided?: boolean
    action?: { label: string; onPress: () => void }
}

export function SectionHeader({ label, count, collapsed, onToggle, divided, action }: SectionHeaderProps) {
    const theme = useTheme()
    const t = useTranslations('mobileHome')
    const chevron = useAnimatedStyle(() => ({ transform: [{ rotate: withTiming(collapsed ? '-90deg' : '0deg', { duration: MOTION.fast, easing: EASE_OUT }) }] }))
    return (
        <View style={{ paddingHorizontal: HOME_GUTTER, paddingTop: divided ? spacing.md : 0 }}>
            {divided && <View style={{ height: 1, backgroundColor: theme.border, marginBottom: spacing.md }} />}
            {/* The action sits beside the toggle, not inside it, so VoiceOver reaches both. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: !collapsed }} accessibilityLabel={t('section.label', { label, count })} hitSlop={6} style={({ pressed }) => ({ flex: 1, paddingVertical: spacing.sm, opacity: pressed ? 0.6 : 1 })}>
                    <AppText variant="footnote" tone="muted" medium maxFontSizeMultiplier={1.4}>
                        {label}
                        <AppText variant="footnote" tone="muted">{`  ${count}`}</AppText>
                    </AppText>
                </Pressable>
                {action && (
                    <Pressable onPress={action.onPress} accessibilityRole="button" hitSlop={10} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
                        <AppText variant="footnote" medium maxFontSizeMultiplier={1.4}>
                            {action.label}
                        </AppText>
                    </Pressable>
                )}
                <Pressable onPress={onToggle} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" hitSlop={10} style={({ pressed }) => ({ paddingVertical: spacing.sm, opacity: pressed ? 0.6 : 1 })}>
                    <Animated.View style={chevron}>
                        <Icon name="chevron-down" size={13} color={theme.mutedForeground} />
                    </Animated.View>
                </Pressable>
            </View>
        </View>
    )
}
