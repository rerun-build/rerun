import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { Logo } from '@/components/layout/Logo'
import { GateCodeField } from '@/components/published/GateCodeField'
import { GateMessage, GateScreen, RerunTile, type GateBrand } from '@/components/published/GateScreen'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { GateInput } from '@/components/published/GateInput'
import { APP_URL } from '@/lib/app-url'
import { GATE_EMAIL_PARAM, GATE_ERROR_PARAM, loadPublished, loadWorkspaceBrand, safeNextPath, type GateError, type PublishedEntry } from '@/lib/published/gate'
import { extractPublishedSlug, publishedSiteOrigin } from '@/lib/published/host'
import { openPublishedHref } from '@/lib/published/links'
import { KeyIcon, LogInIcon, MailIcon } from '@/lib/icons'
import { getTranslations } from 'next-intl/server'

export const dynamic = 'force-dynamic'

type Params = { slug: string }
type Search = Record<string, string | string[] | undefined>

const RERUN_BRAND: GateBrand = { name: 'Rerun', iconUrl: null }

function param(search: Search, key: string): string | undefined {
    const value = search[key]
    return Array.isArray(value) ? value[0] : value
}

async function onOwnHost(slug: string): Promise<boolean> {
    return extractPublishedSlug((await headers()).get('host')) === slug
}

async function gateContext(slug: string): Promise<{ entry: PublishedEntry | null; brand: GateBrand }> {
    const entry = await loadPublished(slug)
    return { entry, brand: entry ? await loadWorkspaceBrand(entry.workspace_id) : RERUN_BRAND }
}

// A crawler unfurling the link is no one in particular: whatever it reads, anyone the link is
// forwarded to reads too, so the title of the page never reaches the preview.
export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
    const { slug } = await params
    const origin = publishedSiteOrigin(slug)
    const { entry, brand } = await gateContext(slug)
    const t = await getTranslations('publicPages')
    const title = entry ? t('publishedView.protectedTitle') : t('linkOff.title')
    const description = entry ? t('publishedView.protectedDescription', { workspace: brand.name }) : t('linkOff.subtitle')
    const images = entry ? ['/__rerun/og.png'] : undefined
    return {
        title: { absolute: title },
        description,
        robots: { index: false, follow: false },
        ...(origin ? { metadataBase: new URL(origin) } : {}),
        openGraph: { title, description, images, siteName: 'Rerun' },
        twitter: { card: 'summary_large_image', title, description, images },
    }
}

type GateTranslator = Awaited<ReturnType<typeof getTranslations<'publicPages.gate'>>>

function errorText(error: GateError | undefined, expected: GateError, t: GateTranslator): string | null {
    if (error === 'limited') return t('errors.limited')
    if (error !== expected) return null
    switch (expected) {
        case 'password':
            return t('errors.password')
        case 'code':
            return t('errors.code')
        case 'email':
            return t('errors.email')
        default:
            return null
    }
}

function isGateError(value: string | undefined): value is GateError {
    return value === 'password' || value === 'code' || value === 'limited' || value === 'email'
}

export default async function PublishedGatePage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<Search> }) {
    const { slug } = await params
    if (!(await onOwnHost(slug))) notFound()

    const search = await searchParams
    const next = safeNextPath(param(search, 'next'))
    const rawError = param(search, GATE_ERROR_PARAM)
    const error = isGateError(rawError) ? rawError : undefined
    const email = param(search, GATE_EMAIL_PARAM)?.trim()
    const { entry, brand } = await gateContext(slug)
    const tPages = await getTranslations('publicPages')
    const t = await getTranslations('publicPages.gate')

    if (!entry || param(search, 'gate') === 'gone') {
        return <GateScreen brand={brand} lock={null} mark={<RerunTile />} title={tPages('linkOff.title')} subtitle={tPages('linkOff.subtitle')} />
    }

    const title = entry.title ?? tPages('publishedView.protectedTitle')

    if (entry.access === 'password') {
        const message = errorText(error, 'password', t)
        return (
            <GateScreen brand={brand} lock={<Icon icon={KeyIcon} size="lg" />} title={title} subtitle={t('password.subtitle', { workspace: brand.name })}>
                <form method="post" action="/__rerun/password" className="flex flex-col gap-2.5">
                    <input type="hidden" name="next" value={next} />
                    <GateInput type="password" name="password" placeholder={t('password.placeholder')} autoComplete="current-password" autoFocus required aria-invalid={!!message || undefined} />
                    {message && <GateMessage>{message}</GateMessage>}
                    <Button type="submit" size="lg">
                        {t('open')}
                    </Button>
                </form>
            </GateScreen>
        )
    }

    if (entry.access === 'invited' && email) {
        const message = errorText(error, 'code', t)
        return (
            <GateScreen brand={brand} lock={<Icon icon={MailIcon} size="lg" />} title={t('code.title')} subtitle={t('code.subtitle', { email })}>
                <form method="post" action="/__rerun/code/verify" className="flex flex-col gap-2.5">
                    <input type="hidden" name="email" value={email} />
                    <input type="hidden" name="next" value={next} />
                    <GateCodeField invalid={!!message} />
                    {message && <GateMessage>{message}</GateMessage>}
                    <Button type="submit" size="lg">
                        {t('open')}
                    </Button>
                    <Button variant="ghost" asChild>
                        <a href={next}>{t('code.otherEmail')}</a>
                    </Button>
                </form>
            </GateScreen>
        )
    }

    if (entry.access === 'invited') {
        const message = errorText(error, 'email', t)
        return (
            <GateScreen brand={brand} lock={<Icon icon={MailIcon} size="lg" />} title={title} subtitle={t('email.subtitle')}>
                <form method="post" action="/__rerun/code/send" className="flex flex-col gap-2.5">
                    <input type="hidden" name="next" value={next} />
                    <GateInput type="email" name="email" placeholder="you@company.com" autoComplete="email" autoFocus required aria-invalid={!!message || undefined} />
                    {message && <GateMessage>{message}</GateMessage>}
                    <Button type="submit" size="lg">
                        {t('email.submit')}
                    </Button>
                </form>
            </GateScreen>
        )
    }

    return (
        <GateScreen brand={brand} lock={<Logo size="lg" />} title={title} subtitle={t('members.subtitle', { workspace: brand.name })}>
            <Button size="lg" asChild>
                <a href={`${APP_URL}${openPublishedHref(slug, next)}`}>
                    <LogInIcon />
                    {t('members.continue')}
                </a>
            </Button>
        </GateScreen>
    )
}
