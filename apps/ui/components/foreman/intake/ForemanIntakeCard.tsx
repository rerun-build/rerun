'use client'

import { StepDots } from '@rerun/ui/chat'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { ArrowRight } from '@/lib/icons'
import { rolesForIndustry } from '@/lib/onboarding/intake'
import { cn } from '@/lib/utils'
import { AnimatedHeight } from './AnimatedHeight'
import { IntakeChoiceStep } from './IntakeChoiceStep'
import { IntakeCompanyStep } from './IntakeCompanyStep'
import { IntakeIndustryStep } from './IntakeIndustryStep'
import { IntakeTextStep } from './IntakeTextStep'
import type { ForemanIntakeController } from './useForemanIntake'

const STEP_MOTION = {
    initial: { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -6 },
    transition: { duration: 0.18, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] },
}

export function ForemanIntakeCard({ intake, autoFocus = true, className }: { intake: ForemanIntakeController; autoFocus?: boolean; className?: string }) {
    const t = useTranslations('foreman.intake')
    const { step, draft, index, steps, answered, reachable, canAdvance, submitting, error, industry, siteRead, set, chooseIndustry, chooseRole, skipWebsite, goTo, next } = intake
    const busy = submitting
    const skippable = step === 'company' && !draft.companyUrl.trim()

    return (
        <div className={cn('relative mb-2 flex flex-col gap-3 overflow-hidden rounded-lg border border-border bg-muted/30 p-3', className)}>
            <AnimatedHeight>
                <AnimatePresence mode="popLayout" initial={false}>
                    <motion.div key={step} {...STEP_MOTION}>
                        {step === 'company' && <IntakeCompanyStep draft={draft} siteRead={siteRead} disabled={busy} autoFocus={autoFocus} onChange={set} onEnter={next} />}
                        {step === 'industry' && <IntakeIndustryStep draft={draft} disabled={busy} onChange={set} onChoose={chooseIndustry} onEnter={next} />}
                        {step === 'role' && <IntakeChoiceStep label={t('role.label')} options={rolesForIndustry(industry)} value={draft.position} placeholder={t('role.placeholder')} disabled={busy} onChange={position => set({ position })} onChoose={chooseRole} onEnter={next} />}
                        {step === 'name' && <IntakeTextStep label={t('name.label')} value={draft.firstName} placeholder={t('name.placeholder')} disabled={busy} onChange={firstName => set({ firstName })} onEnter={next} />}
                    </motion.div>
                </AnimatePresence>
            </AnimatedHeight>

            {error && <p className="px-1 text-xs text-destructive">{error}</p>}

            <div className="flex items-center justify-between gap-2 px-1">
                <StepDots count={steps.length} current={index} answered={answered} reachable={reachable} onSelect={goTo} disabled={busy} />
                {skippable ? (
                    <Button size="sm" disabled={busy} onClick={skipWebsite} data-intake="skip" className="max-sm:h-9 max-sm:px-3 max-sm:text-sm">
                        {t('skip')}
                    </Button>
                ) : (
                    <TooltipDisabledReason reason={!busy && !canAdvance ? t('answerToContinue') : undefined}>
                        <Button size="sm" disabled={busy || !canAdvance} onClick={next} data-intake="next" className="max-sm:h-9 max-sm:px-3 max-sm:text-sm">
                            {t('next')}
                            <ArrowRight data-icon="inline-end" className="size-4" />
                        </Button>
                    </TooltipDisabledReason>
                )}
            </div>
        </div>
    )
}
