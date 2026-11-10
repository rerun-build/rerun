import { View } from 'react-native'
import { useTranslations } from 'use-intl'

import { AppText } from '@/components/ui/AppText'
import { useTheme } from '@/theme/theme'
import { spacing } from '@/theme/tokens'

export function OrDivider() {
    const theme = useTheme()
    const t = useTranslations('mobileAuth')
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginVertical: spacing.xs }}>
            <View style={{ flex: 1, height: 1, backgroundColor: theme.border }} />
            <AppText variant="footnote" tone="muted">
                {t('start.or')}
            </AppText>
            <View style={{ flex: 1, height: 1, backgroundColor: theme.border }} />
        </View>
    )
}
