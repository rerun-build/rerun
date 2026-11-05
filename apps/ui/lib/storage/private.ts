import type { Database } from '@/app/api/database.types'
import type { SupabaseClient } from '@supabase/supabase-js'

// The public counterpart of this helper is lib/images/upload.ts. Here the bucket is created
// private and no public URL is ever handed back: reaching an object takes the service-role
// client or a signed URL, so the stored path is not itself a capability.
export async function uploadPrivateFile(supabase: SupabaseClient<Database>, bucket: string, path: string, body: Blob | ArrayBuffer | Uint8Array, contentType: string): Promise<string> {
    await supabase.storage.createBucket(bucket, { public: false }).catch(() => {})

    const { error } = await supabase.storage.from(bucket).upload(path, body, { contentType, upsert: true })
    if (error) throw new Error(error.message)

    return path
}

export const STORAGE_BUSY_ERROR = 'Rerun is very busy right now and could not fetch this file. Try again in a minute.'

// Storage answers 429 SlowDown ("Too many connections issued to the database") while the project's
// Postgres pooler is full, and those bursts last a few seconds: on the launch night it cost two
// coworkers out of three of a starter team. A download is a read, so it is safe to play again.
const DOWNLOAD_RETRY_DELAYS_MS = [400, 1200, 3000]

const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504])

function isTransientStorageError(error: { name?: string; status?: number }): boolean {
    if (error.status !== undefined) return TRANSIENT_STATUSES.has(error.status)
    return error.name === 'StorageUnknownError'
}

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export async function downloadPrivateFile(supabase: SupabaseClient<Database>, bucket: string, path: string): Promise<Blob> {
    for (let attempt = 0; ; attempt += 1) {
        const { data, error } = await supabase.storage.from(bucket).download(path)
        if (!error) return data
        if (!isTransientStorageError(error)) throw new Error(error.message)
        if (attempt === DOWNLOAD_RETRY_DELAYS_MS.length) {
            console.warn('[storage] download gave up after retries', bucket, path, error.status, error.message)
            throw new Error(STORAGE_BUSY_ERROR, { cause: error })
        }
        await pause(DOWNLOAD_RETRY_DELAYS_MS[attempt] * (1 + Math.random() * 0.25))
    }
}

export async function removePrivateFiles(supabase: SupabaseClient<Database>, bucket: string, paths: string[]): Promise<void> {
    if (paths.length === 0) return
    const { error } = await supabase.storage.from(bucket).remove(paths)
    if (error) throw new Error(error.message)
}
