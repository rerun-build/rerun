import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { OgReadyMarker } from '@/components/og/OgReadyMarker'
import { TemplateOgStage } from '@/components/templates/TemplateOgStage'
import { OG_HEIGHT, OG_WIDTH } from '@/lib/og/size'
import { agentsFromRow, connectorsFromRow } from '@/lib/templates/document'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'

export const metadata: Metadata = {
    title: 'Template OG render',
    robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

const RENDER_COLUMNS = ['title', 'tagline', 'agents', 'connectors'] as const

export default async function TemplateOgRenderPage({ params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params

    const supabase = createServiceRoleClient()
    const { data } = await selectMaybeSingle(supabase, 'templates', RENDER_COLUMNS, { slug })
    if (!data) notFound()

    return (
        <main className="dark overflow-hidden bg-[#0a0a0a]" style={{ width: OG_WIDTH, height: OG_HEIGHT }}>
            <style>{'nextjs-portal{display:none}'}</style>
            <TemplateOgStage
                title={data.title}
                tagline={data.tagline ?? ''}
                agents={agentsFromRow.parse(data.agents)}
                connectors={connectorsFromRow.parse(data.connectors)}
                rounded={false}
            />
            <OgReadyMarker />
        </main>
    )
}
