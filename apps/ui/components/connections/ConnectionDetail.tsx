'use client'

import { BaseUrlField } from '@/components/connections/BaseUrlField'
import { CustomModelList } from '@/components/connections/CustomModelList'
import { DeleteConnectionButton, type DeleteResult } from '@/components/connections/DeleteConnectionButton'
import { DetailBlock } from '@/components/connections/DetailBlock'
import { ModelBuckets } from '@/components/connections/ModelBuckets'
import { OpencodeModels } from '@/components/connections/OpencodeModels'
import { PlanConnect } from '@/components/connections/plan-connect/PlanConnect'
import { PlanLimitsBlock } from '@/components/connections/PlanLimitsBlock'
import { DetailHeader } from '@/components/connections/SourceBits'
import { Button } from '@/components/ui/button'
import { CreditsUsageBar } from '@/cloud/billing.client'
import { Input } from '@/components/ui/input'
import { PanelScroller } from '@/components/ui/panel-list'
import { connectMethod, creditResetPhrase, isCreditUsedUp, sourceKind, type RerunCredit } from '@/lib/engine/ai-sources'
import { catalogFor } from '@/lib/engine/models'
import type { BoxConnection, UpdateBoxConnectionInput } from '@/lib/engine/types'
import { AlertTriangle, CoinsIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { useBillingStore } from '@/stores/billing.store'
import { CONNECTION_SATELLITE_KEYS, CONNECTION_TOKEN_KEY, RERUN_CONNECTION_ID } from '@rerun/contracts'
import { useCallback, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

type MutationResult = { success: boolean; error?: string }

type ConnectionDetailProps = {
    connection: BoxConnection
    credit: RerunCredit
    // The workspace default when it sits on this connection.
    defaultModel: string | null
    // The provider turned the credential away while it is still on file, so `connected` cannot tell.
    reconnectRequested?: boolean
    onReconnected?: () => void
    onBack: () => void
    onUpdate: (id: string, patch: UpdateBoxConnectionInput) => Promise<MutationResult>
    onUpdateKeys: (id: string, body: { set?: Record<string, string>; remove?: string[] }) => Promise<MutationResult>
    onDelete: (id: string) => Promise<DeleteResult>
}

// Everything one named credential of the workspace owns. Every edit persists immediately: a moved
// model is a PATCH, a pasted key is a PATCH, and a failed one says so under the header.
export function ConnectionDetail({ connection, credit, defaultModel, reconnectRequested = false, onReconnected, onBack, onUpdate, onUpdateKeys, onDelete }: ConnectionDetailProps) {
    const [error, setError] = useState<string | null>(null)
    const rejected = reconnectRequested || connection.credentialRejected
    const isOpenRouter = connection.provider === 'openrouter'
    const catalog = catalogFor(connection.provider)

    const patch = useCallback(
        async (next: UpdateBoxConnectionInput) => {
            const result = await onUpdate(connection.id, next)
            setError(result.success ? null : (result.error ?? 'Failed to save'))
        },
        [connection.id, onUpdate]
    )

    const applyKeys = useCallback(
        async (keys: Record<string, string>) => {
            // A credential replaced by hand carries no refresh material, so whatever an earlier
            // OAuth connect left behind goes with it: the engine would otherwise keep refreshing
            // against a lineage this token does not belong to.
            const remove = CONNECTION_SATELLITE_KEYS[connection.provider].filter(name => !(name in keys))
            const result = await onUpdateKeys(connection.id, { set: keys, remove })
            if (result.success && rejected) {
                onReconnected?.()
                toast.success(connectMethod(connection.provider) === 'key' ? 'Key replaced' : 'Signed in again')
            }
            return result
        },
        [connection.id, connection.provider, onUpdateKeys, rejected, onReconnected]
    )

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <DetailHeader source={connection} credit={credit} onBack={onBack} onRename={name => void patch({ name })} />
            <PanelScroller className="space-y-5 p-4">
                {error && <p className="text-[11px] text-destructive">{error}</p>}
                <SourceAlert connection={connection} credit={credit} reconnectRequested={rejected} onKeys={applyKeys} />
                {sourceKind(connection.provider) === 'plan' && connection.connected && <PlanLimitsBlock connection={connection} />}
                {connection.provider === 'opencode' ? (
                    <OpencodeModels connection={connection} defaultModel={defaultModel} onModelsChange={models => void patch({ models })} />
                ) : (
                    <ModelBuckets connection={connection} defaultModel={defaultModel} onModelsChange={models => void patch({ models })} />
                )}
                {isOpenRouter && <BaseUrlField baseUrl={connection.baseUrl ?? ''} onCommit={value => void patch({ baseUrl: value })} />}
                {isOpenRouter && connection.connected && <CustomModelList models={connection.extraModels} onChange={extraModels => void patch({ extraModels })} reserved={catalog.models.map(m => m.id)} />}
            </PanelScroller>
            {connection.id !== RERUN_CONNECTION_ID && (
                <div className="border-t p-3">
                    <DeleteConnectionButton connection={connection} onDelete={onDelete} onDeleted={onBack} />
                </div>
            )}
        </div>
    )
}

function AlertBlock({ children }: { children: ReactNode }) {
    return (
        <div className="flex items-start gap-3 rounded-md border border-orange-500/30 bg-orange-500/5 px-3 py-2.5">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-orange-500" />
            <div className="min-w-0 flex-1 space-y-2">{children}</div>
        </div>
    )
}

// Renders nothing while a source works: switching account or key is remove, then add again.
function SourceAlert({ connection, credit, reconnectRequested, onKeys }: { connection: BoxConnection; credit: RerunCredit; reconnectRequested: boolean; onKeys: (keys: Record<string, string>) => Promise<MutationResult> }) {
    const [value, setValue] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const openBilling = useBillingStore(s => s.openBilling)
    const kind = sourceKind(connection.provider)

    if (kind === 'included') {
        const usedUp = isCreditUsedUp(credit)
        return (
            <DetailBlock
                title="This month's credits"
                aside={
                    <Button size="xs" variant={usedUp ? 'default' : 'outline'} onClick={() => openBilling('credit_pack', 'ai_providers')}>
                        <CoinsIcon />
                        Top up
                    </Button>
                }
            >
                <div className={cn('rounded-md border bg-muted/20 p-3', usedUp && 'border-red-500/30 bg-red-500/5')}>
                    <CreditsUsageBar className="mt-0" usedMicros={credit.usedMicros} budgetMicros={credit.budgetMicros} resetAt={credit.resetAt} />
                </div>
                <p className="text-[11px] text-muted-foreground">
                    {usedUp ? `Coworkers running on Rerun are paused until the credits are back ${creditResetPhrase(credit)}. Top up or pick another default model to keep them going.` : 'Comes with your Rerun plan. No key, nothing to set up.'}
                </p>
            </DetailBlock>
        )
    }

    if (connection.connected && !reconnectRequested) return null

    const method = connectMethod(connection.provider)
    if (method !== 'key') {
        return (
            <div className="space-y-5">
                <AlertBlock>
                    <p className="text-xs">{connection.connected ? 'This sign-in was rejected. Coworkers using it are stopped until you sign in again.' : 'This sign-in expired. Coworkers using it are stopped until you sign in again.'}</p>
                </AlertBlock>
                <PlanConnect provider={method === 'device-codex' ? 'codex' : 'claude'} onKeys={onKeys} surface="reconnect" lastStep={() => ({ title: 'Your coworkers start again' })} />
            </div>
        )
    }

    const save = async () => {
        const trimmed = value.trim()
        if (!trimmed) return
        setBusy(true)
        const result = await onKeys({ [CONNECTION_TOKEN_KEY[connection.provider]]: trimmed }).catch(() => ({ success: false as const, error: 'Something went wrong. Please try again.' }))
        setBusy(false)
        setError(result.success ? null : (result.error ?? 'Failed to save'))
        if (result.success) setValue('')
    }

    return (
        <AlertBlock>
            <p className="text-xs">{connection.connected ? 'This key was rejected. Coworkers using it are stopped until you paste a new one.' : 'No key on file. Coworkers using it are stopped until you paste one.'}</p>
            <div className="flex items-center gap-2">
                <Input hideRequired type="password" value={value} onChange={e => setValue(e.target.value)} placeholder="Paste your key" className="h-8 font-mono text-xs" />
                <Button size="sm" disabled={!value.trim() || busy} onClick={() => void save()}>
                    Save
                </Button>
            </div>
            {error && <p className="text-[11px] text-destructive">{error}</p>}
        </AlertBlock>
    )
}
