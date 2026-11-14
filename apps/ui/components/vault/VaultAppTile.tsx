'use client'

import type { ReactNode } from 'react'

import { PANEL_CARD, PANEL_CARD_INTERACTIVE } from '@/components/ui/panel-row'
import { cn } from '@/lib/utils'
import { VaultCoworkerFaces, type VaultUsage } from './VaultCoworkerFaces'

type Props = { icon: ReactNode; name: string; label?: string | null; badges?: ReactNode; usage: VaultUsage; onClick: () => void }

// An app of the Vault, recognised by its logo first, then by the account it is signed in with.
export function VaultAppTile({ icon, name, label, badges, usage, onClick }: Props) {
    return (
        <button type="button" onClick={onClick} className={cn(PANEL_CARD, PANEL_CARD_INTERACTIVE, 'flex min-w-0 flex-col items-start gap-3 p-3 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none')}>
            <span className="flex w-full items-start justify-between gap-2">
                {icon}
                {badges && <span className="flex min-w-0 flex-wrap justify-end gap-1">{badges}</span>}
            </span>
            <span className="flex w-full min-w-0 flex-col gap-0.5">
                <span className="truncate text-sm font-medium">{name}</span>
                {/* An empty line rather than none, so the tiles of a row keep their faces on one line. */}
                <span className="truncate text-xs text-muted-foreground">{label || ' '}</span>
            </span>
            <span className="flex h-6 items-center">
                <VaultCoworkerFaces usage={usage} />
            </span>
        </button>
    )
}
