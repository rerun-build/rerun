'use client'

import type { ComponentType } from 'react'
import { cn } from '../cn'
import { CoworkerFace } from './CoworkerFace'
import { Icon } from '../primitives'
import { ATTENTION_STATUS_META } from './attention'

// What an update is about, worn on the corner of the buddy of the agent it comes from.
export function BuddyPip({ icon: Glyph, className }: { icon: ComponentType<{ className?: string }>; className?: string }) {
    return (
        <span className={cn('flex size-3.5 items-center justify-center rounded-full bg-card ring-1 ring-border', className)}>
            <Glyph className="size-2.5" />
        </span>
    )
}

// Who is asking and what for. An update that names no agent keeps the bare status icon.
export function AttentionBuddy({ agentId, status }: { agentId: string; status: string }) {
    const meta = ATTENTION_STATUS_META[status] ?? ATTENTION_STATUS_META.waiting_human
    if (!agentId) return <Icon icon={meta.icon} size="sm" className={cn('rounded-full', meta.color)} />
    return <CoworkerFace agentId={agentId} size={32} badge={<BuddyPip icon={meta.icon} className={meta.color} />} />
}
