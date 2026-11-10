import { useState } from 'react'
import { TextInput } from 'react-native'
import { useTranslations } from 'use-intl'

import { FIELD_HEIGHT, FIELD_RADIUS } from '@/components/auth/PhoneField'
import { useSignInFlow } from '@/components/auth/SignInFlow'
import { StepTitle } from '@/components/auth/steps/StepTitle'
import { useEmailCode } from '@/components/auth/useSignInActions'
import { AppText } from '@/components/ui/AppText'
import { Button } from '@/components/ui/Button'
import { fieldOutline } from '@/theme/field'
import { useTheme } from '@/theme/theme'
import { fonts, spacing } from '@/theme/tokens'

export function EmailStep() {
    const theme = useTheme()
    const [focused, setFocused] = useState(false)
    const { email, setEmail } = useSignInFlow()
    const { send, sending, error, clearError } = useEmailCode()
    const t = useTranslations('mobileAuth')

    return (
        <>
            <StepTitle title={t('email.title')} />
            <TextInput
                value={email}
                onChangeText={text => {
                    setEmail(text)
                    clearError()
                }}
                onSubmitEditing={send}
                placeholder={t('email.placeholder')}
                placeholderTextColor={theme.mutedForeground}
                keyboardType="email-address"
                textContentType="emailAddress"
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                returnKeyType="send"
                accessibilityLabel={t('email.label')}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                maxFontSizeMultiplier={1.3}
                style={{ height: FIELD_HEIGHT, paddingHorizontal: spacing.lg, borderRadius: FIELD_RADIUS, borderCurve: 'continuous', ...fieldOutline(theme, { focused, invalid: !!error }), backgroundColor: theme.card, fontFamily: fonts.regular, fontSize: 17, color: theme.foreground }}
            />
            {error && (
                <AppText variant="footnote" tone="destructive">
                    {error}
                </AppText>
            )}
            <Button label={t('email.send')} size="lg" loading={sending} disabled={!email.trim()} onPress={send} />
        </>
    )
}
