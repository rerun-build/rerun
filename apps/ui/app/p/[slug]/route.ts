import { publishedSiteOrigin } from '@/lib/published/host'
import { PUBLISHED_BUCKET } from '@/lib/services/publish'
import { loadPublished } from '@/lib/published/gate'
import { createClient } from '@/supabase/server'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'

export const dynamic = 'force-dynamic'

const SIGNED_URL_TTL_SECONDS = 60

async function isMember(workspaceId: number): Promise<boolean> {
    const { data } = await (await createClient()).auth.getUser()
    if (!data.user || data.user.is_anonymous) return false
    const { data: membership } = await selectMaybeSingle(createServiceRoleClient(), 'workspace_members', ['user_id'] as const, { user_id: data.user.id, workspace_id: workspaceId })
    return !!membership
}

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
    const { slug } = await params
    const entry = await loadPublished(slug)
    if (!entry) return new Response('Not found', { status: 404 })

    const origin = publishedSiteOrigin(slug)
    if (origin) return Response.redirect(`${origin}/`, 302)

    if (entry.kind === 'site') return new Response('Not found', { status: 404 })
    if (entry.access !== 'public' && !(await isMember(entry.workspace_id))) return new Response('Not found', { status: 404 })

    const { data } = await createServiceRoleClient().storage.from(PUBLISHED_BUCKET).createSignedUrl(entry.storage_key, SIGNED_URL_TTL_SECONDS)
    return data?.signedUrl ? Response.redirect(data.signedUrl, 302) : new Response('Not found', { status: 404 })
}
