'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { getAgentDetailAction, listAgentToolsAction, updateAgentConfigAction } from '@/app/api/_actions/agent.actions'
import { Icon } from '@/components/ui/icon'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipDisabledReason, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useCanManageAgent } from '@/hooks/useBoxAccess'
import { useBoxManageReason } from '@/hooks/useBoxManageReason'
import { ENGINE_SELF_IMPROVEMENT_KEYS } from '@/lib/engine/constants'
import type { EngineSelfImprovement, EngineToolFamily } from '@/lib/engine/types'
import { ActivityIcon, BrainIcon, CalendarClockIcon, CardsIcon, CircleCheckIcon, CoinsIcon, DatabaseIcon, FolderIcon, GlobeIcon, InfoIcon, LayersIcon, Loader2Icon, LockIcon, type LucideIcon, MessageCircleQuestionIcon, MonitorIcon, QuickReplyIcon, TerminalIcon, UsersIcon, WandSparklesIcon, WebhookIcon, WrenchIcon } from '@/lib/icons'
import { EmptyState } from '@/components/ui/empty-state'
import { PanelGrid, PanelListHeader, PanelScroller } from '@/components/ui/panel-list'
import { PANEL_CARD, PANEL_CARD_INTERACTIVE } from '@/components/ui/panel-row'
import { SkeletonCardGrid } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useState } from 'react'

type SelfImprovementKey = (typeof ENGINE_SELF_IMPROVEMENT_KEYS)[number]

const SELF_IMPROVEMENT_SUBKEYS = ENGINE_SELF_IMPROVEMENT_KEYS.filter((key): key is Exclude<SelfImprovementKey, 'enabled'> => key !== 'enabled')

type AgentPanelToolsProps = {
    agentId: string
}

type CapabilityMeta = {
    icon: LucideIcon
    label: string
    blurb: string
    help: string
}

const CAPABILITY_ICONS = {
    filesystem: FolderIcon,
    shell: TerminalIcon,
    web: GlobeIcon,
    memory: BrainIcon,
    db: DatabaseIcon,
    brain: BrainIcon,
    sharedDb: DatabaseIcon,
    skills: LayersIcon,
    self: WandSparklesIcon,
    schedule: CalendarClockIcon,
    trigger: WebhookIcon,
    callAgent: UsersIcon,
    team: ActivityIcon,
    askUser: MessageCircleQuestionIcon,
    requestApproval: CircleCheckIcon,
    cards: CardsIcon,
    quickReplies: QuickReplyIcon,
    computer: MonitorIcon,
    paidData: CoinsIcon,
    requestSecret: LockIcon,
} satisfies Record<string, LucideIcon>

type CapabilityFamily = keyof typeof CAPABILITY_ICONS

export function useCapabilityMeta(): Record<string, CapabilityMeta> {
    const t = useTranslations('agent.agentPanelTools.capabilities')
    return useMemo(
        () =>
            Object.fromEntries(
                (Object.keys(CAPABILITY_ICONS) as CapabilityFamily[]).map(family => [family, { icon: CAPABILITY_ICONS[family], label: t(`${family}.label`), blurb: t(`${family}.blurb`), help: t(`${family}.help`) }]),
            ),
        [t],
    )
}

function capitalize(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1)
}

function metaFor(family: EngineToolFamily, capabilities: Record<string, CapabilityMeta>): CapabilityMeta {
    return capabilities[family.family] ?? { icon: WrenchIcon, label: capitalize(family.family), blurb: family.description, help: family.description }
}

