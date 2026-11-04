import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from './database.types'
import { randomUuid } from './helpers'

// The single owner of the experts image storage layout, shared by the three write paths: the admin
// form (`admin/`), the landing claim wizard and the in-app profile dialog (both `claimed/`).
export const EXPERT_PHOTOS_BUCKET = 'expert-photos'
export const EXPERT_BANNERS_BUCKET = 'banner-illustrations'

const MAX_IMAGE_BYTES = 8 * 1024 * 1024

export type ExpertImageFolder = 'photo' | 'banner'
export type ExpertImagePrefix = 'admin' | 'claimed'
export type ExpertImageUploadResult = { ok: true; url: string } | { ok: false; error: string }

export async function uploadExpertImage(
    supabase: SupabaseClient<Database>,
    { expertId, file, folder, prefix }: { expertId: string; file: unknown; folder: ExpertImageFolder; prefix: ExpertImagePrefix },
): Promise<ExpertImageUploadResult> {
    if (!(file instanceof File)) return { ok: false, error: 'No file provided.' }
    if (!file.type.startsWith('image/')) return { ok: false, error: 'Please choose an image file.' }
    if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: 'Image is too large (max 8MB).' }

    await supabase.storage.createBucket(EXPERT_PHOTOS_BUCKET, { public: true }).catch(() => {})

    const extension = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'png'
    const path = `${prefix}/${expertId}/${folder}/${randomUuid()}.${extension}`
    const { error } = await supabase.storage
        .from(EXPERT_PHOTOS_BUCKET)
        .upload(path, new Uint8Array(await file.arrayBuffer()), { contentType: file.type, upsert: true })
    if (error) throw new Error(error.message)

    return { ok: true, url: supabase.storage.from(EXPERT_PHOTOS_BUCKET).getPublicUrl(path).data.publicUrl }
}

// banner_url is NOT NULL on experts, so imported profiles get a randomly assigned illustration.
// Rather than maintaining a duplicated file list, we read the banner-illustrations bucket at
// runtime (same source the admin banners generator writes to).
export async function listExpertBannerUrls(supabase: SupabaseClient<Database>): Promise<string[]> {
    const { data, error } = await supabase.storage.from(EXPERT_BANNERS_BUCKET).list('', { limit: 1000 })
    if (error || !data) return []
    return data
        .filter(f => f.name.endsWith('.webp'))
        .sort((a, b) => scrambleSeed(a.name) - scrambleSeed(b.name))
        .map(f => supabase.storage.from(EXPERT_BANNERS_BUCKET).getPublicUrl(f.name).data.publicUrl)
}

// Storage lists alphabetically and every filename starts with its dominant color, so the raw order
// stacks all the blues, then all the violets. Ordering on a hash of the name breaks those runs up
// while keeping the grid stable from one open to the next.
function scrambleSeed(name: string): number {
    let hash = 0
    for (let i = 0; i < name.length; i++) hash = (Math.imul(hash, 31) + name.charCodeAt(i)) | 0
    return hash
}

export async function randomExpertBannerUrl(supabase: SupabaseClient<Database>): Promise<string | null> {
    const urls = await listExpertBannerUrls(supabase)
    if (urls.length === 0) return null
    return urls[Math.floor(Math.random() * urls.length)]
}
