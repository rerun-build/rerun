'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { NoPlanNotice } from '@/components/connections/NoPlanNotice'
import { nameStep } from '@/components/connections/plan-connect/NameStep'
import { PlanConnect } from '@/components/connections/plan-connect/PlanConnect'
import { ProviderHeader } from '@/components/connections/SourceBits'
import { CredentialGuide } from '@/components/services/CredentialGuide'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PanelScroller } from '@/components/ui/panel-list'
import { connectMethod, providerGuide, providerPitch, suggestName, type AddableProvider, type GuidedProvider } from '@/lib/engine/ai-sources'
import type { BoxConnection, CreateBoxConnectionInput } from '@/lib/engine/types'
import { CONNECTION_TOKEN_KEY, DEFAULT_CONNECTION_MODELS } from '@rerun/contracts'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

type CreateConnectionResult = { success: true; connection: BoxConnection } | { success: false; error?: string; reason?: 'no_plan' }

type AddProviderPageProps = {
    provider: AddableProvider
    onBack: () => void
    onCreate: (params: CreateBoxConnectionInput) => Promise<CreateConnectionResult>
    onOpen: (connectionId: string) => void
    onRename: (connectionId: string, name: string) => Promise<{ success: boolean; error?: string }>
    takenNames: string[]
    // Whether the engine will adopt this one as the workspace default the moment it is plugged in.
    willBecomeBoxDefault: boolean
}

// Name the connection, hand it a credential. The name is what the model picker shows, so it is the
// difference between "Claude" twice and "Claude Clement" / "Claude Theo". A plan is named last, once
// signed in: the connection is created under the suggested name and renamed on Done.
export function AddProviderPage({ provider, onBack, onCreate, onOpen, onRename, takenNames, willBecomeBoxDefault }: AddProviderPageProps) {
    const t = useTranslations('connections')
    const tCommon = useTranslations('common')
    const errorText = useErrorText()
    const [suggestedName] = useState(() => suggestName(provider, takenNames))
    const [name, setName] = useState(suggestedName)
    const [apiKey, setApiKey] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [needsPlan, setNeedsPlan] = useState(false)
    const [created, setCreated] = useState<BoxConnection | null>(null)
    const [renaming, setRenaming] = useState(false)
    const [renameError, setRenameError] = useState<string | null>(null)
    const method = connectMethod(provider)
    const isPlan = method !== 'key'

    const create = async (keys: Record<string, string>): Promise<CreateConnectionResult> => {
        const trimmed = name.trim()
        if (!trimmed) return { success: false, error: t('errors.nameRequired') }
        setBusy(true)
        try {
            const result = await onCreate({ name: trimmed, provider, models: DEFAULT_CONNECTION_MODELS[provider], extraModels: [], keys })
            setNeedsPlan(!result.success && result.reason === 'no_plan')
            setError(result.success ? null : errorText(result, t('errors.createFailed')))
            if (result.success && isPlan) setCreated(result.connection)
            else if (result.success) onOpen(result.connection.id)
            return result
        } catch {
            setError(tCommon('somethingWentWrong'))
            return { success: false, error: tCommon('somethingWentWrong') }
        } finally {
            setBusy(false)
        }
    }

    const finish = async () => {
        if (!created) return
        const trimmed = name.trim()
        if (trimmed !== created.name) {
            setRenaming(true)
            const result = await onRename(created.id, trimmed).catch(() => ({ success: false, error: tCommon('somethingWentWrong') }))
            setRenaming(false)
            if (!result.success) return setRenameError(errorText(result, t('errors.renameFailed')))
        }
        onOpen(created.id)
    }

    const lastStep = (linked: boolean) => nameStep({ linked: linked && created !== null, name, placeholder: suggestedName, onName: setName, onDone: () => void finish(), saving: renaming, error: renameError })

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <ProviderHeader provider={provider} onBack={onBack} />
            <PanelScroller className="space-y-4 p-4">
                {/* The two plans create the connection from inside their own flow, the moment the token lands,
                    and Done in the last step opens it. */}
                {isPlan ? (
                    <PlanConnect provider={method === 'device-codex' ? 'codex' : 'claude'} onKeys={create} surface="add_provider" lastStep={lastStep} />
                ) : (
                    <>
                        <Input label={t('name.label')} value={name} onChange={e => setName(e.target.value)} helperText={t('name.helper')} className="h-8" />
                        <Input hideRequired label={t('key.label')} type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={t('key.placeholder')} className="h-8 font-mono text-xs" />
                        <CredentialGuide label={providerPitch(provider, t).title} title={providerGuide(provider as GuidedProvider, t).title} guide={providerGuide(provider as GuidedProvider, t).steps} />
                    </>
                )}

                {willBecomeBoxDefault && <p className="text-[11px] text-muted-foreground">{t('becomesDefault')}</p>}

                {/* A plan's own widget already shows why its token was refused. */}
                {needsPlan && <NoPlanNotice />}

                {!isPlan && (
                    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
                        {error && !needsPlan && <p className="min-w-0 flex-1 text-[11px] text-destructive">{error}</p>}
                        <Button size="sm" disabled={busy || !name.trim() || !apiKey.trim()} onClick={() => void create({ [CONNECTION_TOKEN_KEY[provider]]: apiKey.trim() })}>
                            {busy ? t('connecting') : t('addProvider.addKey')}
                        </Button>
                    </div>
                )}
            </PanelScroller>
        </div>
    )
}
