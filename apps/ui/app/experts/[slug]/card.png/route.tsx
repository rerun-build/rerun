import { readFile } from 'node:fs/promises'
import { ImageResponse } from 'next/og'
import type { ReactNode } from 'react'

import { badgeFromType, markdownToPlainText } from '@rerun/ui/experts/options'
import { MARK_PATH } from '@rerun/ui/logo'
import { brandIconDataUrl } from '@/lib/og/brand-icon'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import { createServiceRoleClient } from '@/supabase/serviceRole'

export const runtime = 'nodejs'

const BRAND = '#4d34f7'

const BASE_W = 376
const BASE_H = 600

const EXPERT_COLUMNS = [
    'name',
    'type',
    'location',
    'bio',
    'avatar_url',
    'skills',
    'x_url',
    'linkedin_url',
    'github_url',
    'website_url',
] as const

type ExpertCard = {
    name: string
    badge: string
    expertise: string
    location: string
    description: string
    avatarUrl: string
    xUrl: string
    linkedinUrl: string
    githubUrl: string
    websiteUrl: string
}

let fontsPromise: Promise<{ inter: Buffer; interSemibold: Buffer; mono: Buffer; monoMedium: Buffer }> | null = null
function loadFonts() {
    fontsPromise ??= (async () => ({
        inter: await readFile(new URL('../../../_fonts/Inter-Regular.ttf', import.meta.url)),
        interSemibold: await readFile(new URL('../../../_fonts/Inter-SemiBold.ttf', import.meta.url)),
        mono: await readFile(new URL('../../../_fonts/GeistMono-Regular.ttf', import.meta.url)),
        monoMedium: await readFile(new URL('../../../_fonts/GeistMono-Medium.ttf', import.meta.url)),
    }))()
    return fontsPromise
}

async function fetchImageDataUrl(url: string): Promise<string> {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`image responded ${res.status}`)
    const input = Buffer.from(await res.arrayBuffer())
    const { default: sharp } = await import('sharp')
    const png = await sharp(input).png().toBuffer()
    return `data:image/png;base64,${png.toString('base64')}`
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
    if (raw === null || raw.trim() === '') return fallback
    const n = Number(raw)
    if (!Number.isFinite(n)) return fallback
    return Math.min(max, Math.max(min, Math.round(n)))
}

function initials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean)
    if (parts.length === 0) return '★'
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function truncate(text: string, max: number): string {
    if (text.length <= max) return text
    return `${text.slice(0, max - 1).trimEnd()}…`
}

const X_PATH = 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z'
const LINKEDIN_PATH =
    'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z'
const GITHUB_PATH =
    'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12'
const GLOBE_PATH =
    'M12 2a10 10 0 100 20 10 10 0 000-20zm0 0c2.5 2.5 3.5 6 3.5 10s-1 7.5-3.5 10m0-20c-2.5 2.5-3.5 6-3.5 10s1 7.5 3.5 10M2 12h20'

const DIAMOND = 'M6 0 L12 6 L6 12 L0 6 Z'

function buildHoloTileUrl(): string {
    const cell = 22
    const viewBox = 812
    const offset = 150
    const tileScale = cell / viewBox
    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${cell}" height="${cell}" viewBox="0 0 ${cell} ${cell}">` +
        `<g transform="scale(${tileScale}) translate(${offset} ${offset})">` +
        `<path fill="none" stroke="${BRAND}" stroke-width="26" stroke-linejoin="round" fill-rule="evenodd" d="${MARK_PATH}"/>` +
        `</g>` +
        `</svg>`
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

const HOLO_TILE_URL = buildHoloTileUrl()

function HeaderMarks({ s }: { s: number }) {
    const c = 'rgba(255,255,255,0.25)'
    const d = 12 * s
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 * s }}>
            <svg width={d} height={d} viewBox="0 0 12 12" fill={c}>
                <path d={DIAMOND} />
            </svg>
            <svg width={d} height={d} viewBox="0 0 12 12" fill="none" stroke={c} strokeWidth={1.4}>
                <path d={DIAMOND} />
            </svg>
            <svg width={d} height={d} viewBox="0 0 12 12" fill={c}>
                <path d={DIAMOND} />
            </svg>
        </div>
    )
}

