import { createHash } from 'node:crypto'

import { readBoardImageRequest } from '@/lib/og/board-image'
import { captureOgCard, OG_VERSION, readOgRequest } from '@/lib/og/capture'
import { CARD_SCALE } from '@/lib/og/size'

export const runtime = 'nodejs'

export async function GET(req: Request) {
    const request = readBoardImageRequest(new URL(req.url).searchParams)
    if (!request) return new Response('Invalid or unsigned board image URL', { status: 403 })

    const { fresh } = readOgRequest(req)
    const digest = createHash('sha256').update(request.query).digest('base64url')

    return captureOgCard({
        req,
        renderPath: `/render/board?${request.query}&v=${OG_VERSION}`,
        cacheKey: `board:${digest}:${OG_VERSION}`,
        format: request.format,
        fresh,
        label: 'board',
        size: { width: request.width, height: request.height, scale: CARD_SCALE },
    })
}
