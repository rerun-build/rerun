import { View, type StyleProp, type ViewStyle } from 'react-native'
import { useTranslations } from 'use-intl'

import { useTheme } from '@/theme/theme'
import { brand } from '@/theme/tokens'

export function UnreadDot({ style }: { style?: StyleProp<ViewStyle> }) {
    const theme = useTheme()
    const t = useTranslations('mobileCommon')
    return <View accessibilityLabel={t('unread')} style={[{ width: 9, height: 9, borderRadius: 5, backgroundColor: theme.scheme === 'dark' ? brand.soft : brand.base }, style]} />
}
