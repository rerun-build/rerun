'use client'

import type { TemplateConnector } from '@rerun/contracts'
import { type BoardAgent, TemplateBoardPreview } from '@rerun/ui/iso-grid'

import { CARD_BACKGROUND, CARD_HEIGHT, CARD_MAX_ZOOM, CARD_THEME, CARD_WIDTH, type CardTheme } from '@/lib/og/size'

export type TemplateCardStageProps = {
    agents: BoardAgent[]
    connectors: TemplateConnector[]
    maxZoom?: number
    theme?: CardTheme
    rounded?: boolean
    width?: number
    height?: number
    highlightedConnectorSlugs?: readonly string[]
}

export function TemplateCardStage({
    agents,
    connectors,
    maxZoom = CARD_MAX_ZOOM,
    theme = CARD_THEME,
    rounded = true,
    width = CARD_WIDTH,
    height = CARD_HEIGHT,
    highlightedConnectorSlugs,
}: TemplateCardStageProps) {
    return (
        <div
            className={`${theme} relative overflow-hidden ${rounded ? 'rounded-2xl border border-border' : ''}`}
            style={{ width, height, background: CARD_BACKGROUND[theme] }}
        >
            <TemplateBoardPreview agents={agents} connectors={connectors} maxZoom={maxZoom} highlightedConnectorSlugs={highlightedConnectorSlugs} className="size-full" />
        </div>
    )
}
