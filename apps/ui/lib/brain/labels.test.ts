import { englishTranslator } from '@/lib/i18n/english-translator'
import { loadMessages } from '@rerun/i18n/messages'
import { createTranslator } from 'use-intl'
import { describe, expect, it } from 'vitest'
import { brainAuthorLabel as authorIn, brainSlugify, brainSourceLabel as sourceIn, brainSourceLabels as sourcesIn } from './labels'

const english = englishTranslator('brain')
const french = createTranslator({ locale: 'fr', messages: await loadMessages('fr'), namespace: 'brain' })
const brainSourceLabel = (tag: string) => sourceIn(tag, english)
const brainSourceLabels = (tags: string[]) => sourcesIn(tags, english)
const brainAuthorLabel = (author: string) => authorIn(author, english)

describe('brainSourceLabel', () => {
    it('names the research tags in plain words', () => {
        expect(brainSourceLabel('site:pricing')).toBe('Pricing page')
        expect(brainSourceLabel('site:meta')).toBe('Website')
        expect(brainSourceLabel('site')).toBe('Website')
        expect(brainSourceLabel('linkedin:company')).toBe('LinkedIn page')
        expect(brainSourceLabel('google:business')).toBe('Google Business Profile')
        expect(brainSourceLabel('stack')).toBe('Website tools')
        expect(brainSourceLabel('site:catalog')).toBe('Product catalog')
        expect(brainSourceLabel('catalog')).toBe('Product catalog')
    })

    it('keeps every label as it read in English', () => {
        const labels = ['site:about', 'site:team', 'site:pricing', 'site:customers', 'site:product', 'site:legal', 'site:careers', 'site:contact', 'site:privacy', 'site:blog', 'dns', 'search', 'registry', 'linkedin', 'linkedin:person', 'google'].map(brainSourceLabel)
        expect(labels).toEqual(['About page', 'Team page', 'Pricing page', 'Customers page', 'Product page', 'Legal notice', 'Careers page', 'Contact page', 'Privacy policy', 'Blog', 'Email setup', 'Web search', 'Company registry', 'LinkedIn', 'Your LinkedIn', 'Google'])
    })

    it('names the sources in the reader\'s language and keeps a cited source as written', () => {
        expect(sourceIn('site:pricing', french)).toBe('Page Tarifs')
        expect(sourceIn('Call with Marie', french)).toBe('Call with Marie')
        expect(authorIn('seed', french)).toBe("Rerun, d'après votre site web")
    })

    it('shows a link by its host and path, shortened', () => {
        expect(brainSourceLabel('https://www.acme.com/blog/launch/')).toBe('acme.com/blog/launch')
        expect(brainSourceLabel('https://shop.acme.com/products/coussin-anti-chute-bebe-dragon-bleu-et-rose')).toBe('shop.acme.com/products/coussin-anti-chu…')
    })

    it('keeps a source it does not know as written', () => {
        expect(brainSourceLabel('Call with Marie')).toBe('Call with Marie')
    })
})

describe('brainSourceLabels', () => {
    it('merges tags that read the same', () => {
        expect(brainSourceLabels(['site:meta', 'stack', 'site:home', 'linkedin:company'])).toEqual(['Website', 'Website tools', 'LinkedIn page'])
        expect(brainSourceLabels(['site:catalog', 'catalog', 'Call with Marie', 'Call with Marie'])).toEqual(['Product catalog', 'Call with Marie'])
    })
})

describe('labels', () => {
    it('names the author of a page', () => {
        expect(brainAuthorLabel('seed')).toBe('Rerun, from your website')
        expect(brainAuthorLabel('agent:Sales')).toBe('Sales')
        expect(brainAuthorLabel('agent:foreman')).toBe('Chief of Staff')
        expect(brainAuthorLabel('user:ana@acme.com')).toBe('ana@acme.com')
        expect(brainAuthorLabel('user')).toBe('user')
    })

    it('turns a title into a page slug', () => {
        expect(brainSlugify('  Équipe & Fondateurs!! ')).toBe('equipe-fondateurs')
    })
})
