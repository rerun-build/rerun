'use client'

import { OnboardingHeading } from '@/components/onboarding/OnboardingDialog'
import { Button } from '@/components/ui/button'
import { ArrowLeftIcon } from '@/lib/icons'
import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'

export type StepAction = { label: string; onClick: () => void; disabled?: boolean; loading?: boolean }

// One step of the onboarding dialog: what it asks, read first in a large title, then the answer, then
// the way forward. The way back sits in the dialog's top left corner.
export function StepFrame({ title, description, onBack, primary, secondary, error, children }: { title: ReactNode; description?: ReactNode; onBack?: () => void; primary?: StepAction; secondary?: StepAction; error?: string | null; children?: ReactNode }) {
    const t = useTranslations('onboarding')
    return (
        <div className="flex flex-col gap-6">
            {onBack && (
                <Button variant="ghost" size="icon-sm" className="absolute top-3 left-3" onClick={onBack} aria-label={t('back')}>
                    <ArrowLeftIcon />
                </Button>
            )}
            <OnboardingHeading title={title} subtitle={description} />
            {children && <div className="min-w-0">{children}</div>}
            {error && <p className="text-sm text-destructive">{error}</p>}
            {(primary || secondary) && (
                <div className="flex flex-col gap-1">
                    {primary && (
                        <Button size="lg" className="w-full" onClick={primary.onClick} disabled={primary.disabled} loading={primary.loading}>
                            {primary.label}
                        </Button>
                    )}
                    {secondary && (
                        <Button variant="ghost" className="w-full text-muted-foreground" onClick={secondary.onClick} disabled={secondary.disabled} loading={secondary.loading}>
                            {secondary.label}
                        </Button>
                    )}
                </div>
            )}
        </div>
    )
}
