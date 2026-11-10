'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { CONNECTION_TOKEN_KEY } from '@rerun/contracts'
import { ScrollFade } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { NoPlanNotice } from '@/components/connections/NoPlanNotice'
import { CredentialGuide } from '@/components/services/CredentialGuide'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { KEY_PROVIDERS, providerGuide, providerPitch, type AddableProvider, type GuidedProvider, type KeyProvider } from '@/lib/engine/ai-sources'
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

// The rows of the API key road. Nothing is picked up front: a preselected row would read as a
// recommendation, and none of the four is one.
export function KeyConnectStep({ onPick, onBack, onSkip, onKeys, only }: KeyConnectStepProps) {
    const t = useTranslations('dialogs.subscriptionOffer.key')
    const tConnections = useTranslations('connections')
    const errorText = useErrorText()
    const [provider, setProvider] = useState<GuidedProvider | null>(only ?? null)
    const headline = only === 'opencode' ? { title: t('opencodeTitle'), detail: t('opencodeDetail') } : { title: t('title'), detail: t('detail') }
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
            if (!result.success) setError(errorText(result, t('failed')))
        } catch {
            setError(t('somethingWentWrong'))
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
                                        <span className="truncate text-sm">{providerPitch(id, tConnections).title}</span>
                                        <span className="truncate text-[11px] text-muted-foreground">{providerPitch(id, tConnections).hint}</span>
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}

                    {provider && (
                        <div className="flex flex-col gap-3">
                            <Input hideRequired label={t('field')} type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={t('placeholder')} className="font-mono text-xs" />
                            <CredentialGuide label={providerPitch(provider, tConnections).title} title={providerGuide(provider, tConnections).title} guide={providerGuide(provider, tConnections).steps} />
                            {needsPlan && <NoPlanNotice />}
                            <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
                                {error && !needsPlan && <p className="min-w-0 flex-1 text-xs text-destructive">{error}</p>}
                                <Button disabled={busy || !apiKey.trim()} onClick={() => void save()}>
                                    {busy ? t('connecting') : t('add')}
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
