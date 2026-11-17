'use client'

import { Orb } from '@/components/foreman/Orb'
import { OnboardingHeading } from '@/components/onboarding/OnboardingDialog'
import { Button } from '@/components/ui/button'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslations } from 'next-intl'

export type EngineMilestone = 'trial' | 'machine' | 'engine'

export type EngineProgress = { done: EngineMilestone[]; ready: boolean; failed: boolean }

// The last screen: the Chief of Staff's orb wakes up while the machine is reserved and answers, each
// line a milestone that really happened, then it greets them and hands them over to the app.
export function EngineStep({ firstName, progress, error, onRetry, onEnter, entering }: { firstName: string | null; progress: EngineProgress; error: string | null; onRetry: () => void; onEnter: () => void; entering: boolean }) {
    const t = useTranslations('onboarding.engine')
    const pending = (['trial', 'machine', 'engine'] as const).find(milestone => !progress.done.includes(milestone)) ?? 'engine'
    const line = progress.failed ? t('failed') : progress.ready ? t('ready') : t(`milestones.${pending}`)

    return (
        <div className="flex flex-col gap-6">
            <OnboardingHeading
                mark={<Orb size={72} state={progress.ready ? 'speaking' : progress.failed ? 'idle' : 'thinking'} />}
                title={progress.ready ? (firstName ? t('greetingNamed', { name: firstName }) : t('greeting')) : t('title')}
                subtitle={
                    <AnimatePresence mode="wait" initial={false}>
                        <motion.span key={line} className="block" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }} aria-live="polite">
                            {line}
                        </motion.span>
                    </AnimatePresence>
                }
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex w-full flex-col gap-1">
                {progress.failed ? (
                    <>
                        <Button size="lg" className="w-full" onClick={onRetry}>
                            {t('retry')}
                        </Button>
                        <Button variant="ghost" className="w-full text-muted-foreground" onClick={onEnter} loading={entering}>
                            {t('enterAnyway')}
                        </Button>
                    </>
                ) : (
                    <Button size="lg" className="w-full" disabled={!progress.ready} loading={entering} onClick={onEnter}>
                        {progress.ready ? t('enter') : t('wait')}
                    </Button>
                )}
            </div>
        </div>
    )
}
