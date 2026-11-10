'use client'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { normalizeEmail } from '@/lib/email'
import { AlertTriangle } from '@/lib/icons'
import { zodResolver } from '@hookform/resolvers/zod'
import { getCookie, setSharedCookie, track } from '@rerun/analytics/client'
import { StepTransition } from '@rerun/ui/steps'
import { REGEXP_ONLY_DIGITS } from 'input-otp'
import { CaptchaError } from '@/components/auth/captcha/captcha-error'
import { useTranslations } from 'next-intl'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

export type EmailCodeStep = 'email' | 'code'

// `change` is the same two steps for an account that is already signed in and moves to a new
// address: nothing of it is a signup, and the button its email would carry leads nowhere.
export type EmailCodePurpose = 'sign-in' | 'change'

export const SIGN_IN_CODE_LENGTH = 6
// Supabase refuses a second code for the same address within a minute (auth.email.max_frequency).
const RESEND_COOLDOWN_SECONDS = 60

export type EmailSendOutcome = 'held' | void

type EmailTranslator = ReturnType<typeof useTranslations<'auth.email'>>

const emailSchemaFor = (t: EmailTranslator) => z.object({ email: z.string().trim().email(t('errors.invalidEmail')) })
const codeSchemaFor = (t: EmailTranslator) => z.object({ code: z.string().length(SIGN_IN_CODE_LENGTH, t('errors.codeLength', { length: SIGN_IN_CODE_LENGTH })) })

function markVerificationSent() {
    track('email_verification_sent', {})
    setSharedCookie('rr_verif_sent_at', String(Date.now()), 1)
}

function markVerificationCompleted() {
    const sentAt = Number(getCookie('rr_verif_sent_at'))
    track('email_verification_completed', { via: 'code', delay_seconds: sentAt ? Math.round((Date.now() - sentAt) / 1000) : undefined })
}

const analyticsMessage = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong. Please try again.')

// Supabase answers a wrong code and an expired one with the same error, so the copy covers both.
const isInvalidCode = (error: unknown) => error instanceof Error && /expired|invalid/i.test(error.message)

