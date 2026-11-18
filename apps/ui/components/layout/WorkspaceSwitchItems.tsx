'use client'

import { switchWorkspaceAction } from '@/app/api/_actions/workspace.actions'
import { DropdownMenuItem, DropdownMenuLabel } from '@/components/ui/dropdown-menu'
import { useErrorText } from '@/hooks/useErrorText'
import { accountLabel } from '@/lib/auth/placeholder-email'
import { CheckIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { abortWorkspaceSwitch, beginWorkspaceSwitch, enterActiveWorkspace } from '@/lib/workspace/workspace-switch'
import { useSession } from '@/supabase/session/SessionProvider'
import { WorkspaceLogoImage } from '@rerun/ui/chrome'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { toast } from 'sonner'

export const PRICING_ICONS = ['/pricing/solo.png', '/pricing/team.png', '/pricing/scale.png']

type SessionWorkspace = ReturnType<typeof useSession>['workspaces'][number]

export function switchableWorkspaces(workspaces: SessionWorkspace[]): SessionWorkspace[] {
    return workspaces.filter(w => !w.is_sandbox).sort((a, b) => a.id - b.id)
}

function useWorkspaceSwitch() {
    const errorText = useErrorText()
    const { workspace } = useSession()
    const [busy, setBusy] = useState(false)

    async function switchTo(workspaceId: number) {
        if (busy || workspaceId === workspace?.id) return
        setBusy(true)
        beginWorkspaceSwitch()
        const result = await switchWorkspaceAction(workspaceId)
        if (result.ok) return enterActiveWorkspace()
        abortWorkspaceSwitch()
        toast.error(errorText(result))
        setBusy(false)
    }

    return { busy, switchTo }
}

// The account's email, then every workspace it can switch to, the active one checked.
export function WorkspaceSwitchItems() {
    const t = useTranslations('layout.workspaceMenu')
    const { workspace, workspaces, session } = useSession()
    const { busy, switchTo } = useWorkspaceSwitch()
    const email = accountLabel(session?.user?.email)

    return (
        <>
            {email && <DropdownMenuLabel className="truncate pl-7.5 text-xs font-normal text-muted-foreground">{email}</DropdownMenuLabel>}
            {switchableWorkspaces(workspaces).map((w, index) => {
                const active = w.id === workspace?.id
                const fallbackIcon = PRICING_ICONS[index % PRICING_ICONS.length]
                return (
                    <DropdownMenuItem key={w.id} disabled={busy} onSelect={() => switchTo(w.id)} className={cn('gap-2', !active && 'text-muted-foreground')}>
                        <WorkspaceLogoImage src={w.icon_url || fallbackIcon} fallbackSrc={fallbackIcon} className="size-5 shrink-0 rounded-full object-cover" />
                        <span className="flex-1 truncate">{w.name || t('defaultName')}</span>
                        {active && <CheckIcon className="size-4" />}
                    </DropdownMenuItem>
                )
            })}
        </>
    )
}
