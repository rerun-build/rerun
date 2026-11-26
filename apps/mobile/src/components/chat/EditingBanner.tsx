import { Pressable, View } from 'react-native'
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated'
import { useTranslations } from 'use-intl'

import { AppText } from '@/components/ui/AppText'
import { Icon } from '@/components/ui/Icon'
import { useTheme } from '@/theme/theme'
import { radius, spacing } from '@/theme/tokens'

// Above the composer while it holds a message being edited: sending replaces that message.
export function EditingBanner({ onCancel }: { onCancel: () => void }) {
    const t = useTranslations('mobileChat.messageActions')
    const theme = useTheme()
    return (
        <Animated.View entering={FadeInDown.duration(200)} exiting={FadeOutDown.duration(200)} style={{ paddingHorizontal: spacing.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingLeft: spacing.lg, borderRadius: radius.lg, borderCurve: 'continuous', borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card }}>
                <View style={{ flex: 1, paddingVertical: spacing.sm, gap: 2 }}>
                    <AppText variant="footnote" medium>
                        {t('editing')}
                    </AppText>
                    <AppText variant="caption" tone="muted" numberOfLines={2}>
                        {t('editHint')}
                    </AppText>
                </View>
                <Pressable onPress={onCancel} accessibilityRole="button" accessibilityLabel={t('cancelEdit')} hitSlop={4} style={({ pressed }) => ({ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
                    <Icon name="x" size={14} bold color={theme.mutedForeground} />
                </Pressable>
            </View>
        </Animated.View>
    )
}
