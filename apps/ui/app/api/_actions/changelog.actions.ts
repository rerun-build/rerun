'use server'

import type { Database } from '@/app/api/database.types'
import { requireWorkspaceContext } from '@/app/api/_auth/ownership'
import { selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'

const MAX_ENTRIES = 10

export type ChangelogEntryView = {
    id: string
    slug: string
    title: string
    bodyMd: string
    imageUrl: string | null
    imageDarkUrl: string | null
    imageAlt: string | null
    imageFill: boolean
    publishedAt: string
    unread: boolean
}

export type ChangelogFeed = { entries: ChangelogEntryView[]; seenAt: string | null }

const EMPTY: ChangelogFeed = { entries: [], seenAt: null }

export async function listChangelogAction(): Promise<ChangelogFeed> {
    const { supabase, userId, workspace } = await requireWorkspaceContext()

    const { data: me } = await selectMaybeSingle(supabase, 'users', ['signed_up_at', 'changelog_seen_at'] as const, { id: userId })
    if (!me?.signed_up_at || !workspace.onboarded_at) return EMPTY

    const { data } = await selectMany(
        supabase,
        'changelog_entries',
        ['id', 'slug', 'title', 'body_md', 'image_url', 'image_dark_url', 'dialog_image_url', 'dialog_image_dark_url', 'image_alt', 'published_at'] as const,
        { published_at: { lte: new Date().toISOString() } },
        { column: 'published_at', ascending: false },
        MAX_ENTRIES,
    )
    if (!data?.length) return { entries: [], seenAt: me.changelog_seen_at }

    const seen = Date.parse(me.changelog_seen_at)
    const entries = data.flatMap<ChangelogEntryView>(entry =>
        entry.published_at
            ? [
                  {
                      id: entry.id,
                      slug: entry.slug,
                      title: entry.title,
                      bodyMd: entry.body_md,
                      imageUrl: entry.dialog_image_url ?? entry.image_url,
                      imageDarkUrl: entry.dialog_image_url ? entry.dialog_image_dark_url : entry.image_dark_url,
                      imageAlt: entry.image_alt,
                      imageFill: entry.dialog_image_url !== null,
                      publishedAt: entry.published_at,
                      unread: Date.parse(entry.published_at) > seen,
                  },
              ]
            : [],
    )
    return { entries, seenAt: me.changelog_seen_at }
}

export async function markChangelogSeenAction(seenAt: string): Promise<void> {
    const { supabase, userId } = await requireWorkspaceContext()
    const { data: me } = await selectMaybeSingle(supabase, 'users', ['changelog_seen_at'] as const, { id: userId })
    if (!me) return
    if (Date.parse(seenAt) <= Date.parse(me.changelog_seen_at)) return

    await supabase.from('users').update<Database['public']['Tables']['users']['Update']>({ changelog_seen_at: seenAt }).eq('id', userId)
}
