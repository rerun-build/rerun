'use client'

import type { PaidSource } from '@rerun/contracts'
import { useTranslations } from 'next-intl'
import { SourceFacepile } from './SourceLogo'

type RowSourcesCellProps = { sources: readonly PaidSource[]; onOpen: () => void }

export function RowSourcesCell({ sources, onOpen }: RowSourcesCellProps) {
    const t = useTranslations('data.sources')
    const names = sources.map(source => source.name).join(', ')
    return (
        <button type="button" aria-label={t('cellLabel', { names })} title={names} onClick={onOpen} onDoubleClick={event => event.stopPropagation()} className="-mx-1 flex min-h-8 items-center rounded-md px-1 outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50">
            <SourceFacepile sources={sources} size="xs" />
        </button>
    )
}
