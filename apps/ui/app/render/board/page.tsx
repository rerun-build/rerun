import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { OgReadyMarker } from '@/components/og/OgReadyMarker'
import { TemplateCardStage } from '@/components/templates/TemplateCardStage'
import { readBoardImageRequest } from '@/lib/og/board-image'
import { boardImageMaxZoom, stageBoardScene } from '@/lib/og/board-scene'
import { CARD_BACKGROUND } from '@/lib/og/size'
import { createServiceRoleClient } from '@/supabase/serviceRole'

export const metadata: Metadata = {
    title: 'Board render',
    robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

type Search = { [key: string]: string | string[] | undefined }

function toSearchParams(search: Search): URLSearchParams {
    const params = new URLSearchParams()
    for (const [key, raw] of Object.entries(search)) {
        const value = Array.isArray(raw) ? raw[0] : raw
        if (value !== undefined) params.set(key, value)
    }
    return params
}

export default async function BoardRenderPage({ searchParams }: { searchParams: Promise<Search> }) {
    const request = readBoardImageRequest(toSearchParams(await searchParams))
    if (!request) notFound()

    const { agents, connectors, highlightedConnectorSlugs } = await stageBoardScene(createServiceRoleClient(), request.scene)

    return (
        <main className="overflow-hidden" style={{ width: request.width, height: request.height, background: CARD_BACKGROUND[request.theme] }}>
            <style>{'nextjs-portal{display:none}'}</style>
            <TemplateCardStage
                agents={agents}
                connectors={connectors}
                highlightedConnectorSlugs={highlightedConnectorSlugs}
                maxZoom={boardImageMaxZoom(request)}
                theme={request.theme}
                width={request.width}
                height={request.height}
                rounded={false}
            />
            <OgReadyMarker />
        </main>
    )
}
