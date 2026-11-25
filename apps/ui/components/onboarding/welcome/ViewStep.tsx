'use client'

import { StepFrame } from '@/components/onboarding/welcome/StepFrame'
import { BoxIcon, CheckIcon, PanelLeftIcon } from '@/lib/icons'
import type { WorkspaceView } from '@/lib/workspace-view'
import { useTranslations } from 'next-intl'
import { ViewTile } from './ViewTile'

const OPTIONS = [
    { value: 'simple', icon: PanelLeftIcon, perks: ['messaging', 'smallScreen'] },
    { value: 'board', icon: BoxIcon, perks: ['glance', 'live'] },
] as const satisfies readonly { value: WorkspaceView; icon: typeof BoxIcon; perks: readonly string[] }[]

// The classic view comes first and is picked from the start: most people know how to use a list and a
// chat. The panel beside the step shows the picked view full size, and its own switch changes the pick.
export function ViewStep({ view, onView, onSubmit, onBack, saving, error }: { view: WorkspaceView; onView: (view: WorkspaceView) => void; onSubmit: () => void; onBack: () => void; saving: boolean; error: string | null }) {
    const t = useTranslations('onboarding.view')
    const tView = useTranslations('workspaceView.switch')

    return (
        <StepFrame title={t('title')} description={t('description')} onBack={onBack} primary={{ label: t(`continue.${view}`), onClick: onSubmit, loading: saving }} error={error}>
            <div className="space-y-4">
                <div role="radiogroup" aria-label={t('title')} className="grid gap-2 sm:grid-cols-2">
                    {OPTIONS.map(option => (
                        <ViewTile key={option.value} view={option.value} icon={option.icon} label={tView(option.value)} selected={view === option.value} onClick={() => onView(option.value)}>
                            <span className="block px-1 pb-1 text-xs leading-snug text-muted-foreground">
                                {t(`options.${option.value}.line`)}
                                <span className="mt-2 block space-y-1">
                                    {option.perks.map(perk => (
                                        <span key={perk} className="flex items-center gap-1.5">
                                            <CheckIcon className="size-3 shrink-0" />
                                            {t(`perks.${perk}`)}
                                        </span>
                                    ))}
                                </span>
                            </span>
                        </ViewTile>
                    ))}
                </div>
                <p className="text-center text-xs text-muted-foreground">{t('hint')}</p>
            </div>
        </StepFrame>
    )
}
