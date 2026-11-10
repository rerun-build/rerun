import { fal } from '@fal-ai/client'
import { isRecord } from '@rerun/contracts'
import { withBrandIconTone, type BrandIconTone } from '@rerun/ui/brand-icon'
import type { Database } from '@/app/api/database.types'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMany } from '@/supabase/supabase-helpers'
import { analyzeBrandIconTone } from './icon-tone.server'

// Brand-icon pipeline for the service library. Given a service website, produce a clean,
// transparent brand icon and classify whether it needs a white treatment on dark surfaces.
//
// Two sources, in order:
//   1. Simple Icons — ~3300 popular brands as clean, single-path, transparent monochrome
//      marks. Free and instant. This is the primary source and the best quality.
//   2. logo.dev → FAL (pixelcut background removal) — fallback for brands Simple Icons
//      doesn't cover. logo.dev serves the brand logo, FAL strips its background.
//      Quality is bounded by logo.dev's art: brands it serves as a *filled tile* flatten
//      to a solid square (the mark is lost), which is exactly why Simple Icons goes first.
//
// In all cases we store the colour asset (SVG or transparent PNG). Its URL carries `tone=dark`
// only when the measured contrast against Rerun's dark surface is below 3:1. <Icon> otherwise
// renders the original colours and uses a white silhouette only for that dark-on-dark case.

const ICON_BUCKET = 'service-icons'
const SIMPLEICONS_BASE_URL = process.env.RERUN_SIMPLEICONS_BASE_URL ?? 'https://cdn.simpleicons.org'
const LOGODEV_BASE_URL = process.env.RERUN_LOGODEV_BASE_URL ?? 'https://img.logo.dev'
const FAL_BG_REMOVAL_MODEL = process.env.RERUN_FAL_BG_MODEL ?? 'pixelcut/background-removal'

// Accepts a full URL ("https://stripe.com/pricing"), a bare host ("www.stripe.com") or a
// domain ("stripe.com") and returns the registrable host ("stripe.com").
export function normalizeDomain(input: string): string {
    const trimmed = input.trim()
    const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    try {
        return new URL(withProto).hostname.replace(/^www\./i, '')
    } catch {
        return trimmed.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0]
    }
}