export function AgentPanelTools({ agentId }: AgentPanelToolsProps) {
    const boxManageReason = useBoxManageReason()
    const t = useTranslations('agent.agentPanelTools')
    const errorText = useErrorText()
    const capabilities = useCapabilityMeta()
    const [families, setFamilies] = useState<EngineToolFamily[]>([])
    const [selfImprovement, setSelfImprovement] = useState<EngineSelfImprovement | null>(null)
    const [paidDataAlwaysAllow, setPaidDataAlwaysAllow] = useState(false)
    const [loading, setLoading] = useState(true)
    const [pending, setPending] = useState<Set<string>>(new Set())
    const [error, setError] = useState<string | null>(null)
    const canManage = useCanManageAgent(agentId)
    const manageReason = canManage ? undefined : boxManageReason

    useEffect(() => {
        setLoading(true)
        setError(null)
        Promise.all([listAgentToolsAction(agentId), getAgentDetailAction(agentId)])
            .then(([tools, detail]) => {
                if (tools.length === 0 || !detail) {
                    setError(t('unreachable'))
                    return
                }
                setFamilies(tools)
                setSelfImprovement(detail.config.selfImprovement)
                setPaidDataAlwaysAllow(detail.config.paidDataAlwaysAllow)
            })
            .catch(() => setError(t('unreachable')))
            .finally(() => setLoading(false))
    }, [agentId, t])

    const withPending = useCallback(async (key: string, apply: () => void, revert: () => void, patch: Parameters<typeof updateAgentConfigAction>[1]) => {
        apply()
        setPending(prev => new Set(prev).add(key))
        const result = await updateAgentConfigAction(agentId, patch)
        if (!result.success) {
            revert()
            setError(errorText(result, t('updateFailed')))
        }
        setPending(prev => {
            const s = new Set(prev)
            s.delete(key)
            return s
        })
    }, [agentId, t, errorText])

    const handleToggle = useCallback(
        async (family: string, value: boolean) => {
            if (family === 'self') {
                await withPending(
                    'self',
                    () => {
                        setFamilies(prev => prev.map(f => (f.family === 'self' ? { ...f, enabled: value } : f)))
                        setSelfImprovement(prev => (prev ? { ...prev, enabled: value } : prev))
                    },
                    () => {
                        setFamilies(prev => prev.map(f => (f.family === 'self' ? { ...f, enabled: !value } : f)))
                        setSelfImprovement(prev => (prev ? { ...prev, enabled: !value } : prev))
                    },
                    { selfImprovement: { enabled: value } }
                )
                return
            }
            await withPending(
                family,
                () => setFamilies(prev => prev.map(f => (f.family === family ? { ...f, enabled: value } : f))),
                () => setFamilies(prev => prev.map(f => (f.family === family ? { ...f, enabled: !value } : f))),
                { tools: { [family]: value } }
            )
        },
        [withPending]
    )

    const handleSelfImprovement = useCallback(
        async (key: Exclude<SelfImprovementKey, 'enabled'>, value: boolean) => {
            await withPending(
                key,
                () => setSelfImprovement(prev => (prev ? { ...prev, [key]: value } : prev)),
                () => setSelfImprovement(prev => (prev ? { ...prev, [key]: !value } : prev)),
                { selfImprovement: { [key]: value } }
            )
        },
        [withPending]
    )

    const handlePaidDataAlwaysAllow = useCallback(
        async (value: boolean) => {
            await withPending(
                'paidDataAlwaysAllow',
                () => setPaidDataAlwaysAllow(value),
                () => setPaidDataAlwaysAllow(!value),
                { paidDataAlwaysAllow: value }
            )
        },
        [withPending]
    )

    if (loading) {
        return <SkeletonCardGrid rows={6} className="p-3" />
    }

    if (error) {
        return <EmptyState className="h-full" icon={WrenchIcon} title={t('unavailableTitle')} description={error} />
    }

    return (
        <div className="flex flex-col h-full">
            <PanelListHeader>
                <p className="text-xs text-muted-foreground">{t('intro')}</p>
            </PanelListHeader>
            <TooltipProvider>
            <PanelScroller>
                <PanelGrid>
                {[...families].sort((a, b) => Number(a.family === 'self') - Number(b.family === 'self')).map(family => {
                    const checked = !!family.enabled
                    const isPending = pending.has(family.family)
                    const meta = metaFor(family, capabilities)
                    const isSelf = family.family === 'self'
                    const isPaidData = family.family === 'paidData'
                    const expanded = (isSelf || isPaidData) && checked
                    return (
                        <div key={family.family} className={cn('flex flex-col gap-2 p-3', PANEL_CARD, PANEL_CARD_INTERACTIVE, expanded && 'col-span-2')}>
                            <div className="flex items-start justify-between gap-2">
                                <Icon icon={meta.icon} size="md" />
                                {isPending ? (
                                    <Loader2Icon className="size-3.5 animate-spin text-muted-foreground shrink-0 mt-1" />
                                ) : (
                                    <TooltipDisabledReason reason={manageReason} className="shrink-0">
                                        <Switch checked={checked} disabled={!canManage} onCheckedChange={value => handleToggle(family.family, value)} className="shrink-0 mt-0.5" />
                                    </TooltipDisabledReason>
                                )}
                            </div>
                            <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                    <span className="text-sm font-medium truncate">{meta.label}</span>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <button type="button" aria-label={t('about', { capability: meta.label })} className="text-muted-foreground/60 hover:text-foreground shrink-0 transition-colors">
                                                <InfoIcon className="size-3.5" />
                                            </button>
                                        </TooltipTrigger>
                                        <TooltipContent side="left" className="max-w-65 flex-col items-start">
                                            <p className="text-xs">{meta.help}</p>
                                            {family.tools.length > 0 && (
                                                <div className="mt-1.5 w-full border-t border-background/20 pt-1.5">
                                                    <p className="text-[10px] uppercase tracking-wide text-background/60 mb-1">{t('includes')}</p>
                                                    <ul className="space-y-0.5">
                                                        {family.tools.map(tool => (
                                                            <li key={tool.name} className="text-[11px] text-background/80">
                                                                {tool.description || tool.name}
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            )}
                                        </TooltipContent>
                                    </Tooltip>
                                </div>
                                <span className="text-xs text-muted-foreground block line-clamp-2">{meta.blurb}</span>
                            </div>
                            {expanded && isPaidData && (
                                <div className="mt-1 flex flex-col border-t border-border pt-1">
                                    <label className="flex items-center gap-2 py-1.5 px-1 rounded-md hover:bg-accent/40 transition-colors cursor-pointer">
                                        <span className="flex-1 min-w-0">
                                            <span className="text-sm block truncate">{t('paidDataAlwaysAllow.label')}</span>
                                            <span className="text-xs text-muted-foreground block">{t('paidDataAlwaysAllow.description')}</span>
                                        </span>
                                        {pending.has('paidDataAlwaysAllow') ? (
                                            <Loader2Icon className="size-3.5 animate-spin text-muted-foreground shrink-0" />
                                        ) : (
                                            <TooltipDisabledReason reason={manageReason} className="shrink-0">
                                                <Switch checked={paidDataAlwaysAllow} disabled={!canManage} onCheckedChange={handlePaidDataAlwaysAllow} className="shrink-0" />
                                            </TooltipDisabledReason>
                                        )}
                                    </label>
                                </div>
                            )}
                            {expanded && isSelf && selfImprovement && (
                                <div className="mt-1 flex flex-col border-t border-border pt-1">
                                    {SELF_IMPROVEMENT_SUBKEYS.map(key => (
                                        <label key={key} className="flex items-center gap-2 py-1.5 px-1 rounded-md hover:bg-accent/40 transition-colors cursor-pointer">
                                            <span className="flex-1 min-w-0">
                                                <span className="text-sm block truncate">{t(`selfImprovement.${key}.label`)}</span>
                                                <span className="text-xs text-muted-foreground block">{t(`selfImprovement.${key}.description`)}</span>
                                            </span>
                                            {pending.has(key) ? (
                                                <Loader2Icon className="size-3.5 animate-spin text-muted-foreground shrink-0" />
                                            ) : (
                                                <TooltipDisabledReason reason={manageReason} className="shrink-0">
                                                    <Switch checked={!!selfImprovement[key]} disabled={!canManage} onCheckedChange={value => handleSelfImprovement(key, value)} className="shrink-0" />
                                                </TooltipDisabledReason>
                                            )}
                                        </label>
                                    ))}
                                </div>
                            )}
                        </div>
                    )
                })}
                </PanelGrid>
            </PanelScroller>
            </TooltipProvider>
        </div>
    )
}
