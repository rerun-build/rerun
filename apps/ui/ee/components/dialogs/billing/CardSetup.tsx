'use client'

import { useCheckout } from '@stripe/react-stripe-js/checkout'
import type { StripeExpressCheckoutElementConfirmEvent } from '@stripe/stripe-js'
import { useTranslations } from 'next-intl'
import { useEffect, useState, type ReactNode } from 'react'

import { confirmCardSetupAction, createPlanCardSetupAction } from '@/ee/actions/billing.actions'
import { useErrorText } from '@/hooks/useErrorText'

import { Notice, PayFooter } from './parts'
import { StripeCheckoutProvider, StripePaymentFields, StripePaymentFieldsSkeleton } from './StripeCheckout'

// A setup session in the app's own UI, for a new card or for a failed payment: saving the card also
// retries the open invoice.
function useSetupSession(): { clientSecret: string; sessionId: string } | { error: string } | null {
    const [session, setSession] = useState<{ clientSecret: string; sessionId: string } | { error: string } | null>(null)
    const errorText = useErrorText()
    useEffect(() => {
        let cancelled = false
        createPlanCardSetupAction().then(result => {
            if (cancelled) return
            setSession(result.ok ? { clientSecret: result.clientSecret, sessionId: result.sessionId } : { error: errorText(result) })
        })
        return () => {
            cancelled = true
        }
    }, [errorText])
    return session
}

function SetupForm({ sessionId, cta, footnote, children, onSaved }: { sessionId: string; cta: ReactNode; footnote?: string; children?: ReactNode; onSaved: () => void }) {
    const t = useTranslations('billing')
    const errorText = useErrorText()
    const checkout = useCheckout()
    const loaded = checkout.type === 'success' ? checkout.checkout : null
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const save = async (expressCheckoutConfirmEvent?: StripeExpressCheckoutElementConfirmEvent) => {
        if (!loaded || submitting) return
        setSubmitting(true)
        setError(null)
        try {
            const result = await loaded.confirm({ redirect: 'if_required', expressCheckoutConfirmEvent })
            if (result.type === 'error') throw new Error(result.error.message)
            const saved = await confirmCardSetupAction(sessionId)
            if (!saved.ok) throw new Error(errorText(saved))
            onSaved()
        } catch (err) {
            setError(err instanceof Error ? err.message : t('plan.card.notSaved'))
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <>
            <StripePaymentFields wallet={{ onConfirm: event => void save(event), disabledReason: submitting ? t('plan.pleaseWait') : undefined }} />
            {children}
            <PayFooter cta={cta} footnote={footnote} onClick={() => void save()} loading={submitting} disabled={!loaded} error={error} />
        </>
    )
}

// `children` sits between the card fields and the button, such as the invoice the card will pay.
export function CardSetupForm({ cta, footnote, children, onSaved }: { cta: ReactNode; footnote?: string; children?: ReactNode; onSaved: () => void }) {
    const session = useSetupSession()
    if (!session) return <StripePaymentFieldsSkeleton />
    if ('error' in session) return <Notice tone="danger">{session.error}</Notice>
    return (
        <StripeCheckoutProvider clientSecret={session.clientSecret}>
            <SetupForm sessionId={session.sessionId} cta={cta} footnote={footnote} onSaved={onSaved}>
                {children}
            </SetupForm>
        </StripeCheckoutProvider>
    )
}
