'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { getAiConnectionUsageAction } from '@/app/api/_actions/workspace-connection.actions'
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { Button } from '@/components/ui/button'
import type { BoxConnection, BoxConnectionUsage } from '@/lib/engine/types'
import { Trash2Icon } from '@/lib/icons'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { toast } from 'sonner'

export type DeleteResult = { success: true; released: BoxConnectionUsage } | { success: false; error: string }

type DeleteConnectionButtonProps = {
    connection: BoxConnection
    onDelete: (id: string) => Promise<DeleteResult>
    onDeleted: () => void
}

type ConnectionsT = ReturnType<typeof useTranslations<'connections'>>

// Deleting a connection lives here, at the bottom of its detail view, rather than in the grid:
// nothing destructive should sit one stray click away from a list you only meant to scan.
export function DeleteConnectionButton({ connection, onDelete, onDeleted }: DeleteConnectionButtonProps) {
    const t = useTranslations('connections')
    const errorText = useErrorText()
    const [usage, setUsage] = useState<BoxConnectionUsage | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [pending, setPending] = useState(false)

    const remove = async () => {
        setPending(true)
        const result = await onDelete(connection.id)
        setPending(false)
        if (!result.success) {
            setError(errorText(result, t('errors.deleteFailed')))
            return
        }
        toast.success(t('remove.removed', { name: connection.name }), { description: describeReleased(t, result.released) })
        onDeleted()
    }

    return (
        <div className="space-y-2">
            {error && <p className="text-[11px] text-destructive">{error}</p>}
            <ConfirmDialog title={t('remove.confirmTitle', { name: connection.name })} confirmLabel={t('remove.confirm')} description={describeUsage(t, usage)} pending={pending} onConfirm={() => void remove()}>
                <Button type="button" size="sm" variant="destructive" onClick={() => void getAiConnectionUsageAction(connection.id).then(setUsage)}>
                    <Trash2Icon />
                    {t('remove.button', { name: connection.name })}
                </Button>
            </ConfirmDialog>
        </div>
    )
}

function moversSentence(t: ConnectionsT, usage: BoxConnectionUsage, group: 'fallBack' | 'released'): string | null {
    const agents = usage.agents.map(a => a.name).join(', ')
    const count = usage.automations.length
    if (agents && count > 0) return t(`remove.${group}.both`, { agents, count })
    if (agents) return t(`remove.${group}.agents`, { agents })
    if (count > 0) return t(`remove.${group}.automations`, { count })
    return null
}

// The engine never refuses the delete: it moves everything that named the connection back onto the
// Box default first. So this announces what is about to move, not what to go fix by hand.
function describeUsage(t: ConnectionsT, usage: BoxConnectionUsage | null): string {
    if (!usage) return t('remove.checking')
    const moved = moversSentence(t, usage, 'fallBack')
    const sentences = moved ? [moved] : []
    // The Box default is not a pointer anything holds by name, so it has to be named on its own.
    if (usage.isBoxDefault) sentences.push(t('remove.holdsDefault'))
    if (sentences.length === 0) return t('remove.nothingRuns')
    return sentences.join(' ')
}

function describeReleased(t: ConnectionsT, usage: BoxConnectionUsage): string | undefined {
    const moved = moversSentence(t, usage, 'released')
    const sentences = moved ? [moved] : []
    if (usage.isBoxDefault) sentences.push(t('remove.defaultCleared'))
    return sentences.length > 0 ? sentences.join(' ') : undefined
}
