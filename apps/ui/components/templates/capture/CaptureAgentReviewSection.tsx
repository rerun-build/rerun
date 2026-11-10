'use client'

import { useLocale, useTranslations } from 'next-intl'
import * as React from 'react'
import { isSetupAnswered } from '@rerun/contracts'
import { Stripes } from '@rerun/ui/primitives'
import { AgentSetupFields, type AgentSetupDraft } from '@/components/agent/AgentSetupFields'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Field } from '@/components/ui/field'
import { ChevronRight, FolderIcon, LockIcon, Package, ShieldAlertIcon, ShieldCheck, WrenchIcon } from '@/lib/icons'
import type { AgentCapturePlan } from '@/lib/templates/capture'
import { scheduleLabel } from '@/lib/templates/labels'
import { cn } from '@/lib/utils'
import { CaptureFileTree } from './CaptureFileTree'
import { formatBytes } from '@/lib/files/format'
import { CaptureReviewChips, CaptureReviewGroup, CaptureReviewRow } from './CaptureReviewGroup'
import { flaggedPathSet, planStats } from './capturePlanSummary'

export function CaptureAgentReviewSection({
    plan,
    excluded,
    approved,
    soloAgent,
    setup,
    onToggleFiles,
    onApprove,
    onSetupChange,
}: {
    plan: AgentCapturePlan
    excluded: string[]
    approved: boolean
    soloAgent: boolean
    setup: AgentSetupDraft
    onToggleFiles: (paths: string[], keep: boolean) => void
    onApprove: (next: boolean) => void
    onSetupChange: (next: AgentSetupDraft) => void
}) {
    const t = useTranslations('templates.capture.review')
    const locale = useLocale()
    const flagged = React.useMemo(() => flaggedPathSet(plan), [plan])
    const stats = planStats(plan, excluded)
    const [filesOpen, setFilesOpen] = React.useState(stats.flaggedTotal > 0 || soloAgent)

    const travels = plan.connectorSlugs.length + plan.skills.length + plan.schedules.length + plan.triggers.length + plan.tools.length + plan.memoryCount > 0
    const removed = plan.redactions.length + plan.strippedConfigKeys.length > 0
    const toProvide = plan.envKeys.length + plan.mcpAuth.length > 0

    return (
        <div className={cn('flex flex-col gap-3 overflow-hidden rounded-lg border bg-card p-3', approved ? 'border-primary/40' : 'border-border/60')}>
            <div className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-sm font-medium">{plan.displayName || plan.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                        {t('files', { kept: stats.kept, total: stats.total, size: formatBytes(stats.keptBytes, locale) })}
                    </span>
                </div>
                <span className="flex min-w-0 items-baseline gap-1.5 text-xs text-muted-foreground">
                    {plan.name && <span className="shrink-0">@{plan.name}</span>}
                    {plan.description && <span className="truncate">{plan.description}</span>}
                </span>
            </div>

            {travels && (
                <CaptureReviewGroup icon={Package} title={t('tools')}>
                    {plan.tools.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1">
                            <CaptureReviewChips items={plan.tools} max={plan.tools.length} />
                        </div>
                    )}
                    {plan.connectorSlugs.length > 0 && (
                        <CaptureReviewRow label={t('apps')}>
                            <CaptureReviewChips items={plan.connectorSlugs} />
                        </CaptureReviewRow>
                    )}
                    {plan.skills.length > 0 && (
                        <CaptureReviewRow label={t('skills')}>
                            <CaptureReviewChips items={plan.skills.map(skill => skill.name)} max={6} />
                        </CaptureReviewRow>
                    )}
                    {plan.schedules.length > 0 && (
                        <CaptureReviewRow label={t('schedules')}>
                            <CaptureReviewChips items={plan.schedules.map(s => `${s.name}: ${s.cron ? scheduleLabel(s.cron, locale) : t('oneShot')}`)} max={4} />
                        </CaptureReviewRow>
                    )}
                    {plan.triggers.length > 0 && (
                        <CaptureReviewRow label={t('webhooks')}>
                            <CaptureReviewChips items={plan.triggers.map(trigger => `${trigger.name}: ${trigger.methods.join('/')}`)} max={4} />
                        </CaptureReviewRow>
                    )}
                    {plan.memoryCount > 0 && (
                        <CaptureReviewRow label={t('memories')}>
                            <span className="text-[0.7rem] text-muted-foreground">{t('memoriesNote', { count: plan.memoryCount })}</span>
                        </CaptureReviewRow>
                    )}
                </CaptureReviewGroup>
            )}

            {removed && (
                <CaptureReviewGroup icon={ShieldCheck} title={t('removed')}>
                    {plan.redactions.map(redaction => (
                        <div key={redaction.path} className="flex items-baseline gap-2 text-xs">
                            <span className="shrink-0 font-mono text-foreground/80">{redaction.path}</span>
                            <span className="min-w-0 truncate text-muted-foreground">{redaction.reason}</span>
                        </div>
                    ))}
                    {plan.strippedConfigKeys.length > 0 && (
                        <CaptureReviewRow label="config.json">
                            <CaptureReviewChips items={plan.strippedConfigKeys} mono max={6} />
                        </CaptureReviewRow>
                    )}
                </CaptureReviewGroup>
            )}

            {toProvide && (
                <CaptureReviewGroup icon={LockIcon} title={t('toProvide')} tone="warning">
                    {plan.envKeys.length > 0 && (
                        <CaptureReviewRow label={t('envKeys')}>
                            <CaptureReviewChips items={plan.envKeys} mono max={10} />
                        </CaptureReviewRow>
                    )}
                    {plan.mcpAuth.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1">
                            <CaptureReviewChips items={plan.mcpAuth.map(auth => `${auth.server} (${auth.kind})`)} max={6} />
                        </div>
                    )}
                </CaptureReviewGroup>
            )}

            {stats.flaggedTotal > 0 && (
                <CaptureReviewGroup
                    icon={ShieldAlertIcon}
                    title={t('flagged')}
                    tone={stats.flaggedKept.length > 0 ? 'danger' : 'warning'}
                >
                    {stats.flaggedKept.length > 0 ? (
                        <>
                            <p className="text-xs text-destructive">{t('flaggedKept', { kept: stats.flaggedKept.length, total: stats.flaggedTotal })}</p>
                            <div className="flex flex-wrap gap-1">
                                <CaptureReviewChips items={stats.flaggedKept} mono max={5} />
                            </div>
                        </>
                    ) : (
                        <p className="text-xs text-muted-foreground">{t('flaggedOut', { count: stats.flaggedTotal })}</p>
                    )}
                </CaptureReviewGroup>
            )}

            <CaptureReviewGroup icon={WrenchIcon} title={t('install')}>
                <AgentSetupFields
                    value={setup}
                    onChange={next => {
                        onSetupChange(next)
                        // Changing the answer changes what this agent ships. Rewording the
                        // instructions does not, so it leaves a sign-off alone.
                        if (next.required !== setup.required) onApprove(false)
                    }}
                />
            </CaptureReviewGroup>

            <Collapsible open={filesOpen} onOpenChange={setFilesOpen}>
                <CaptureReviewGroup icon={FolderIcon} title={t('filesGroup')}>
                    <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded py-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
                        <ChevronRight className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
                        {filesOpen ? t('hideFolder') : t('showFolder')}
                        <span className="ml-auto">{t('kept', { kept: stats.kept, total: stats.total })}</span>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                        <CaptureFileTree
                            files={plan.files}
                            excluded={excluded}
                            onToggle={(paths, keep) => {
                                onToggleFiles(paths, keep)
                                // Putting a flagged file back in changes what was signed off, so the
                                // review has to be given again.
                                if (keep && paths.some(path => flagged.has(path))) onApprove(false)
                            }}
                        />
                    </CollapsibleContent>
                </CaptureReviewGroup>
            </Collapsible>

            <div className="relative -mx-3 -mb-3 mt-auto overflow-hidden border-t border-border/60 bg-amber-500/[0.02] px-3 py-2.5">
                <Stripes fade="vertical" color="rgb(245 158 11 / 0.06)" />
                <Field
                    className="relative"
                    orientation="row"
                    label={t('confirm')}
                    helperText={
                        setup.required === null
                            ? t('answerFirst')
                            : !isSetupAnswered(setup)
                              ? t('writeFirst')
                              : stats.flaggedKept.length > 0
                                ? t('flaggedTravel', { count: stats.flaggedKept.length })
                                : t('nothingSecret')
                    }
                >
                    <Checkbox size="sm" disabled={!isSetupAnswered(setup)} checked={approved} onCheckedChange={value => onApprove(value === true)} />
                </Field>
            </div>
        </div>
    )
}
