import { SymbolView } from 'expo-symbols'
import { Linking, View } from 'react-native'
import { useTranslations } from 'use-intl'

import { AppText } from '@/components/ui/AppText'
import { PillButton } from '@/components/ui/PillButton'
import { useTheme } from '@/theme/theme'
import { spacing } from '@/theme/tokens'

const APP_STORE_URL = 'https://apps.apple.com/app/id6825274993'

export function UpdateRequired() {
    const theme = useTheme()
    const t = useTranslations('mobileOnboarding')
    const common = useTranslations('mobileCommon')
    return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.xl, paddingHorizontal: spacing.xl, backgroundColor: theme.background }}>
            <SymbolView name="arrow.down.app" size={56} weight="regular" tintColor={theme.mutedForeground} />
            <View style={{ alignItems: 'center', gap: spacing.xs }}>
                <AppText variant="title" style={{ textAlign: 'center' }}>
                    {t('update.title')}
                </AppText>
                <AppText variant="callout" tone="muted" style={{ textAlign: 'center' }}>
                    {t('update.body')}
                </AppText>
            </View>
            <PillButton label={common('actions.update')} onPress={() => Linking.openURL(APP_STORE_URL)} />
        </View>
    )
}
