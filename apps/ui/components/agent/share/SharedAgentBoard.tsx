'use client'

import type { TemplateAgent, TemplateConnector } from '@moldwright/contracts'
import { TemplateCardBoard } from '@moldwright/ui/iso-grid'
import { useMemo } from 'react'

const SHARE_MAX_ZOOM = 3

export function SharedAgentBoard({ agent, connectors }: { agent: TemplateAgent; connectors: TemplateConnector[] }) {
    const agents = useMemo(() => [agent], [agent])

    return (
        <div className="pointer-events-none relative aspect-[1200/630] w-full shrink-0 overflow-hidden bg-[#fafafa] mask-b-from-80% dark:bg-[#0a0a0a]">
            <TemplateCardBoard agents={agents} connectors={connectors} maxZoom={SHARE_MAX_ZOOM} />
        </div>
    )
}
