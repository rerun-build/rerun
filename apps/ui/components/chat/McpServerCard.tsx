'use client'

import { Badge, PANEL_CARD } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'

import { McpOAuthAuthorize } from '@/components/agent/McpOAuthAuthorize'
import { CustomMcpStatusBadge } from '@/components/services/CustomMcpStatusBadge'
import { openPendingSignInPopup } from '@/components/services/sign-in-popup'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { invalidateConnectorServices, useConnectorServices } from '@/hooks/useConnectorServices'
import { refreshMcpServerStatuses, useMcpServerStatuses } from '@/hooks/useMcpServerStatuses'
import type { McpRegisterCard } from '@/lib/chat/mcp-register-card'
import { LogInIcon, PlugIcon } from '@/lib/icons'
import { humanizeToolSegment } from '@/lib/chat/connector-tools'
import { mcpServerHost } from '@/lib/services/custom-mcp'
import { serviceIconProps } from '@/lib/services/icons'
import { cn } from '@/lib/utils'

type McpServerCardProps = McpRegisterCard & { agentId?: string; signInPending?: boolean }

// The tool output is frozen at the time of the call, so the server is looked up again: an old card
// in the history follows the sign-in made since, and shows no status once the server is gone.
export function McpServerCard({ agentId, name, url, outcome, failure, signInPending }: McpServerCardProps) {
    const t = useTranslations('chat')
    const tServices = useTranslations('services')
    const connectors = useConnectorServices(outcome === 'saved' ? agentId : undefined)
    const { statuses, loading } = useMcpServerStatuses(outcome === 'saved' ? agentId : undefined)
    const [signIn, setSignIn] = useState<{ popup: Window | null } | null>(null)
    const refetched = useRef(false)

    const server = connectors.custom.find(s => s.name === name)
    const status = statuses.get(name)

    // A card drawn right after the agent registered the server can predate both stores.
    useEffect(() => {
        if (!agentId || outcome !== 'saved' || refetched.current || !connectors.loaded || loading) return
        if (server && status) return
        refetched.current = true
        invalidateConnectorServices(agentId)
        refreshMcpServerStatuses(agentId)
    }, [agentId, outcome, connectors.loaded, loading, server, status])

    const displayName = server?.displayName ?? humanizeToolSegment(name)
    const host = server?.host ?? mcpServerHost(url)

    if (outcome === 'failed') {
        return (
            <div className={cn(PANEL_CARD, 'flex items-center gap-3 px-3 py-2.5')}>
                <Icon icon={PlugIcon} size="sm" />
                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-foreground">{t('mcpServer.failed', { name: displayName })}</p>
                    {failure && <p className="line-clamp-2 text-xs text-muted-foreground">{failure}</p>}
                </div>
                <Badge size="xs" tone="red" glow={false}>
                    {t('mcpServer.notAdded')}
                </Badge>
            </div>
        )
    }

    const canSignIn = status?.status === 'needs_auth' && !!server?.signInUrl && !signInPending

    return (
        <div className={cn(PANEL_CARD, 'flex flex-col gap-3 px-3 py-2.5')}>
            <div className="flex items-center gap-3">
                <Icon {...serviceIconProps(server?.icon ?? null, 'custom')} size="sm" />
                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-foreground">{t('mcpServer.added', { name: displayName })}</p>
                    <p className="truncate text-xs text-muted-foreground">{host ? t('mcpServer.customWithHost', { host }) : t('mcpServer.custom')}</p>
                </div>
                <CustomMcpStatusBadge status={status} loading={loading || !connectors.loaded} />
                {canSignIn && !signIn && (
                    <Button size="sm" variant="outline" onClick={() => setSignIn({ popup: openPendingSignInPopup(displayName, tServices('signInPopup.connecting', { name: displayName })) })}>
                        <LogInIcon />
                        {t('actions.connect')}
                    </Button>
                )}
            </div>
            {canSignIn && signIn && agentId && server?.signInUrl && (
                <McpOAuthAuthorize
                    url={server.signInUrl}
                    agentId={agentId}
                    serverName={name}
                    autoStart
                    pendingPopup={signIn.popup}
                    onAuthorized={() => {
                        setSignIn(null)
                        refreshMcpServerStatuses(agentId)
                    }}
                />
            )}
        </div>
    )
}
