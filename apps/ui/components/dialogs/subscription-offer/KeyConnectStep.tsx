'use client'

import { CONNECTION_TOKEN_KEY } from '@rerun/contracts'
import { ScrollFade } from '@rerun/ui/primitives'
import { useState } from 'react'

import { NoPlanNotice } from '@/components/connections/NoPlanNotice'
import { CredentialGuide } from '@/components/services/CredentialGuide'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { KEY_PROVIDERS, PROVIDER_GUIDE, PROVIDER_PITCH, type AddableProvider, type GuidedProvider, type KeyProvider } from '@/lib/engine/ai-sources'
import { ProviderIcon } from '@/lib/engine/provider-icons'
import { KeyIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

import { DeclineButton, OfferFooter } from './offer-footer'
import type { KeysResult } from './SubscriptionOffer'

type KeyConnectStepProps = {
    onPick?: (provider: AddableProvider) => void
    onBack: () => void
    onSkip: () => void
    onKeys: (provider: AddableProvider, keys: Record<string, string>) => Promise<KeysResult>
    // A single provider whose key is pasted here, with no list to pick from: OpenCode, a plan sold as a key.
    only?: GuidedProvider
}

const OPENCODE_HEADLINE = { title: 'Connect OpenCode', detail: 'Paste your OpenCode key: the Go models run on your plan, the Console ones on your credits.' }
const KEY_HEADLINE = { title: 'Use an API key', detail: 'Your coworkers run on your key, billed per token by its provider.' }

// The rows of the API key road. Nothing is picked up front: a preselected row would read as a
// recommendation, and none of the four is one.
export function KeyConnectStep({ onPick, onBack, onSkip, onKeys, only }: KeyConnectStepProps) {
    const [provider, setProvider] = useState<GuidedProvider | null>(only ?? null)
    const headline = only === 'opencode' ? OPENCODE_HEADLINE : KEY_HEADLINE
    const [apiKey, setApiKey] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [needsPlan, setNeedsPlan] = useState(false)

    const pick = (next: KeyProvider) => {
        setProvider(next)
        setApiKey('')
        setError(null)
    }

    const save = async () => {
        if (!provider) return
        onPick?.(provider)
        setBusy(true)
        try {
            const result = await onKeys(provider, { [CONNECTION_TOKEN_KEY[provider]]: apiKey.trim() })
            setNeedsPlan(!result.success && result.reason === 'no_plan')
            if (!result.success) setError(result.error ?? 'Failed to add the key')
        } catch {
            setError('Something went wrong. Please try again.')
        } finally {
            setBusy(false)
        }
    }

    return (
        <>
            <ScrollFade className="-mx-1 -mt-1 min-h-0 flex-1 px-1 pt-1 pb-6">
                <div className="flex flex-col gap-5">
                    <div className="flex items-center gap-3">
                        <Icon icon={KeyIcon} />
                        <div className="min-w-0">
                            <h2 className="text-sm font-medium">{headline.title}</h2>
                            <p className="text-sm text-muted-foreground">{headline.detail}</p>
                        </div>
                    </div>

                    {!only && (
                        <div className="flex flex-col gap-2">
                            {KEY_PROVIDERS.map(id => (
                                <button key={id} type="button" onClick={() => pick(id)} className={cn('flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors hover:bg-accent/30', provider === id ? 'border-foreground ring-1 ring-foreground' : 'bg-muted/20')}>
                                    <ProviderIcon provider={id} className="size-4" />
                                    <span className="flex min-w-0 flex-1 flex-col">
                                        <span className="truncate text-sm">{PROVIDER_PITCH[id].title}</span>
                                        <span className="truncate text-[11px] text-muted-foreground">{PROVIDER_PITCH[id].hint}</span>
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}

                    {provider && (
                        <div className="flex flex-col gap-3">
                            <Input hideRequired label="API key" type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder="Paste your key" className="font-mono text-xs" />
                            <CredentialGuide label={PROVIDER_PITCH[provider].title} title={PROVIDER_GUIDE[provider].title} guide={PROVIDER_GUIDE[provider].steps} />
                            {needsPlan && <NoPlanNotice />}
                            <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
                                {error && !needsPlan && <p className="min-w-0 flex-1 text-xs text-destructive">{error}</p>}
                                <Button disabled={busy || !apiKey.trim()} onClick={() => void save()}>
                                    {busy ? 'Connecting…' : 'Add key'}
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            </ScrollFade>

            <OfferFooter onBack={onBack}>
                <DeclineButton onClick={onSkip} />
            </OfferFooter>
        </>
    )
}
