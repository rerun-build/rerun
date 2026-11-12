import { chatErrorTitle, classifyChatError, friendlyError } from '@rerun/contracts'
import { View } from 'react-native'
import { useTranslations } from 'use-intl'

import { AppText } from '@/components/ui/AppText'
import { PillButton } from '@/components/ui/PillButton'
import { ProviderLogo } from '@/components/ui/ProviderLogo'
import { useTheme } from '@/theme/theme'
import { radius, spacing, withAlpha } from '@/theme/tokens'

export type ErrorCardActions = {
    onRetry: () => void
    // Sign in again on the connection the coworker runs on.
    onReconnect?: () => void
    onSwitchModel?: () => void
    onConnect?: (provider: 'claude' | 'codex') => void
    // On a free week sold by the app's store: the stores cannot end a trial early, so the plan's
    // credit only comes with the first paid month, which the card says instead of selling more.
    storeTrial?: boolean
}

// The web's ProviderErrorNotice and BudgetExhaustedNotice, without what the app cannot sell: a
// refusal that repeats on every send is offered its fix instead of a retry. A fix the screen does not
// offer falls back to Try again.
export function ErrorCard({ message, onRetry, onReconnect, onSwitchModel, onConnect, storeTrial }: { message: string } & ErrorCardActions) {
    const theme = useTheme()
    const t = useTranslations('mobileChat.error')
    const tErrors = useTranslations('chatErrors')
    const tBilling = useTranslations('mobileBilling')
    const kind = classifyChatError(message)
    const budget = kind === 'budget' && onConnect
    const reconnect = kind === 'unauthorized' && onReconnect
    const switchable = (kind === 'usage_limit' || kind === 'provider_error' || kind === 'context_window' || kind === 'overloaded' || kind === 'generic') && onSwitchModel
    // A conversation the coworker cannot reach answers every resend the same way.
    const retry = !budget && !reconnect && kind !== 'session_gone' && (kind === 'overloaded' || kind === 'generic' || kind === 'interrupted' || kind === 'run_in_flight' || kind === 'thinking_replay' || !switchable)

    return (
        <View style={{ gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, borderCurve: 'continuous', borderWidth: 1, borderColor: withAlpha(theme.destructive, 0.35), backgroundColor: withAlpha(theme.destructive, theme.scheme === 'dark' ? 0.1 : 0.05) }}>
            <AppText variant="headline">{budget ? t('creditsTitle') : (chatErrorTitle(kind, message, tErrors) ?? t('fallbackTitle'))}</AppText>
            <AppText variant="callout" tone="muted">
                {budget ? t('creditsBody') : friendlyError(message, tErrors)}
            </AppText>
            {budget && storeTrial && (
                <AppText variant="footnote" tone="muted">
                    {tBilling('creditsOnTrial')}
                </AppText>
            )}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                {budget && (
                    <>
                        <PillButton label={t('connectClaude')} icon={<ProviderLogo provider="claude" size={14} />} onPress={() => onConnect('claude')} />
                        <PillButton label={t('connectChatGpt')} icon={<ProviderLogo provider="openai" size={14} color={theme.primaryForeground} />} onPress={() => onConnect('codex')} />
                    </>
                )}
                {reconnect && <PillButton label={t('reconnect')} onPress={onReconnect} />}
                {retry && <PillButton label={t('tryAgain')} variant="secondary" onPress={onRetry} />}
                {switchable && <PillButton label={t('switchModel')} variant={retry ? 'secondary' : 'primary'} onPress={onSwitchModel} />}
            </View>
        </View>
    )
}
