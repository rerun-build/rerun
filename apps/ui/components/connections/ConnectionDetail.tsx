'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { BaseUrlField } from '@/components/connections/BaseUrlField'
import { CustomModelList } from '@/components/connections/CustomModelList'
import { CustomEndpointSettings } from '@/components/connections/custom/CustomEndpointSettings'
import { DeleteConnectionButton, type DeleteResult } from '@/components/connections/DeleteConnectionButton'
import { DetailBlock } from '@/components/connections/DetailBlock'
import { ModelBuckets } from '@/components/connections/ModelBuckets'
import { OpencodeModels } from '@/components/connections/OpencodeModels'
import { PlanConnect } from '@/components/connections/plan-connect/PlanConnect'
import { PlanLimitsBlock } from '@/components/connections/PlanLimitsBlock'
import { DetailHeader } from '@/components/connections/SourceBits'
import { Button } from '@/components/ui/button'
import { CreditsUsageBar } from '@rerun/cloud/billing.client'
import { Input } from '@/components/ui/input'
import { PanelScroller } from '@/components/ui/panel-list'
import { connectMethod, isCreditUsedUp, sourceKind, type RerunCredit } from '@/lib/engine/ai-sources'
import { catalogFor } from '@/lib/engine/models'
import type { BoxConnection, UpdateBoxConnectionInput } from '@/lib/engine/types'
import { AlertTriangle, CoinsIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { useBillingStore } from '@/stores/billing.store'
import { CONNECTION_SATELLITE_KEYS, CONNECTION_TOKEN_KEY, RERUN_CONNECTION_ID } from '@rerun/contracts'
import { shortDate } from '@rerun/i18n/format'
import { useLocale, useTranslations } from 'next-intl'
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
    // A member reads the connection; every control is held disabled, the reason on top.
    readOnlyReason?: string
}

