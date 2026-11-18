'use client'

import { PRICING_ICONS, switchableWorkspaces, WorkspaceSwitchItems } from '@/components/layout/WorkspaceSwitchItems'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useSession } from '@/supabase/session/SessionProvider'
import { WorkspacePill } from '@rerun/ui/chrome'
import { Skeleton } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'

// The board's workspace pill, over the onboarding of a new workspace: someone who created it by
// mistake goes back to the workspace they were in, instead of being held on its welcome steps. Its
// row is decided on the server, so until the session has loaded the pill holds its place.
export function WelcomeWorkspaceSwitcher() {
    const t = useTranslations('layout.workspaceMenu')
    const { workspace, workspaces } = useSession()
    if (!workspace || workspaces.length === 0) return <Skeleton className="h-(--chrome-size) w-40 rounded-full" />

    const sorted = switchableWorkspaces(workspaces)
    const activeIcon = PRICING_ICONS[Math.max(0, sorted.findIndex(w => w.id === workspace.id)) % PRICING_ICONS.length]

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <WorkspacePill className="max-w-full shrink" name={workspace.name || t('defaultName')} iconUrl={workspace.icon_url || activeIcon} fallbackIconUrl={activeIcon} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="bottom" className="w-60 max-h-[calc(100dvh-5rem)] overflow-y-auto">
                <WorkspaceSwitchItems />
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
