'use client'

import { ContactManagerButton } from '@/components/brand/ContactManagerButton'
import type { WorkspaceManager } from '@/components/brand/useWorkspaceManager'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'

export function ManagedPausedNotice({ manager, className }: { manager: WorkspaceManager; className?: string }) {
    const t = useTranslations('managed.paused')
    return (
        <div className={cn('flex flex-col gap-3 rounded-md border border-dashed px-3 py-4 sm:flex-row sm:items-center', className)}>
            <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                {t('title')} {t('body', { manager: manager.name })}
            </p>
            <ContactManagerButton manager={manager} size="sm" className="shrink-0 self-start sm:self-auto" />
        </div>
    )
}
