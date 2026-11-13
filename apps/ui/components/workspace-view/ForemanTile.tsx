'use client'

import { useTranslations } from 'next-intl'

import { Orb } from '@/components/foreman/Orb'
import { useForemanInCenter } from '@/components/workspace-view/useForemanInCenter'
import { cn } from '@/lib/utils'
import { foremanOrbState, selectForemanVisible, useForemanStore } from '@/stores/foreman.store'

/** The Chief of Staff at the top of the list, in place of the orb that floats over the board. */
export function ForemanTile() {
    const t = useTranslations('workspaceView.foreman')
    const visible = useForemanStore(selectForemanVisible)
    const open = useForemanInCenter()
    const activity = useForemanStore(s => s.activity)
    if (!visible) return null

    return (
        <button
            type="button"
            aria-current={open ? 'true' : undefined}
            onClick={() => useForemanStore.getState().openInCenter()}
            className={cn('flex w-full items-center gap-2.5 rounded-lg py-2 pr-2 pl-2 text-left transition-colors', open ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60')}
        >
            <span className="flex size-8 shrink-0 items-center justify-center">
                <Orb size={26} state={foremanOrbState({ open, activity })} facing="right" />
            </span>
            <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{t('name')}</span>
                <span className="block truncate text-xs text-muted-foreground">{t('line')}</span>
            </span>
        </button>
    )
}
