import { RERUN_BRAND, type Brand } from '@rerun/contracts'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ASSET_ORIGIN, EMAIL_PREVIEWS, LOGO_URL, NEWSLETTERS, renderEmail, TONES, TrialEnded, theme } from '@rerun/emails'

// The email design system only holds if the templates keep going through it. These three checks
// are what stop the old habits from creeping back: per-file colour constants, flexbox that no
// mail client runs, and alpha colours the Word engine drops on the floor.

// Structural colours that are not design tokens: the light edge on the button relief, and the
// transparent keyword.
const STRUCTURAL_COLOURS = new Set(['#ffffff'])

function allowedColours(): Set<string> {
    const values = [
        ...Object.values(theme.surface),
        ...Object.values(theme.text),
        ...Object.values(theme.brand),
        ...Object.values(TONES).flatMap(tone => Object.values(tone)),
        ...STRUCTURAL_COLOURS,
    ]
    return new Set(values.map(value => value.toLowerCase()))
}

// Newsletters go through the same checks: they are written by hand, one file per issue, and
// nothing else would stop a pasted hex from landing in one.
const NEWSLETTER_PREVIEW_PROPS = {
    appUrl: 'https://app.rerun.build',
    unsubscribeUrl: 'https://app.rerun.build/unsubscribe?token=test',
}

async function renderAll() {
    const elements = [
        ...EMAIL_PREVIEWS.map(preview => ({ id: preview.id, element: preview.element })),
        ...NEWSLETTERS.map(newsletter => ({
            id: `newsletter/${newsletter.slug}`,
            element: newsletter.render(NEWSLETTER_PREVIEW_PROPS),
        })),
    ]
    return Promise.all(elements.map(async entry => ({ id: entry.id, ...(await renderEmail(entry.element)) })))
}

