'use client'

import { EmailCodeForm, type EmailCodeStep, type EmailSendOutcome } from '@/components/auth/EmailCodeForm'
import type { GetCaptchaToken } from '@/components/auth/captcha/captcha-error'
import { useCaptcha } from '@/components/auth/captcha/useCaptcha'
import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

export function AnonymousEmailStep({ sendCode, verifyCode, onStepChange, beforeEmail }: { sendCode: (email: string, getToken: GetCaptchaToken) => Promise<EmailSendOutcome>; verifyCode: (email: string, code: string) => Promise<void>; onStepChange: (step: EmailCodeStep) => void; beforeEmail?: ReactNode }) {
    const { containerRef, challenging, getToken } = useCaptcha()
    return (
        <div>
            <EmailCodeForm sendCode={email => sendCode(email, getToken)} verifyCode={verifyCode} onStepChange={onStepChange} beforeEmail={beforeEmail} />
            <div ref={containerRef} className={cn('flex justify-center', challenging && 'mt-4')} />
        </div>
    )
}
