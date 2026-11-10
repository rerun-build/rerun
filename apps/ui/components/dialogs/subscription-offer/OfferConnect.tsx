'use client'

import { SUBSCRIPTION_PROVIDERS, type SubscriptionProvider } from '@/components/agent/ModelPickerProviders'
import { Button } from '@/components/ui/button'
import { ProviderIcon } from '@/lib/engine/provider-icons'
import { KeyIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'

import { KeyLogos } from './offer-plans'

// Each plan sits in a frame of its own, and the only filled surface of the column is the Connect
// button inside it. The API key is not a third plan: it hangs under a divider, in outline.
//
// OpenCode joins as a third plan only where it can run (`onOpencode`). Two columns stay two on a
// phone: the third tile then takes a row of its own rather than squeezing the other two.
export function OfferConnect({ onPick, onKey, onOpencode }: { onPick: (provider: SubscriptionProvider) => void; onKey: () => void; onOpencode?: () => void }) {
    const t = useTranslations('dialogs.subscriptionOffer')
    return (
        <div className="flex flex-col gap-3">
            <div className={cn('grid grid-cols-2 gap-3', onOpencode && 'sm:grid-cols-3')}>
                {SUBSCRIPTION_PROVIDERS.map(provider => (
                    <PlanTile key={provider} provider={provider} plan={t(`plans.${provider}`)} onConnect={() => onPick(provider)} />
                ))}
                {onOpencode && <PlanTile provider="opencode" plan={OPENCODE_PLAN} onConnect={onOpencode} className="col-span-2 sm:col-span-1" />}
            </div>
            <OrDivider />
            <Button variant="outline" className="w-full" onClick={onKey}>
                <KeyIcon />
                {t('useApiKey')}
                <KeyLogos />
            </Button>
        </div>
    )
}

const OPENCODE_PLAN = 'OpenCode Go'

function PlanTile({ provider, plan, onConnect, className }: { provider: string; plan: string; onConnect: () => void; className?: string }) {
    const t = useTranslations('dialogs.subscriptionOffer')
    return (
        <div className={cn('flex flex-col items-center gap-3 rounded-lg border bg-muted/20 p-4 text-center', className)}>
            <ProviderIcon provider={provider} className="size-6" />
            <span className="text-sm font-medium">{plan}</span>
            <Button className="w-full" onClick={onConnect}>
                {t('connect')}
            </Button>
        </div>
    )
}

// Same divider as AuthMethods, for the same reason: what follows is the other road, not the next item.
function OrDivider() {
    const t = useTranslations('dialogs.subscriptionOffer')
    return (
        <div className="my-1 flex items-center gap-2 text-xs uppercase">
            <span className="flex-1 border-t" />
            <span className="text-muted-foreground">{t('or')}</span>
            <span className="flex-1 border-t" />
        </div>
    )
}
