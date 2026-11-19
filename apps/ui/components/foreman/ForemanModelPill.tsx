'use client'

import { FOREMAN_AGENT_ID } from '@moldwright/contracts'
import { useTranslations } from 'next-intl'

import { ModelPillTrigger } from '@/components/agent/ModelPillTrigger'
import { ModelSelector } from '@/components/agent/ModelSelector'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import type { ForemanBackend } from '@/lib/foreman/phase'
import { useForemanStore } from '@/stores/foreman.store'

export function ForemanModelPill({ backend }: { backend: ForemanBackend }) {
    const t = useTranslations('foreman.modelPill')
    const open = useForemanStore(state => state.open)
    if (backend === 'engine') return open === true ? <ModelSelector agentId={FOREMAN_AGENT_ID} /> : null
    return (
        <TooltipDisabledReason reason={t('hubReason')}>
            <ModelPillTrigger provider="rerun" label="Moldwright Balanced" disabled />
        </TooltipDisabledReason>
    )
}
