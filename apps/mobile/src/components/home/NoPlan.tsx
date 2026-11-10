import { View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslations } from 'use-intl'

import { AccountMenu } from '@/components/home/AccountMenu'
import { WorkspaceMenu } from '@/components/home/WorkspaceMenu'
import { usePaneInsets } from '@/components/layout/PaneSize'
import { ForemanOrb } from '@/components/orb/ForemanOrb'
import { AppText } from '@/components/ui/AppText'
import { useTheme } from '@/theme/theme'
import { spacing } from '@/theme/tokens'

// A workspace without a subscription has no machine to run coworkers. The app sells nothing and points
// nowhere to buy (App Store guideline 3.1.1): it keeps the account and the other workspaces within reach.
export function NoPlan() {
    const theme = useTheme()
    const insets = useSafeAreaInsets()
    const pane = usePaneInsets()
    const t = useTranslations('mobileOnboarding')
    return (
        <View style={{ flex: 1, backgroundColor: theme.background, paddingTop: insets.top + spacing.xs, paddingLeft: pane.left, paddingRight: pane.right }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg }}>
                <AccountMenu />
                <View style={{ flex: 1 }} />
                <WorkspaceMenu />
            </View>
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, paddingHorizontal: spacing.xl, paddingBottom: insets.bottom + spacing.xxl }}>
                <ForemanOrb size={64} />
                <View style={{ alignItems: 'center', gap: spacing.xs }}>
                    <AppText variant="title" style={{ textAlign: 'center' }}>
                        {t('noPlan.title')}
                    </AppText>
                    <AppText variant="callout" tone="muted" style={{ textAlign: 'center' }}>
                        {t('noPlan.body')}
                    </AppText>
                </View>
            </View>
        </View>
    )
}
