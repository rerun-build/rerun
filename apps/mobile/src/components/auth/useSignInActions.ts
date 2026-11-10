import { reachableChannels, type PhoneChannel } from '@rerun/contracts'
import { useState } from 'react'
import { useTranslations } from 'use-intl'

import { useSignInFlow } from '@/components/auth/SignInFlow'
import { signInWithApple } from '@/auth/apple'
import { signInWithGoogle } from '@/auth/google'
import { sendEmailCode, sendPhoneCode, SignInError } from '@/auth/sign-in'
import { track } from '@/lib/analytics'
import { isPossibleNumber } from '@/lib/phone'

const SEND_BY_KEYS = { whatsapp: 'phone.sendByWhatsapp', sms: 'phone.sendBySms' } as const

export function useChannelLabel(): (channel: PhoneChannel) => string {
    const t = useTranslations('mobileAuth')
    return channel => t(SEND_BY_KEYS[channel])
}

const REASON_KEYS = { network: 'errors.offline', session: 'errors.session', apple: 'errors.apple', google: 'errors.google' } as const

// The sentence of a failed sign-in in the app's language. A refusal of the hub the app has no sentence
// for yet keeps the hub's own words.
export function useSignInErrorText(): (failure: unknown) => string {
    const t = useTranslations('mobileAuth')
    return failure => {
        if (!(failure instanceof SignInError)) return t('errors.generic')
        if (Object.hasOwn(REASON_KEYS, failure.reason)) return t(REASON_KEYS[failure.reason as keyof typeof REASON_KEYS])
        if (!failure.method) return failure.message
        const key = `errors.${failure.method}.${failure.reason}` as Parameters<typeof t>[0]
        return t.has(key) ? t(key) : failure.message
    }
}

const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())

// The phone number leads: it signs into the account that holds it, or creates one.
export function usePhoneCode() {
    const { country, phone, goTo, setThinking } = useSignInFlow()
    const t = useTranslations('mobileAuth')
    const errorText = useSignInErrorText()
    const [sending, setSending] = useState<PhoneChannel | null>(null)
    const [error, setError] = useState<string | null>(null)
    const channels = reachableChannels(country, 'verify')

    const send = async (channel: PhoneChannel) => {
        if (!isPossibleNumber(phone, country)) return setError(t('errors.phone.invalid_number'))
        track('signup_method_selected', { method: 'phone' })
        setSending(channel)
        setThinking(true)
        setError(null)
        try {
            const sentBy = await sendPhoneCode({ phone, country, channel })
            goTo({ name: 'code', method: 'phone', channel: sentBy })
        } catch (failure) {
            // Back from the code step within the minute: the code already sent is still the one to type.
            if (failure instanceof SignInError && failure.reason === 'too_soon') {
                goTo({ name: 'code', method: 'phone', channel, resendIn: failure.retryAfterSeconds ?? 0 })
                return
            }
            setError(errorText(failure))
        } finally {
            setSending(null)
            setThinking(false)
        }
    }

    return { channels, send, sending, error, clearError: () => setError(null) }
}

export function useEmailCode() {
    const { email, goTo, setThinking } = useSignInFlow()
    const t = useTranslations('mobileAuth')
    const errorText = useSignInErrorText()
    const [sending, setSending] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const send = async () => {
        if (!looksLikeEmail(email)) return setError(t('errors.email.invalid_email'))
        track('signup_method_selected', { method: 'email' })
        setSending(true)
        setThinking(true)
        setError(null)
        try {
            await sendEmailCode(email.trim())
            goTo({ name: 'code', method: 'email' })
        } catch (failure) {
            setError(errorText(failure))
        } finally {
            setSending(false)
            setThinking(false)
        }
    }

    return { send, sending, error, clearError: () => setError(null) }
}

// Once the session opens, the root layout swaps the sign-in screens for the app on its own.
export function useOAuthSignIn() {
    const { setThinking } = useSignInFlow()
    const errorText = useSignInErrorText()
    const [signingIn, setSigningIn] = useState<'apple' | 'google' | null>(null)
    const [error, setError] = useState<string | null>(null)

    const continueWith = async (method: 'apple' | 'google') => {
        if (signingIn) return
        track('signup_method_selected', { method })
        setSigningIn(method)
        setThinking(true)
        setError(null)
        try {
            await (method === 'apple' ? signInWithApple() : signInWithGoogle())
        } catch (failure) {
            setError(errorText(failure))
        } finally {
            setSigningIn(null)
            setThinking(false)
        }
    }

    return { continueWith, signingIn, error }
}
