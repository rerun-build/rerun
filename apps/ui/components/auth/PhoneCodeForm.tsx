'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { LastUsedBadge } from '@/components/auth/LastUsedBadge'
import { PhoneSendError } from '@/components/auth/phone-send'
import { CaptchaError } from '@/components/auth/captcha/captcha-error'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import { PhoneNumberInput } from '@/components/ui/phone-number-input'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { countryFromLocale, countryOfE164, countryOfTyped, toE164 } from '@/lib/phone/normalize'
import { reachableChannels } from '@/lib/phone/reach'
import { clearSentCode, readSentCode, writeSentCode } from '@/lib/phone/sent-code'
import { VERIFICATION_CODE_LENGTH, type VerificationChannel } from '@/lib/phone/verification'
import { zodResolver } from '@hookform/resolvers/zod'
import { StepTransition } from '@rerun/ui/steps'
import { REGEXP_ONLY_DIGITS } from 'input-otp'
import type { CountryCode } from 'libphonenumber-js/min'
import { useTranslations } from 'next-intl'
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

export type PhoneCodeRequest = { phone: string; country: CountryCode; channel: VerificationChannel }
export type PhoneCodeStep = 'phone' | 'code'

// The server holds a new code on the same channel back for a minute (MIN_RESEND_INTERVAL_MS), and
// one on the other channel for 20 seconds (MIN_SWITCH_INTERVAL_MS).
const RESEND_COOLDOWN_MS = 60_000
const SWITCH_COOLDOWN_MS = 20_000
// Long enough for a code that is coming to have come: past it, the other channel is offered outright.
const NUDGE_AFTER_MS = 30_000

const CHANNEL_NAMES: Record<VerificationChannel, string> = { sms: 'SMS', whatsapp: 'WhatsApp' }

type PhoneTranslator = ReturnType<typeof useTranslations<'auth.phone'>>

const phoneSchemaFor = (t: PhoneTranslator) => z.object({ phone: z.string().trim().min(1, t('errors.phoneRequired')) })
const codeSchemaFor = (t: PhoneTranslator) => z.object({ code: z.string().length(VERIFICATION_CODE_LENGTH, t('errors.codeLength', { length: VERIFICATION_CODE_LENGTH })) })

const FALLBACK_COUNTRY = countryFromLocale(undefined)
const neverChanges = () => () => {}

const errorMessage = (error: unknown, t: PhoneTranslator, tCaptcha: ReturnType<typeof useTranslations<'auth.captcha'>>, errorText: ReturnType<typeof useErrorText>) => {
    if (error instanceof CaptchaError) return tCaptcha(error.inAppBrowser ? 'failedInApp' : 'failed')
    if (error instanceof PhoneSendError) return errorText(error.refusal)
    return error instanceof Error ? error.message : t('errors.generic')
}

const retryAfterMs = (error: unknown) => (error instanceof PhoneSendError && error.retryAfterSeconds ? error.retryAfterSeconds * 1000 : null)

const secondsLeft = (until: number, now: number) => Math.max(0, Math.ceil((until - now) / 1000))

const formatWait = (seconds: number, t: PhoneTranslator) => (seconds < 60 ? t('wait.seconds', { count: seconds }) : t('wait.minutes', { count: Math.ceil(seconds / 60) }))

function WhatsAppIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
        </svg>
    )
}

