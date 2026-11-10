'use client'

import { CheckIcon, MinusIcon, UserRoundIcon, XIcon } from '../icons'
import { TextShimmer } from '../TextShimmer'
import { IconBadge } from '../primitives/icon-badge'
import { useKitTranslations } from '../locale'

export type AgentStatusValue = 'idle' | 'working' | 'error' | 'waiting_human' | 'offline'

export type AgentStatusEntry = { id: string; name: string; status: AgentStatusValue }

function AgentStatusIndicator({ status }: { status: AgentStatusValue }) {
    switch (status) {
        case 'working':
            return <IconBadge tone="brand" animated />
        case 'idle':
            return <IconBadge tone="green" icon={CheckIcon} />
        case 'error':
            return <IconBadge tone="red" icon={XIcon} />
        case 'waiting_human':
            return <IconBadge tone="brand" icon={UserRoundIcon} />
        case 'offline':
            return <IconBadge tone="neutral" icon={MinusIcon} />
    }
}

export function AgentStatusList({ agents }: { agents: AgentStatusEntry[] }) {
    const t = useKitTranslations()
    return (
        <div className="flex h-full flex-col gap-1 overflow-auto">
            {agents.map(a => (
                <div key={a.id} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-accent">
                    <AgentStatusIndicator status={a.status} />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{a.name}</span>
                    {a.status === 'working' ? (
                        <TextShimmer as="span" duration={1.6} spread={2} scaleSpreadWithLength className="shrink-0 text-[11px] [--shimmer-base:#78716c] [--shimmer-highlight:#fbbf24]">
                            {t('monitoring.agentStatus.working')}
                        </TextShimmer>
                    ) : (
                        <span className="shrink-0 text-[11px] text-muted-foreground">{t(`monitoring.agentStatus.${a.status}`)}</span>
                    )}
                </div>
            ))}
            {agents.length === 0 && <div className="flex flex-1 items-center justify-center text-[12px] text-muted-foreground">{t('monitoring.agentStatus.empty')}</div>}
        </div>
    )
}
