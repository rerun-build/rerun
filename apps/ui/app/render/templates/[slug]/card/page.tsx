import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { OgReadyMarker } from '@/components/og/OgReadyMarker'
import { TemplateCardStage } from '@/components/templates/TemplateCardStage'
import { CARD_BACKGROUND, CARD_HEIGHT, CARD_MAX_ZOOM, CARD_THEME, CARD_THEMES, CARD_WIDTH, type CardTheme } from '@/lib/og/size'
import { agentsFromRow, connectorsFromRow } from '@/lib/templates/document'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'

export const metadata: Metadata = {
    title: 'Template card render',
    robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

const RENDER_COLUMNS = ['agents', 'connectors'] as const

type Search = { [key: string]: string | string[] | undefined }

const first = (raw: string | string[] | undefined) => (Array.isArray(raw) ? raw[0] : raw)

function readMaxZoom(raw: string | string[] | undefined): number {
    const value = Number(first(raw))
    if (!Number.isFinite(value) || value < 0.3 || value > 8) return CARD_MAX_ZOOM
    return value
}

function readTheme(raw: string | string[] | undefined): CardTheme {
    const value = first(raw)
    return CARD_THEMES.find(theme => theme === value) ?? CARD_THEME
}

export default async function TemplateCardRenderPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Search> }) {
    const [{ slug }, search] = await Promise.all([params, searchParams])

    const supabase = createServiceRoleClient()
    const { data } = await selectMaybeSingle(supabase, 'templates', RENDER_COLUMNS, { slug })
    if (!data) notFound()

    const agents = agentsFromRow.parse(data.agents)
    if (agents.length === 0) notFound()

    const theme = readTheme(search.theme)

    return (
        <main className="overflow-hidden" style={{ width: CARD_WIDTH, height: CARD_HEIGHT, background: CARD_BACKGROUND[theme] }}>
            <style>{'nextjs-portal{display:none}'}</style>
            <TemplateCardStage
                agents={agents}
                connectors={connectorsFromRow.parse(data.connectors)}
                maxZoom={readMaxZoom(search.zoom)}
                theme={theme}
                rounded={false}
            />
            <OgReadyMarker />
        </main>
    )
}
