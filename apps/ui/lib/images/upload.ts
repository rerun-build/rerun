import type { Database } from '@/app/api/database.types'
import type { SupabaseClient } from '@supabase/supabase-js'
import { randomUuid } from '@rerun/db/helpers'

// Paths are random UUIDs, so an object is never overwritten and can be cached forever.
const IMMUTABLE_CACHE_CONTROL = '31536000'

const DEFAULT_MAX_SIZE = 1600

export type PublicImageOptions = {
    maxSize?: number
    // Downscaling from a much larger source softens the edges; a light pass gets the bite back.
    sharpen?: boolean
}

// Shared image ingest for every admin surface that accepts an upload: normalise the
// orientation, cap the dimensions and store one webp in a public bucket. Callers only
// choose the bucket and the folder inside it.
export async function uploadPublicImage(
    supabase: SupabaseClient<Database>,
    bytes: ArrayBuffer | Uint8Array,
    bucket: string,
    folder: string,
    { maxSize = DEFAULT_MAX_SIZE, sharpen = false }: PublicImageOptions = {},
): Promise<string> {
    await supabase.storage.createBucket(bucket, { public: true }).catch(() => {})

    const { default: sharp } = await import('sharp')
    const pipeline = sharp(Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)))
        .rotate()
        .resize(maxSize, maxSize, { fit: 'inside', withoutEnlargement: true })
    const webp = await (sharpen ? pipeline.sharpen({ sigma: 0.6 }) : pipeline).webp({ quality: 82, effort: 6 }).toBuffer()

    const path = `${folder}/${randomUuid()}.webp`
    const { error } = await supabase.storage
        .from(bucket)
        .upload(path, new Uint8Array(webp), { contentType: 'image/webp', cacheControl: IMMUTABLE_CACHE_CONTROL, upsert: true })
    if (error) throw new Error(error.message)

    return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl
}
