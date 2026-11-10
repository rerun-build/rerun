'use client'

import { BorderBeam } from '@rerun/ui'
import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'

import { McpOAuthAuthorize } from '@/components/agent/McpOAuthAuthorize'
import { CustomMcpStatusBadge } from '@/components/services/CustomMcpStatusBadge'
import { openPendingSignInPopup } from '@/components/services/sign-in-popup'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Separator } from '@/components/ui/separator'
import { invalidateConnectorServices, useConnectorServices } from '@/hooks/useConnectorServices'
import { refreshMcpServerStatuses, useMcpServerStatuses } from '@/hooks/useMcpServerStatuses'
import { humanizeToolSegment } from '@/lib/chat/connector-tools'
import { serializeMcpSignInResult, type McpSignInRequest } from '@/lib/chat-hitl'
import { serviceIconProps } from '@/lib/services/icons'
import { cn } from '@/lib/utils'

type McpSignInBlockProps = McpSignInRequest & {
    agentId: string
    // Sends the reply that resumes the run, once.
    onDone: (summary: string) => void
    onSkip: () => void
    // Rendered in the thread rather than docked above the composer: no dock margin.
    inline?: boolean
}

// The sign-in an agent asks for after registering a server that answered 401: the user connects
// here and the agent picks up on its own, the way a suggested app does.
export function McpSignInBlock({ agentId, name, reason, onDone, onSkip, inline }: McpSignInBlockProps) {
    const t = useTranslations('chat')
    const tServices = useTranslations('services')
    const connectors = useConnectorServices(agentId)
    const { statuses, loading } = useMcpServerStatuses(agentId)
    const [signIn, setSignIn] = useState<{ popup: Window | null } | null>(null)
    const [submitted, setSubmitted] = useState(false)
    // An OAuth result can be delivered twice within one render, so the latch answering the agent is a ref.
    const submittedRef = useRef(false)
    const refetched = useRef(false)

    const server = connectors.custom.find(s => s.name === name)
    const status = statuses.get(name)
    const connected = status?.status === 'connected'

    // The agent registered the server moments ago, so both stores can predate it.
    useEffect(() => {
        if (refetched.current || !connectors.loaded || loading || (server && status)) return
        refetched.current = true
        invalidateConnectorServices(agentId)
        refreshMcpServerStatuses(agentId)
    }, [agentId, connectors.loaded, loading, server, status])

    const answer = (send: () => void) => {
        if (submittedRef.current) return
        submittedRef.current = true
        setSubmitted(true)
        send()
    }

    const displayName = server?.displayName ?? humanizeToolSegment(name)
    const subtitle = reason ?? (server?.host ? t('mcpServer.customWithHost', { host: server.host }) : t('mcpServer.custom'))

    return (
        <div className={cn('relative space-y-3 overflow-hidden rounded-lg border border-border bg-muted/30 p-3', !inline && 'mb-2')}>
            <BorderBeam animated pattern="arcs" tone="brand" glow width={1} duration={7} />
            <div className="relative flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
                <Icon {...serviceIconProps(server?.icon ?? null, 'custom')} size="sm" />
                <div className="min-w-32 flex-1">
                    <span className="block truncate font-medium leading-snug">{t('mcpSignIn.title', { name: displayName })}</span>
                    <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
                </div>
                <CustomMcpStatusBadge status={status} loading={loading || !connectors.loaded} />
                {!signIn && (
                    <div className="flex items-center gap-1">
                        <Button size="sm" variant="ghost" disabled={submitted} onClick={() => answer(onSkip)}>
                            {t('actions.notNow')}
                        </Button>
                        {connected ? (
                            <Button size="sm" disabled={submitted} onClick={() => answer(() => onDone(serializeMcpSignInResult(name)))}>
                                {t('actions.continue')}
                            </Button>
                        ) : (
                            <Button size="sm" disabled={submitted || !server?.signInUrl} onClick={() => setSignIn({ popup: openPendingSignInPopup(displayName, tServices('signInPopup.connecting', { name: displayName })) })}>
                                {t('actions.connect')}
                            </Button>
                        )}
                    </div>
                )}
                {signIn && (
                    <Button size="sm" variant="ghost" disabled={submitted} onClick={() => {
                            signIn.popup?.close()
                            setSignIn(null)
                        }}
                        className="text-muted-foreground">
                        {t('actions.cancel')}
                    </Button>
                )}
            </div>
            {signIn && server?.signInUrl && (
                <>
                    <Separator className="-mx-3 border-t border-dashed bg-transparent data-horizontal:h-0 data-horizontal:w-auto" />
                    <McpOAuthAuthorize
                        url={server.signInUrl}
                        agentId={agentId}
                        serverName={name}
                        autoStart
                        pendingPopup={signIn.popup}
                        onAuthorized={() => {
                            refreshMcpServerStatuses(agentId)
                            answer(() => onDone(serializeMcpSignInResult(name)))
                        }}
                    />
                </>
            )}
        </div>
    )
}
