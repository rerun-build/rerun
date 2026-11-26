'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { PanelList } from '@/components/ui/panel-list'
import { PanelRow } from '@/components/ui/panel-row'
import { serviceIconProps } from '@/lib/services/icons'
import type { ServiceSearchResult } from '@/lib/services/types'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { Badge } from '@rerun/ui/primitives'

type ServiceListProps = {
    // Apps the coworker does not hold yet: an installed one is managed from its tile.
    services: ServiceSearchResult[]
    // When provided, each app gets an Add button (the Apps tab). In chat we omit it — the agent
    // drives installs via tools.
    onInstall?: (slug: string) => void
    // Why adding an app is out of reach: the buttons stay, disabled.
    disabledReason?: string
}

export function ServiceList({ services, onInstall, disabledReason }: ServiceListProps) {
    const t = useTranslations('services.list')
    return (
        <PanelList>
            {services.map(s => (
                <PanelRow
                    key={s.slug}
                    leading={<Icon {...serviceIconProps(s.icon, s.category)} size="sm" />}
                    title={
                        s.paidApp ? (
                            <span className="flex min-w-0 items-center gap-1.5">
                                <span className="truncate">{s.name}</span>
                                <Badge size="xs" tone="brand" glow={false}>
                                    Pro
                                </Badge>
                            </span>
                        ) : (
                            s.name
                        )
                    }
                    description={s.summary}
                    actions={
                        onInstall && (
                            <TooltipDisabledReason reason={disabledReason}>
                                <Button size="sm" variant="outline" disabled={!!disabledReason} onClick={() => onInstall(s.slug)}>
                                    {t('add')}
                                </Button>
                            </TooltipDisabledReason>
                        )
                    }
                />
            ))}
        </PanelList>
    )
}
