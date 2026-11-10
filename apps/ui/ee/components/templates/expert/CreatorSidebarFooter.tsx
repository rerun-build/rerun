'use client'

import { Badge } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'
import type { CreatorAccountState } from '@/ee/services/connect.service'
import { Skeleton } from '@/components/ui/skeleton'
import { CircleDollarSignIcon, WalletIcon } from '@/lib/icons'
import { payoutStateLabel, payoutStateTone } from '@/ee/lib/templates/payouts'
import type { CreatorPane } from '@/stores/creator.store'
import { cn } from '@/lib/utils'

// Pinned under the template list, same row geometry as ExpertTemplateRow: getting paid belongs in
// the same panel as pricing a template, not behind a separate entry point.
export function CreatorSidebarFooter({ pane, account, onSelect }: { pane: CreatorPane; account: CreatorAccountState | null; onSelect: (pane: CreatorPane) => void }) {
    const t = useTranslations('templates.payouts.sidebar')
    const tPayouts = useTranslations('templates.payouts')
    return (
        <div className="shrink-0 border-t border-border">
            <Row icon={WalletIcon} label={t('payouts')} selected={pane.kind === 'payouts'} onSelect={() => onSelect({ kind: 'payouts' })}>
                {account === null ? (
                    <Skeleton className="h-4 w-16 rounded-full" />
                ) : (
                    <Badge tone={payoutStateTone(account.state)} size="xs" glow={false} className="font-medium">
                        {payoutStateLabel(account.state, tPayouts)}
                    </Badge>
                )}
            </Row>
            <Row icon={CircleDollarSignIcon} label={t('revenue')} selected={pane.kind === 'revenue'} onSelect={() => onSelect({ kind: 'revenue' })} />
        </div>
    )
}

function Row({
    icon: RowIcon,
    label,
    selected,
    onSelect,
    children,
}: {
    icon: React.ComponentType<{ className?: string }>
    label: string
    selected: boolean
    onSelect: () => void
    children?: React.ReactNode
}) {
    return (
        <button
            type="button"
            onClick={onSelect}
            aria-current={selected ? 'true' : undefined}
            className={cn('flex h-11 w-full items-center gap-3 px-4 text-left transition-colors hover:bg-accent', selected && 'bg-accent')}
        >
            <RowIcon className="size-4 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-xs font-medium">{label}</span>
            {children}
        </button>
    )
}
