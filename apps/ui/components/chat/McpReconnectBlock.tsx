'use client'

import { StepRow } from '@/components/chat/StepRow'
import { PlugIcon } from '@/lib/icons'
import type { McpReconnectEvent } from '@rerun/contracts'
import { useTranslations } from 'next-intl'

export function McpReconnectBlock({ data }: { data: McpReconnectEvent }) {
    const t = useTranslations('chat')
    const label = data.effect === 'next_message' ? t('steps.mcpReconnectedNextMessage', { name: data.name }) : t('steps.mcpReconnected', { name: data.name })
    return <StepRow iconProps={{ icon: PlugIcon }} label={label} status="done" />
}
