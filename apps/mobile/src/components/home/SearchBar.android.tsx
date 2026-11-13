import { Pressable, View } from 'react-native'
import { useTranslations } from 'use-intl'

import { AppText } from '@/components/ui/AppText'
import { GLASS_BUTTON_SIZE } from '@/components/ui/GlassButton'
import { Icon } from '@/components/ui/Icon'
import { opaqueSurface } from '@/components/ui/surface'
import { useTheme } from '@/theme/theme'
import { radius, spacing, withAlpha } from '@/theme/tokens'

// The Home's search pinned to the bottom, as on iOS but on an opaque capsule: a tap opens the search screen.
export function SearchBar({ height = GLASS_BUTTON_SIZE, onPress }: { height?: number; onPress: () => void }) {
    const theme = useTheme()
    const t = useTranslations('mobileHome')
    return (
        <View style={{ flex: 1, height, borderRadius: radius.pill, overflow: 'hidden', ...opaqueSurface(theme.scheme) }}>
            <Pressable onPress={onPress} accessibilityRole="search" accessibilityLabel={t('search.title')} android_ripple={{ color: withAlpha(theme.foreground, 0.1), borderless: false }} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg }}>
                <Icon name="search" size={17} color={theme.mutedForeground} />
                <AppText variant="body" tone="muted" numberOfLines={1} maxFontSizeMultiplier={1.2}>
                    {t('search.title')}
                </AppText>
            </Pressable>
        </View>
    )
}
