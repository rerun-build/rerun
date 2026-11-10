'use client'

import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { ArrowLeftIcon, Trash2Icon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'
import type { ComponentProps, ReactNode } from 'react'

export function PanelEditorShell({ children }: { children: ReactNode }) {
    return <div className="flex flex-col h-full">{children}</div>
}

export function PanelEditorHeader({ title, onBack, mono, children }: { title: string; onBack?: () => void; mono?: boolean; children?: ReactNode }) {
    const t = useTranslations('ui')
    return (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
            {onBack && (
                <Button size="icon-sm" variant="ghost" onClick={onBack} aria-label={t('back')}>
                    <ArrowLeftIcon className="size-4" />
                </Button>
            )}
            <p className={cn('flex-1 min-w-0 truncate text-sm font-medium', mono && 'font-mono')}>{title}</p>
            {children && <div className="flex items-center gap-1 shrink-0">{children}</div>}
        </div>
    )
}

export function PanelEditorBody({ children }: { children: ReactNode }) {
    return <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">{children}</div>
}

export function PanelEditorFooter({ children }: { children: ReactNode }) {
    return <div className="flex items-center gap-2 border-t border-border p-3">{children}</div>
}

type PanelDeleteButtonProps = Omit<ComponentProps<typeof Button>, 'children' | 'variant' | 'size' | 'loading'> & {
    label: string
    busy?: boolean
    // Faux quand le bouton n'est qu'un trigger d'AlertDialog : la dialog porte alors la confirmation.
    confirm?: boolean
    confirmTitle?: string
    confirmDescription?: ReactNode
    confirmLabel?: string
    size?: 'icon-sm' | 'icon-xs'
}

// La confirmation passe par une dialog, sauf quand l'appelant en fournit déjà une.
export function PanelDeleteButton({ label, busy = false, confirm = true, confirmTitle, confirmDescription, confirmLabel, size = 'icon-sm', className, onClick, ...props }: PanelDeleteButtonProps) {
    const t = useTranslations('ui')
    const button = (
        <Button size={size} variant="destructive" loading={busy} title={label} aria-label={label} className={cn('shrink-0', className)} onClick={confirm ? undefined : onClick} {...props}>
            <Trash2Icon />
        </Button>
    )

    if (!confirm) return button

    return (
        <ConfirmDialog title={confirmTitle ?? t('deleteConfirmTitle', { label })} description={confirmDescription} confirmLabel={confirmLabel} onConfirm={event => onClick?.(event)}>
            {button}
        </ConfirmDialog>
    )
}
