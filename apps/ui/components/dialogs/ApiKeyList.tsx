'use client'

import type { ApiKeyView } from '@/app/api/_actions/api-keys.actions'
import { Button } from '@/components/ui/button'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { BanIcon } from '@/lib/icons'
import { shortRelativeTime } from '@/lib/time'
import { useLocale, useTranslations } from 'next-intl'

// One block for the whole set: the rows share its border and are told apart by a divider rather
// than each floating on its own. The empty case keeps the block so the section holds its shape.
export function ApiKeyList({ keys, busy, disabledReason, onRevoke }: { keys: ApiKeyView[]; busy: boolean; disabledReason?: string; onRevoke: (key: ApiKeyView) => void }) {
    const t = useTranslations('dialogs.apiKeys')
    return (
        <div className="min-w-0 overflow-hidden rounded-lg border border-border/60">
            {keys.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">{t('empty')}</p>
            ) : (
                <div className="divide-y divide-border/60">
                    {keys.map(key => (
                        <Row key={key.id} apiKey={key} busy={busy} disabledReason={disabledReason} onRevoke={onRevoke} />
                    ))}
                </div>
            )}
        </div>
    )
}

function Row({ apiKey, busy, disabledReason, onRevoke }: { apiKey: ApiKeyView; busy: boolean; disabledReason?: string; onRevoke: (key: ApiKeyView) => void }) {
    const t = useTranslations('dialogs.apiKeys')
    const locale = useLocale()
    return (
        <div className="flex items-center gap-2.5 px-3 py-2.5">
            <div className="min-w-0 flex-1">
                <span className="block truncate text-sm">{apiKey.name}</span>
                <span className="font-mono text-[11px] text-muted-foreground">{apiKey.keyPrefix}…</span>
            </div>

            <span className="shrink-0 text-[11px] text-muted-foreground">{apiKey.lastUsedAt ? t('lastUsed', { time: shortRelativeTime(apiKey.lastUsedAt, locale) }) : t('neverUsed')}</span>

            {/* Revoking breaks whatever runs on that key, so the click only asks: the confirmation
                dialog is what actually revokes. */}
            <TooltipDisabledReason reason={disabledReason} className="shrink-0">
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    disabled={busy || !!disabledReason}
                    onClick={() => onRevoke(apiKey)}
                    title={disabledReason ? undefined : t('revokeThisKey')}
                    aria-label={t('revokeThisKey')}
                    className="shrink-0 text-muted-foreground transition-colors hover:text-destructive"
                >
                    <BanIcon className="size-4" />
                </Button>
            </TooltipDisabledReason>
        </div>
    )
}
