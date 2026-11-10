'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { LayersIcon, PlusIcon } from '@/lib/icons'
import type { ExpertTemplate } from '@/lib/templates/expert'
import { cn } from '@/lib/utils'
import { ExpertTemplateRow } from './ExpertTemplateRow'

export function ExpertTemplateList({
    templates,
    selectedId,
    onRequestCreate,
    onSelect,
}: {
    templates: ExpertTemplate[] | null
    selectedId: string | null
    onRequestCreate: () => void
    onSelect: (id: string) => void
}) {
    const t = useTranslations('templates.expert.list')
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="border-b border-border px-4 pb-3">
                <Button size="sm" variant="outline" className="w-full" onClick={onRequestCreate}>
                    <PlusIcon className="size-3.5" />
                    {t('newTemplate')}
                </Button>
            </div>

            {templates === null ? (
                <ExpertTemplateListSkeleton />
            ) : templates.length === 0 ? (
                <EmptyState
                    icon={LayersIcon}
                    title={t('emptyTitle')}
                    description={t('emptyDescription')}
                />
            ) : (
                <div className="min-h-0 flex-1 overflow-y-auto">
                    {templates.map(template => (
                        <ExpertTemplateRow key={template.id} template={template} selected={template.id === selectedId} onSelect={() => onSelect(template.id)} />
                    ))}
                </div>
            )}
        </div>
    )
}

const ROW_TITLE_WIDTHS = ['w-32', 'w-24', 'w-36', 'w-28']

// Mirrors ExpertTemplateRow so the rows land where the placeholders were.
function ExpertTemplateListSkeleton({ rows = 4 }: { rows?: number }) {
    return (
        <div className="min-h-0 flex-1 overflow-y-auto">
            {Array.from({ length: rows }).map((_, i) => (
                <div key={i} className="flex w-full items-center gap-3 border-b border-border px-4 py-3">
                    <Skeleton className="h-9 w-14 shrink-0 rounded" />
                    <div className="flex min-w-0 flex-col gap-1">
                        <Skeleton className={cn('h-4', ROW_TITLE_WIDTHS[i % ROW_TITLE_WIDTHS.length])} />
                        <div className="flex items-center gap-1.5">
                            <Skeleton className="h-4 w-14 rounded-full" />
                            <Skeleton className="h-4 w-10 rounded-full" />
                            <Skeleton className="h-3 w-12" />
                        </div>
                    </div>
                </div>
            ))}
        </div>
    )
}
