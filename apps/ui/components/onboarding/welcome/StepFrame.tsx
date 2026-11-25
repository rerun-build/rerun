'use client'

import { OnboardingHeading, OnboardingStepLayout } from '@/components/onboarding/OnboardingPage'
import { Button } from '@/components/ui/button'
import { ArrowLeftIcon } from '@/lib/icons'
import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'

export type StepAction = { label: string; onClick: () => void; disabled?: boolean; loading?: boolean }

// One step of the onboarding page: what it asks, read first in a large title, then the answer and
// the way forward in one card, with the way back beside it. `secondary` is the way past a question
// left unanswered.
export function StepFrame({ title, description, size = 'question', onBack, primary, secondary, error, children }: { title: ReactNode; description?: ReactNode; size?: 'form' | 'question'; onBack?: () => void; primary?: StepAction; secondary?: StepAction; error?: string | null; children?: ReactNode }) {
    const t = useTranslations('onboarding')
    return (
        <OnboardingStepLayout size={size} heading={<OnboardingHeading title={title} subtitle={description} />}>
            <div className="flex flex-col gap-6">
                {children && <div className="min-w-0">{children}</div>}
                {error && <p className="text-sm text-destructive">{error}</p>}
                {(onBack || primary || secondary) && (
                    <div className="flex gap-2">
                        {onBack && (
                            <Button variant="ghost" size="lg" className="text-muted-foreground" onClick={onBack}>
                                <ArrowLeftIcon />
                                {t('back')}
                            </Button>
                        )}
                        {secondary && (
                            <Button variant="outline" size="lg" className="flex-1" onClick={secondary.onClick} disabled={secondary.disabled} loading={secondary.loading}>
                                {secondary.label}
                            </Button>
                        )}
                        {primary && (
                            <Button size="lg" className="flex-1" onClick={primary.onClick} disabled={primary.disabled} loading={primary.loading}>
                                {primary.label}
                            </Button>
                        )}
                    </div>
                )}
            </div>
        </OnboardingStepLayout>
    )
}
