import type { StoreProvider } from '@rerun/contracts'
import * as WebBrowser from 'expo-web-browser'
import { Pressable, View } from 'react-native'
import { useTranslations } from 'use-intl'

import { ForemanOrb } from '@/components/orb/ForemanOrb'
import { AppText } from '@/components/ui/AppText'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import type { PaywallState } from '@/store/usePaywall'
import { useTheme } from '@/theme/theme'
import { radius, spacing } from '@/theme/tokens'

export const TERMS_URL = 'https://rerun.build/terms'
export const PRIVACY_URL = 'https://rerun.build/privacy'

type PaywallCardProps = {
    state: PaywallState
    provider: StoreProvider
    onBuy: () => void
    onRestore: () => void
    onRetry: () => void
}

function Frame({ children }: { children: React.ReactNode }) {
    const theme = useTheme()
    return <View style={{ gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, borderCurve: 'continuous', borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card }}>{children}</View>
}

function TextLink({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
    return (
        <Pressable accessibilityRole="link" hitSlop={10} disabled={disabled} onPress={onPress} style={({ pressed }) => ({ opacity: pressed || disabled ? 0.5 : 1, minHeight: 28, justifyContent: 'center' })}>
            <AppText variant="footnote" tone="muted" style={{ textDecorationLine: 'underline' }}>
                {label}
            </AppText>
        </Pressable>
    )
}

// The plan's offer, as the store sells it: what it is, its price per month as the store shows it, the
// free week when this account still has it, the automatic renewal and how to stop it, the terms and
// the privacy policy, and Restore purchases. What App Review checks on a subscription's purchase
// screen (guideline 3.1.2) is all here, on both stores.
export function PaywallCard({ state, provider, onBuy, onRestore, onRetry }: PaywallCardProps) {
    const t = useTranslations('mobileBilling.paywall')

    if (state.step === 'loading') {
        return (
            <Frame>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                    <ForemanOrb size={32} state="thinking" />
                    <View style={{ flex: 1, gap: spacing.xs }}>
                        <Skeleton style={{ height: 16, width: '70%', borderRadius: 6 }} />
                        <Skeleton style={{ height: 12, width: '45%', borderRadius: 6 }} />
                    </View>
                </View>
                <Skeleton style={{ height: 44, borderRadius: 22 }} />
            </Frame>
        )
    }

    if (state.step === 'unavailable') {
        const member = state.reason === 'member'
        return (
            <Frame>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                    <ForemanOrb size={32} state="idle" />
                    <AppText variant="callout" tone="muted" style={{ flex: 1 }}>
                        {member ? t('unavailable.member') : t('unavailable.no_product')}
                    </AppText>
                </View>
                {!member && <Button label={t('unavailable.retry')} variant="outline" onPress={onRetry} />}
            </Frame>
        )
    }

    if (state.step === 'entitled') return null

    const { product, notice } = state
    const trial = product.trialDays !== null
    const busy = state.step !== 'ready'
    const showNotice = notice && notice !== 'cancelled'
    return (
        <Frame>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <ForemanOrb size={32} state={busy ? 'thinking' : 'idle'} />
                <View style={{ flex: 1, gap: 2 }}>
                    <AppText variant="headline">{trial ? t('trialTitle', { days: product.trialDays ?? 0 }) : t('paidTitle')}</AppText>
                    <AppText variant="footnote" tone="muted">
                        {trial ? t('then', { price: product.displayPrice }) : t('monthly', { price: product.displayPrice })}
                    </AppText>
                </View>
            </View>
            <AppText variant="callout">{t('includes')}</AppText>
            {showNotice && (
                <AppText variant="footnote" tone={notice === 'pending' || notice === 'nothing_to_restore' ? 'muted' : 'destructive'} accessibilityLiveRegion="polite">
                    {t(`notice.${notice}`)}
                </AppText>
            )}
            {notice === 'failed' && state.step === 'ready' ? (
                <Button label={t('notice.tryAgain')} onPress={onRetry} size="lg" />
            ) : (
                <Button label={state.step === 'verifying' ? t('confirming') : trial ? t('startTrial') : t('subscribe')} onPress={onBuy} size="lg" loading={busy} disabled={busy} />
            )}
            <AppText variant="caption" tone="muted">
                {t('renews', { store: provider, price: product.displayPrice })}
            </AppText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: spacing.lg }}>
                <TextLink label={t('restore')} onPress={onRestore} disabled={busy} />
                <TextLink label={t('terms')} onPress={() => void WebBrowser.openBrowserAsync(TERMS_URL)} />
                <TextLink label={t('privacy')} onPress={() => void WebBrowser.openBrowserAsync(PRIVACY_URL)} />
            </View>
        </Frame>
    )
}
