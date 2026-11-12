import type { StoreProvider } from '@rerun/contracts'
import { useLocalSearchParams } from 'expo-router'
import { ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { PaywallCard } from '@/components/billing/PaywallCard'
import { AppText } from '@/components/ui/AppText'
import type { PaywallState } from '@/store/usePaywall'
import { ThemeScope, useColorSchemeName } from '@/theme/theme'
import { palette, spacing, type ColorScheme } from '@/theme/tokens'

// Dev only: the store's offer in each of its states, on mock data.
//   /lab-paywall?state=trial&provider=google&scheme=dark
//   state: all | trial | paid | buying | verifying | restoring | failed | pending | elsewhere | expired | nothing | loading | member | no_product
const TRIAL = { productId: 'rerun.base.monthly', displayPrice: '$29.99', trialDays: 7, offerToken: null }
const PAID = { ...TRIAL, trialDays: null }

const STATES: Record<string, PaywallState> = {
    trial: { step: 'ready', product: TRIAL, notice: null },
    paid: { step: 'ready', product: PAID, notice: null },
    buying: { step: 'buying', product: TRIAL, notice: null },
    verifying: { step: 'verifying', product: TRIAL, notice: null },
    restoring: { step: 'restoring', product: PAID, notice: null },
    failed: { step: 'ready', product: TRIAL, notice: 'failed' },
    pending: { step: 'ready', product: TRIAL, notice: 'pending' },
    elsewhere: { step: 'ready', product: TRIAL, notice: 'linked_elsewhere' },
    expired: { step: 'ready', product: PAID, notice: 'expired' },
    nothing: { step: 'ready', product: PAID, notice: 'nothing_to_restore' },
    loading: { step: 'loading' },
    member: { step: 'unavailable', reason: 'member' },
    no_product: { step: 'unavailable', reason: 'no_product' },
}

export default function PaywallLab() {
    const params = useLocalSearchParams<{ state?: string; provider?: StoreProvider; scheme?: ColorScheme }>()
    const system = useColorSchemeName()
    const insets = useSafeAreaInsets()
    const scheme = params.scheme === 'dark' || params.scheme === 'light' ? params.scheme : system
    const provider: StoreProvider = params.provider === 'google' ? 'google' : 'apple'
    const shown = params.state && STATES[params.state] ? [params.state] : Object.keys(STATES)
    const noop = () => {}

    return (
        <ThemeScope scheme={scheme}>
            <ScrollView style={{ flex: 1, backgroundColor: palette[scheme].background }} contentContainerStyle={{ gap: spacing.xl, padding: spacing.xl, paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xxl }}>
                {shown.map(name => (
                    <View key={name} style={{ gap: spacing.sm, width: '100%', maxWidth: 480, alignSelf: 'center' }}>
                        {shown.length > 1 && (
                            <AppText variant="caption" tone="muted">
                                {name}
                            </AppText>
                        )}
                        <PaywallCard state={STATES[name]} provider={provider} onBuy={noop} onRestore={noop} onRetry={noop} />
                    </View>
                ))}
            </ScrollView>
        </ThemeScope>
    )
}
