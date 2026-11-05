'use client'

import { EmailCodeForm, type EmailCodeStep, type EmailSendOutcome } from '@/components/auth/EmailCodeForm'
import { useTurnstile } from '@/components/auth/useTurnstile'
import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

export type GetCaptchaToken = () => Promise<string | undefined>

// The captcha lives next to the form it guards, not in `useAnonymousSignUp`: the widget is drawn
// into its container once, when the hook mounts, and the account dialog only mounts the form once
// it opens. Here the hook and the container mount together.
export function AnonymousEmailStep({ sendCode, verifyCode, onStepChange, beforeEmail }: { sendCode: (email: string, getToken: GetCaptchaToken) => Promise<EmailSendOutcome>; verifyCode: (email: string, code: string) => Promise<void>; onStepChange: (step: EmailCodeStep) => void; beforeEmail?: ReactNode }) {
    const { containerRef, challenging, getToken } = useTurnstile()
    return (
        <div>
            <EmailCodeForm sendCode={email => sendCode(email, getToken)} verifyCode={verifyCode} onStepChange={onStepChange} beforeEmail={beforeEmail} />
            <div ref={containerRef} className={cn('flex justify-center', challenging && 'mt-4')} />
        </div>
    )
}
