import type { Database } from '@/app/api/database.types'
import type { SupabaseClient } from '@supabase/supabase-js'
import { randomUuid } from '@rerun/db/helpers'
import { uploadPublicImage } from '@/lib/images/upload'

export const CHANGELOG_BUCKET = 'changelog-images'

const FOLDER = 'entries'
const MAX_WIDTH = 1600
const IMMUTABLE_CACHE_CONTROL = '31536000'

// Au-delà, la popup passe plusieurs secondes sur un cadre vide. Un enregistrement plus court tient
// de toute façon mieux l'attention qu'un long.
const MAX_ANIMATED_BYTES = 2_000_000

// Une entrée montre soit une capture, soit un enregistrement d'écran, soit une image générée. Le
// chemin partagé `uploadPublicImage` ne passe pas `{ animated: true }` à sharp et ne garderait donc
// que la première frame d'un GIF, sans rien signaler. D'où ce tri en amont.
export async function uploadChangelogMedia(supabase: SupabaseClient<Database>, bytes: ArrayBuffer | Uint8Array): Promise<string> {
    const buffer = Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
    const { default: sharp } = await import('sharp')

    const { pages } = await sharp(buffer).metadata()
    if ((pages ?? 1) <= 1) return uploadPublicImage(supabase, buffer, CHANGELOG_BUCKET, FOLDER, { maxSize: MAX_WIDTH, sharpen: true })

    await supabase.storage.createBucket(CHANGELOG_BUCKET, { public: true }).catch(() => {})

    // Pas de `.rotate()` sur une animation : il n'y a pas d'EXIF sur un GIF, et libvips traite les
    // pages comme une seule bande verticale qu'une rotation mettrait en travers.
    const animated = await sharp(buffer, { animated: true })
        .resize(MAX_WIDTH, null, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 75, effort: 4 })
        .toBuffer()
    if (animated.byteLength > MAX_ANIMATED_BYTES) {
        throw new Error(`Animation too heavy (${Math.round(animated.byteLength / 1000)} kB). Shorten the recording or lower its frame rate.`)
    }

    const path = `${FOLDER}/${randomUuid()}.webp`
    const { error } = await supabase.storage
        .from(CHANGELOG_BUCKET)
        .upload(path, new Uint8Array(animated), { contentType: 'image/webp', cacheControl: IMMUTABLE_CACHE_CONTROL, upsert: true })
    if (error) throw new Error(error.message)

    return supabase.storage.from(CHANGELOG_BUCKET).getPublicUrl(path).data.publicUrl
}

export function shouldMirror(url: string): boolean {
    if (!/^https?:\/\//i.test(url)) return false
    try {
        const { pathname } = new URL(url)
        return !pathname.includes(`/${CHANGELOG_BUCKET}/`)
    } catch {
        return false
    }
}

// Le skill peut donner une URL déjà en ligne plutôt qu'un fichier. On la rapatrie pour que l'entrée
// ne dépende pas d'un hébergeur qu'on ne contrôle pas.
export async function normalizeChangelogImage(supabase: SupabaseClient<Database>, imageUrl: string): Promise<string> {
    if (!imageUrl || !shouldMirror(imageUrl)) return imageUrl
    try {
        const res = await fetch(imageUrl)
        if (!res.ok) return imageUrl
        return await uploadChangelogMedia(supabase, await res.arrayBuffer())
    } catch {
        return imageUrl
    }
}