// Everything one named credential of the workspace owns. Every edit persists immediately: a moved
// model is a PATCH, a pasted key is a PATCH, and a failed one says so under the header.
export function ConnectionDetail({ connection, credit, defaultModel, reconnectRequested = false, onReconnected, onBack, onUpdate, onUpdateKeys, onDelete, readOnlyReason }: ConnectionDetailProps) {
    const t = useTranslations('connections')
    const errorText = useErrorText()
    const [error, setError] = useState<string | null>(null)
    const rejected = reconnectRequested || connection.credentialRejected
    const isOpenRouter = connection.provider === 'openrouter'
    const isCustom = connection.provider === 'custom'
    const catalog = catalogFor(connection.provider)

    const patch = useCallback(
        async (next: UpdateBoxConnectionInput) => {
            const result = await onUpdate(connection.id, next)
            setError(result.success ? null : errorText(result, t('errors.saveFailed')))
        },
        [connection.id, onUpdate, t, errorText]
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
                toast.success(connectMethod(connection.provider) === 'key' ? t('detail.keyReplaced') : t('detail.signedInAgain'))
            }
            return result
        },
        [connection.id, connection.provider, onUpdateKeys, rejected, onReconnected, t]
    )

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <DetailHeader source={connection} credit={credit} onBack={onBack} onRename={readOnlyReason ? undefined : name => void patch({ name })} />
            <PanelScroller className="space-y-5 p-4">
                {readOnlyReason && <p className="text-xs text-muted-foreground">{t('detail.readOnly', { reason: readOnlyReason })}</p>}
                {error && <p className="text-[11px] text-destructive">{error}</p>}
                <fieldset disabled={!!readOnlyReason} className="contents">
                <SourceAlert connection={connection} credit={credit} reconnectRequested={rejected} onKeys={applyKeys} />
                {sourceKind(connection.provider) === 'plan' && connection.connected && <PlanLimitsBlock connection={connection} />}
                {connection.provider === 'opencode' ? (
                    <OpencodeModels connection={connection} defaultModel={defaultModel} onModelsChange={models => void patch({ models })} />
                ) : (
                    <ModelBuckets connection={connection} defaultModel={defaultModel} onModelsChange={models => void patch({ models })} />
                )}
                {isOpenRouter && <BaseUrlField baseUrl={connection.baseUrl ?? ''} onCommit={value => void patch({ baseUrl: value })} />}
                {isOpenRouter && connection.connected && <CustomModelList models={connection.extraModels} onChange={extraModels => void patch({ extraModels })} reserved={catalog.models.map(m => m.id)} />}
                {isCustom && <CustomModelList hint={t.rich('customModels.serverHint', { mono: chunks => <span className="font-mono">{chunks}</span> })} placeholder={t('customModels.idPlaceholder')} models={connection.extraModels} onChange={extraModels => void patch({ extraModels })} reserved={[...connection.models, ...(connection.discoveredModels ?? []).map(m => m.id)]} />}
                {isCustom && <CustomEndpointSettings key={connection.id} connection={connection} onPatch={next => void patch(next)} />}
                </fieldset>
            </PanelScroller>
            {connection.id !== RERUN_CONNECTION_ID && (
                <div className="border-t p-3">
                    <TooltipDisabledReason reason={readOnlyReason}>
                        <fieldset disabled={!!readOnlyReason} className="contents">
                            <DeleteConnectionButton connection={connection} onDelete={onDelete} onDeleted={onBack} />
                        </fieldset>
                    </TooltipDisabledReason>
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
    const t = useTranslations('connections')
    const tCommon = useTranslations('common')
    const errorText = useErrorText()
    const locale = useLocale()
    const [value, setValue] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const openBilling = useBillingStore(s => s.openBilling)
    const kind = sourceKind(connection.provider)

    if (kind === 'included') {
        const usedUp = isCreditUsedUp(credit)
        return (
            <DetailBlock
                title={t('detail.creditsTitle')}
                aside={
                    <Button size="xs" variant={usedUp ? 'default' : 'outline'} onClick={() => openBilling('credit_pack', 'ai_providers')}>
                        <CoinsIcon />
                        {t('detail.topUp')}
                    </Button>
                }
            >
                <div className={cn('rounded-md border bg-muted/20 p-3', usedUp && 'border-red-500/30 bg-red-500/5')}>
                    <CreditsUsageBar className="mt-0" usedMicros={credit.usedMicros} budgetMicros={credit.budgetMicros} resetAt={credit.resetAt} />
                </div>
                <p className="text-[11px] text-muted-foreground">
                    {usedUp ? (credit.resetAt ? t('detail.creditsUsedUpOn', { date: shortDate(credit.resetAt, locale) }) : t('detail.creditsUsedUpNextMonth')) : t('detail.creditsIncluded')}
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
                    <p className="text-xs">{connection.connected ? t('detail.signInRejected') : t('detail.signInExpired')}</p>
                </AlertBlock>
                <PlanConnect provider={method === 'device-codex' ? 'codex' : 'claude'} onKeys={onKeys} surface="reconnect" lastStep={() => ({ title: t('detail.reconnected') })} />
            </div>
        )
    }

    const save = async () => {
        const trimmed = value.trim()
        if (!trimmed) return
        setBusy(true)
        const result = await onKeys({ [CONNECTION_TOKEN_KEY[connection.provider]]: trimmed }).catch(() => ({ success: false as const, error: tCommon('somethingWentWrong') }))
        setBusy(false)
        setError(result.success ? null : errorText(result, t('errors.saveFailed')))
        if (result.success) setValue('')
    }

    return (
        <AlertBlock>
            <p className="text-xs">{connection.connected ? t('detail.keyRejected') : t('detail.keyMissing')}</p>
            <div className="flex items-center gap-2">
                <Input hideRequired type="password" value={value} onChange={e => setValue(e.target.value)} placeholder={t('key.placeholder')} className="h-8 font-mono text-xs" />
                <Button size="sm" disabled={!value.trim() || busy} onClick={() => void save()}>
                    {tCommon('save')}
                </Button>
            </div>
            {error && <p className="text-[11px] text-destructive">{error}</p>}
        </AlertBlock>
    )
}
