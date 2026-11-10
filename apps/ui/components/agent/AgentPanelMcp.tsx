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
import type { EngineMcpServer } from '@/lib/engine/types'
import { serviceIconProps } from '@/lib/services/icons'
import { BlocksIcon, PlugIcon, PlusIcon } from '@/lib/icons'
import { Badge } from '@rerun/ui/primitives'
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

export function AgentPanelMcp({ agentId }: AgentPanelMcpProps) {
    const boxManageReason = useBoxManageReason()
    const t = useTranslations('agent.agentPanelMcp')
    const [servers, setServers] = useState<EngineMcpServer[]>([])
    // The connector store already joins every server name to the app or custom entry that owns it.
    const { map: connectors, loaded: connectorsLoaded } = useConnectorServices(agentId)
    const [loading, setLoading] = useState(true)
    const [unreachable, setUnreachable] = useState(false)
    const [view, setView] = useState<View>({ mode: 'list' })
    const canManage = useCanManageAgent(agentId)

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

    // Mutate by delta: the engine merges by name under a per-agent lock, so a stale local
    // list can never clobber servers added elsewhere (other tabs, installs, the agent itself).
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
                                return (
                                    <PanelRow
                                        key={`${s.name}-${i}`}
                                        leading={<Icon {...(owner ? serviceIconProps(owner.icon, owner.category) : { icon: PlugIcon })} size="sm" />}
                                        onClick={() => setView({ mode: 'edit', index: i, readOnly: fromApp })}
                                        title={s.name}
                                        description={serverSummary(s)}
                                        meta={
                                            fromApp ? (
                                                <Badge size="xs" tone="neutral" glow={false} leading={<BlocksIcon className="size-2.5" />}>
                                                    {t('appBadge')}
                                                </Badge>
                                            ) : undefined
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
