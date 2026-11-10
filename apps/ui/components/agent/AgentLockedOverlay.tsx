'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { activateAgentAction } from '@/app/api/_actions/agent.actions'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { formatKeptUntil } from '@/components/layout/WorkspacePausedBanner'
import { useCanManageAgent } from '@/hooks/useBoxAccess'
import { useEntitlements } from '@/hooks/useEntitlements'
import { useBoxManageReason } from '@/hooks/useBoxManageReason'
import { useWorkspaceAccess } from '@/hooks/useWorkspaceAccess'
import { LoaderIcon, LockIcon } from '@/lib/icons'
import { isPlanLimited, type IsoAgent } from '@/lib/board/types'
import { useBillingStore } from '@/stores/billing.store'
import { useBoardStore } from '@/stores/board.store'
import { useSession } from '@/supabase/session/SessionProvider'
import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'
import { toast } from 'sonner'

// What a switched-off agent shows instead of its tabs. There is no matching "deactivate": the plan
// says how many agents run, the user says which ones, and freeing a slot means deleting an agent
// (Settings stays reachable behind this, which is where that lives).
export function AgentLockedOverlay({ agent }: { agent: IsoAgent }) {
    const { access, keptUntil, paymentFailed, sandboxArchived } = useWorkspaceAccess()
    if (sandboxArchived) return <SandboxArchivedOverlay name={agent.name} keptUntil={keptUntil} />
    if (access === 'paused') return <WorkspacePausedOverlay name={agent.name} keptUntil={keptUntil} paymentFailed={paymentFailed} />
    if (access === 'restoring') return <WorkspaceRestoringOverlay name={agent.name} />
    return <AgentSlotOverlay agent={agent} />
}

// The whole workspace is off, its machine archived: nothing here is about a slot.
export function WorkspacePausedOverlay({ name, keptUntil, paymentFailed = false }: { name: string; keptUntil: Date | null; paymentFailed?: boolean }) {
    const t = useTranslations('agent.agentLockedOverlay')
    const locale = useLocale()
    return (
        <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
            <Icon size="lg" icon={LockIcon} className="text-muted-foreground" />
            <div className="space-y-1.5">
                <p className="text-sm font-medium">{t('paused.title', { name })}</p>
                <p className="text-sm text-muted-foreground">
                    {keptUntil ? t('savedUntil', { date: formatKeptUntil(keptUntil, locale) }) : t('saved')} {paymentFailed ? t('paused.updatePaymentToResume', { name }) : t('paused.subscribeToResume', { name })}
                </p>
            </div>
            <Button variant="outline" highlight onClick={() => useBillingStore.getState().openBilling(undefined, 'paused_agent_panel')}>
                {paymentFailed ? t('paused.updatePayment') : t('paused.subscribe')}
            </Button>
        </div>
    )
}

// No button here: the request lives on the board's banner, where its answer is shown too.
function SandboxArchivedOverlay({ name, keptUntil }: { name: string; keptUntil: Date | null }) {
    const t = useTranslations('agent.agentLockedOverlay')
    const locale = useLocale()
    return (
        <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
            <Icon size="lg" icon={LockIcon} className="text-muted-foreground" />
            <div className="space-y-1.5">
                <p className="text-sm font-medium">{t('sandboxArchived.title', { name })}</p>
                <p className="text-sm text-muted-foreground">
                    {keptUntil ? t('savedUntil', { date: formatKeptUntil(keptUntil, locale) }) : t('saved')} {t('sandboxArchived.requestReactivation', { name })}
                </p>
            </div>
        </div>
    )
}

export function WorkspaceRestoringOverlay({ name }: { name: string }) {
    const t = useTranslations('agent.agentLockedOverlay')
    return (
        <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
            <Icon size="lg" icon={LoaderIcon} className="text-muted-foreground [&_svg]:animate-spin" />
            <div className="space-y-1.5">
                <p className="text-sm font-medium">{t('restoring.title', { name })}</p>
                <p className="text-sm text-muted-foreground">{t('restoring.description', { name })}</p>
            </div>
        </div>
    )
}

function AgentSlotOverlay({ agent }: { agent: IsoAgent }) {
    const boxManageReason = useBoxManageReason()
    const t = useTranslations('agent.agentLockedOverlay')
    const errorText = useErrorText()
    const { noFreeAgentSlot, activeAgentsCount, maxAgents, gate } = useEntitlements()
    const { workspace } = useSession()
    const localActivateAgent = useBoardStore(s => s._localActivateAgent)
    const canManage = useCanManageAgent(agent.id)
    const [activating, setActivating] = useState(false)

    const fromTemplate = !isPlanLimited(agent)
    const capFixedByHand = noFreeAgentSlot && workspace?.subscription_status !== 'trialing'

    const handleActivate = async () => {
        setActivating(true)
        const res = await activateAgentAction(agent.id)
        setActivating(false)
        if (!res.ok) {
            toast.error(t('slot.activateFailed'), { description: errorText(res) })
            return
        }
        localActivateAgent(agent.id)
        toast.success(t('slot.backOnline', { name: agent.name }))
    }

    return (
        <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
            <Icon size="lg" icon={LockIcon} className="text-muted-foreground" />
            <div className="space-y-1.5">
                <p className="text-sm font-medium">{t('slot.inactive', { name: agent.name })}</p>
                <p className="text-sm text-muted-foreground">
                    {fromTemplate ? t('slot.templateEnded') : t('slot.nothingLost')}
                </p>
            </div>

            {!fromTemplate &&
                (noFreeAgentSlot ? (
                    <div className="space-y-2">
                        {/* Only a trial's cap is lifted by paying: a paid plan runs unlimited coworkers, so a number left on
                            a subscribed workspace was set by hand from the admin and no checkout raises it. */}
                        <TooltipDisabledReason reason={capFixedByHand ? t('slot.fixedLimit') : undefined}>
                            <Button variant="outline" highlight disabled={capFixedByHand} onClick={gate}>
                                {t('slot.upgradeToActivate')}
                            </Button>
                        </TooltipDisabledReason>
                        {maxAgents !== null && (
                            <p className="text-xs text-muted-foreground">
                                {t('slot.activeCount', { active: activeAgentsCount, max: maxAgents })}
                            </p>
                        )}
                    </div>
                ) : (
                    <TooltipDisabledReason reason={canManage ? undefined : boxManageReason}>
                        <Button size="sm" disabled={activating || !canManage} onClick={handleActivate}>
                            {activating ? t('slot.activating') : t('slot.activate')}
                        </Button>
                    </TooltipDisabledReason>
                ))}
        </div>
    )
}
