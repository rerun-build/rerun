import { ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslations } from 'use-intl'

import { useIsWorkspaceAdmin } from '@/auth/AuthProvider'
import { PaywallCard } from '@/components/billing/PaywallCard'
import { AccountMenu } from '@/components/home/AccountMenu'
import { WorkspaceMenu } from '@/components/home/WorkspaceMenu'
import { usePaneInsets } from '@/components/layout/PaneSize'
import { ForemanOrb } from '@/components/orb/ForemanOrb'
import { AppText } from '@/components/ui/AppText'
import { usePaywall } from '@/store/usePaywall'
import { useTheme } from '@/theme/theme'
import { spacing } from '@/theme/tokens'

// A workspace without a subscription has no machine to run coworkers. Its admin is offered the plan
// through the app's store, the only way the app sells (App Store guideline 3.1.1); a member, or a server
// that sells nothing, keeps the account and the other workspaces within reach.
export function NoPlan() {
    const theme = useTheme()
    const insets = useSafeAreaInsets()
    const pane = usePaneInsets()
    const t = useTranslations('mobileOnboarding')
    const admin = useIsWorkspaceAdmin()
    const paywall = usePaywall({ surface: 'no_plan', enabled: admin })
    const selling = admin && !(paywall.state.step === 'unavailable' && paywall.state.reason !== 'no_product')
    return (
        <View style={{ flex: 1, backgroundColor: theme.background, paddingTop: insets.top + spacing.xs, paddingLeft: pane.left, paddingRight: pane.right }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg }}>
                <AccountMenu />
                <View style={{ flex: 1 }} />
                <WorkspaceMenu />
            </View>
            {selling ? (
                <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', gap: spacing.xl, paddingHorizontal: spacing.xl, paddingTop: spacing.xl, paddingBottom: insets.bottom + spacing.xxl }}>
                    <View style={{ alignItems: 'center', gap: spacing.xs }}>
                        <AppText variant="title" style={{ textAlign: 'center' }}>
                            {t('noPlan.title')}
                        </AppText>
                    </View>
                    <View style={{ width: '100%', maxWidth: 480, alignSelf: 'center' }}>
                        <PaywallCard state={paywall.state} provider={paywall.provider} onBuy={paywall.buy} onRestore={paywall.restore} onRetry={paywall.retry} />
                    </View>
                </ScrollView>
            ) : (
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
            )}
        </View>
    )
}
