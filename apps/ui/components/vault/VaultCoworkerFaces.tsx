'use client'

import { useTranslations } from 'next-intl'

import type { VaultEntryView } from '@/app/api/_services/vault.service'
import { cn } from '@/lib/utils'
import { AgentBuddy } from '@rerun/ui/iso-grid'
import { Badge } from '@rerun/ui/primitives'
import { coworkerFaces, usedBySummary, type UsedByText } from './vault-text'

export type VaultUsage = Pick<VaultEntryView, 'sharedWithAll' | 'coworkers' | 'hiddenCoworkers'>

const SHOWN_FACES = 3

export function useUsedByText(): UsedByText {
    const t = useTranslations('vault')
    return {
        everyone: t('row.everyone'),
        unused: t('row.unused'),
        usedBy: names => t('row.usedBy', { names }),
        usedByMore: (names, count) => t('row.usedByMore', { names, count }),
        hidden: count => t('detail.hiddenCoworkers', { count }),
    }
}

// Who uses an entry, drawn rather than written. The buddies are decorative, so the sentence they
// replace stays on the group for the tooltip and the screen reader.
export function VaultCoworkerFaces({ usage, size = 24, className }: { usage: VaultUsage; size?: number; className?: string }) {
    const t = useTranslations('vault')
    const summary = usedBySummary(usage, useUsedByText())
    const faces = coworkerFaces(usage, SHOWN_FACES)
    if (!faces.everyone && faces.ids.length === 0 && faces.more === 0) return null

    return (
        <span role="img" aria-label={summary} title={summary} className={cn('flex shrink-0 items-center', className)}>
            {faces.everyone ? (
                <Badge size="xs" tone="neutral" glow={false}>
                    {t('row.everyoneShort')}
                </Badge>
            ) : (
                <>
                    {faces.ids.map((id, index) => (
                        <AgentBuddy key={id} agentId={id} size={size} animated={false} facing="right" className={cn(index > 0 && '-ml-2')} />
                    ))}
                    {faces.more > 0 && <span className="ml-1 text-xs text-muted-foreground tabular-nums">+{faces.more}</span>}
                </>
            )}
        </span>
    )
}
