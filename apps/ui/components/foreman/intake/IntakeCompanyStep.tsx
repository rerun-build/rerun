'use client'

import { AnimatePresence, motion } from 'motion/react'
import { useTranslations } from 'next-intl'
import { useId } from 'react'

import { Field } from '@/components/ui/field'
import { IconBadge } from '@/components/ui/icon-badge'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { CheckIcon } from '@/lib/icons'
import { intakeFieldHandlers } from './IntakeField'
import type { ForemanIntakeController } from './useForemanIntake'
import type { IntakeDraft } from './steps'

// The first question. The site is the good answer: it is the only input that tells us what this
// company sells and to whom, which is what the foreman writes agents out of. Someone who does not
// want to hand over their address, or does not have a site at all, skips it from the card's footer
// and is asked their industry instead (IntakeIndustryStep).

type IntakeCompanyStepProps = {
    draft: IntakeDraft
    siteRead: ForemanIntakeController['siteRead']
    platform: ForemanIntakeController['platform']
    disabled?: boolean
    autoFocus?: boolean
    onChange: (patch: Partial<IntakeDraft>) => void
    onEnter: () => void
}

const ADORNMENT_MOTION = {
    initial: { opacity: 0, scale: 0.9 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.9 },
    transition: { duration: 0.15 },
}

export function IntakeCompanyStep({ draft, siteRead, platform, disabled, autoFocus, onChange, onEnter }: IntakeCompanyStepProps) {
    const t = useTranslations('foreman.intake')
    const siteId = useId()

    return (
        <Field label={t('website.label')} htmlFor={siteId} error={platform ? t('website.platform', { domain: platform }) : undefined}>
            <div className="relative">
                <Input
                    id={siteId}
                    autoFocus={autoFocus}
                    value={draft.companyUrl}
                    disabled={disabled}
                    placeholder="acme.com"
                    onChange={event => onChange({ companyUrl: event.target.value })}
                    {...intakeFieldHandlers(onEnter)}
                    className="pr-11"
                />
                <div className="pointer-events-none absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center">
                    <AnimatePresence mode="wait" initial={false}>
                        {siteRead === 'reading' && (
                            <motion.div key="reading" {...ADORNMENT_MOTION} className="flex size-7 items-center justify-center">
                                <Spinner className="text-muted-foreground" />
                            </motion.div>
                        )}
                        {siteRead === 'ready' && (
                            <motion.div key="ready" {...ADORNMENT_MOTION} className="flex size-7 items-center justify-center">
                                <IconBadge tone="green" icon={CheckIcon} />
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>
        </Field>
    )
}
