import type { AddableProvider, AiConnectionKind, AiConnectionsView } from '@rerun/contracts'
import { Fragment } from 'react'
import { useTranslations } from 'use-intl'

import { Section, Separator } from '@/components/ui/GroupedList'
import { spacing } from '@/theme/tokens'

import { LOGO_TILE, ProviderRow, SheetFrame } from './bits'

const TITLES = { plan: 'subscriptions', key: 'apiKeys' } as const satisfies Record<Exclude<AiConnectionKind, 'included'>, string>

// Every provider a connection can be added for, or only one kind when the list's Add row opened it.
export function AddProvider({ addable, only, onPick, onBack }: { addable: AiConnectionsView['addable']; only?: Exclude<AiConnectionKind, 'included'>; onPick: (provider: AddableProvider) => void; onBack: () => void }) {
    const t = useTranslations('mobileProviders.add')
    const kinds = only ? [only] : (['plan', 'key'] as const)
    return (
        <SheetFrame title={only === 'plan' ? t('addSubscription') : only === 'key' ? t('addApiKey') : t('addProvider')} onBack={onBack}>
            {kinds.map(kind => (
                <Section key={kind} title={only ? undefined : t(TITLES[kind])}>
                    {addable
                        .filter(entry => entry.kind === kind)
                        .map((entry, index) => (
                            <Fragment key={entry.provider}>
                                {index > 0 && <Separator inset={spacing.lg + LOGO_TILE + spacing.md} />}
                                <ProviderRow id={`add-${entry.provider}`} provider={entry.provider} title={entry.title} subtitle={entry.hint} onPress={() => onPick(entry.provider)} />
                            </Fragment>
                        ))}
                </Section>
            ))}
        </SheetFrame>
    )
}
