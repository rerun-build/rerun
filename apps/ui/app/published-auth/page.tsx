import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { GateScreen, RerunTile } from '@/components/published/GateScreen'
import { SwitchAccountButton } from '@/components/published/SwitchAccountButton'
import { Icon } from '@/components/ui/icon'
import { realEmail } from '@/lib/auth/placeholder-email'
import { mintAccessTicket } from '@/lib/published/access-ticket'
import { loadPublished, loadWorkspaceBrand, safeNextPath } from '@/lib/published/gate'
import { publishedSiteOrigin } from '@/lib/published/host'
import { openPublishedHref } from '@/lib/published/links'
import { UsersIcon } from '@/lib/icons'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { createClient } from '@/supabase/server'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import { getTranslations } from 'next-intl/server'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations('publicPages.publishedAuth')
    return { title: t('metaTitle'), robots: { index: false, follow: false } }
}

type Search = Record<string, string | string[] | undefined>

function param(search: Search, key: string): string | undefined {
    const value = search[key]
    return Array.isArray(value) ? value[0] : value
}

// The round trip a member makes to open a page of their workspace: the page's host never sees the
// app's session, so the app proves membership here and hands that host a one-minute ticket.
export default async function PublishedAuthPage({ searchParams }: { searchParams: Promise<Search> }) {
    const search = await searchParams
    const slug = param(search, 'slug')?.trim() ?? ''
    const next = safeNextPath(param(search, 'next'))
    const entry = slug ? await loadPublished(slug) : null
    const t = await getTranslations('publicPages')
    if (!entry) return <GateScreen brand={{ name: 'Rerun', iconUrl: null }} lock={null} mark={<RerunTile />} title={t('linkOff.title')} subtitle={t('linkOff.subtitle')} />

    const returnTo = openPublishedHref(slug, next)
    const { data } = await (await createClient()).auth.getUser()
    const user = data.user
    if (!user || user.is_anonymous) redirect(`/auth?next=${encodeURIComponent(returnTo)}`)

    const { data: membership } = await selectMaybeSingle(createServiceRoleClient(), 'workspace_members', ['user_id'] as const, { user_id: user.id, workspace_id: entry.workspace_id })
    if (membership) {
        const origin = publishedSiteOrigin(slug)
        if (!origin) redirect(`/p/${slug}`)
        const ticket = mintAccessTicket({ slug, v: entry.access_version, grant: 'member', sub: user.id })
        redirect(`${origin}/__rerun/auth?ticket=${encodeURIComponent(ticket)}&next=${encodeURIComponent(next)}`)
    }

    const brand = await loadWorkspaceBrand(entry.workspace_id)
    const email = realEmail(user.email)
    return (
        <GateScreen
            brand={brand}
            lock={<Icon icon={UsersIcon} size="lg" />}
            title={t('publishedAuth.noAccess')}
            subtitle={email ? t('publishedAuth.signedInAs', { email, workspace: brand.name }) : t('publishedAuth.signedInAsOther', { workspace: brand.name })}
        >
            <SwitchAccountButton returnTo={returnTo} />
        </GateScreen>
    )
}
