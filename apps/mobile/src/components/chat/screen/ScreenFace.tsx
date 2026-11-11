import { View } from 'react-native'
import Animated, { FadeOut } from 'react-native-reanimated'
import { useTranslations } from 'use-intl'

import { AppText } from '@/components/ui/AppText'
import { Icon } from '@/components/ui/Icon'
import { useTheme } from '@/theme/theme'
import { mix, spacing } from '@/theme/tokens'

import { ScreenLoader } from './ScreenLoader'
import type { ScreenStatus } from './useAgentScreen'

// What covers a 16:9 box until the screen paints, whatever its size: the block in the thread, the
// floating thumbnail. The live screen under it is the caller's.
export function ScreenFace({ status }: { status: ScreenStatus }) {
    const theme = useTheme()
    const t = useTranslations('mobileChat.screen')
    if (status === 'live') return null
    const surface = mix(theme.card, theme.muted, 0.4)
    return (
        <Animated.View exiting={FadeOut.duration(300)} pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: spacing.lg, backgroundColor: surface }}>
            {status === 'loading' ? (
                <ScreenLoader />
            ) : (
                <View style={{ alignItems: 'center', gap: 6 }}>
                    <Icon name="monitor" size={20} color={theme.mutedForeground} />
                    <AppText variant="footnote" tone="muted" style={{ textAlign: 'center' }}>
                        {t(status)}
                    </AppText>
                </View>
            )}
        </Animated.View>
    )
}
