import 'server-only'
import type { Database } from '@/app/api/database.types'
import { capturePage } from '@/lib/og/shot'
import { mintAccessTicket } from '@/lib/published/access-ticket'
import { loadPublished } from '@/lib/published/gate'
import { publishedSiteOrigin } from '@/lib/published/host'
import { PUBLISHED_BUCKET, thumbnailKeyFor } from '@/lib/services/publish'
import { createServiceRoleClient } from '@/supabase/serviceRole'

const THUMB_WIDTH = 1280
const THUMB_HEIGHT = 800
const THUMB_SCALE = 0.5

// No capture for what has nothing to look at: the grid shows the file's icon instead.
function isCapturable(contentType: string): boolean {
    return !contentType.startsWith('video/') && !contentType.startsWith('audio/') && !contentType.startsWith('application/zip') && contentType !== 'application/octet-stream'
}

async function imageThumbnail(storageKey: string): Promise<Buffer | null> {
    const { data } = await createServiceRoleClient().storage.from(PUBLISHED_BUCKET).download(storageKey)
    if (!data) return null
    const { default: sharp } = await import('sharp')
    return sharp(Buffer.from(await data.arrayBuffer()))
        .resize(THUMB_WIDTH * THUMB_SCALE, THUMB_HEIGHT * THUMB_SCALE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer()
}

// The capture service opens the link like a member would: a one-minute ticket for this access
// version, redeemed on the page's own host, then the page itself.
async function pageThumbnail(slug: string, accessVersion: number, requestUrl: string): Promise<Buffer | null> {
    const origin = publishedSiteOrigin(slug)
    if (!origin) return null
    const ticket = mintAccessTicket({ slug, v: accessVersion, grant: 'shot', sub: 'shot' })
    const capture = await capturePage(`${origin}/__rerun/auth?ticket=${encodeURIComponent(ticket)}&next=%2F`, {
        requestUrl,
        width: THUMB_WIDTH,
        height: THUMB_HEIGHT,
        scale: THUMB_SCALE,
        format: 'png',
        fresh: true,
        waitFor: null,
        dark: false,
    })
    return capture.body
}

// Best effort, after the publish answered: a link without a thumbnail shows its icon.
export async function captureThumbnail(slug: string, requestUrl: string): Promise<void> {
    try {
        const entry = await loadPublished(slug)
        if (!entry || !isCapturable(entry.content_type)) return

        const isImage = entry.kind === 'file' && entry.content_type.startsWith('image/')
        const body = isImage ? await imageThumbnail(entry.storage_key) : await pageThumbnail(slug, entry.access_version, requestUrl)
        if (!body || body.byteLength === 0) return

        const supabase = createServiceRoleClient()
        const key = thumbnailKeyFor(entry.workspace_id, slug, Date.now())
        const { error } = await supabase.storage.from(PUBLISHED_BUCKET).upload(key, body, { contentType: 'image/png', upsert: true })
        if (error) throw new Error(error.message)

        await supabase.from('published_files').update<Database['public']['Tables']['published_files']['Update']>({ thumbnail_key: key }).eq('id', entry.id)
        if (entry.thumbnail_key && entry.thumbnail_key !== key) await supabase.storage.from(PUBLISHED_BUCKET).remove([entry.thumbnail_key])
    } catch (err) {
        console.warn('[published] thumbnail capture failed', slug, err instanceof Error ? err.message : err)
    }
}
