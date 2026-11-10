'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useState, useTransition } from 'react'
import { StepTransition, StepperBar, useStepper } from '@rerun/ui/steps'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { routes } from '@/lib/routes'
import { CREATOR_TERMS } from '@/lib/creator/terms'
import { acceptCreatorTermsAction, claimCreatorSandboxAction, type CreatorInvite } from '@/app/api/_actions/creator-onboarding.actions'
import { JoinCard } from './JoinShell'

const STEP_COUNT = 3

export function CreatorOnboarding({ invite, token }: { invite: CreatorInvite; token?: string }) {
    const router = useRouter()
    const stepper = useStepper(STEP_COUNT, invite.claimed ? 2 : 0)
    const { goTo } = stepper
    const firstName = invite.name.trim().split(/\s+/)[0]

    const [claimError, setClaimError] = useState<string | null>(null)
    const errorText = useErrorText()
    const [claiming, startClaim] = useTransition()

    const claim = useCallback(() => {
        setClaimError(null)
        startClaim(async () => {
            const result = await claimCreatorSandboxAction(token)
            if (result.ok) goTo(2)
            else setClaimError(errorText(result))
        })
    }, [token, goTo, errorText])

    // The claim runs on arrival at its own step rather than on the button, so a failed pool grab is
    // retried from where it failed instead of sending people back to the welcome screen.
    useEffect(() => {
        if (stepper.index === 1 && !claiming && !claimError) claim()
    }, [stepper.index, claiming, claimError, claim])

    return (
        <JoinCard>
            <StepperBar count={STEP_COUNT} current={stepper.index} />

            <StepTransition stepKey={stepper.index} direction={stepper.direction} className="flex flex-col gap-6">
                {stepper.index === 0 ? (
                    <WelcomeStep firstName={firstName} onContinue={stepper.goForward} />
                ) : stepper.index === 1 ? (
                    <ClaimStep error={claimError} onRetry={claim} />
                ) : (
                    <TermsStep onDone={() => router.push(routes.home)} />
                )}
            </StepTransition>
        </JoinCard>
    )
}

function WelcomeStep({ firstName, onContinue }: { firstName: string; onContinue: () => void }) {
    const t = useTranslations('auth.creatorOnboarding')
    return (
        <>
            <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-brand">Rerun Creators</p>
                <h1 className="text-xl font-semibold tracking-tight">{t('welcome.title', { name: firstName })}</h1>
                <p className="text-sm text-muted-foreground">
                    {t('welcome.message')}
                </p>
            </div>
            <Button size="lg" className="w-full" onClick={onContinue}>
                {t('welcome.claim')}
            </Button>
        </>
    )
}

function ClaimStep({ error, onRetry }: { error: string | null; onRetry: () => void }) {
    const t = useTranslations('auth.creatorOnboarding')
    if (error) {
        return (
            <>
                <div className="space-y-2">
                    <h1 className="text-xl font-semibold tracking-tight">{t('claim.notReady')}</h1>
                    <p className="text-sm text-muted-foreground">{error}</p>
                </div>
                <Button size="lg" className="w-full" onClick={onRetry}>
                    {t('claim.retry')}
                </Button>
            </>
        )
    }

    return (
        <>
            <div className="space-y-2">
                <Skeleton className="h-6 w-56" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
            </div>
            <p className="text-sm text-muted-foreground">{t('claim.preparing')}</p>
            <Skeleton className="h-11 w-full" />
        </>
    )
}

function TermsStep({ onDone }: { onDone: () => void }) {
    const t = useTranslations('auth.creatorOnboarding')
    const [checked, setChecked] = useState<Set<string>>(new Set())
    const [error, setError] = useState<string | null>(null)
    const errorText = useErrorText()
    const [pending, startTransition] = useTransition()
    const allChecked = CREATOR_TERMS.every(term => checked.has(term.id))

    function toggle(id: string) {
        setChecked(prev => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

    function submit() {
        setError(null)
        startTransition(async () => {
            const result = await acceptCreatorTermsAction()
            if (result.ok) onDone()
            else setError(errorText(result))
        })
    }

    return (
        <>
            <div className="space-y-2">
                <h1 className="text-xl font-semibold tracking-tight">{t('terms.title')}</h1>
                <p className="text-sm text-muted-foreground">{t('terms.message')}</p>
            </div>

            <ul className="flex flex-col gap-3">
                {CREATOR_TERMS.map(term => (
                    <li key={term.id} className="flex items-start gap-3">
                        <Checkbox id={`term-${term.id}`} size="sm" className="mt-0.5" checked={checked.has(term.id)} onCheckedChange={() => toggle(term.id)} />
                        <label htmlFor={`term-${term.id}`} className="text-sm leading-5 text-muted-foreground">
                            {term.href ? (
                                <a href={term.href} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">
                                    {t(`terms.items.${term.id}`)}
                                </a>
                            ) : (
                                t(`terms.items.${term.id}`)
                            )}
                        </label>
                    </li>
                ))}
            </ul>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}

            <Button size="lg" className="w-full" disabled={!allChecked} loading={pending} onClick={submit}>
                {t('terms.accept')}
            </Button>
        </>
    )
}
