import { router } from 'expo-router'
import { View } from 'react-native'
import { useTranslations } from 'use-intl'

import { PhoneField } from '@/components/auth/PhoneField'
import { useSignInFlow } from '@/components/auth/SignInFlow'
import { StepTitle } from '@/components/auth/steps/StepTitle'
import { useChannelLabel, usePhoneCode } from '@/components/auth/useSignInActions'
import { AppText } from '@/components/ui/AppText'
import { Button } from '@/components/ui/Button'
import { spacing } from '@/theme/tokens'

export function PhoneStep() {
    const { country, phone, setPhone } = useSignInFlow()
    const { channels, send, sending, error, clearError } = usePhoneCode()
    const t = useTranslations('mobileAuth')
    const channelLabel = useChannelLabel()

    return (
        <>
            <StepTitle title={t('phone.title')} />
            <PhoneField
                country={country}
                value={phone}
                autoFocus
                onChangeText={text => {
                    setPhone(text)
                    clearError()
                }}
                onPickCountry={() => router.push('/sign-in/country')}
                onSubmit={() => channels[0] && send(channels[0])}
                invalid={Boolean(error)}
            />
            {error && (
                <AppText variant="footnote" tone="destructive">
                    {error}
                </AppText>
            )}
            {channels.length === 0 ? (
                <AppText variant="callout" tone="muted" style={{ textAlign: 'center' }}>
                    {t('phone.unsupportedCountry')}
                </AppText>
            ) : (
                <View style={{ gap: spacing.sm }}>
                    {channels.map((channel, index) => (
                        <Button key={channel} label={channelLabel(channel)} size="lg" variant={index === 0 ? 'default' : 'outline'} loading={sending === channel} disabled={sending !== null || !phone} onPress={() => send(channel)} />
                    ))}
                </View>
            )}
            <AppText variant="caption" tone="muted" style={{ textAlign: 'center' }}>
                {t('phone.consent')}
            </AppText>
        </>
    )
}
