'use client'

import { CreateWorkspaceDialog } from '@/components/dialogs/CreateWorkspaceDialog'
import { Skeleton } from '@/components/ui/skeleton'
import { TooltipLabeled } from '@/components/ui/tooltip'
import { useWorkspaceSwitch } from '@/hooks/useWorkspaceSwitch'
import { PlusIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { fallbackWorkspaceIcon, listSwitchableWorkspaces } from '@/lib/workspace/switchable-workspaces'
import { useSession } from '@/supabase/session/SessionProvider'
import { WorkspaceLogoImage } from '@rerun/ui/chrome'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

export type RailWorkspace = { id: number; name: string | null; icon_url: string | null }

const ROUND_BUTTON = 'flex size-10 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50'

/**
 * The column of workspaces on the frame, left of the board. `workspaces` arrives sorted: an icon's
 * fallback picture follows its place in the list, as in the workspace menu.
 */
export function WorkspaceRailView({
    workspaces,
    activeId,
    loading = false,
    disabled = false,
    onSelect,
    onCreate,
    className,
}: {
    workspaces: readonly RailWorkspace[]
    activeId: number | null
    loading?: boolean
    disabled?: boolean
    onSelect: (workspaceId: number) => void
    onCreate: () => void
    className?: string
}) {
    const t = useTranslations('layout.workspaceMenu')

    return (
        // Sitting in the frame's padding beside the board, the first icon lines up with the workspace
        // pill, which the board puts --chrome-edge inside its 1px border.
        <nav aria-label={t('railLabel')} className={cn('no-scrollbar flex w-14 shrink-0 flex-col items-center gap-2 overflow-y-auto pt-[calc(var(--chrome-edge,1rem)+1px)] pb-2', className)}>
            {loading ? (
                <Skeleton className="size-10 shrink-0 rounded-full" />
            ) : (
                <>
                    {workspaces.map((workspace, index) => {
                        const active = workspace.id === activeId
                        const name = workspace.name || t('defaultName')
                        const fallbackIcon = fallbackWorkspaceIcon(index)
                        return (
                            <div key={workspace.id} className="group relative flex w-full shrink-0 justify-center">
                                <span
                                    aria-hidden
                                    className={cn(
                                        'absolute top-1/2 left-0 w-1 -translate-y-1/2 rounded-r-full bg-foreground transition-[height,opacity] duration-200 motion-reduce:transition-none',
                                        active ? 'h-8' : 'h-2 opacity-0 group-hover:h-4 group-hover:opacity-100'
                                    )}
                                />
                                <TooltipLabeled label={name} side="right" sideOffset={10}>
                                    <button type="button" aria-label={name} aria-current={active ? 'page' : undefined} disabled={disabled} onClick={() => onSelect(workspace.id)} className={cn(ROUND_BUTTON, 'overflow-hidden border border-border bg-card')}>
                                        <WorkspaceLogoImage src={workspace.icon_url || fallbackIcon} fallbackSrc={fallbackIcon} className="size-full rounded-full object-cover" />
                                    </button>
                                </TooltipLabeled>
                            </div>
                        )
                    })}
                    <TooltipLabeled label={t('newWorkspace')} side="right" sideOffset={10}>
                        <button type="button" aria-label={t('newWorkspace')} disabled={disabled} onClick={onCreate} className={cn(ROUND_BUTTON, 'border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground')}>
                            <PlusIcon className="size-4" />
                        </button>
                    </TooltipLabeled>
                </>
            )}
        </nav>
    )
}

export function WorkspaceRail({ className }: { className?: string }) {
    const { workspace, workspaces, loading } = useSession()
    const { switchTo, busy } = useWorkspaceSwitch(workspace?.id)
    const [createOpen, setCreateOpen] = useState(false)

    return (
        <>
            <WorkspaceRailView workspaces={listSwitchableWorkspaces(workspaces)} activeId={workspace?.id ?? null} loading={loading} disabled={busy} onSelect={switchTo} onCreate={() => setCreateOpen(true)} className={className} />
            <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
        </>
    )
}
