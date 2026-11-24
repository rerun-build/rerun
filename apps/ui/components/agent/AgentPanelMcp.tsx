'use client'

import { useErrorText, type Refusal } from '@/hooks/useErrorText'
import { getAgentDetailAction, patchAgentMcpServersAction } from '@/app/api/_actions/agent.actions'
import { McpOAuthAuthorize } from '@/components/agent/McpOAuthAuthorize'
import { McpServerEditor } from '@/components/agent/McpServerEditor'
import { CustomMcpRow } from '@/components/services/CustomMcpRow'
import { openPendingSignInPopup } from '@/components/services/sign-in-popup'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { useCanManageAgent } from '@/hooks/useBoxAccess'
import { useBoxManageReason } from '@/hooks/useBoxManageReason'
import { invalidateConnectorServices, useConnectorServices } from '@/hooks/useConnectorServices'
import { refreshMcpServerStatuses, useMcpServerStatuses } from '@/hooks/useMcpServerStatuses'
import type { EngineMcpServer } from '@/lib/engine/types'
import type { CustomMcpServer } from '@/lib/services/types'
import { serviceIconProps } from '@/lib/services/icons'
import { BlocksIcon, PlugIcon, PlusIcon } from '@/lib/icons'
import { Badge } from '@rerun/ui/primitives'
import { EmptyState } from '@/components/ui/empty-state'
import { PanelEditorBody, PanelEditorHeader, PanelEditorShell } from '@/components/ui/panel-editor'
import { PanelList, PanelListHeader, PanelScroller } from '@/components/ui/panel-list'
import { PanelRow } from '@/components/ui/panel-row'
import { PanelSteps } from '@/components/ui/panel-steps'
import { SkeletonPanelRows } from '@/components/ui/skeleton'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'

type AgentPanelMcpProps = {
    agentId: string
}

type View = { mode: 'list' } | { mode: 'create' } | { mode: 'edit'; index: number; readOnly: boolean } | { mode: 'connect'; server: CustomMcpServer; popup: Window | null }

function serverSummary(s: EngineMcpServer): string {
    if (s.transport === 'sse' || s.transport === 'http') return `${s.transport} · ${s.url ?? '—'}`
    return `stdio · ${[s.command, ...(s.args ?? [])].filter(Boolean).join(' ') || '—'}`
}

export function AgentPanelMcp({ agentId }: AgentPanelMcpProps) {
    const boxManageReason = useBoxManageReason(agentId)
    const t = useTranslations('agent.agentPanelMcp')
    const tApps = useTranslations('agent.agentPanelServices')
    const tServices = useTranslations('services')
    const [servers, setServers] = useState<EngineMcpServer[]>([])
    // The connector store already joins every server name to the app or custom entry that owns it.
    const { map: connectors, custom, loaded: connectorsLoaded } = useConnectorServices(agentId)
    const { statuses, loading: statusesLoading } = useMcpServerStatuses(agentId)
    const [loading, setLoading] = useState(true)
    const [unreachable, setUnreachable] = useState(false)
    const [view, setView] = useState<View>({ mode: 'list' })
    const [error, setError] = useState<string | null>(null)
    const errorText = useErrorText()
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
            setError(null)
            setServers((result.detail.config.mcpServers ?? []) as EngineMcpServer[])
            invalidateConnectorServices(agentId)
            refreshMcpServerStatuses(agentId)
        }
        return result
    }, [agentId])

    const removeServer = async (name: string) => {
        setError(null)
        const result = await mutate({ remove: [name] })
        if (!result.success) setError(errorText(result, tApps('removeServerFailed')))
    }

    const stepKey = view.mode === 'edit' ? `edit:${view.index}` : view.mode === 'connect' ? `connect:${view.server.name}` : view.mode
    const stepDepth = view.mode === 'list' ? 0 : 1

    if (view.mode === 'create') {
        return (
            <PanelSteps stepKey={stepKey} depth={stepDepth}>
                <McpServerEditor agentId={agentId} onSave={async servers => mutate({ upsert: servers })} onDone={() => setView({ mode: 'list' })} onBack={() => setView({ mode: 'list' })} />
            </PanelSteps>
        )
    }

    if (view.mode === 'connect' && view.server.signInUrl) {
        return (
            <PanelSteps stepKey={stepKey} depth={stepDepth}>
                <PanelEditorShell>
                    <PanelEditorHeader title={view.server.displayName} onBack={() => setView({ mode: 'list' })} />
                    <PanelEditorBody>
                        <p className="text-xs text-muted-foreground">{tApps('signInHint', { host: view.server.host ?? view.server.displayName })}</p>
                        <McpOAuthAuthorize
                            url={view.server.signInUrl}
                            agentId={agentId}
                            serverName={view.server.name}
                            autoStart
                            pendingPopup={view.popup}
                            onAuthorized={() => {
                                refreshMcpServerStatuses(agentId)
                                setView({ mode: 'list' })
                            }}
                        />
                    </PanelEditorBody>
                </PanelEditorShell>
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
                    onSave={async ([server]) => mutate({ remove: current.name !== server.name ? [current.name] : [], upsert: [server] })}
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
                <PanelListHeader countLabel={t('count', { count: servers.length })}>
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
                    <PanelScroller className="space-y-2">
                        {error && <p className="text-xs text-destructive">{error}</p>}
                        <PanelList>
                            {servers.map((s, i) => {
                                const owner = connectors.get(s.name)
                                const fromApp = !!owner && !owner.custom
                                const customServer = fromApp ? undefined : custom.find(c => c.name === s.name)
                                if (customServer) {
                                    return (
                                        <CustomMcpRow
                                            key={`${s.name}-${i}`}
                                            server={customServer}
                                            status={statuses.get(s.name)}
                                            statusLoading={statusesLoading}
                                            description={serverSummary(s)}
                                            onConnect={() => setView({ mode: 'connect', server: customServer, popup: openPendingSignInPopup(customServer.displayName, tServices('signInPopup.connecting', { name: customServer.displayName })) })}
                                            onEdit={() => setView({ mode: 'edit', index: i, readOnly: false })}
                                            onRemove={() => void removeServer(s.name)}
                                            disabledReason={canManage ? undefined : boxManageReason}
                                        />
                                    )
                                }
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
