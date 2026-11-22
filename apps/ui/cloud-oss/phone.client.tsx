'use client'

import type { ReactNode } from 'react'

// Never rendered: every caller checks PHONE_ENABLED first. Kept so the callers type-check.
export function PhoneChangeForm(_props: { onChanged: () => Promise<void> }) {
    return null
}

export function PhoneSignIn(_props: { onSignedIn: (created: boolean) => void | Promise<void>; onStepChange?: (step: 'phone' | 'code') => void; beforePhone?: ReactNode; afterPhone?: ReactNode; phoneLastUsed?: boolean; skipCaptcha?: boolean }) {
    return null
}

export function PhoneVerificationStep(_props: { active: boolean }) {
    return null
}

export function PhoneVerificationDialog(_props: { open: boolean }) {
    return null
}
