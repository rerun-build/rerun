import type { PhoneChannel } from '@rerun/contracts'
import { useState } from 'react'
import { View } from 'react-native'
import { useTranslations } from 'use-intl'

import { CodeField } from '@/components/auth/CodeField'
import { useSignInFlow, type SignInStep } from '@/components/auth/SignInFlow'
import { StepTitle } from '@/components/auth/steps/StepTitle'
import { TextLink } from '@/components/auth/TextLink'
import { useSignInErrorText } from '@/components/auth/useSignInActions'
import { useSecondsSince } from '@/components/auth/useSecondsSince'
import { AppText } from '@/components/ui/AppText'
import { Button } from '@/components/ui/Button'
import { CODE_LENGTH, sendEmailCode, sendPhoneCode, signInWithEmail, signInWithPhone } from '@/auth/sign-in'
import { track } from '@/lib/analytics'
import { internationalNumber } from '@/lib/phone'
import { spacing } from '@/theme/tokens'

// Same waits as the web: a new code after a minute, the other channel after 20 seconds.
const RESEND_AFTER_SECONDS = 60
const SWITCH_AFTER_SECONDS = 20
const CHANNEL_NAMES: Record<PhoneChannel, string> = { whatsapp: 'WhatsApp', sms: 'SMS' }

export function CodeStep({ step }: { step: Extract<SignInStep, { name: 'code' }> }) {
    const { country, phone, email, back, setThinking } = useSignInFlow()
    const t = useTranslations('mobileAuth')
    const errorText = useSignInErrorText()
    const byPhone = step.method === 'phone'
    const [channel, setChannel] = useState<PhoneChannel>(step.method === 'phone' ? step.channel : 'sms')
    // Opened on a code sent earlier, the wait before a new one is what the hub said is left of it.
    const [sentAt, setSentAt] = useState(() => Date.now() - (step.method === 'phone' && step.resendIn !== undefined ? (RESEND_AFTER_SECONDS - step.resendIn) * 1000 : 0))
    const [code, setCode] = useState('')
    const [verifying, setVerifying] = useState(false)
    const [resending, setResending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const elapsed = useSecondsSince(sentAt)
    const resendIn = Math.max(0, RESEND_AFTER_SECONDS - elapsed)
    const otherChannel: PhoneChannel = channel === 'sms' ? 'whatsapp' : 'sms'

    // Once the session opens, the root layout swaps the sign-in screens for the app on its own.
    const verify = async (value: string) => {
        setVerifying(true)
        setThinking(true)
        setError(null)
        try {
            if (byPhone) {
                const created = await signInWithPhone({ phone, country, channel }, value)
                track('phone_verification_completed', { channel, context: 'sign_in' })
                if (created) track('account_created', { method: 'phone' })
            } else {
                await signInWithEmail(email.trim(), value)
            }
        } catch (failure) {
            setError(errorText(failure))
            setCode('')
            setVerifying(false)
            setThinking(false)
        }
    }

    const resend = async (to: PhoneChannel) => {
        setResending(true)
        setThinking(true)
        setError(null)
        try {
            if (byPhone) setChannel(await sendPhoneCode({ phone, country, channel: to }))
            else await sendEmailCode(email.trim())
            setSentAt(Date.now())
        } catch (failure) {
            setError(errorText(failure))
        } finally {
            setResending(false)
            setThinking(false)
        }
    }

    return (
        <>
            <StepTitle title={t('code.title')} subtitle={byPhone ? t('code.sentByPhone', { channel: CHANNEL_NAMES[channel], number: internationalNumber(phone, country) }) : t('code.sentByEmail', { email: email.trim() })} />
            <CodeField length={CODE_LENGTH} value={code} onChangeText={setCode} onComplete={verify} disabled={verifying} invalid={Boolean(error)} />
            {error && (
                <AppText variant="footnote" tone="destructive" style={{ textAlign: 'center' }}>
                    {error}
                </AppText>
            )}
            <Button label={t('code.continue')} size="lg" loading={verifying} disabled={code.length < CODE_LENGTH} onPress={() => verify(code)} />
            <View style={{ alignItems: 'center', gap: spacing.lg, marginTop: spacing.xs }}>
                <TextLink label={resendIn > 0 ? t('code.resendIn', { seconds: resendIn }) : t('code.resend')} disabled={resendIn > 0 || resending} onPress={() => resend(channel)} />
                {byPhone && elapsed >= SWITCH_AFTER_SECONDS && <TextLink label={t('code.switchChannel', { channel: CHANNEL_NAMES[otherChannel] })} disabled={resending} onPress={() => resend(otherChannel)} />}
                <TextLink label={byPhone ? t('code.differentNumber') : t('code.differentEmail')} onPress={back} />
            </View>
        </>
    )
}
