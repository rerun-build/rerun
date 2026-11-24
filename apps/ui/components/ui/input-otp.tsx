'use client'

import * as React from 'react'
import { OTPInput, OTPInputContext } from 'input-otp'

import { cn } from '@/lib/utils'

function InputOTP({ className, containerClassName, ...props }: React.ComponentProps<typeof OTPInput> & { containerClassName?: string }) {
    return (
        <OTPInput
            data-slot="input-otp"
            dir="ltr"
            containerClassName={cn('flex items-center gap-2 has-disabled:opacity-50', containerClassName)}
            className={cn('disabled:cursor-not-allowed', className)}
            {...props}
        />
    )
}

function InputOTPGroup({ className, ...props }: React.ComponentProps<'div'>) {
    return <div data-slot="input-otp-group" className={cn('flex items-center gap-2', className)} {...props} />
}

function InputOTPSlot({ index, className, ...props }: React.ComponentProps<'div'> & { index: number }) {
    const inputOTPContext = React.useContext(OTPInputContext)
    const { char, hasFakeCaret, isActive } = inputOTPContext?.slots[index] ?? {}

    return (
        <div
            data-slot="input-otp-slot"
            data-active={isActive}
            className={cn(
                'relative flex h-12 w-10 items-center justify-center rounded-lg border border-input bg-background font-mono text-lg transition-all aria-invalid:border-red-500 data-[active=true]:z-10 data-[active=true]:border-primary data-[active=true]:ring-1 data-[active=true]:ring-primary',
                className,
            )}
            {...props}
        >
            {char}
            {hasFakeCaret && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="h-5 w-px animate-caret-blink bg-foreground duration-1000" />
                </div>
            )}
        </div>
    )
}

export { InputOTP, InputOTPGroup, InputOTPSlot }
