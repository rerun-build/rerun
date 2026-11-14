import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from './database.types'

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
    const path = `${prefix}/${expertId}/${folder}/${crypto.randomUUID()}.${extension}`
    const { error } = await supabase.storage
        .from(EXPERT_PHOTOS_BUCKET)
        .upload(path, new Uint8Array(await file.arrayBuffer()), { contentType: file.type, upsert: true })
    if (error) throw new Error(error.message)

    return { ok: true, url: supabase.storage.from(EXPERT_PHOTOS_BUCKET).getPublicUrl(path).data.publicUrl }
}

export async function listExpertBannerUrls(supabase: SupabaseClient<Database>): Promise<string[]> {
    const { data, error } = await supabase.storage.from(EXPERT_BANNERS_BUCKET).list('', { limit: 1000 })
    if (error || !data) return []
    return data
        .filter(f => f.name.endsWith('.webp'))
        .sort((a, b) => scrambleSeed(a.name) - scrambleSeed(b.name))
        .map(f => supabase.storage.from(EXPERT_BANNERS_BUCKET).getPublicUrl(f.name).data.publicUrl)
}

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
