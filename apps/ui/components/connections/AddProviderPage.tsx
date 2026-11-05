'use client'

import { NoPlanNotice } from '@/components/connections/NoPlanNotice'
import { nameStep } from '@/components/connections/plan-connect/NameStep'
import { PlanConnect } from '@/components/connections/plan-connect/PlanConnect'
import { ProviderHeader } from '@/components/connections/SourceBits'
import { CredentialGuide } from '@/components/services/CredentialGuide'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PanelScroller } from '@/components/ui/panel-list'
import { PROVIDER_GUIDE, PROVIDER_PITCH, connectMethod, suggestName, type AddableProvider, type GuidedProvider } from '@/lib/engine/ai-sources'
import type { BoxConnection, CreateBoxConnectionInput } from '@/lib/engine/types'
import { CONNECTION_TOKEN_KEY, DEFAULT_CONNECTION_MODELS } from '@rerun/contracts'
import { useState } from 'react'

type CreateConnectionResult = { success: true; connection: BoxConnection } | { success: false; error?: string; reason?: 'no_plan' }

const CONNECT_FAILED = 'Something went wrong. Please try again.'

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
        if (!trimmed) return { success: false, error: 'Give this connection a name' }
        setBusy(true)
        try {
            const result = await onCreate({ name: trimmed, provider, models: DEFAULT_CONNECTION_MODELS[provider], extraModels: [], keys })
            setNeedsPlan(!result.success && result.reason === 'no_plan')
            setError(result.success ? null : (result.error ?? 'Failed to create the connection'))
            if (result.success && isPlan) setCreated(result.connection)
            else if (result.success) onOpen(result.connection.id)
            return result
        } catch {
            setError(CONNECT_FAILED)
            return { success: false, error: CONNECT_FAILED }
        } finally {
            setBusy(false)
        }
    }

    const finish = async () => {
        if (!created) return
        const trimmed = name.trim()
        if (trimmed !== created.name) {
            setRenaming(true)
            const result = await onRename(created.id, trimmed).catch(() => ({ success: false, error: CONNECT_FAILED }))
            setRenaming(false)
            if (!result.success) return setRenameError(result.error ?? 'Failed to rename the connection')
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
                        <Input label="Name" value={name} onChange={e => setName(e.target.value)} helperText="Shown in every coworker's model picker" className="h-8" />
                        <Input hideRequired label="API key" type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="Paste your key" className="h-8 font-mono text-xs" />
                        <CredentialGuide label={PROVIDER_PITCH[provider].title} title={PROVIDER_GUIDE[provider as GuidedProvider].title} guide={PROVIDER_GUIDE[provider as GuidedProvider].steps} />
                    </>
                )}

                {willBecomeBoxDefault && <p className="text-[11px] text-muted-foreground">This becomes the workspace default: every coworker with no model of its own will run on it.</p>}

                {/* A plan's own widget already shows why its token was refused. */}
                {needsPlan && <NoPlanNotice />}

                {!isPlan && (
                    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
                        {error && !needsPlan && <p className="min-w-0 flex-1 text-[11px] text-destructive">{error}</p>}
                        <Button size="sm" disabled={busy || !name.trim() || !apiKey.trim()} onClick={() => void create({ [CONNECTION_TOKEN_KEY[provider]]: apiKey.trim() })}>
                            {busy ? 'Connecting…' : 'Add key'}
                        </Button>
                    </div>
                )}
            </PanelScroller>
        </div>
    )
}
