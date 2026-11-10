import { View } from 'react-native'
import { useTranslations } from 'use-intl'

import { AppText } from '@/components/ui/AppText'
import { Icon } from '@/components/ui/Icon'
import { PillButton } from '@/components/ui/PillButton'
import { useTheme } from '@/theme/theme'
import { spacing } from '@/theme/tokens'

import { openStoreListing } from './store-listing'

export function UpdateRequired() {
    const theme = useTheme()
    const t = useTranslations('mobileOnboarding')
    const common = useTranslations('mobileCommon')
    return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.xl, paddingHorizontal: spacing.xl, backgroundColor: theme.background }}>
            <Icon name="download" size={56} color={theme.mutedForeground} />
            <View style={{ alignItems: 'center', gap: spacing.xs }}>
                <AppText variant="title" style={{ textAlign: 'center' }}>
                    {t('update.title')}
                </AppText>
                <AppText variant="callout" tone="muted" style={{ textAlign: 'center' }}>
                    {t('update.body')}
                </AppText>
            </View>
            <PillButton label={common('actions.update')} onPress={() => void openStoreListing()} />
        </View>
    )
}
