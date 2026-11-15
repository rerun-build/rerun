'use client'

import { useTranslations } from 'next-intl'
import { IconBadge } from '@/components/ui/icon-badge'
import { CheckIcon } from '@/lib/icons'
import { invalidateConnectorServices } from '@/hooks/useConnectorServices'
import { useEffect } from 'react'

type ServiceInstalledBlockProps = {
    name: string
    toolNames?: string[]
    agentId?: string
}

export function ServiceInstalledBlock({ name, toolNames, agentId }: ServiceInstalledBlockProps) {
    const t = useTranslations('services.installed')
    useEffect(() => {
        if (agentId) invalidateConnectorServices(agentId)
    }, [agentId])

    return (
        <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm">
                <IconBadge tone="green" icon={CheckIcon} glow={false} />
                <span className="font-medium">{t('title', { name })}</span>
            </div>
            {toolNames && toolNames.length > 0 && <p className="text-xs text-muted-foreground">{t('nextTurn', { tools: toolNames.join(', ') })}</p>}
        </div>
    )
}
