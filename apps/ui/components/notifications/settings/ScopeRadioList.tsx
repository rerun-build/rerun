'use client'

import { NOTIFICATION_SCOPES, type NotificationScope } from '@/lib/notifications/prefs'
import { cn } from '@/lib/utils'
import { Badge } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'
import type { KeyboardEvent } from 'react'

import { SCOPE_META } from './scope-meta'
import { SETTINGS_CARD, SettingsSection } from './SettingsSection'

const RECOMMENDED: NotificationScope = 'mine'

export function ScopeRadioList({ scope, onChange }: { scope: NotificationScope; onChange: (scope: NotificationScope) => void }) {
    const t = useTranslations('notifications.settings')
    const moveWithArrows = (event: KeyboardEvent<HTMLDivElement>) => {
        const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0
        if (!step) return
        event.preventDefault()
        const next = NOTIFICATION_SCOPES[(NOTIFICATION_SCOPES.indexOf(scope) + step + NOTIFICATION_SCOPES.length) % NOTIFICATION_SCOPES.length]
        onChange(next)
        event.currentTarget.querySelector<HTMLButtonElement>(`[data-scope="${next}"]`)?.focus()
    }

    return (
        <SettingsSection title={t('scopeTitle')}>
            <div role="radiogroup" aria-label={t('scopeTitle')} onKeyDown={moveWithArrows} className={SETTINGS_CARD}>
                {NOTIFICATION_SCOPES.map(option => {
                    const selected = scope === option
                    const { icon: ScopeIcon } = SCOPE_META[option]
                    return (
                        <button
                            key={option}
                            type="button"
                            role="radio"
                            data-scope={option}
                            aria-checked={selected}
                            tabIndex={selected ? 0 : -1}
                            onClick={() => onChange(option)}
                            className={cn('flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors outline-none first:rounded-t-lg last:rounded-b-lg focus-visible:ring-3 focus-visible:ring-ring/50', selected ? 'bg-primary/5' : 'hover:bg-muted/40')}
                        >
                            <span className={cn('mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border', selected ? 'border-primary' : 'border-muted-foreground/40')}>{selected && <span className="size-2 rounded-full bg-primary" />}</span>
                            <span className="flex min-w-0 flex-col gap-0.5">
                                <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                                    <ScopeIcon className="size-4 text-muted-foreground" />
                                    {t(`scopes.${option}.label`)}
                                    {option === RECOMMENDED && (
                                        <Badge size="xs" tone="brand">
                                            {t('recommended')}
                                        </Badge>
                                    )}
                                </span>
                                <span className="text-xs text-muted-foreground">{t(`scopes.${option}.detail`)}</span>
                            </span>
                        </button>
                    )
                })}
            </div>
        </SettingsSection>
    )
}
