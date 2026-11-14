import type { Database } from '@/app/api/database.types'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { revalidateLanding } from '@/lib/landing-revalidate'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import { normalizeChangelogImage } from './images'

export const CHANGELOG_PATH = '/changelog'

export type ChangelogEntryInput = {
    slug: string
    title: string
    body_md: string
    image_url: string
    image_dark_url: string
    dialog_image_url: string
    dialog_image_dark_url: string
    image_alt: string
    publish: boolean
    published_at?: string
}

export const changelogEntrySchema = z
    .object({
        slug: z
            .string()
            .trim()
            .min(1)
            .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be kebab-case'),
        title: z.string().trim().min(1).max(80),
        body_md: z.string().trim().min(1),
        image_url: z.string().default(''),
        image_dark_url: z.string().default(''),
        dialog_image_url: z.string().default(''),
        dialog_image_dark_url: z.string().default(''),
        image_alt: z.string().default(''),
        publish: z.boolean().default(false),
        published_at: z.iso.datetime({ offset: true }).optional(),
    })
    .strict()
    .refine(entry => !entry.published_at || entry.publish, { path: ['published_at'], message: 'published_at needs publish: true' })
    .refine(entry => !entry.published_at || Date.parse(entry.published_at) <= Date.now(), { path: ['published_at'], message: 'published_at cannot be in the future' })

export type WriteResult = { ok: true; slug: string; entry: unknown } | { ok: false; status: number; error: string }

export function toRow(input: ChangelogEntryInput): Database['public']['Tables']['changelog_entries']['Insert'] {
    return {
        slug: input.slug.trim(),
        title: input.title.trim(),
        body_md: input.body_md.trim(),
        image_url: input.image_url.trim() || null,
        image_dark_url: input.image_dark_url.trim() || null,
        dialog_image_url: input.dialog_image_url.trim() || null,
        dialog_image_dark_url: input.dialog_image_dark_url.trim() || null,
        image_alt: input.image_alt.trim() || null,
    }
}

export function publishedAtFor(publish: boolean, existing: string | null, backdated?: string): string | null {
    if (!publish) return null
    if (backdated) return new Date(backdated).toISOString()
    return existing ?? new Date().toISOString()
}

const IMAGE_COLUMNS = ['image_url', 'image_dark_url', 'dialog_image_url', 'dialog_image_dark_url'] as const

export async function normalizeRowImages(supabase: SupabaseClient<Database>, row: Database['public']['Tables']['changelog_entries']['Insert']) {
    for (const column of IMAGE_COLUMNS) {
        const url = row[column]
        row[column] = url ? await normalizeChangelogImage(supabase, url) : null
    }
}

export async function pingChangelogRevalidate() {
    await revalidateLanding([CHANGELOG_PATH])
}

export async function upsertChangelogEntry(
    supabase: SupabaseClient<Database>,
    input: ChangelogEntryInput,
    { draftsOnly = false }: { draftsOnly?: boolean } = {},
): Promise<WriteResult> {
    const row = toRow(input)

    const { data: existing, error: readError } = await selectMaybeSingle(supabase, 'changelog_entries', ['id', 'published_at'] as const, { slug: row.slug })
    if (readError) return { ok: false, status: 500, error: readError.message }
    if (draftsOnly && existing?.published_at) return { ok: false, status: 409, error: 'This entry is already published, only an admin can change it' }

    await normalizeRowImages(supabase, row)

    const published_at = publishedAtFor(input.publish, existing?.published_at ?? null, input.published_at)
    const { data, error } = await supabase
        .from('changelog_entries')
        .upsert<Database['public']['Tables']['changelog_entries']['Insert']>({ ...row, published_at, updated_at: new Date().toISOString() }, { onConflict: 'slug' })
        .select()
        .single()
    if (error) return { ok: false, status: 500, error: error.message }

    await pingChangelogRevalidate()
    return { ok: true, slug: row.slug, entry: data }
}