function SocialSquare({ path, s, filled = true }: { path: string; s: number; filled?: boolean }) {
    return (
        <div
            style={{
                display: 'flex',
                width: 28 * s,
                height: 28 * s,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 6 * s,
                border: `${1 * s}px solid rgba(255,255,255,0.1)`,
                backgroundColor: 'rgba(255,255,255,0.05)',
            }}
        >
            <svg
                width={14 * s}
                height={14 * s}
                viewBox="0 0 24 24"
                fill={filled ? 'rgba(255,255,255,0.7)' : 'none'}
                stroke={filled ? 'none' : 'rgba(255,255,255,0.7)'}
                strokeWidth={filled ? 0 : 2}
            >
                <path d={path} />
            </svg>
        </div>
    )
}

function DataRow({ label, s, children }: { label: string; s: number; children: ReactNode }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 * s }}>
            <span
                style={{
                    width: 64 * s,
                    flexShrink: 0,
                    fontFamily: 'Geist Mono',
                    fontSize: 11 * s,
                    letterSpacing: 2 * s,
                    textTransform: 'uppercase',
                    color: 'rgba(255,255,255,0.35)',
                }}
            >
                {label}
            </span>
            <span style={{ fontFamily: 'Geist Mono', fontSize: 11 * s, color: 'rgba(255,255,255,0.25)' }}>&gt;</span>
            {children}
        </div>
    )
}

