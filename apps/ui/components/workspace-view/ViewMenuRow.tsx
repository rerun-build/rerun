'use client'

import { useTranslations } from 'next-intl'

import { useWorkspaceView } from '@/components/workspace-view/WorkspaceViewProvider'
import { ViewModeSwitch } from '@/components/workspace-view/ViewModeSwitch'
import { LayoutGridIcon } from '@/lib/icons'
import { useWorkspaceViewStore } from '@/stores/workspace-view.store'

// A plain row of the workspace menu, like the theme's: the icons take the click, the menu stays open on
// the view it switched to. Absent for an account the Simple view is not released to.
export function ViewMenuRow() {
    const t = useTranslations('workspaceView.switch')
    const { view, enabled } = useWorkspaceView()
    if (!enabled) return null
    return (
        <div className="flex items-center gap-2 px-1.5 py-1 text-sm text-muted-foreground">
            <LayoutGridIcon className="size-4" />
            {t('label')}
            <ViewModeSwitch value={view} onChange={next => useWorkspaceViewStore.getState().choose(next)} className="ml-auto origin-right scale-90" />
        </div>
    )
}
