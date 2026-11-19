'use client'

import { useTranslations } from 'next-intl'
import { useMemo } from 'react'

import type { PlanSceneLabels } from '@/lib/foreman/plan-scene'

export function usePlanSceneLabels(): PlanSceneLabels {
    const t = useTranslations('foreman.plan.scene')
    return useMemo(() => ({ planned: (name: string) => t('planned', { name }), plannedBox: t('plannedBox') }), [t])
}