// Simple Icons slugs are lowercase alphanumeric (e.g. "github", "visualstudiocode"). Strip
// everything else so a service slug ("brand-voice") or domain label maps to a candidate.
function toSimpleIconSlug(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

// The second-level label of a host: "stripe.com" → "stripe", "notion.so" → "notion".
function domainLabel(domain: string): string {
    const labels = domain.split('.')
    return labels.length >= 2 ? labels[labels.length - 2] : labels[0]
}

// Try Simple Icons for a slug. Returns the SVG markup, or null on 404 (unknown brand).
async function fetchSimpleIcon(slug: string): Promise<string | null> {
    const res = await fetch(`${SIMPLEICONS_BASE_URL}/${encodeURIComponent(slug)}`)
    if (!res.ok) return null
    if (!(res.headers.get('content-type') ?? '').includes('svg')) return null
    return res.text()
}

// The logo.dev image URL for a domain. Token is a publishable key, fine in the query string.
function logoDevUrl(domain: string): string {
    const token = process.env.LOGODEV_TOKEN
    if (!token) throw new Error('LOGODEV_TOKEN is not configured')
    const params = new URLSearchParams({ token, size: '256', format: 'png' })
    return `${LOGODEV_BASE_URL}/${encodeURIComponent(domain)}?${params.toString()}`
}

// Run FAL's background-removal model on the logo. `output_format: 'rgba'` (default) returns
// a transparent PNG; the result URL is on FAL's CDN (ephemeral), so callers must re-host.
async function removeBackground(imageUrl: string): Promise<string> {
    if (!process.env.FAL_KEY) throw new Error('FAL_KEY is not configured')
    fal.config({ credentials: process.env.FAL_KEY })
    const result = await fal.subscribe(FAL_BG_REMOVAL_MODEL, {
        input: { image_url: imageUrl, output_format: 'rgba' },
    })
    const url = (result.data as { image?: { url?: string } })?.image?.url
    if (!url) throw new Error('FAL background removal returned no image')
    return url
}

// Persist bytes to Supabase Storage under a stable, slug-keyed path and return the public
// URL. Cache-busted so re-runs (upsert overwrites the path) are picked up immediately.
async function storeAsset(slug: string, bytes: Uint8Array, ext: 'svg' | 'png', contentType: string): Promise<string> {
    const supabase = createServiceRoleClient()
    await supabase.storage.createBucket(ICON_BUCKET, { public: true }).catch(() => {}) // idempotent

    const path = `${slug}.${ext}`
    const { error } = await supabase.storage.from(ICON_BUCKET).upload(path, bytes, { contentType, upsert: true })
    if (error) throw new Error(`Storage upload failed: ${error.message}`)

    const { data } = supabase.storage.from(ICON_BUCKET).getPublicUrl(path)
    return `${data.publicUrl}?v=${Date.now()}`
}

async function downloadBytes(url: string): Promise<Uint8Array> {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Failed to download asset: ${res.status}`)
    return new Uint8Array(await res.arrayBuffer())
}

// Rogne la marge transparente d'un PNG pour que le logo remplisse son cadre. logo.dev sert ses
// logos centrés dans une tuile avec de la marge ; FAL enlève le fond mais garde cette marge, donc
// `object-contain` rétrécit le logo visible. Le trim recadre sur le contenu réel → cohérent avec
// les Simple Icons (déjà serrées). `failOn: 'none'` tolère les PNG limites ; `threshold` absorbe
// l'anti-aliasing. No-op (retourne l'original) si l'image n'a pas de bordure uniforme à rogner.
async function trimTransparentPng(bytes: Uint8Array): Promise<Uint8Array> {
    try {
        const { default: sharp } = await import('sharp')
        const out = await sharp(bytes, { failOn: 'none' }).trim({ threshold: 10 }).png().toBuffer()
        return new Uint8Array(out)
    } catch {
        return bytes
    }
}

export type BrandIconResult = {
    source: 'simple-icons' | 'logo.dev'
    matched: string // the Simple Icons slug or the logo.dev domain that produced the icon
    domain: string
    tone: BrandIconTone
    iconUrl: string
    sourceUrl?: string // logo.dev raw URL (fallback path only)
    cutoutUrl?: string // FAL output URL (fallback path only)
}

// Full pipeline: service → stored, render-ready icon URL. Tries Simple Icons first (by the
// service slug, then the domain label), then falls back to logo.dev → FAL. Does NOT touch
// the catalog row — the caller decides whether to persist `iconUrl`.
export async function buildBrandIcon(slug: string, website: string): Promise<BrandIconResult> {
    const domain = normalizeDomain(website)

    // 1. Simple Icons (primary). Candidates: the service slug, then the domain's label.
    const candidates = [...new Set([toSimpleIconSlug(slug), toSimpleIconSlug(domainLabel(domain))].filter(Boolean))]
    for (const candidate of candidates) {
        const svg = await fetchSimpleIcon(candidate)
        if (svg) {
            const bytes = new TextEncoder().encode(svg)
            const tone = await analyzeBrandIconTone(bytes)
            const iconUrl = withBrandIconTone(await storeAsset(slug, bytes, 'svg', 'image/svg+xml'), tone)
            return { source: 'simple-icons', matched: candidate, domain, tone, iconUrl }
        }
    }

    // 2. logo.dev → FAL background removal → trim → re-host (fallback).
    const sourceUrl = logoDevUrl(domain)
    const cutoutUrl = await removeBackground(sourceUrl)
    const trimmed = await trimTransparentPng(await downloadBytes(cutoutUrl))
    const tone = await analyzeBrandIconTone(trimmed)
    const iconUrl = withBrandIconTone(await storeAsset(slug, trimmed, 'png', 'image/png'), tone)
    return { source: 'logo.dev', matched: domain, domain, tone, iconUrl, sourceUrl, cutoutUrl }
}

export type ReclassifyBrandIconsResult = {
    updated: Array<{ slug: string; before: string; after: string; tone: BrandIconTone }>
    failed: Array<{ slug: string; error: string }>
    templatesUpdated: string[]
    templateFailures: Array<{ slug: string; error: string }>
}

export function syncTemplateConnectorIconSnapshot(connectors: unknown, iconsBySlug: ReadonlyMap<string, string>): { connectors: unknown; changed: boolean } {
    if (!Array.isArray(connectors)) return { connectors, changed: false }

    let changed = false
    const next = connectors.map(connector => {
        if (!isRecord(connector) || typeof connector.slug !== 'string') return connector
        const icon = iconsBySlug.get(connector.slug)
        if (!icon || connector.icon === icon) return connector
        changed = true
        return { ...connector, icon }
    })

    return { connectors: next, changed }
}

// Re-analyse les assets stockés sans repasser par Simple Icons, logo.dev ou FAL. L'URL catalogue
// reçoit ou perd `tone=dark`, puis les snapshots dénormalisés dans templates.connectors sont
// synchronisés. Les octets des assets restent intacts.
export async function reclassifyAllBrandIcons(): Promise<ReclassifyBrandIconsResult> {
    const supabase = createServiceRoleClient()
    const { data, error } = await selectMany(supabase, 'services', ['slug', 'icon'] as const, {})
    if (error) throw new Error(error.message)

    const results = await Promise.all(
        (data ?? []).map(async ({ slug, icon }) => {
            if (!slug || !icon || !/^https?:\/\//i.test(icon)) return null
            try {
                const tone = await analyzeBrandIconTone(await downloadBytes(icon))
                const after = withBrandIconTone(icon, tone)
                const { error: updateError } = await supabase
                    .from('services')
                    .update<Database['public']['Tables']['services']['Update']>({ icon: after })
                    .eq('slug', slug)
                if (updateError) throw new Error(updateError.message)
                return { ok: true as const, value: { slug, before: icon, after, tone } }
            } catch (cause) {
                return { ok: false as const, value: { slug, error: cause instanceof Error ? cause.message : 'unknown' } }
            }
        }),
    )

    const updated = results.flatMap(result => (result?.ok ? [result.value] : []))
    const failed = results.flatMap(result => (result && !result.ok ? [result.value] : []))
    const iconsBySlug = new Map(updated.map(result => [result.slug, result.after]))

    const { data: templates, error: templateReadError } = await selectMany(supabase, 'templates', ['id', 'slug', 'connectors'] as const, {})
    if (templateReadError) throw new Error(templateReadError.message)

    const templateResults = await Promise.all(
        (templates ?? []).map(async template => {
            const synced = syncTemplateConnectorIconSnapshot(template.connectors, iconsBySlug)
            if (!synced.changed) return null
            const { error: updateError } = await supabase
                .from('templates')
                .update<Database['public']['Tables']['templates']['Update']>({
                    connectors: synced.connectors as Database['public']['Tables']['templates']['Update']['connectors'],
                })
                .eq('id', template.id)
            if (updateError) return { ok: false as const, slug: template.slug, error: updateError.message }
            return { ok: true as const, slug: template.slug }
        }),
    )

    return {
        updated,
        failed,
        templatesUpdated: templateResults.flatMap(result => (result?.ok ? [result.slug] : [])),
        templateFailures: templateResults.flatMap(result => (result && !result.ok ? [{ slug: result.slug, error: result.error }] : [])),
    }
}

// Backfill : re-rogne et reclassifie les PNG déjà stockés (sans re-payer logo.dev/FAL). Pour
// chaque service concerné, on re-télécharge l'asset courant et le ré-uploade au même chemin.
// Idempotent : un PNG déjà serré ressort identique. Les échecs restent isolés.
export async function retrimAllPngIcons(): Promise<Array<{ slug: string; before: string; after: string }>> {
    const supabase = createServiceRoleClient()
    const { data, error } = await selectMany(supabase, 'services', ['slug', 'icon'] as const, { icon: { ilike: '%.png%' } })
    if (error) throw new Error(error.message)

    const results: Array<{ slug: string; before: string; after: string } | null> = await Promise.all(
        (data ?? []).map(async ({ slug, icon }) => {
            if (!slug || !icon) return null
            try {
                const trimmed = await trimTransparentPng(await downloadBytes(icon))
                const tone = await analyzeBrandIconTone(trimmed)
                const after = withBrandIconTone(await storeAsset(slug, trimmed, 'png', 'image/png'), tone)
                const { error: upErr } = await supabase
                    .from('services')
                    .update<Database['public']['Tables']['services']['Update']>({ icon: after })
                    .eq('slug', slug)
                if (upErr) throw new Error(upErr.message)
                return { slug, before: icon, after }
            } catch {
                return null
            }
        }),
    )

    return results.filter((r): r is { slug: string; before: string; after: string } => r !== null)
}
