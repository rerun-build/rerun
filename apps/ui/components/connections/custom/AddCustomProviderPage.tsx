'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { probeCustomEndpointAction } from '@/app/api/_actions/workspace-connection.actions'
import { NoPlanNotice } from '@/components/connections/NoPlanNotice'
import { ProviderHeader } from '@/components/connections/SourceBits'
import { CustomPresetPicker } from '@/components/connections/custom/CustomPresetPicker'
import { MODELS_ON_AT_CONNECT, isHttpUrl, presetsFor, probeProblemMessage } from '@/components/connections/custom/custom-endpoint'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PanelScroller } from '@/components/ui/panel-list'
import { RERUN_CLOUD } from '@rerun/cloud/edition'
import { suggestName, uniqueName } from '@/lib/engine/ai-sources'
import type { BoxConnection, CreateBoxConnectionInput } from '@/lib/engine/types'
import { CONNECTION_TOKEN_KEY, type CustomPreset } from '@rerun/contracts'
import { useTranslations } from 'next-intl'
import { useId, useState } from 'react'

type CreateConnectionResult = { success: true; connection: BoxConnection } | { success: false; error?: string; reason?: 'no_plan' }

type Probe = typeof probeCustomEndpointAction

type AddCustomProviderPageProps = {
    onBack: () => void
    // The machine's probe; the lab hands in a scripted one.
    probe?: Probe
    onCreate: (params: CreateBoxConnectionInput) => Promise<CreateConnectionResult>
    onOpen: (connectionId: string) => void
    takenNames: string[]
    willBecomeBoxDefault: boolean
}

// Name, address, key: the machine asks the server which models it serves before the connection
// exists, so a typo in the address is caught here rather than on the first run.
export function AddCustomProviderPage({ onBack, probe = probeCustomEndpointAction, onCreate, onOpen, takenNames, willBecomeBoxDefault }: AddCustomProviderPageProps) {
    const t = useTranslations('connections')
    const tCommon = useTranslations('common')
    const errorText = useErrorText()
    const presets = presetsFor(RERUN_CLOUD)
    const id = useId()
    const [preset, setPreset] = useState<CustomPreset | null>(() => (RERUN_CLOUD ? null : (presets[0] ?? null)))
    const [name, setName] = useState(() => (preset ? uniqueName(preset.label, takenNames) : suggestName('custom', takenNames)))
    const [baseUrl, setBaseUrl] = useState<string>(preset?.baseUrl ?? '')
    const [apiKey, setApiKey] = useState('')
    const [modelId, setModelId] = useState('')
    const [asksModel, setAsksModel] = useState(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [needsPlan, setNeedsPlan] = useState(false)

    const pick = (next: CustomPreset | null) => {
        setPreset(next)
        setName(next ? uniqueName(next.label, takenNames) : suggestName('custom', takenNames))
        setBaseUrl(next?.baseUrl ?? '')
        setAsksModel(false)
        setError(null)
    }

    const keyRequired = preset?.keyRequired ?? false
    const ready = !!name.trim() && isHttpUrl(baseUrl) && (!keyRequired || !!apiKey.trim()) && (!asksModel || !!modelId.trim())

    const connect = async () => {
        setBusy(true)
        setError(null)
        try {
            const key = apiKey.trim()
            const model = asksModel ? modelId.trim() : undefined
            const probed = await probe({ baseUrl: baseUrl.trim(), apiKey: key || undefined, model })
            if (!probed.success) {
                setNeedsPlan(probed.reason === 'no_plan')
                return setError(errorText(probed))
            }
            const problem = probeProblemMessage(t, probed.result, model, RERUN_CLOUD)
            if (probed.result.problem === 'not_listed') setAsksModel(true)
            if (problem) return setError(problem)

            const created = await onCreate({
                name: name.trim(),
                provider: 'custom',
                baseUrl: probed.result.baseUrl,
                models: probed.result.models.slice(0, MODELS_ON_AT_CONNECT).map(entry => entry.id),
                extraModels: [],
                keys: key ? { [CONNECTION_TOKEN_KEY.custom]: key } : {},
            })
            setNeedsPlan(!created.success && created.reason === 'no_plan')
            if (created.success) onOpen(created.connection.id)
            else setError(errorText(created, t('errors.createFailed')))
        } catch {
            setError(tCommon('somethingWentWrong'))
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <ProviderHeader provider="custom" onBack={onBack} />
            <PanelScroller className="space-y-4 p-4">
                <CustomPresetPicker id={`${id}-server`} presets={presets} selected={preset?.id ?? null} onPick={pick} />
                <Input id={`${id}-name`} label={t('name.label')} value={name} onChange={e => setName(e.target.value)} helperText={t('name.helper')} className="h-8" />
                <Input
                    hideRequired
                    id={`${id}-base-url`}
                    label={t('custom.baseUrl')}
                    value={baseUrl}
                    onChange={e => setBaseUrl(e.target.value)}
                    placeholder="https://your-server.com/v1"
                    inputMode="url"
                    autoComplete="off"
                    spellCheck={false}
                    className="h-8 font-mono text-xs"
                />
                <Input
                    hideRequired={keyRequired}
                    optional={!keyRequired}
                    id={`${id}-api-key`}
                    label={t('key.label')}
                    type="password"
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                    placeholder={keyRequired ? t('key.placeholder') : t('custom.keyOptionalPlaceholder')}
                    className="h-8 font-mono text-xs"
                />
                {asksModel && <Input id={`${id}-model`} hideRequired autoFocus label={t('custom.modelId')} value={modelId} onChange={e => setModelId(e.target.value)} placeholder="llama3.3:70b" spellCheck={false} className="h-8 font-mono text-xs" />}

                {willBecomeBoxDefault && <p className="text-[11px] text-muted-foreground">{t('becomesDefault')}</p>}
                {needsPlan && <NoPlanNotice />}

                <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
                    {error && !needsPlan && <p className="min-w-0 flex-1 text-[11px] break-words text-destructive">{error}</p>}
                    <Button size="sm" disabled={busy || !ready} onClick={() => void connect()}>
                        {busy ? t('connecting') : t('custom.connect')}
                    </Button>
                </div>
            </PanelScroller>
        </div>
    )
}
