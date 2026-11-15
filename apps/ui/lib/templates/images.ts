import type { Database } from '@/app/api/database.types'
import type { SupabaseClient } from '@supabase/supabase-js'
import { type PublicImageOptions, uploadPublicImage } from '@/lib/images/upload'
import { fetchPublic } from '@/lib/net/public-fetch'

export const TEMPLATE_MEDIA_BUCKET = 'template-media'

export type TemplateImageFolder = 'gallery' | 'og'

const TEMPLATE_IMAGE_OPTIONS: PublicImageOptions = { maxSize: 1200 }

export async function uploadTemplateImageBytes(
    supabase: SupabaseClient<Database>,
    bytes: ArrayBuffer | Uint8Array,
    folder: TemplateImageFolder,
    options?: PublicImageOptions,
): Promise<string> {
    return uploadPublicImage(supabase, bytes, TEMPLATE_MEDIA_BUCKET, folder, { ...TEMPLATE_IMAGE_OPTIONS, ...options })
}

const MAX_REMOTE_IMAGE_BYTES = 8 * 1024 * 1024
const REMOTE_IMAGE_TIMEOUT_MS = 30_000

export async function storeTemplateImageFromUrl(
    supabase: SupabaseClient<Database>,
    imageUrl: string,
    folder: TemplateImageFolder = 'gallery',
    options?: PublicImageOptions,
): Promise<string> {
    let url: URL
    try {
        url = new URL(imageUrl)
    } catch {
        throw new Error('imageUrl must be a full URL.')
    }
    if (url.protocol !== 'https:') throw new Error('imageUrl must be https.')

    const res = await fetchPublic(url.toString(), {}, { timeoutMs: REMOTE_IMAGE_TIMEOUT_MS })
    if (!res.ok) throw new Error(`Could not download the image: ${res.status}`)

    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.startsWith('image/')) throw new Error(`That URL answered "${contentType || 'no content type'}", not an image.`)

    const bytes = await res.arrayBuffer()
    if (bytes.byteLength > MAX_REMOTE_IMAGE_BYTES) throw new Error('The image is over 8MB.')

    return uploadTemplateImageBytes(supabase, bytes, folder, options)
}