describe('email templates', () => {
    it('has at least one preview per template', () => {
        const templates = readdirSync(path.resolve(import.meta.dirname, '../../../../packages/emails/emails')).filter(file => file.endsWith('.tsx'))
        const groups = new Set(EMAIL_PREVIEWS.map(p => p.group))
        expect(groups.size).toBe(templates.length)
    })

    it('renders every preview to HTML and to text', async () => {
        for (const rendered of await renderAll()) {
            expect(rendered.html, rendered.id).toContain('<html')
            expect(rendered.text.trim(), rendered.id).not.toBe('')
        }
    })

    it('never links to the settings page, which the app does not have', async () => {
        for (const { id, html } of await renderAll()) {
            expect(html, id).not.toContain('/settings"')
        }
    })

    it('shows no unsubscribe link on an email that has none to offer', async () => {
        const rendered = await renderAll()
        for (const id of ['sign-in-code/default', 'workspace-invite/anonymous', 'trial-final-notice/no-card', 'renewal-reminder/seven-days']) {
            const email = rendered.find(entry => entry.id === id)
            expect(email?.html, id).not.toContain('Unsubscribe')
        }
    })

    it('never lays out with flexbox', async () => {
        for (const { id, html } of await renderAll()) {
            expect(html.replace(/\s/g, ''), id).not.toContain('display:flex')
        }
    })

    it('never paints with alpha colours', async () => {
        for (const { id, html } of await renderAll()) {
            const alphaPaint = html.match(/(?:^|[;"\s])(?:color|background(?:-color)?|border(?:-[a-z]+)?-color):[^;"]*rgba\(/gi)
            expect(alphaPaint, id).toBeNull()
        }
    })

    it('only uses colours declared in the theme', async () => {
        const allowed = allowedColours()
        for (const { id, html } of await renderAll()) {
            // The lookbehind skips numeric HTML entities (&#8203;), which are not colours.
            const strays = [...new Set(html.match(/(?<!&)#[0-9a-f]{3,8}\b/gi) ?? [])]
                .map(hex => hex.toLowerCase())
                .filter(hex => !allowed.has(hex))
            expect(strays, `${id} uses colours that are not theme tokens`).toEqual([])
        }
    })
})

describe('email templates in the reader\'s language', () => {
    it('renders an email in French, footer included', async () => {
        const { html, text } = await renderEmail(
            React.createElement(TrialEnded, {
                reason: 'no_card',
                workspaceName: 'Acme',
                trialEndedLabel: '12 mars',
                pausedLabel: '12 mars à 16:00 UTC',
                keptUntilLabel: '10 juin',
                summary: { agents: 3, runs: 41 },
                billingUrl: 'https://app.rerun.build/?billing=1',
                appUrl: 'https://app.rerun.build',
                unsubscribeUrl: 'https://app.rerun.build/unsubscribe?token=test',
                locale: 'fr',
            }),
        )
        expect(html).toContain('lang="fr"')
        expect(text).toContain('VOTRE ESSAI EST TERMINÉ')
        expect(text).toContain("L'essai de Acme s'est terminé le 12 mars, et vos coworkers se sont arrêtés.")
        expect(text).toContain('Démarrer mon abonnement')
        expect(text).toContain('Se désabonner')
        expect(text).not.toContain('YOUR TRIAL HAS ENDED')
    })

    // A key missing from a pack, or a message the ICU parser refuses, would print its key path.
    it.each(['fr', 'es', 'pt', 'de', 'tr', 'ar', 'zh', 'he'] as const)('renders every preview in %s with no missing or broken message', async locale => {
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
        for (const preview of EMAIL_PREVIEWS) {
            const { html, text } = await renderEmail(React.cloneElement(preview.element as React.ReactElement<{ locale?: string }>, { locale }))
            expect(html, preview.id).toContain(`lang="${locale}"`)
            expect(html, preview.id).toContain(`dir="${locale === 'ar' || locale === 'he' ? 'rtl' : 'ltr'}"`)
            expect(text, preview.id).not.toMatch(/\bemails\.[a-zA-Z]/)
        }
        expect(errors).not.toHaveBeenCalled()
        errors.mockRestore()
    })
})

const AGENCY: Brand = { ...RERUN_BRAND, organizationId: 'org', name: 'Nordlys & Co', iconUrl: 'https://cdn.example/nordlys.png', supportEmail: 'help@nordlys.no' }
const AGENCY_APP = 'https://agents.nordlys.no'

// Rerun's own programs, which no organization ever sends.
const RERUN_ONLY = /^(creator-invite|creator-pitch|lifetime-code)\//

type BrandedElement = React.ReactElement<{ brand?: Brand; locale?: string }>

// The previews link to Rerun's app; a sender links to the app of the brand.
function onAgencyApp<T>(value: T): T {
    if (typeof value === 'string') return value.replaceAll(ASSET_ORIGIN, AGENCY_APP) as T
    if (Array.isArray(value)) return value.map(onAgencyApp) as T
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, onAgencyApp(entry)])) as T
    return value
}

const links = (html: string) => [...html.matchAll(/<a\b[^>]* href="([^"]*)"/g)].map(match => match[1])
const images = (html: string) => [...html.matchAll(/<img\b[^>]* src="([^"]*)"/g)].map(match => match[1])

describe('the brand of an email', () => {
    it('is Rerun by default: its logo, its site and its line at the foot of every preview', async () => {
        for (const preview of EMAIL_PREVIEWS) {
            const element = preview.element as BrandedElement
            const { html, text } = await renderEmail(element)
            expect(html, preview.id).toBe((await renderEmail(React.cloneElement(element, { brand: RERUN_BRAND }))).html)
            expect(links(html).slice(0, 2), preview.id).toEqual(['https://rerun.build', 'https://rerun.build'])
            expect(images(html)[0], preview.id).toBe(LOGO_URL)
            expect(html, preview.id).toMatch(/<img[^>]*alt="Rerun"/)
            expect(text, preview.id).toContain('Run your work on coworkers. Build them, watch them work, and keep your eyes on everything.\n\n© 2026 Rerun')
            expect(html, preview.id).not.toContain('mailto:')
        }
    })

    it.each(['en', 'fr', 'es', 'pt', 'de', 'tr'] as const)('names the organization and nothing of Rerun, in %s', async locale => {
        const branded = EMAIL_PREVIEWS.filter(preview => !RERUN_ONLY.test(preview.id))
        expect(branded.length).toBeGreaterThan(30)
        for (const preview of branded) {
            const element = preview.element as BrandedElement
            const { html, text } = await renderEmail(React.cloneElement(element, { ...onAgencyApp(element.props), brand: AGENCY, locale }))
            expect(html, preview.id).not.toMatch(/rerun/i)
            expect(text, preview.id).not.toMatch(/rerun/i)
            expect(text, preview.id).toContain('© 2026 Nordlys & Co')
            expect(images(html)[0], preview.id).toBe(AGENCY.iconUrl)
            expect(links(html), preview.id).toContain('mailto:help@nordlys.no')
        }
    })

    it('shows a name alone when the organization has no icon, and no contact when it gave none', async () => {
        const { html, text } = await renderEmail(React.cloneElement(EMAIL_PREVIEWS[0].element as BrandedElement, { brand: { ...AGENCY, iconUrl: null, supportEmail: null } }))
        expect(text).toContain('Nordlys & Co')
        expect(html).not.toContain(LOGO_URL)
        expect(html).not.toContain('mailto:')
    })

    it('loads the artwork of an organization from its own app, and from production when the app is not reachable', async () => {
        // Without its close-up, which the sender captures on the app of the brand, the email opens on its own art.
        const element = EMAIL_PREVIEWS[0].element as React.ReactElement<{ brand?: Brand; appUrl?: string; boardUrl?: string }>
        const art = async (appUrl: string) => images((await renderEmail(React.cloneElement(element, { brand: AGENCY, appUrl, boardUrl: undefined }))).html)[1]
        expect(await art(AGENCY_APP)).toMatch(/^https:\/\/agents\.nordlys\.no\/email\//)
        expect(await art('http://localhost:3000')).toContain(`${ASSET_ORIGIN}/email/`)
    })
})
