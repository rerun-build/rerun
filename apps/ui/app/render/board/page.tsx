import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { AlertBoardStage } from '@/components/og/AlertBoardStage'
import { OgReadyMarker } from '@/components/og/OgReadyMarker'
import { TemplateCardStage } from '@/components/templates/TemplateCardStage'
import { isAlertBoard, readBoardImageRequest, type BoardImageRequest } from '@/lib/og/board-image'
import { alertAppIcon, boardImageMaxZoom, stageBoardScene } from '@/lib/og/board-scene'
import { CARD_BACKGROUND } from '@/lib/og/size'
import { createServiceRoleClient } from '@/supabase/serviceRole'

// Rendering surface for the screenshot service: the board the query describes, at the exact pixel
// size it asks for, and nothing else.
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

async function stageOf(request: BoardImageRequest) {
    const supabase = createServiceRoleClient()
    if (isAlertBoard(request.scene)) return <AlertBoardStage board={request.scene} appIcon={await alertAppIcon(supabase, request.scene)} />

    const { agents, connectors, highlightedConnectorSlugs } = await stageBoardScene(supabase, request.scene)
    return (
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
    )
}

export default async function BoardRenderPage({ searchParams }: { searchParams: Promise<Search> }) {
    // Checked here as well as on the capture route: this page is outside auth, and unsigned it
    // would write any text it is handed on our own domain.
    const request = readBoardImageRequest(toSearchParams(await searchParams))
    if (!request) notFound()

    return (
        <main className="overflow-hidden" style={{ width: request.width, height: request.height, background: CARD_BACKGROUND[request.theme] }}>
            {/* The dev overlay renders in the corner of the viewport, so it lands inside the capture. */}
            <style>{'nextjs-portal{display:none}'}</style>
            {await stageOf(request)}
            <OgReadyMarker />
        </main>
    )
}
