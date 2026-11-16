'use client'

import { useTranslations } from 'next-intl'

import type { WorkspaceRoutine } from '@/app/api/_actions/agent.actions'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { EllipsisIcon } from '@/lib/icons'

type RoutineMenuProps = { routine: WorkspaceRoutine; canRename: boolean; onRename: () => void; onEdit: () => void; onRunNow: () => void }

export function RoutineMenu({ routine, canRename, onRename, onEdit, onRunNow }: RoutineMenuProps) {
    const t = useTranslations('foreman.routines')
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button size="icon-sm" variant="ghost" aria-label={t('options', { name: routine.name })} className="text-muted-foreground">
                    <EllipsisIcon />
                </Button>
            </DropdownMenuTrigger>
            {/* The rename field takes the focus a beat later; the menu handing it back would steal it. */}
            <DropdownMenuContent align="end" onCloseAutoFocus={event => event.preventDefault()}>
                {canRename && <DropdownMenuItem onSelect={onRename}>{t('rename')}</DropdownMenuItem>}
                <DropdownMenuItem onSelect={onEdit}>{t('edit')}</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={routine.setupPending && !routine.enabled} onSelect={onRunNow}>
                    {t('runNow')}
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
