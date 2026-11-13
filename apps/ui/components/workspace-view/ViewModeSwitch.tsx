'use client'

import { useTranslations } from 'next-intl'

import { TooltipLabeled } from '@/components/ui/tooltip'
import { BoxIcon, PanelLeftIcon } from '@/lib/icons'
import type { WorkspaceView } from '@/lib/workspace-view'
import { cn } from '@/lib/utils'

const VIEWS = [
    { value: 'board', icon: BoxIcon },
    { value: 'simple', icon: PanelLeftIcon },
] as const satisfies readonly { value: WorkspaceView; icon: typeof BoxIcon }[]

/** The 3D board or the Simple view, as two icons side by side. */
export function ViewModeSwitch({ value, onChange, className }: { value: WorkspaceView; onChange: (view: WorkspaceView) => void; className?: string }) {
    const t = useTranslations('workspaceView.switch')
    return (
        <div role="radiogroup" aria-label={t('label')} className={cn('inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-muted p-0.5', className)}>
            {VIEWS.map(view => {
                const active = view.value === value
                return (
                    <TooltipLabeled key={view.value} label={t(view.value)}>
                        <button
                            type="button"
                            role="radio"
                            aria-checked={active}
                            aria-label={t(view.value)}
                            onClick={() => onChange(view.value)}
                            className={cn('flex size-7 items-center justify-center rounded-md transition-colors', active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
                        >
                            <view.icon className="size-3.5" />
                        </button>
                    </TooltipLabeled>
                )
            })}
        </div>
    )
}
