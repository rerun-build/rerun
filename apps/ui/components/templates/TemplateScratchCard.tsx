'use client'

import { useTranslations } from 'next-intl'
import { Icon } from '@/components/ui/icon'
import { BorderBeam } from '@rerun/ui'
import { Stripes } from '@rerun/ui/primitives'
import { cn } from '@/lib/utils'
import { PlusIcon } from '@/lib/icons'

export function TemplateScratchCard({ selected, onSelect, className }: { selected: boolean; onSelect: () => void; className?: string }) {
    const t = useTranslations('templates.scratch')
    return (
        <button
            type="button"
            onClick={onSelect}
            className={cn('group relative flex flex-col overflow-hidden rounded-lg border text-left transition-colors', selected ? 'border-primary/40 bg-primary/5' : 'border-border bg-card hover:bg-muted/50', className)}
        >
            {selected && <BorderBeam animated pattern="arcs" tone="white" glow />}
            {/* Faded like its neighbours in the grid: one card meeting its body on a hard edge while
                the rest dissolve would read as a mistake. */}
            <div className="relative flex aspect-[1200/630] items-center justify-center overflow-hidden bg-muted/40 mask-b-from-80%">
                <Stripes />
                <Icon icon={PlusIcon} size="md" className="relative" />
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-1 p-2.5">
                <p className="truncate text-sm font-medium">{t('title')}</p>
                <p className="line-clamp-2 text-xs text-muted-foreground">{t('description')}</p>
            </div>
        </button>
    )
}