function CardImage({ data, photoDataUrl, brandIcon, s }: { data: ExpertCard; photoDataUrl: string | null; brandIcon: string; s: number }) {
    const socials = [data.xUrl && X_PATH, data.linkedinUrl && LINKEDIN_PATH, data.githubUrl && GITHUB_PATH].filter(Boolean) as string[]
    const hasWebsite = Boolean(data.websiteUrl)

    return (
        <div
            style={{
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                width: 360 * s,
                minHeight: 582 * s,
                borderRadius: 16 * s,
                border: `${1 * s}px solid rgba(255,255,255,0.1)`,
                backgroundImage: 'radial-gradient(130% 80% at 50% 0%, #2c1d54, #0b0713)',
                boxShadow: `0 ${10 * s}px ${30 * s}px -${12 * s}px rgba(0,0,0,0.85), 0 0 ${30 * s}px -${14 * s}px rgba(183,168,255,0.45)`,
                overflow: 'hidden',
            }}
        >
            <div
                aria-hidden
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    borderRadius: 16 * s,
                    backgroundImage: `url(${HOLO_TILE_URL})`,
                    backgroundRepeat: 'repeat',
                    backgroundSize: `${22 * s}px ${22 * s}px`,
                    opacity: 0.4,
                }}
            />
            <div
                aria-hidden
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    borderRadius: 16 * s,
                    backgroundImage:
                        'linear-gradient(to bottom, rgba(11,7,19,0) 18%, rgba(11,7,19,0.55) 34%, rgba(11,7,19,0.8) 52%, rgba(11,7,19,0.85) 100%)',
                }}
            />
            <div
                aria-hidden
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    borderRadius: 16 * s,
                    backgroundImage:
                        'linear-gradient(115deg, transparent 34%, rgba(186,176,255,0.05) 46%, rgba(255,255,255,0.06) 50%, rgba(183,168,255,0.05) 54%, transparent 66%)',
                }}
            />
            <div
                aria-hidden
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    borderRadius: 16 * s,
                    backgroundImage: 'radial-gradient(60% 32% at 50% 22%, rgba(255,255,255,0.08), transparent 60%)',
                }}
            />
            <div style={{ position: 'relative', display: 'flex', flexGrow: 1, flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: `${32 * s}px ${24 * s}px 0` }}>
                <span
                    style={{
                        fontFamily: 'Geist Mono',
                        fontSize: 11 * s,
                        fontWeight: 500,
                        letterSpacing: 3 * s,
                        textTransform: 'uppercase',
                        backgroundImage: `linear-gradient(90deg, ${BRAND}, #dbd5ff)`,
                        backgroundClip: 'text',
                        WebkitBackgroundClip: 'text',
                        color: 'transparent',
                    }}
                >
                    Rerun Experts
                </span>
                <HeaderMarks s={s} />
            </div>

            <div style={{ display: 'flex', height: 208 * s, alignItems: 'center', justifyContent: 'center' }}>
                <div
                    style={{
                        display: 'flex',
                        width: 96 * s,
                        height: 96 * s,
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: 9999,
                        border: `${1.5 * s}px solid rgba(255,255,255,0.6)`,
                        backgroundColor: 'rgba(255,255,255,0.05)',
                        boxShadow: `0 0 ${34 * s}px -${6 * s}px rgba(255,255,255,0.7)`,
                    }}
                >
                    {photoDataUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={photoDataUrl} alt="" width={96 * s} height={96 * s} style={{ borderRadius: 9999, objectFit: 'cover' }} />
                    ) : (
                        <span style={{ fontFamily: 'Inter', fontSize: 30 * s, fontWeight: 600, color: 'rgba(255,255,255,0.75)' }}>
                            {initials(data.name)}
                        </span>
                    )}
                </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', padding: `0 ${24 * s}px` }}>
                <div
                    style={{
                        display: 'flex',
                        fontFamily: 'Inter',
                        fontSize: 30 * s,
                        fontWeight: 600,
                        lineHeight: 1,
                        letterSpacing: -0.5 * s,
                        textTransform: 'uppercase',
                        backgroundImage: 'radial-gradient(120% 140% at 50% -40%, #ffffff 12%, #bab0ff 58%, #4d34f7 130%)',
                        backgroundClip: 'text',
                        WebkitBackgroundClip: 'text',
                        color: 'transparent',
                    }}
                >
                    {truncate(data.name, 22)}
                </div>
                <div
                    style={{
                        marginTop: 10 * s,
                        fontFamily: 'Geist Mono',
                        fontSize: 11 * s,
                        letterSpacing: 3 * s,
                        textTransform: 'uppercase',
                        color: 'rgba(255,255,255,0.45)',
                    }}
                >
                    {data.expertise}
                </div>
                {data.description && (
                    <div style={{ marginTop: 16 * s, fontFamily: 'Inter', fontSize: 14 * s, lineHeight: 1.5, color: 'rgba(255,255,255,0.55)' }}>
                        {truncate(data.description, 120)}
                    </div>
                )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 * s, marginTop: 24 * s, padding: `0 ${24 * s}px` }}>
                {data.location && (
                    <DataRow label="Location" s={s}>
                        <span style={{ fontFamily: 'Geist Mono', fontSize: 12 * s, color: 'rgba(255,255,255,0.85)' }}>{truncate(data.location, 32)}</span>
                    </DataRow>
                )}
                <DataRow label="Status" s={s}>
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            borderRadius: 9999,
                            border: `${1 * s}px solid rgba(77,52,247,0.5)`,
                            backgroundColor: 'rgba(77,52,247,0.12)',
                            padding: `${3 * s}px ${10 * s}px`,
                            fontFamily: 'Geist Mono',
                            fontSize: 10 * s,
                            letterSpacing: 1.5 * s,
                            textTransform: 'uppercase',
                            color: '#dbd5ff',
                            boxShadow: `0 0 ${16 * s}px -${3 * s}px rgba(183,168,255,0.7)`,
                        }}
                    >
                        {data.badge}
                    </div>
                </DataRow>
                {(socials.length > 0 || hasWebsite) && (
                    <DataRow label="Links" s={s}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 * s }}>
                            {socials.map((path, i) => (
                                <SocialSquare key={i} path={path} s={s} />
                            ))}
                            {hasWebsite && <SocialSquare path={GLOBE_PATH} s={s} filled={false} />}
                        </div>
                    </DataRow>
                )}
            </div>

            <div style={{ display: 'flex', flexGrow: 1, minHeight: 24 * s }} />

            <div
                style={{
                    display: 'flex',
                    height: 1 * s,
                    margin: `0 ${24 * s}px`,
                    backgroundImage:
                        'repeating-linear-gradient(90deg, rgba(255,255,255,0.18) 0, rgba(255,255,255,0.18) 4px, transparent 4px, transparent 8px)',
                }}
            />

            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: `${20 * s}px ${24 * s}px`,
                    fontFamily: 'Geist Mono',
                    fontSize: 10 * s,
                    letterSpacing: 2 * s,
                    textTransform: 'uppercase',
                    color: 'rgba(255,255,255,0.3)',
                }}
            >
                <span>Rerun.build</span>
                <div style={{ position: 'relative', display: 'flex', width: 16 * s, height: 16 * s, alignItems: 'center', justifyContent: 'center' }}>
                    <div
                        aria-hidden
                        style={{
                            position: 'absolute',
                            top: -6 * s,
                            left: -6 * s,
                            right: -6 * s,
                            bottom: -6 * s,
                            backgroundImage: 'radial-gradient(circle, rgba(183,168,255,0.85), transparent 70%)',
                        }}
                    />
                    <img src={brandIcon} width={16 * s} height={16 * s} style={{ position: 'relative', borderRadius: 3.6 * s }} alt="" />
                </div>
            </div>
            </div>
        </div>
    )
}

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params

    const supabase = createServiceRoleClient()
    const { data: row } = await selectMaybeSingle(supabase, 'experts', EXPERT_COLUMNS, { slug })
    if (!row) return new Response('Not found', { status: 404 })

    const badge = badgeFromType(row.type)
    const data: ExpertCard = {
        name: row.name.trim(),
        badge,
        expertise: row.skills.slice(0, 2).join(' · ').trim() || badge,
        location: row.location?.trim() ?? '',
        description: markdownToPlainText(row.bio ?? ''),
        avatarUrl: row.avatar_url?.trim() ?? '',
        xUrl: row.x_url?.trim() ?? '',
        linkedinUrl: row.linkedin_url?.trim() ?? '',
        githubUrl: row.github_url?.trim() ?? '',
        websiteUrl: row.website_url?.trim() ?? '',
    }

    const search = new URL(req.url).searchParams
    const s = clampInt(search.get('scale'), 2, 1, 4)
    const format = search.get('format') === 'webp' ? 'webp' : 'png'

    let photoDataUrl: string | null = null
    if (data.avatarUrl) {
        try {
            photoDataUrl = await fetchImageDataUrl(data.avatarUrl)
        } catch {
            photoDataUrl = null
        }
    }

    const [{ inter, interSemibold, mono, monoMedium }, brandIcon] = await Promise.all([loadFonts(), brandIconDataUrl()])
    const width = BASE_W * s
    const height = BASE_H * s

    const element = (
        <div
            style={{
                display: 'flex',
                width,
                height,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'transparent',
            }}
        >
            <CardImage data={data} photoDataUrl={photoDataUrl} brandIcon={brandIcon} s={s} />
        </div>
    )

    const png = await new ImageResponse(element, {
        width,
        height,
        fonts: [
            { name: 'Inter', data: inter, weight: 400, style: 'normal' },
            { name: 'Inter', data: interSemibold, weight: 600, style: 'normal' },
            { name: 'Geist Mono', data: mono, weight: 400, style: 'normal' },
            { name: 'Geist Mono', data: monoMedium, weight: 500, style: 'normal' },
        ],
    }).arrayBuffer()

    if (format === 'webp') {
        const { default: sharp } = await import('sharp')
        const webp = await sharp(Buffer.from(png)).webp({ quality: 90 }).toBuffer()
        return new Response(new Uint8Array(webp), {
            headers: {
                'Content-Type': 'image/webp',
                'Cache-Control': 'public, max-age=300, s-maxage=300',
            },
        })
    }

    return new Response(png, {
        headers: {
            'Content-Type': 'image/png',
            'Cache-Control': 'public, max-age=300, s-maxage=300',
        },
    })
}
