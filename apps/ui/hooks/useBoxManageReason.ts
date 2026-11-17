'use client'

import { useTranslations } from 'next-intl'

import { useForemanStore } from '@/stores/foreman.store'

// Why a control of a coworker is disabled for someone who only uses its Box.
export function useBoxManageReason(): string {
    return useTranslations('errors')('boxManagerOnlyChange')
}

// The same, for a control of one agent: the Chief of Staff sits in no Box, an admin manages it.
export function useAgentManageReason(agentId: string | null | undefined): string {
    const t = useTranslations('errors')
    const isForeman = useForemanStore(state => !!agentId && state.agentRowId === agentId)
    return isForeman ? t('adminOnly') : t('boxManagerOnlyChange')
}
