'use client'

import type { TemplateConnector } from '@rerun/contracts'
import { useTranslations } from 'next-intl'
import { TemplateDetailSection } from '@/components/templates/TemplateDetailSection'
import { Icon } from '@/components/ui/icon'
import { serviceIconProps } from '@/lib/services/icons'

export function TemplateDetailApps({ connectors }: { connectors: TemplateConnector[] }) {
    const t = useTranslations('templates.detail')
    if (connectors.length === 0) return null
    return (
        <TemplateDetailSection title={t('whatYouNeed')}>
            <ul className="grid grid-cols-2 gap-1.5">
                {connectors.map(connector => (
                    <li key={connector.slug} className="flex items-center gap-2.5 rounded-lg border border-border/60 bg-muted/20 px-2.5 py-2">
                        <Icon {...serviceIconProps(connector.icon)} size="xs" />
                        <p dir="auto" className="min-w-0 flex-1 truncate text-xs font-medium rtl:text-right">{connector.name}</p>
                    </li>
                ))}
            </ul>
        </TemplateDetailSection>
    )
}
