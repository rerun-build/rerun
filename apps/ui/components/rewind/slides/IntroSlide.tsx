'use client'

import { TemplateBoardPreview, type BoardAgent } from '@rerun/ui/iso-grid'
import type { TemplateConnector } from '@rerun/contracts'
import { useLocale, useTranslations } from 'next-intl'
import { useMemo } from 'react'

import { formatWeekRange } from '@/lib/rewind/format'
import { RewindHeadline, RewindReveal, RewindSlideFrame } from '../RewindSlideFrame'
import type { RewindSlideProps } from './types'

const MAX_BOARD_AGENTS = 6

export function IntroSlide({ payload, wide }: RewindSlideProps) {
    const locale = useLocale()
    const t = useTranslations('rewind.intro')
    const { agents, connectors } = useMemo(() => {
        const shown = payload.agents.slice(0, MAX_BOARD_AGENTS)
        const boardAgents: BoardAgent[] = shown.map(agent => ({ key: agent.agentId, name: agent.name, connectorSlugs: agent.connectors }))
        const boardConnectors: TemplateConnector[] = payload.connectors.map(connector => ({ slug: connector.slug, name: connector.name, icon: connector.icon }))
        return { agents: boardAgents, connectors: boardConnectors }
    }, [payload])

    return (
        <RewindSlideFrame
            tone="violet"
            eyebrow={formatWeekRange(payload.weekStart, payload.weekEnd, locale)}
            visual={
                <div className="relative -mx-6 h-[50cqh] [mask-image:linear-gradient(to_bottom,transparent,black_20%)] rewind-wide:mx-0 rewind-wide:h-full rewind-wide:[mask-image:linear-gradient(to_right,transparent,black_15%)]">
                    {agents.length > 0 && <TemplateBoardPreview agents={agents} connectors={connectors} alive maxZoom={wide ? 4 : 2.4} className="size-full" />}
                </div>
            }
        >
            <RewindHeadline className="text-[2.75rem]/[1.05] rewind-wide:text-[min(4.5rem,13cqh)]/[1.02]">{t.rich('headline', { br: () => <br /> })}</RewindHeadline>
            <RewindReveal delay={0.7} className="mt-3 text-base text-white/75 rewind-wide:mt-5 rewind-wide:text-lg">
                {payload.totals.activeAgents === 1 ? t('clockedInOne') : t('clockedInOther', { count: payload.totals.activeAgents })}
            </RewindReveal>
        </RewindSlideFrame>
    )
}
