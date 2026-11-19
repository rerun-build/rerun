'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { savePhoneNumberAction, skipPhoneStepAction } from '@/app/api/_actions/phone.actions'
import { PhoneNumberForm, type PhoneNumberRequest } from '@/components/auth/PhoneNumberForm'
import { useSession } from '@/supabase/session/SessionProvider'
import { track } from '@moldwright/analytics/client'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'

export function PhoneVerificationStep({ active }: { active: boolean }) {
    const t = useTranslations('auth.phoneStep')
    const errorText = useErrorText()
    const { refreshPhoneStep, signOut } = useSession()

    const viewed = useRef(false)
    useEffect(() => {
        if (!active || viewed.current) return
        viewed.current = true
        track('phone_wall_viewed', {})
    }, [active])

    const submit = async ({ phone, country }: PhoneNumberRequest) => {
        const result = await savePhoneNumberAction({ phone, country })
        if (!result.ok) throw new Error(errorText(result))
        track('phone_wall_submitted', { country })
        await refreshPhoneStep()
    }

    const skip = async () => {
        const result = await skipPhoneStepAction()
        if (!result.ok) {
            toast.error(t('skipFailed'))
            return
        }
        track('phone_wall_skipped', {})
        await refreshPhoneStep()
    }

    return (
        <>
            <PhoneNumberForm submit={submit} skip={skip} />
            <div className="flex flex-col items-center gap-2">
                <p className="text-center text-sm text-muted-foreground">
                    {t.rich('notYou', {
                        signOut: chunks => (
                            <button type="button" onClick={signOut} className="underline underline-offset-4 transition-colors hover:text-foreground">
                                {chunks}
                            </button>
                        ),
                    })}
                </p>
            </div>
        </>
    )
}
