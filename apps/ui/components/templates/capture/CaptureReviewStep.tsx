'use client'

import { useTranslations } from 'next-intl'
import type { AgentSetupDraft } from '@/components/agent/AgentSetupFields'
import type { AgentCapturePlan } from '@/lib/templates/capture'
import { CaptureAgentReviewSection } from './CaptureAgentReviewSection'

// The archive is a copy of the whole agent folder, so this screen is where the reviewer sees what
// the engine already rewrote on the way out and decides what else should not travel. Each agent
// gets its own section and its own sign-off: one blanket "looks fine" would cover none of them.
export function CaptureReviewStep({
    plans,
    excluded,
    approved,
    approvedCount,
    setups,
    onToggleFiles,
    onApprove,
    onSetupChange,
}: {
    plans: AgentCapturePlan[]
    excluded: Record<string, string[]>
    approved: Record<string, boolean>
    approvedCount: number
    setups: Record<string, AgentSetupDraft>
    onToggleFiles: (agentRowId: string, paths: string[], keep: boolean) => void
    onApprove: (agentRowId: string, next: boolean) => void
    onSetupChange: (agentRowId: string, next: AgentSetupDraft) => void
}) {
    const t = useTranslations('templates.capture.review')
    return (
        <div className="flex flex-col gap-4">
            <p className="text-xs text-muted-foreground">{t('reviewed', { approved: approvedCount, total: plans.length })}</p>

            {plans.map(plan => (
                <CaptureAgentReviewSection
                    key={plan.agentRowId}
                    plan={plan}
                    excluded={excluded[plan.agentRowId] ?? []}
                    approved={approved[plan.agentRowId] ?? false}
                    soloAgent={plans.length === 1}
                    setup={setups[plan.agentRowId] ?? { required: null, prompt: '' }}
                    onToggleFiles={(paths, keep) => onToggleFiles(plan.agentRowId, paths, keep)}
                    onApprove={next => onApprove(plan.agentRowId, next)}
                    onSetupChange={next => onSetupChange(plan.agentRowId, next)}
                />
            ))}
        </div>
    )
}
