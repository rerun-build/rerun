import { RERUN_FAVICON } from '@/lib/brand/icons'
import { getBrand } from '@/lib/brand/server'

// What a browser asks for on its own, for a document that names no icon (an image, a JSON answer).
export async function GET() {
    const { iconUrl } = await getBrand()
    return new Response(null, { status: 307, headers: { Location: iconUrl ?? RERUN_FAVICON, 'Cache-Control': 'public, max-age=3600' } })
}