// Passwordless sign-in: an email, then the code mailed to it. The email also carries a button that
// signs in on its own through /auth/confirm, so this form is only one of the two ways through.
export function EmailCodeForm({
    defaultEmail = '',
    sendCode,
    verifyCode,
    onStepChange,
    beforeEmail,
    purpose = 'sign-in',
    initialSentTo,
}: {
    defaultEmail?: string
    // `held`: the last code left less than a minute ago, so none was mailed.
    sendCode: (email: string) => Promise<EmailSendOutcome>
    verifyCode: (email: string, code: string) => Promise<void>
    onStepChange?: (step: EmailCodeStep) => void
    beforeEmail?: ReactNode
    purpose?: EmailCodePurpose
    initialSentTo?: string
}) {
    const t = useTranslations('auth.email')
    const tCaptcha = useTranslations('auth.captcha')
    const emailSchema = useMemo(() => emailSchemaFor(t), [t])
    const codeSchema = useMemo(() => codeSchemaFor(t), [t])
    const errorMessage = (error: unknown) => {
        if (error instanceof CaptchaError) return tCaptcha(error.inAppBrowser ? 'failedInApp' : 'failed')
        return error instanceof Error ? error.message : t('errors.generic')
    }
    const [step, setStep] = useState<EmailCodeStep>(initialSentTo ? 'code' : 'email')
    const [email, setEmail] = useState(initialSentTo ?? '')
    const signingIn = purpose === 'sign-in'
    const [cooldown, setCooldown] = useState(0)
    const [resending, setResending] = useState(false)

    const emailForm = useForm<z.infer<typeof emailSchema>>({ resolver: zodResolver(emailSchema), defaultValues: { email: defaultEmail } })
    const codeForm = useForm<z.infer<typeof codeSchema>>({ resolver: zodResolver(codeSchema), defaultValues: { code: '' } })

    useEffect(() => {
        if (cooldown <= 0) return
        const timer = setTimeout(() => setCooldown(c => c - 1), 1000)
        return () => clearTimeout(timer)
    }, [cooldown])

    const goTo = (next: EmailCodeStep) => {
        setStep(next)
        onStepChange?.(next)
    }

    const submitEmail = emailForm.handleSubmit(
        async values => {
            if (signingIn) track('signup_method_selected', { method: 'email' })
            const normalized = normalizeEmail(values.email)
            try {
                await sendCode(normalized)
                if (signingIn) markVerificationSent()
                setEmail(normalized)
                codeForm.reset({ code: '' })
                setCooldown(RESEND_COOLDOWN_SECONDS)
                goTo('code')
            } catch (error) {
                toast.error(errorMessage(error))
            }
        },
        errors => {
            if (signingIn && errors.email?.type) track('signup_field_error', { field: 'email', error_type: String(errors.email.type) })
        },
    )

    const submitCode = codeForm.handleSubmit(async ({ code }) => {
        try {
            await verifyCode(email, code)
            if (signingIn) markVerificationCompleted()
        } catch (error) {
            if (signingIn) track('signup_field_error', { field: 'code', error_type: analyticsMessage(error) })
            codeForm.setError('code', { message: isInvalidCode(error) ? t('errors.invalidCode') : errorMessage(error) })
        }
    })

    const resend = async () => {
        setResending(true)
        try {
            const outcome = await sendCode(email)
            if (signingIn) markVerificationSent()
            codeForm.reset({ code: '' })
            setCooldown(RESEND_COOLDOWN_SECONDS)
            toast.success(outcome === 'held' ? t('code.held') : t('code.resent'))
        } catch (error) {
            toast.error(errorMessage(error))
        } finally {
            setResending(false)
        }
    }

    const changeEmail = () => {
        emailForm.reset({ email })
        goTo('email')
    }

    return (
        <StepTransition stepKey={step} direction={step === 'code' ? 1 : -1}>
            {step === 'email' ? (
                <div className="space-y-4">
                    {beforeEmail}
                    <Form {...emailForm}>
                        <form onSubmit={submitEmail} className="space-y-4">
                            <FormField
                                control={emailForm.control}
                                name="email"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormControl>
                                            <Input type="email" label={t('label')} placeholder="you@rerun.build" autoComplete="email" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <Button type="submit" className="w-full" loading={emailForm.formState.isSubmitting}>
                                {signingIn ? t('continue') : t('sendCode')}
                            </Button>
                        </form>
                    </Form>
                </div>
            ) : (
                <Form {...codeForm}>
                    <form onSubmit={submitCode} className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                            {t.rich(signingIn ? 'code.sentSignIn' : 'code.sent', {
                                length: SIGN_IN_CODE_LENGTH,
                                email,
                                address: chunks => <span className="font-medium text-foreground">{chunks}</span>,
                            })}
                        </p>
                        <FormField
                            control={codeForm.control}
                            name="code"
                            render={({ field }) => (
                                <FormItem className="flex flex-col items-center">
                                    <FormControl>
                                        <InputOTP
                                            maxLength={SIGN_IN_CODE_LENGTH}
                                            pattern={REGEXP_ONLY_DIGITS}
                                            autoComplete="one-time-code"
                                            autoFocus
                                            disabled={codeForm.formState.isSubmitting}
                                            {...field}
                                            onComplete={() => submitCode()}
                                        >
                                            <InputOTPGroup>
                                                {Array.from({ length: SIGN_IN_CODE_LENGTH }, (_, index) => (
                                                    <InputOTPSlot key={index} index={index} />
                                                ))}
                                            </InputOTPGroup>
                                        </InputOTP>
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <Alert variant="warning" beam={false}>
                            <AlertTriangle />
                            <AlertDescription>{t('code.spamHint')}</AlertDescription>
                        </Alert>
                        <Button type="submit" className="w-full" loading={codeForm.formState.isSubmitting}>
                            {t('code.submit')}
                        </Button>
                        <div className="flex items-center justify-between text-sm text-muted-foreground">
                            <button type="button" onClick={changeEmail} className="transition-colors hover:text-foreground">
                                {t('code.changeEmail')}
                            </button>
                            <TooltipDisabledReason reason={cooldown > 0 ? t('code.resendIn', { seconds: cooldown }) : undefined}>
                                <button
                                    type="button"
                                    onClick={resend}
                                    disabled={cooldown > 0 || resending}
                                    className="transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                                >
                                    {cooldown > 0 ? t('code.resendWait', { seconds: cooldown }) : t('code.resend')}
                                </button>
                            </TooltipDisabledReason>
                        </div>
                    </form>
                </Form>
            )}
        </StepTransition>
    )
}
