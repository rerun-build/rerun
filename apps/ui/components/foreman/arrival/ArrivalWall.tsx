'use client'

import { track } from '@moldwright/analytics/client'
import { useEffect } from 'react'

import { AuthTerms } from '@/components/auth/AuthShell'
import { PhoneVerificationStep } from '@moldwright/cloud/phone.client'
import { useAnonymousSignUp } from '@/components/auth/useAnonymousSignUp'

const SURFACE = 'ready_made_arrival'

function AccountStep() {
    const { form } = useAnonymousSignUp({ surface: SURFACE, active: true })

    useEffect(() => {
        track('signup_gate_viewed', { surface: SURFACE })
    }, [])

    return (
        <>
            {form}
            <p className="text-center text-xs text-muted-foreground">
                <AuthTerms />
            </p>
        </>
    )
}

export function ArrivalWall({ step }: { step: 'account' | 'phone' }) {
    return <div className="flex flex-col gap-6">{step === 'account' ? <AccountStep /> : <PhoneVerificationStep active />}</div>
}
