'use client'

import { Badge, PANEL_CARD } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

import { getServiceDetailsAction } from '@/app/api/_actions/services.actions'
import { ServiceConfigForm } from '@/components/services/ServiceConfigForm'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { invalidateConnectorServices } from '@/hooks/useConnectorServices'
import { useCatalogServices } from '@/hooks/useCatalogServices'
import { BellIcon, CheckCircle2Icon, LinkIcon, LogInIcon } from '@/lib/icons'
import type { ServiceDetails } from '@/lib/services/types'
import { cn } from '@/lib/utils'
import { useBoardStore } from '@/stores/board.store'

export function NotificationCard({ message }: { message: string }) {
    const t = useTranslations('chat.setupEvents')
    return (
        <div className={cn(PANEL_CARD, 'flex items-start gap-3 px-3 py-2.5')}>
            <Icon icon={BellIcon} size="sm" />
            <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">{t('notificationSent')}</p>
                <p className="mt-0.5 text-sm whitespace-pre-wrap text-foreground">{message}</p>
            </div>
            <Badge size="xs" tone="neutral" glow={false} className="mt-0.5">
                {t('read')}
            </Badge>
        </div>
    )
}

// `schedules` and `triggers` are the slugs the install switched on.
export function SetupCompleteCard({ agentId, summary, schedules, triggers }: { agentId?: string; summary: string; schedules: string[]; triggers: string[] }) {
    const t = useTranslations('chat.setupEvents')
    const agentName = useBoardStore(s => s.agents.find(agent => agent.id === agentId)?.name)
    const activated = [schedules.length > 0 && t('schedulesOn', { count: schedules.length }), triggers.length > 0 && t('triggersOn', { count: triggers.length })].filter((label): label is string => Boolean(label))
    return (
        <div className={cn(PANEL_CARD, 'flex flex-col gap-2 px-3 py-3')}>
            <div className="flex items-center gap-2 text-xs">
                <CheckCircle2Icon className="size-3.5 text-emerald-500" />
                <span className="font-medium text-foreground">{agentName ? t('setUp', { name: agentName }) : t('setupComplete')}</span>
            </div>
            {summary && <p className="text-sm text-foreground/90">{summary}</p>}
            {activated.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {activated.map(label => (
                        <Badge key={label} size="xs" tone="green" glow={false}>
                            {label}
                        </Badge>
                    ))}
                </div>
            )}
        </div>
    )
}

// The tool output is frozen at the time of the call, so whether the sign-in is still owed is asked
// again: an old card in the history must not keep offering a connection made since.
export function NeedsAuthCard({ agentId, slug, name }: { agentId?: string; slug: string; name: string }) {
    const t = useTranslations('chat')
    const { resolved } = useCatalogServices([slug])
    const icon = resolved.get(slug)?.icon
    const [details, setDetails] = useState<ServiceDetails | null>(null)
    const [connecting, setConnecting] = useState(false)
    const [connected, setConnected] = useState(false)

    useEffect(() => {
        if (!agentId) return
        let alive = true
        void getServiceDetailsAction(agentId, slug).then(result => {
            if (alive) setDetails(result)
        })
        return () => {
            alive = false
        }
    }, [agentId, slug])

    const pending = details?.installStatus === 'needs_auth' && !connected
    const done = connected || details?.installStatus === 'active'

    return (
        <div className={cn(PANEL_CARD, 'flex flex-col gap-3 px-3 py-2.5')}>
            <div className="flex items-center gap-3">
                {icon ? <Icon src={icon} size="sm" /> : <Icon icon={LinkIcon} size="sm" />}
                <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground">{t('mcpServer.added', { name })}</p>
                    <p className="text-xs text-muted-foreground">{done ? t('setupEvents.connectedHint') : t('setupEvents.signInHint')}</p>
                </div>
                {done && (
                    <Badge size="xs" tone="green" glow={false}>
                        {t('setupEvents.connected')}
                    </Badge>
                )}
                {pending && !connecting && (
                    <Button size="sm" variant="outline" onClick={() => setConnecting(true)}>
                        <LogInIcon />
                        {t('setupEvents.signIn')}
                    </Button>
                )}
            </div>
            {pending && connecting && agentId && details && (
                <ServiceConfigForm
                    agentId={agentId}
                    slug={slug}
                    name={name}
                    authMethods={details.authMethods}
                    initialMethodId={details.installedMethodId}
                    initialAuthTarget={{ oauth: details.oauth, managed: details.managed, composio: details.composio }}
                    onInstalled={() => {
                        setConnected(true)
                        invalidateConnectorServices(agentId)
                    }}
                />
            )}
        </div>
    )
}
