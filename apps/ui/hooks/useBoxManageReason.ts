'use client'

import { FOREMAN_AGENT_ID } from '@rerun/contracts'
import { useTranslations } from 'next-intl'

// Why a control of a coworker is disabled for someone who only uses its Box. The Chief of Staff sits
// in no Box: what it keeps is a workspace admin's to change.
export function useBoxManageReason(agentId?: string): string {
    return useTranslations('errors')(agentId === FOREMAN_AGENT_ID ? 'adminOnly' : 'boxManagerOnlyChange')
}
