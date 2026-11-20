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

/** The board or the classic view, as two icons side by side. Without `onChange` it is only a picture of itself: out of reach of the keyboard and of assistive tech. */
export function ViewModeSwitch({ value, onChange, className }: { value: WorkspaceView; onChange?: (view: WorkspaceView) => void; className?: string }) {
    const t = useTranslations('workspaceView.switch')
    return (
        <div role="radiogroup" aria-label={t('label')} inert={!onChange} className={cn('inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-muted p-0.5', !onChange && 'pointer-events-none', className)}>
            {VIEWS.map(view => {
                const active = view.value === value
                return (
                    <TooltipLabeled key={view.value} label={t(view.value)}>
                        <button
                            type="button"
                            role="radio"
                            aria-checked={active}
                            aria-label={t(view.value)}
                            tabIndex={onChange ? undefined : -1}
                            onClick={() => onChange?.(view.value)}
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
