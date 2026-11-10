'use client'

import { listTaskOutcomesAction, listTriggerRunsAction, listTriggersAction } from '@/app/api/_actions/agent.actions'
import { adoptRunSession, RunHistoryList } from '@/components/agent/AgentRunHistory'
import { TaskOutcomeFooter } from '@/components/agent/TaskOutcomeFooter'
import { TriggerEditor } from '@/components/agent/TriggerEditor'
import { Button } from '@/components/ui/button'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { useCanManageAgent } from '@/hooks/useBoxAccess'
import { useBoxManageReason } from '@/hooks/useBoxManageReason'
import { EmptyState } from '@/components/ui/empty-state'
import { PanelList, PanelListHeader, PanelScroller } from '@/components/ui/panel-list'
import { PanelRow } from '@/components/ui/panel-row'
import { PanelSteps } from '@/components/ui/panel-steps'
import { SkeletonPanelRows } from '@/components/ui/skeleton'
import { Badge } from '@rerun/ui/primitives'
import type { EngineRun, EngineTrigger } from '@/lib/engine/types'
import { PauseIcon, PlusIcon, WebhookIcon } from '@/lib/icons'
import { outcomeKey, type TaskOutcome } from '@/lib/schedules/outcomes'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'

type AgentPanelTriggersProps = {
    agentId: string
    onOpenSession: (sessionId: string, title: string, runId: string | null) => void
}

type View = { mode: 'list' } | { mode: 'create' } | { mode: 'edit'; slug: string } | { mode: 'runs'; slug: string }


export function AgentPanelTriggers({ agentId, onOpenSession }: AgentPanelTriggersProps) {
    const boxManageReason = useBoxManageReason()
    const t = useTranslations('agent.agentPanelTriggers')
    const [triggers, setTriggers] = useState<EngineTrigger[]>([])
    const [outcomes, setOutcomes] = useState<Record<string, TaskOutcome>>({})
    const [loading, setLoading] = useState(true)
    const [view, setView] = useState<View>({ mode: 'list' })
    const canManage = useCanManageAgent(agentId)

    const load = useCallback(async () => {
        setLoading(true)
        const [nextTriggers, nextOutcomes] = await Promise.all([listTriggersAction(agentId), listTaskOutcomesAction(agentId)])
        setTriggers(nextTriggers)
        setOutcomes(nextOutcomes)
        setLoading(false)
    }, [agentId])

    useEffect(() => {
        load()
    }, [load])

    const stepKey = view.mode === 'edit' || view.mode === 'runs' ? `${view.mode}:${view.slug}` : view.mode
    const stepDepth = view.mode === 'list' ? 0 : view.mode === 'runs' ? 2 : 1

    if (view.mode === 'create') {
        return (
            <PanelSteps stepKey={stepKey} depth={stepDepth}>
                <TriggerEditor
                    agentId={agentId}
                    onDone={() => {
                        setView({ mode: 'list' })
                        load()
                    }}
                    onBack={() => setView({ mode: 'list' })}
                />
            </PanelSteps>
        )
    }

    if (view.mode === 'edit') {
        return (
            <PanelSteps stepKey={stepKey} depth={stepDepth}>
                <TriggerEditor
                    agentId={agentId}
                    slug={view.slug}
                    onDone={() => {
                        setView({ mode: 'list' })
                        load()
                    }}
                    onBack={() => setView({ mode: 'list' })}
                    onShowHistory={() => setView({ mode: 'runs', slug: view.slug })}
                />
            </PanelSteps>
        )
    }

    if (view.mode === 'runs') {
        return (
            <PanelSteps stepKey={stepKey} depth={stepDepth}>
                <TriggerRuns agentId={agentId} trigger={triggers.find(trigger => trigger.slug === view.slug)} slug={view.slug} onBack={() => setView({ mode: 'edit', slug: view.slug })} onOpenSession={onOpenSession} />
            </PanelSteps>
        )
    }

    if (loading) {
        return (
            <PanelSteps stepKey={stepKey} depth={stepDepth}>
                <SkeletonPanelRows rows={5} lines={3} badge />
            </PanelSteps>
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
                <PanelListHeader count={triggers.length} noun="trigger">
                    {newButton}
                </PanelListHeader>

                {triggers.length === 0 ? (
                    <EmptyState
                        icon={WebhookIcon}
                        title={t('emptyTitle')}
                        description={t('emptyDescription')}
                        action={newButton}
                    />
                ) : (
                    <PanelScroller>
                        <PanelList>
                            {triggers.map(trigger => (
                                <PanelRow
                                    key={trigger.slug}
                                    onClick={() => setView({ mode: 'edit', slug: trigger.slug })}
                                    title={trigger.name}
                                    description={t('summary', { methods: trigger.methods.join('/'), count: trigger.fireCount })}
                                    footer={<TaskOutcomeFooter outcome={outcomes[outcomeKey('trigger', trigger.slug)]} lastStartedAt={trigger.lastFiredAt} />}
                                    meta={
                                        !trigger.enabled && (
                                            <Badge size="xs" tone="neutral" glow={false} leading={<PauseIcon className="size-3" />}>
                                                {t('paused')}
                                            </Badge>
                                        )
                                    }
                                />
                            ))}
                        </PanelList>
                    </PanelScroller>
                )}
            </div>
        </PanelSteps>
    )
}

function TriggerRuns({ agentId, trigger, slug, onBack, onOpenSession }: { agentId: string; trigger?: EngineTrigger; slug: string; onBack: () => void; onOpenSession: (sessionId: string, title: string, runId: string | null) => void }) {
    const t = useTranslations('agent.agentPanelTriggers')
    const loadRuns = useCallback(() => listTriggerRunsAction(agentId, slug), [agentId, slug])
    const title = trigger?.name ?? slug
    const openRun = useCallback(async (run: EngineRun) => {
        const sessionId = await adoptRunSession(agentId, run.sessionId, title)
        onOpenSession(sessionId, title, run.status === 'running' ? run.id : null)
    }, [agentId, title, onOpenSession])
    return <RunHistoryList title={title} loadRuns={loadRuns} emptyIcon={WebhookIcon} emptyLabel={t('neverCalled')} onBack={onBack} onSelectRun={openRun} />
}
