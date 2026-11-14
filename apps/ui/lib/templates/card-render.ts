import type { Database } from '@/app/api/database.types'
import type { SupabaseClient } from '@supabase/supabase-js'

import { uploadPublicImage } from '@/lib/images/upload'
import { CARD_HEIGHT, CARD_SCALE, CARD_THEMES, CARD_WIDTH, type CardTheme } from '@/lib/og/size'
import { capturePage } from '@/lib/og/shot'
import { site } from '@/lib/site'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'

import { agentsFromRow } from './document'
import { TEMPLATE_MEDIA_BUCKET } from './images'

const CARD_FOLDER = 'cards'

const CARD_MAX_SIZE = CARD_WIDTH * CARD_SCALE

const CARD_COLUMNS = ['id', 'agents', 'card_image_dark_url', 'card_image_light_url'] as const

export type TemplateCardUrls = { dark: string | null; light: string | null }

export type TemplateCardRender = { urls: TemplateCardUrls; changed: boolean }

type TemplateCardRow = Pick<Database['public']['Tables']['templates']['Row'], (typeof CARD_COLUMNS)[number]>

const PUBLIC_PREFIX = `/object/public/${TEMPLATE_MEDIA_BUCKET}/${CARD_FOLDER}/`

function cardStoragePath(url: string | null): string | null {
    if (!url) return null
    const at = url.indexOf(PUBLIC_PREFIX)
    if (at === -1) return null
    return `${CARD_FOLDER}/${decodeURIComponent(url.slice(at + PUBLIC_PREFIX.length).split('?')[0])}`
}

export async function removeCards(supabase: SupabaseClient<Database>, urls: (string | null)[]): Promise<void> {
    const paths = urls.map(cardStoragePath).filter((path): path is string => path !== null)
    if (paths.length === 0) return
    await supabase.storage.from(TEMPLATE_MEDIA_BUCKET).remove(paths)
}

function appOrigin(): string {
    return process.env.NEXT_PUBLIC_APP_URL ?? site.url
}

async function captureTheme(supabase: SupabaseClient<Database>, slug: string, theme: CardTheme): Promise<string> {
    const capture = await capturePage(`/render/templates/${encodeURIComponent(slug)}/card?theme=${theme}`, {
        requestUrl: appOrigin(),
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        scale: CARD_SCALE,
        format: 'png',
        fresh: true,
    })

    return uploadPublicImage(supabase, capture.body, TEMPLATE_MEDIA_BUCKET, CARD_FOLDER, { maxSize: CARD_MAX_SIZE })
}

async function writeCards(supabase: SupabaseClient<Database>, row: TemplateCardRow, dark: string | null, light: string | null): Promise<void> {
    const { error } = await supabase
        .from('templates')
        .update<Database['public']['Tables']['templates']['Update']>({ card_image_dark_url: dark, card_image_light_url: light })
        .eq('id', row.id)
    if (error) throw new Error(error.message)
}

export async function captureTemplateCard(slug: string): Promise<TemplateCardRender> {
    const supabase = createServiceRoleClient()

    const { data: row, error } = await selectMaybeSingle(supabase, 'templates', CARD_COLUMNS, { slug })
    if (error) throw new Error(error.message)
    if (!row) throw new Error(`No template found with slug "${slug}"`)

    const current: TemplateCardUrls = { dark: row.card_image_dark_url, light: row.card_image_light_url }

    if (agentsFromRow.parse(row.agents).length === 0) {
        if (!current.dark && !current.light) return { urls: current, changed: false }
        await writeCards(supabase, row, null, null)
        return { urls: { dark: null, light: null }, changed: true }
    }

    const uploaded: Partial<Record<CardTheme, string>> = {}
    try {
        for (const theme of CARD_THEMES) uploaded[theme] = await captureTheme(supabase, slug, theme)
    } catch (failure) {
        await removeCards(supabase, Object.values(uploaded)).catch(() => {})
        throw failure
    }

    const urls: TemplateCardUrls = { dark: uploaded.dark ?? null, light: uploaded.light ?? null }
    await writeCards(supabase, row, urls.dark, urls.light)
    return { urls, changed: true }
}

export async function renderTemplateCard(slug: string): Promise<boolean> {
    try {
        const { changed } = await captureTemplateCard(slug)
        return changed
    } catch (error) {
        console.error(`[templates] card render failed for ${slug}`, error)
        return false
    }
}
