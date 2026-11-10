'use client'

import { RERUN_CLOUD } from '@rerun/cloud/edition'
import { Icon } from '@/components/ui/icon'
import { ProviderIcon } from '@/lib/engine/provider-icons'
import { PlugIcon, ShieldCheckIcon, UsersIcon, type LucideIcon } from '@/lib/icons'
import { useTranslations } from 'next-intl'

type OfferArgument = { key: 'ownPlan' | 'password' | 'unplug'; icon: LucideIcon; pile?: boolean }

const ARGUMENTS: OfferArgument[] = [
    { key: 'ownPlan', icon: UsersIcon, pile: true },
    { key: 'password', icon: ShieldCheckIcon },
    { key: 'unplug', icon: PlugIcon },
]

// The connections a team holds, stacked like a facepile: three teammates, three accounts of their
// own, the same three the board shows. Says "one each" faster than the sentence under it.
const TEAM_CONNECTIONS = ['claude', 'codex', 'openrouter'] as const

export function OfferArguments() {
    const t = useTranslations('dialogs.subscriptionOffer.arguments')
    const description = (key: OfferArgument['key']) => (key === 'unplug' ? t(RERUN_CLOUD ? 'unplug.descriptionCloud' : 'unplug.descriptionSelfHosted') : t(`${key}.description`))
    return (
        <ul className="flex flex-col gap-4">
            {ARGUMENTS.map(point => (
                <li key={point.key} className="flex items-start gap-3">
                    <Icon size="sm" icon={point.icon} />
                    <div className="min-w-0">
                        <p className="flex items-center text-sm font-medium">
                            {t(`${point.key}.label`)}
                            {point.pile && <ConnectionPile />}
                        </p>
                        <p className="text-xs text-muted-foreground">{description(point.key)}</p>
                    </div>
                </li>
            ))}
        </ul>
    )
}

function ConnectionPile() {
    return (
        <span className="ml-2 inline-flex translate-y-0.5 items-center">
            {TEAM_CONNECTIONS.map(provider => (
                <span key={provider} className="flex size-5 items-center justify-center rounded-full bg-muted ring-2 ring-popover not-first:-ml-1.5">
                    <ProviderIcon provider={provider} className="size-3" />
                </span>
            ))}
        </span>
    )
}
