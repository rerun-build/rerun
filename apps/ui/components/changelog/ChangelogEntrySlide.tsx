'use client'

import { formatDate } from '@rerun/i18n/format'
import { Markdown } from '@rerun/ui/markdown'
import { useLocale, useTranslations } from 'next-intl'

import type { ChangelogEntryView } from '@/app/api/_actions/changelog.actions'
import { DialogTitle } from '@/components/ui/dialog'

export function ChangelogEntrySlide({ entry }: { entry: ChangelogEntryView }) {
    const t = useTranslations('changelog')
    const locale = useLocale()
    return (
        <div className="flex flex-col pt-2 sm:pt-6">
            <p className="font-mono text-xs tracking-[0.16em] text-muted-foreground uppercase">{t('eyebrow', { date: formatDate(entry.publishedAt, locale, { month: 'short', day: 'numeric' }) })}</p>
            <DialogTitle className="mt-4 font-heading text-2xl leading-tight font-medium text-balance sm:text-3xl">{entry.title}</DialogTitle>
            <Markdown content={entry.bodyMd} className="mt-4 text-sm text-muted-foreground sm:text-base" />
        </div>
    )
}
