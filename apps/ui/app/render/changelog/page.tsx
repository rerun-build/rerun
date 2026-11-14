import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { ChangelogOgStage } from '@/components/og/ChangelogOgStage'
import { OgReadyMarker } from '@/components/og/OgReadyMarker'
import { getLatestChangelogEntries } from '@/lib/changelog/og'
import { OG_HEIGHT, OG_WIDTH } from '@/lib/og/size'

export const metadata: Metadata = {
    title: 'Changelog OG render',
    robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function ChangelogOgRenderPage() {
    const entries = await getLatestChangelogEntries()
    if (entries.length === 0) notFound()

    return (
        <main className="dark overflow-hidden bg-[#0a0a0a]" style={{ width: OG_WIDTH, height: OG_HEIGHT }}>
            <style>{'nextjs-portal{display:none}'}</style>
            <ChangelogOgStage entries={entries} />
            <OgReadyMarker />
        </main>
    )
}
