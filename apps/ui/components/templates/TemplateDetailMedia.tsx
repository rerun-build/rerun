'use client'

import { Icon } from '@/components/ui/icon'
import { TemplateBoardPreview } from '@rerun/ui/iso-grid'
import { Badge } from '@rerun/ui/primitives'
import { TemplatePriceBadge } from '@/components/templates/TemplatePriceBadge'
import { templateStatusLabel, templateStatusTone } from '@/lib/templates/status'
import type { LibraryTemplate } from '@/lib/templates/library'
import { LayersIcon } from '@/lib/icons'
import { useTranslations } from 'next-intl'

export function TemplateDetailMedia({ template, showStatus }: { template: LibraryTemplate; showStatus: boolean }) {
    const tStatus = useTranslations('templates.status')
    return (
        // shrink-0 : le bandeau ne tient que par son ratio. Sans lui, un ancêtre en flex l'étire sur
        // toute la hauteur du panneau et pousse le titre, le prix et les agents sous la ligne de flottaison.
        <div className="relative flex aspect-video shrink-0 items-center justify-center overflow-hidden border-b bg-muted/40">
            {template.agents.length > 0 ? (
                <TemplateBoardPreview agents={template.agents} connectors={template.connectors} className="size-full" />
            ) : (
                <Icon icon={LayersIcon} size="lg" className="opacity-40" />
            )}
            {showStatus && template.status !== 'published' && (
                <span className="absolute left-3 top-3 z-10 flex rounded-full sm:left-12 bg-background/70 backdrop-blur">
                    <Badge size="xs" tone={templateStatusTone(template.status)} glow={false} className="font-medium">
                        {templateStatusLabel(template.status, tStatus)}
                    </Badge>
                </span>
            )}
            <span className="absolute right-3 top-3 z-10 flex rounded-full bg-background/70 backdrop-blur empty:hidden">
                <TemplatePriceBadge pricing={template.pricing} access={template.access} />
            </span>
        </div>
    )
}
