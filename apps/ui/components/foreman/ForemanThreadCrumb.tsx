'use client'

import { useTranslations } from 'next-intl'

import { StateDot } from '@/components/agent/sheet/OpenChatsTabs'
import { threadStateOf } from '@/components/agent/sheet/ThreadBranch'
import { Button } from '@/components/ui/button'
import type { SessionStatus } from '@/lib/board/types'
import { ChevronLeftIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

/** Under the tabs while a thread is on screen: where it hangs, and the way back to General. */
export function ForemanThreadCrumb({ title, status, onBack }: { title: string; status: SessionStatus | null; onBack: () => void }) {
    const t = useTranslations('foreman.threads')
    const state = status ? threadStateOf(status) : 'done'
    return (
        <div className="flex h-10 min-w-0 items-center gap-1 px-2">
            <Button variant="ghost" size="sm" className="shrink-0 px-1.5 text-muted-foreground" aria-label={t('back')} onClick={onBack}>
                <ChevronLeftIcon className="size-4" />
                {t('general')}
            </Button>
            <span aria-hidden className="text-muted-foreground/50">
                /
            </span>
            <StateDot state={state === 'live' || state === 'needs' ? state : 'quiet'} className="ml-1" />
            <span className={cn('min-w-0 truncate text-sm font-medium', state === 'error' && 'text-destructive')}>{title}</span>
        </div>
    )
}
