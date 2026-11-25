'use server'

import type { Database } from '@/app/api/database.types'
import { requireWorkspaceContext } from '@/app/api/_auth/ownership'
import { selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'
import { isManagedWorkspace } from '@/lib/workspace/managed'

// Le menu rouvre les dernières annonces, pas l'historique : le reste se lit sur la page publique.
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

// Newest first: the popup only shows what is unread, the menu reopens the latest ones, and one read
// serves both.
export async function listChangelogAction(): Promise<ChangelogFeed> {
    const { supabase, userId, workspace } = await requireWorkspaceContext()
    if (isManagedWorkspace(workspace)) return EMPTY

    // La vraie porte est ici. `requireWorkspaceContext` rend un client service role, donc la RLS ne
    // filtre rien : un compte pas encore inscrit ou pas encore sorti de l'onboarding n'a rien à
    // lire, et une entrée non publiée ne doit pas fuiter.
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
                      // La bannière porte une accroche, et la popup écrit déjà le titre à côté. Les
                      // deux formats ne se mélangent pas : un visuel popup sans version sombre sert
                      // dans les deux thèmes, il ne retombe pas sur la bannière sombre.
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

// Le curseur ne recule jamais : deux onglets, ou une action qui revient en retard, ne doivent pas
// rouvrir ce qui a déjà été lu.
export async function markChangelogSeenAction(seenAt: string): Promise<void> {
    const { supabase, userId } = await requireWorkspaceContext()
    const { data: me } = await selectMaybeSingle(supabase, 'users', ['changelog_seen_at'] as const, { id: userId })
    if (!me) return
    if (Date.parse(seenAt) <= Date.parse(me.changelog_seen_at)) return

    await supabase.from('users').update<Database['public']['Tables']['users']['Update']>({ changelog_seen_at: seenAt }).eq('id', userId)
}
