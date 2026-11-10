'use client'

import { useTranslations } from 'next-intl'
import { useRef, useState } from 'react'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'

const CODE_LENGTH = 6

// A native form field: the gate works without a script, and with one the code sends itself once its
// sixth digit is typed.
export function GateCodeField({ invalid }: { invalid?: boolean }) {
    const t = useTranslations('published.gate')
    const [value, setValue] = useState('')
    const ref = useRef<HTMLDivElement>(null)
    return (
        <div ref={ref} className="flex justify-center">
            <InputOTP
                name="code"
                maxLength={CODE_LENGTH}
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                value={value}
                onChange={setValue}
                onComplete={() => ref.current?.closest('form')?.requestSubmit()}
                aria-invalid={invalid || undefined}
                aria-label={t('code')}
            >
                <InputOTPGroup>
                    {Array.from({ length: CODE_LENGTH }, (_, index) => (
                        <InputOTPSlot key={index} index={index} aria-invalid={invalid || undefined} />
                    ))}
                </InputOTPGroup>
            </InputOTP>
        </div>
    )
}
