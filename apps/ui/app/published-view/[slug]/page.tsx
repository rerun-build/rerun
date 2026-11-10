import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { CsvViewer } from '@/components/published/viewers/CsvViewer'
import { DownloadCard } from '@/components/published/viewers/DownloadCard'
import { ImageViewer } from '@/components/published/viewers/ImageViewer'
import { MarkdownSlides } from '@/components/published/viewers/MarkdownSlides'
import { MarkdownViewer } from '@/components/published/viewers/MarkdownViewer'
import { MediaViewer } from '@/components/published/viewers/MediaViewer'
import { PdfViewer } from '@/components/published/viewers/PdfViewer'
import { loadPublished, loadWorkspaceBrand, mayOpen, opensInViewer, previewImageUrl, readAccessCookie, type PublishedEntry } from '@/lib/published/gate'
import { extractPublishedSlug, publishedSiteOrigin } from '@/lib/published/host'
import { fileNameOf, isMarkdownDeck, viewerKindOf } from '@/lib/published/viewer-kind'
import { PUBLISHED_BUCKET } from '@/lib/services/publish'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import { getTranslations } from 'next-intl/server'

// The root of a published host when the link is a single file a browser would only download or
// show raw: a reader for it instead. Reached through the rewrite in proxy.ts, which already let the
// visitor through; the host and the access are checked again here all the same.
export const dynamic = 'force-dynamic'

const MAX_TEXT_BYTES = 2 * 1024 * 1024

type Props = { params: Promise<{ slug: string }> }

const openableEntry = cache(async (slug: string): Promise<PublishedEntry | null> => {
    const requestHeaders = await headers()
    if (extractPublishedSlug(requestHeaders.get('host')) !== slug) return null
    const entry = await loadPublished(slug)
    if (!entry || !opensInViewer(entry)) return null
    const secure = requestHeaders.get('x-forwarded-proto')?.split(',')[0].trim() === 'https'
    return mayOpen(entry, readAccessCookie(requestHeaders.get('cookie'), secure)) ? entry : null
})

async function readText(entry: PublishedEntry): Promise<{ text: string; truncated: boolean } | null> {
    const { data } = await createServiceRoleClient().storage.from(PUBLISHED_BUCKET).download(entry.storage_key)
    if (!data) return null
    return { text: await data.slice(0, MAX_TEXT_BYTES).text(), truncated: data.size > MAX_TEXT_BYTES }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { slug } = await params
    const entry = await openableEntry(slug)
    const origin = publishedSiteOrigin(slug)
    if (!entry || !origin) return { robots: { index: false, follow: false } }

    const [brand, { data: agent }, t] = await Promise.all([loadWorkspaceBrand(entry.workspace_id), selectMaybeSingle(createServiceRoleClient(), 'agents', ['name'] as const, { id: entry.agent_id }), getTranslations('publicPages.publishedView')])
    const isPublic = entry.access === 'public'
    const title = isPublic ? (entry.title ?? fileNameOf(entry.source_path)) : t('protectedTitle')
    const description = isPublic ? (agent?.name ? t('publishedBy', { agent: agent.name, workspace: brand.name }) : t('publishedByUnknown', { workspace: brand.name })) : t('protectedDescription', { workspace: brand.name })
    const image = previewImageUrl(entry, origin)

    return {
        metadataBase: new URL(origin),
        title: { absolute: title },
        description,
        robots: { index: false, follow: false },
        openGraph: { type: 'website', siteName: 'Rerun', title, description, url: origin, images: [{ url: image, width: 1200, height: 630 }] },
        twitter: { card: 'summary_large_image', title, description, images: [image] },
    }
}

export default async function PublishedViewPage({ params }: Props) {
    const { slug } = await params
    const entry = await openableEntry(slug)
    if (!entry) notFound()

    const name = fileNameOf(entry.source_path)
    const kind = viewerKindOf(entry.content_type, entry.source_path)

    if (kind === 'markdown' || kind === 'csv') {
        const content = await readText(entry)
        if (!content) return <DownloadCard slug={slug} name={name} size={entry.size} />
        if (kind === 'csv') return <CsvViewer slug={slug} name={name} text={content.text} textTruncated={content.truncated} />
        if (isMarkdownDeck(entry.source_path, content.text)) return <MarkdownSlides slug={slug} name={entry.title ?? name} markdown={content.text} />
        return <MarkdownViewer slug={slug} name={name} markdown={content.text} updatedAt={entry.updated_at} />
    }
    if (kind === 'pdf') return <PdfViewer slug={slug} name={name} size={entry.size} />
    if (kind === 'image') return <ImageViewer slug={slug} name={name} />
    if (kind === 'video' || kind === 'audio') return <MediaViewer slug={slug} name={name} size={entry.size} kind={kind} />
    return <DownloadCard slug={slug} name={name} size={entry.size} />
}