// A phone number, then the code sent to it over the channel the visitor picked.
export function PhoneCodeForm({
    initialSent = null,
    sendCode,
    verifyCode,
    beforePhone,
    afterPhone,
    onStepChange,
    persistKey,
    phoneLastUsed = false,
}: {
    // A code already out when the form mounts, for the lab to open on the second step.
    initialSent?: PhoneCodeRequest | null
    // Names the code this form sent in the tab's storage, so a reload comes back to the code step.
    persistKey?: string
    // Resolves with the channel the code actually went by, when the server knows it.
    sendCode: (request: PhoneCodeRequest) => Promise<VerificationChannel | void>
    verifyCode: (code: string, request: PhoneCodeRequest) => Promise<void>
    // Shown around the number step only: the other ways in, where this form is one of several.
    beforePhone?: ReactNode
    afterPhone?: ReactNode
    onStepChange?: (step: PhoneCodeStep) => void
    // This number was the way in last time on this browser, badged beside the field's title.
    phoneLastUsed?: boolean
}) {
    const t = useTranslations('auth.phone')
    const tCaptcha = useTranslations('auth.captcha')
    const errorText = useErrorText()
    const phoneSchema = useMemo(() => phoneSchemaFor(t), [t])
    const codeSchema = useMemo(() => codeSchemaFor(t), [t])
    const [step, setStep] = useState<PhoneCodeStep>(initialSent ? 'code' : 'phone')
    // The server has no idea where the visitor is, so the guess only joins in on the client.
    const localeCountry = useSyncExternalStore(
        neverChanges,
        () => countryFromLocale(navigator.language),
        () => FALLBACK_COUNTRY
    )
    const [pickedCountry, setPickedCountry] = useState<CountryCode | null>(null)
    const country = pickedCountry ?? localeCountry
    const [sent, setSent] = useState<PhoneCodeRequest | null>(initialSent)
    const [sending, setSending] = useState<VerificationChannel | null>(null)
    // Timestamps, read against `now`: when the last code left, and when each next one may.
    const [sentAt, setSentAt] = useState(0)
    const [resendAt, setResendAt] = useState(0)
    const [switchAt, setSwitchAt] = useState(0)
    // The wait the server asked for on the number step, for the number it refused.
    const [retryAt, setRetryAt] = useState(0)
    const [now, setNow] = useState(0)

    const phoneForm = useForm<z.infer<typeof phoneSchema>>({ resolver: zodResolver(phoneSchema), defaultValues: { phone: '' } })
    const codeForm = useForm<z.infer<typeof codeSchema>>({ resolver: zodResolver(codeSchema), defaultValues: { code: '' } })
    // The picker keeps its country on a shared calling code, the number itself does not: the
    // channels follow the number as soon as it is complete, as the server will.
    const typedPhone = useWatch({ control: phoneForm.control, name: 'phone' })
    const channels = reachableChannels(countryOfTyped(typedPhone, country), 'verify')

    const ticking = step === 'code' || retryAt > now
    useEffect(() => {
        if (!ticking) return
        const timer = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(timer)
    }, [ticking])

    const goTo = (next: PhoneCodeStep) => {
        setStep(next)
        onStepChange?.(next)
    }

    const startWaits = (at: number) => {
        setSentAt(at)
        setResendAt(at + RESEND_COOLDOWN_MS)
        setSwitchAt(at + SWITCH_COOLDOWN_MS)
        setRetryAt(0)
        setNow(Date.now())
    }

    useEffect(() => {
        if (!persistKey || initialSent) return
        const restored = readSentCode(persistKey)
        if (!restored) return
        const { request, sentAt: restoredSentAt } = restored
        // The tab's storage only exists once hydrated: read during render, the server and the
        // browser would draw two different steps.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSent(request)
        setPickedCountry(request.country)
        phoneForm.reset({ phone: request.phone })
        startWaits(restoredSentAt)
        goTo('code')
    }, [persistKey])

    const deliver = async (request: PhoneCodeRequest) => {
        setSending(request.channel)
        try {
            const channel = (await sendCode(request)) ?? request.channel
            const at = Date.now()
            if (persistKey) writeSentCode(persistKey, { ...request, channel }, at)
            setSent({ ...request, channel })
            codeForm.reset({ code: '' })
            startWaits(at)
            return channel
        } finally {
            setSending(null)
        }
    }

    const submitPhone = (channel: VerificationChannel) =>
        phoneForm.handleSubmit(async ({ phone }) => {
            if (!toE164(phone, country)) {
                phoneForm.setError('phone', { message: t('errors.invalidNumber') })
                return
            }
            try {
                await deliver({ phone, country, channel })
                goTo('code')
            } catch (error) {
                const wait = retryAfterMs(error)
                if (wait) {
                    setRetryAt(Date.now() + wait)
                    setNow(Date.now())
                }
                phoneForm.setError('phone', { message: errorMessage(error, t, tCaptcha, errorText) })
            }
        })()

    const submitCode = codeForm.handleSubmit(async ({ code }) => {
        if (!sent) return
        try {
            await verifyCode(code, sent)
            if (persistKey) clearSentCode(persistKey)
        } catch (error) {
            codeForm.setError('code', { message: errorMessage(error, t, tCaptcha, errorText) })
        }
    })

    const changeNumber = () => {
        if (persistKey) clearSentCode(persistKey)
        goTo('phone')
    }

    const resend = async (channel: VerificationChannel) => {
        if (!sent) return
        const switching = channel !== sent.channel
        try {
            const went = await deliver({ ...sent, channel })
            toast.success(t('code.resent', { channel: CHANNEL_NAMES[went] }))
        } catch (error) {
            const wait = retryAfterMs(error)
            if (wait) (switching ? setSwitchAt : setResendAt)(Date.now() + wait)
            toast.error(errorMessage(error, t, tCaptcha, errorText))
        }
    }

    const resendIn = secondsLeft(resendAt, now)
    const switchIn = secondsLeft(switchAt, now)
    const retryIn = secondsLeft(retryAt, now)
    const nudged = !!sent && sentAt > 0 && now - sentAt >= NUDGE_AFTER_MS
    const sentChannel = sent?.channel ?? 'sms'
    const otherChannel: VerificationChannel = sentChannel === 'sms' ? 'whatsapp' : 'sms'
    const sentTo = sent ? (toE164(sent.phone, sent.country) ?? sent.phone) : ''
    const canSwitch = !!sent && reachableChannels(countryOfE164(sentTo), 'verify').includes(otherChannel)
    const sendByLabel = (channel: VerificationChannel) =>
        retryIn > 0 ? t('sendByWait', { channel: CHANNEL_NAMES[channel], wait: formatWait(retryIn, t) }) : t('sendBy', { channel: CHANNEL_NAMES[channel] })

    return (
        <StepTransition stepKey={step} direction={step === 'code' ? 1 : -1}>
            {step === 'phone' ? (
                <div className="space-y-4">
                    {beforePhone}
                    <Form {...phoneForm}>
                        <form
                            onSubmit={event => {
                                event.preventDefault()
                                const [firstChannel] = channels
                                if (firstChannel) void submitPhone(firstChannel)
                            }}
                            className="space-y-4"
                        >
                            <FormField
                                control={phoneForm.control}
                                name="phone"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormControl>
                                            <PhoneNumberInput
                                                label={t('label')}
                                                labelTrailing={phoneLastUsed && <LastUsedBadge />}
                                                autoFocus
                                                country={country}
                                                {...field}
                                                onCountryChange={picked => {
                                                    setRetryAt(0)
                                                    setPickedCountry(picked)
                                                }}
                                                onChange={value => {
                                                    setRetryAt(0)
                                                    field.onChange(value)
                                                }}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            {channels.length === 0 ? (
                                <p className="text-sm text-muted-foreground text-balance">{t('unsupportedCountry')}</p>
                            ) : (
                                <div className="space-y-2">
                                    {channels.includes('whatsapp') && (
                                        <Button
                                            type="button"
                                            className="w-full bg-[#25D366] text-[#111B21] border-[#1A9E4B] [--relief-solid:0_1px_2px_0_rgb(0_0_0/0.18)] [--relief-solid-hover:0_1px_2px_0_rgb(0_0_0/0.22)] hover:border-[#178C42] hover:bg-[#20BD5A]"
                                            loading={sending === 'whatsapp'}
                                            disabled={sending !== null || retryIn > 0}
                                            onClick={() => submitPhone('whatsapp')}
                                        >
                                            <WhatsAppIcon />
                                            {sendByLabel('whatsapp')}
                                        </Button>
                                    )}
                                    {channels.includes('sms') && (
                                        <Button
                                            type="button"
                                            variant={channels[0] === 'sms' ? 'default' : 'outline'}
                                            className="w-full"
                                            loading={sending === 'sms'}
                                            disabled={sending !== null || retryIn > 0}
                                            onClick={() => submitPhone('sms')}
                                        >
                                            {sendByLabel('sms')}
                                        </Button>
                                    )}
                                </div>
                            )}
                            <p className="text-center text-xs text-muted-foreground text-balance">
                                {t('consent')}
                            </p>
                        </form>
                    </Form>
                    {afterPhone}
                </div>
            ) : (
                <Form {...codeForm}>
                    <form onSubmit={submitCode} className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                            {t.rich('code.sent', {
                                length: VERIFICATION_CODE_LENGTH,
                                phone: sentTo,
                                channel: CHANNEL_NAMES[sentChannel],
                                number: chunks => <span className="font-medium text-foreground">{chunks}</span>,
                            })}
                        </p>
                        <FormField
                            control={codeForm.control}
                            name="code"
                            render={({ field }) => (
                                <FormItem className="flex flex-col items-center">
                                    <FormControl>
                                        <InputOTP
                                            maxLength={VERIFICATION_CODE_LENGTH}
                                            pattern={REGEXP_ONLY_DIGITS}
                                            autoComplete="one-time-code"
                                            autoFocus
                                            disabled={codeForm.formState.isSubmitting}
                                            {...field}
                                            onComplete={() => submitCode()}
                                        >
                                            <InputOTPGroup>
                                                {Array.from({ length: VERIFICATION_CODE_LENGTH }, (_, index) => (
                                                    <InputOTPSlot key={index} index={index} />
                                                ))}
                                            </InputOTPGroup>
                                        </InputOTP>
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <Button type="submit" className="w-full" loading={codeForm.formState.isSubmitting}>
                            {t('code.submit')}
                        </Button>
                        {nudged && canSwitch && (
                            <Button type="button" variant="outline" className="w-full" loading={sending === otherChannel} disabled={sending !== null || switchIn > 0} onClick={() => resend(otherChannel)}>
                                {t('code.nudge', { channel: CHANNEL_NAMES[otherChannel] })}
                            </Button>
                        )}
                        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm text-muted-foreground">
                            <button type="button" onClick={changeNumber} className="transition-colors hover:text-foreground">
                                {t('code.changeNumber')}
                            </button>
                            <TooltipDisabledReason reason={resendIn > 0 ? t('code.resendIn', { seconds: resendIn }) : undefined}>
                                <button
                                    type="button"
                                    onClick={() => resend(sentChannel)}
                                    disabled={resendIn > 0 || sending !== null}
                                    className="transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                                >
                                    {resendIn > 0 ? t('code.resendWait', { wait: formatWait(resendIn, t) }) : t('code.resend')}
                                </button>
                            </TooltipDisabledReason>
                        </div>
                        {!nudged && canSwitch && (
                            <div className="flex justify-center text-sm text-muted-foreground">
                                <TooltipDisabledReason reason={switchIn > 0 ? t('code.switchIn', { channel: CHANNEL_NAMES[otherChannel], seconds: switchIn }) : undefined}>
                                    <button
                                        type="button"
                                        onClick={() => resend(otherChannel)}
                                        disabled={switchIn > 0 || sending !== null}
                                        className="transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                                    >
                                        {switchIn > 0 ? t('code.switchWait', { channel: CHANNEL_NAMES[otherChannel], wait: formatWait(switchIn, t) }) : t('code.switch', { channel: CHANNEL_NAMES[otherChannel] })}
                                    </button>
                                </TooltipDisabledReason>
                            </div>
                        )}
                    </form>
                </Form>
            )}
        </StepTransition>
    )
}
