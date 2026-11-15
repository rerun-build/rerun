'use client'

import { SUBSCRIPTION_PROVIDERS, type SubscriptionProvider } from '@/components/agent/ModelPickerProviders'
import { Button } from '@/components/ui/button'
import { ProviderIcon } from '@/lib/engine/provider-icons'
import { KeyIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'

import { KeyLogos } from './offer-plans'

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
