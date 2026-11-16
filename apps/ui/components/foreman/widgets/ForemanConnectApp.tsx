'use client'

import { useTranslations } from 'next-intl'

import { ServiceSuggestionBlock } from '@/components/services/ServiceSuggestionBlock'
import { pendingServices } from '@/lib/chat-hitl'
import { useBoardStore } from '@/stores/board.store'

// The engine foreman's connect_app: a coworker's own setup card, drawn for the coworker the foreman
// names, since the foreman holds no app. Finishing it sends the summary as the next message, which
// is what resumes the foreman.
export function ForemanConnectApp({ input, onDone }: { input: unknown; onDone: (summary: string) => void }) {
    const t = useTranslations('foreman.connectApp')
    const record = (input ?? {}) as Record<string, unknown>
    const agentId = typeof record.agentId === 'string' ? record.agentId : ''
    const coworker = useBoardStore(state => state.agents.find(agent => agent.id === agentId))
    return (
        <div className="flex flex-col gap-1.5">
            {coworker && <p className="truncate px-1 text-xs text-muted-foreground">{t('for', { name: coworker.name })}</p>}
            <ServiceSuggestionBlock inline agentId={agentId} services={pendingServices(record)} onDone={onDone} />
        </div>
    )
}
