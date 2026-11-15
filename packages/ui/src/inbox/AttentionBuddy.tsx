'use client'

import type { ComponentType } from 'react'
import { cn } from '../cn'
import { AgentBuddy } from '../iso-grid/components/buddy/AgentBuddy'
import { Icon } from '../primitives'
import { ATTENTION_STATUS_META } from './attention'

export function BuddyPip({ icon: Glyph, className }: { icon: ComponentType<{ className?: string }>; className?: string }) {
    return (
        <span className={cn('flex size-3.5 items-center justify-center rounded-full bg-card ring-1 ring-border', className)}>
            <Glyph className="size-2.5" />
        </span>
    )
}

export function AttentionBuddy({ agentId, status }: { agentId: string; status: string }) {
    const meta = ATTENTION_STATUS_META[status] ?? ATTENTION_STATUS_META.waiting_human
    if (!agentId) return <Icon icon={meta.icon} size="sm" className={cn('rounded-full', meta.color)} />
    return <AgentBuddy agentId={agentId} size={32} animated={false} facing="right" badge={<BuddyPip icon={meta.icon} className={meta.color} />} />
}
