'use client'

import type { Refusal } from '@/hooks/useErrorText'
import { getAgentDetailAction, patchAgentMcpServersAction } from '@/app/api/_actions/agent.actions'
import { McpServerEditor } from '@/components/agent/McpServerEditor'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { useCanManageAgent } from '@/hooks/useBoxAccess'
import { useBoxManageReason } from '@/hooks/useBoxManageReason'
import { invalidateConnectorServices, useConnectorServices } from '@/hooks/useConnectorServices'
import { refreshMcpServerStatuses } from '@/hooks/useMcpServerStatuses'
import { useMcpSession } from '@/hooks/useMcpSession'
import type { EngineMcpServer } from '@/lib/engine/types'
import { serviceIconProps } from '@/lib/services/icons'
import { BlocksIcon, PlugIcon, PlusIcon } from '@/lib/icons'
import { Badge } from '@moldwright/ui/primitives'
import { EmptyState } from '@/components/ui/empty-state'
import { PanelList, PanelListHeader, PanelScroller } from '@/components/ui/panel-list'
import { PanelRow } from '@/components/ui/panel-row'
import { PanelSteps } from '@/components/ui/panel-steps'
import { SkeletonPanelRows } from '@/components/ui/skeleton'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'

type AgentPanelMcpProps = {
    agentId: string
}

type View = { mode: 'list' } | { mode: 'create' } | { mode: 'edit'; index: number; readOnly: boolean }

function serverSummary(s: EngineMcpServer): string {
    if (s.transport === 'sse' || s.transport === 'http') return `${s.transport} · ${s.url ?? '—'}`
    return `stdio · ${[s.command, ...(s.args ?? [])].filter(Boolean).join(' ') || '—'}`
}

type Translate = ReturnType<typeof useTranslations<'agent.agentPanelMcp'>>

function stateLabel(t: Translate, state: string): string {
    switch (state) {
        case 'connected':
            return t('state.connected')
        case 'connecting':
            return t('state.connecting')
        case 'failed':
            return t('state.failed')
        case 'reconnecting':
            return t('state.reconnecting')
        default:
            return t('state.idle')
    }
}

function errorLabel(t: Translate, errorClass: string): string {
    switch (errorClass) {
        case 'auth':
            return t('errorClass.auth')
        case 'timeout':
            return t('errorClass.timeout')
        case 'unreachable':
            return t('errorClass.unreachable')
        case 'closed':
            return t('errorClass.closed')
        default:
            return t('errorClass.other')
    }
}

