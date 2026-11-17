'use client'

import type { RemoteOs } from '@rerun/contracts'
import { Badge, type BadgeTone } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'

import type { ComputerStatus } from '@/lib/computers/types'
import { MonitorIcon, ServerIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

// The icon set has no OS logos: a monitor tile, the OS named in the subtitle.
export function OsTile({ os, size = 'md' }: { os: RemoteOs; size?: 'sm' | 'md' }) {
    const Glyph = os === 'linux' ? ServerIcon : MonitorIcon
    return (
        <span className={cn('flex shrink-0 items-center justify-center rounded-md border bg-background', size === 'sm' ? 'size-7' : 'size-9')}>
            <Glyph className={size === 'sm' ? 'size-3.5' : 'size-4.5'} />
        </span>
    )
}

const STATUS_TONE: Record<ComputerStatus, { tone: BadgeTone; animated?: boolean }> = {
    online: { tone: 'green' },
    busy: { tone: 'brand', animated: true },
    paused: { tone: 'orange' },
    offline: { tone: 'neutral' },
}

export function ComputerStatusBadge({ status, jobs = 0 }: { status: ComputerStatus; jobs?: number }) {
    const t = useTranslations('computers.status')
    const { tone, animated } = STATUS_TONE[status]
    return (
        <Badge size="xs" tone={tone} animated={animated} glow={false} className="shrink-0">
            {status === 'busy' ? t('busy', { count: Math.max(jobs, 1) }) : t(status)}
        </Badge>
    )
}

// `#studio-pc`, the way it is typed in the chat.
export const COMPUTER_HANDLE_CLASS = 'font-mono text-emerald-700 dark:text-emerald-300'

export function ComputerHandle({ handle, className }: { handle: string; className?: string }) {
    return <span className={cn(COMPUTER_HANDLE_CLASS, className)}>#{handle}</span>
}

export function ComputerNote({ tone = 'orange', children }: { tone?: 'orange' | 'neutral'; children: ReactNode }) {
    return <div className={cn('rounded-md border px-3 py-2.5 text-xs', tone === 'orange' ? 'border-orange-500/30 bg-orange-500/5' : 'border-border bg-muted/30')}>{children}</div>
}

export function osLabel(os: RemoteOs): string {
    return os === 'mac' ? 'macOS' : os === 'win' ? 'Windows' : 'Linux'
}
