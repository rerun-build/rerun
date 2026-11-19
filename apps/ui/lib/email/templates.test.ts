import { readdirSync } from 'node:fs'
import path from 'node:path'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { EMAIL_PREVIEWS, NEWSLETTERS, renderEmail, TONES, TrialEnded, theme } from '@moldwright/emails'

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

const NEWSLETTER_PREVIEW_PROPS = {
    appUrl: 'https://moldwright.robagentic.tech',
    unsubscribeUrl: 'https://moldwright.robagentic.tech/unsubscribe?token=test',
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
                billingUrl: 'https://moldwright.robagentic.tech/?billing=1',
                appUrl: 'https://moldwright.robagentic.tech',
                unsubscribeUrl: 'https://moldwright.robagentic.tech/unsubscribe?token=test',
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

    it.each(['fr', 'es', 'pt', 'de'] as const)('renders every preview in %s with no missing or broken message', async locale => {
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
        for (const preview of EMAIL_PREVIEWS) {
            const { html, text } = await renderEmail(React.cloneElement(preview.element as React.ReactElement<{ locale?: string }>, { locale }))
            expect(html, preview.id).toContain(`lang="${locale}"`)
            expect(text, preview.id).not.toMatch(/\bemails\.[a-zA-Z]/)
        }
        expect(errors).not.toHaveBeenCalled()
        errors.mockRestore()
    })
})