export function AgentPanelMcp({ agentId }: AgentPanelMcpProps) {
    const boxManageReason = useBoxManageReason()
    const t = useTranslations('agent.agentPanelMcp')
    const [servers, setServers] = useState<EngineMcpServer[]>([])
    const { map: connectors, loaded: connectorsLoaded } = useConnectorServices(agentId)
    const [loading, setLoading] = useState(true)
    const [unreachable, setUnreachable] = useState(false)
    const [view, setView] = useState<View>({ mode: 'list' })
    const canManage = useCanManageAgent(agentId)
    const { states, reconnecting, reconnect } = useMcpSession(agentId)
    const [reconnectFailed, setReconnectFailed] = useState(false)

    const load = useCallback(async () => {
        setLoading(true)
        invalidateConnectorServices(agentId)
        const detail = await getAgentDetailAction(agentId)
        if (!detail) {
            setUnreachable(true)
        } else {
            setUnreachable(false)
            setServers((detail.config.mcpServers ?? []) as EngineMcpServer[])
        }
        setLoading(false)
    }, [agentId])

    useEffect(() => {
        load()
    }, [load])

    const mutate = useCallback(async (body: { upsert?: EngineMcpServer[]; remove?: string[] }): Promise<{ success: boolean } & Refusal> => {
        const result = await patchAgentMcpServersAction(agentId, body)
        if (result.success && result.detail) {
            setServers((result.detail.config.mcpServers ?? []) as EngineMcpServer[])
            invalidateConnectorServices(agentId)
            refreshMcpServerStatuses(agentId)
        }
        return result
    }, [agentId])

    const stepKey = view.mode === 'edit' ? `edit:${view.index}` : view.mode
    const stepDepth = view.mode === 'list' ? 0 : 1

    if (view.mode === 'create') {
        return (
            <PanelSteps stepKey={stepKey} depth={stepDepth}>
                <McpServerEditor agentId={agentId} onSave={async server => mutate({ upsert: [server] })} onDone={() => setView({ mode: 'list' })} onBack={() => setView({ mode: 'list' })} />
            </PanelSteps>
        )
    }

    if (view.mode === 'edit') {
        const current = servers[view.index]
        return (
            <PanelSteps stepKey={stepKey} depth={stepDepth}>
                <McpServerEditor
                    agentId={agentId}
                    server={current}
                    readOnly={view.readOnly}
                    onSave={async server => mutate({ remove: current.name !== server.name ? [current.name] : [], upsert: [server] })}
                    onDelete={async () => mutate({ remove: [current.name] })}
                    onDone={() => setView({ mode: 'list' })}
                    onBack={() => setView({ mode: 'list' })}
                />
            </PanelSteps>
        )
    }

    if (loading || !connectorsLoaded) {
        return (
            <PanelSteps stepKey={stepKey} depth={stepDepth}>
                <SkeletonPanelRows rows={5} />
            </PanelSteps>
        )
    }

    if (unreachable) {
        return (
            <EmptyState className="h-full" icon={PlugIcon} title={t('unreachableTitle')} description={t('unreachableDescription')} />
        )
    }

    const newButton = (
        <TooltipDisabledReason reason={canManage ? undefined : boxManageReason}>
            <Button size="sm" variant="outline" disabled={!canManage} onClick={() => setView({ mode: 'create' })}>
                <PlusIcon className="size-3.5 mr-1" /> {t('new')}
            </Button>
        </TooltipDisabledReason>
    )

    return (
        <PanelSteps stepKey={stepKey} depth={stepDepth}>
            <div className="flex flex-col h-full">
                <PanelListHeader count={servers.length} noun="MCP server">
                    {newButton}
                </PanelListHeader>

                {reconnectFailed ? <p className="px-3 py-1 text-xs text-destructive">{t('reconnectFailed')}</p> : null}

                {servers.length === 0 ? (
                    <EmptyState
                        icon={PlugIcon}
                        title={t('emptyTitle')}
                        description={t('emptyDescription')}
                        action={newButton}
                    />
                ) : (
                    <PanelScroller>
                        <PanelList>
                            {servers.map((s, i) => {
                                const owner = connectors.get(s.name)
                                const fromApp = !!owner && !owner.custom
                                const live = states.get(s.name)
                                const isReconnecting = reconnecting.has(s.name)
                                const stateKey = isReconnecting ? 'reconnecting' : live?.state
                                const busy = isReconnecting || live?.state === 'connecting'
                                const reconnectButton = (
                                    <TooltipDisabledReason reason={canManage ? undefined : boxManageReason}>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={!canManage || busy}
                                            onClick={e => {
                                                e.stopPropagation()
                                                setReconnectFailed(false)
                                                void reconnect(s.name).then(result => {
                                                    if (!result.ok) setReconnectFailed(true)
                                                })
                                            }}
                                        >
                                            {t('reconnect')}
                                        </Button>
                                    </TooltipDisabledReason>
                                )
                                return (
                                    <PanelRow
                                        key={`${s.name}-${i}`}
                                        leading={<Icon {...(owner ? serviceIconProps(owner.icon, owner.category) : { icon: PlugIcon })} size="sm" />}
                                        onClick={() => setView({ mode: 'edit', index: i, readOnly: fromApp })}
                                        title={s.name}
                                        description={serverSummary(s)}
                                        meta={
                                            <>
                                                {fromApp ? (
                                                    <Badge size="xs" tone="neutral" glow={false} leading={<BlocksIcon className="size-2.5" />}>
                                                        {t('appBadge')}
                                                    </Badge>
                                                ) : null}
                                                {stateKey ? (
                                                    <Badge size="xs" tone={stateKey === 'failed' ? 'red' : 'neutral'} glow={false}>
                                                        {stateLabel(t, stateKey)}
                                                        {stateKey === 'failed' && live?.errorClass ? ` · ${errorLabel(t, live.errorClass)}` : ''}
                                                    </Badge>
                                                ) : null}
                                                {reconnectButton}
                                            </>
                                        }
                                    />
                                )
                            })}
                        </PanelList>
                    </PanelScroller>
                )}
            </div>
        </PanelSteps>
    )
}
