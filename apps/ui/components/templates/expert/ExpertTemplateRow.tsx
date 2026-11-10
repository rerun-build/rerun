'use client'

import { Badge } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'
import { TemplatePriceBadge } from '@/components/templates/TemplatePriceBadge'
import { templateStatusLabel, templateStatusTone } from '@/lib/templates/status'
import type { ExpertTemplate } from '@/lib/templates/expert'
import { cn } from '@/lib/utils'

export function ExpertTemplateRow({ template, selected, onSelect }: { template: ExpertTemplate; selected: boolean; onSelect: () => void }) {
    const t = useTranslations('templates.expert.row')
    const tStatus = useTranslations('templates.status')
    return (
        <button
            type="button"
            onClick={onSelect}
            aria-current={selected}
            className={cn('flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left transition-colors', selected ? 'bg-muted' : 'hover:bg-muted/50')}
        >
            {template.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={template.coverUrl} alt="" className="h-9 w-14 shrink-0 rounded object-cover" />
            ) : (
                <div className="h-9 w-14 shrink-0 rounded border border-dashed border-border" />
            )}
            <div className="flex min-w-0 flex-col gap-1">
                <span className="truncate text-sm font-medium">{template.title}</span>
                <div className="flex items-center gap-1.5">
                    <Badge size="xs" tone={templateStatusTone(template.status)} glow={false} className="font-medium">
                        {templateStatusLabel(template.status, tStatus)}
                    </Badge>
                    <TemplatePriceBadge pricing={template.pricing} />
                    <span className="text-[10px] text-muted-foreground">
                        {t('agents', { count: template.agentCount })}
                    </span>
                </div>
            </div>
        </button>
    )
}
