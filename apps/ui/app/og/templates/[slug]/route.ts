import { captureOgCard, OG_VERSION, ogFallbackResponse, readOgRequest } from '@/lib/og/capture'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'

export const runtime = 'nodejs'

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params
    const { format, fresh } = readOgRequest(req)

    const supabase = createServiceRoleClient()
    const { data } = await selectMaybeSingle(supabase, 'templates', ['updated_at'] as const, { slug })
    if (!data) return ogFallbackResponse(req)

    const version = `${OG_VERSION}.${data.updated_at ?? ''}`

    return captureOgCard({
        req,
        renderPath: `/render/templates/${encodeURIComponent(slug)}?v=${encodeURIComponent(version)}`,
        cacheKey: `templates:${slug}:${version}:${format}`,
        format,
        fresh,
        label: `templates/${slug}`,
    })
}
