import type { BrainFileMeta, BrainPageSummary } from '@rerun/contracts'
import { describe, expect, it } from 'vitest'
import { addedByOf, allTags, boxOfItem, coworkerOfAuthor, fileMetaOf, filesOfBox, pagesOfBox } from './items'

const boxes = [
    { id: 'sales', name: 'Sales' },
    { id: 'support', name: null },
]
const page = (slug: string, spaceId: string | null, extra: Partial<BrainPageSummary> = {}): BrainPageSummary => ({ slug, title: slug, type: 'note', hash: slug, updatedAt: '', updatedBy: 'user:theo', tags: [], createdBy: null, spaceId, ...extra })
const file = (path: string, spaceId: string | null, tags: string[] = []): BrainFileMeta => ({ path, kind: 'file', tags, createdBy: 'user:theo', spaceId, createdAt: '' })

describe('filing in the Brain', () => {
    it('reads an item filed under a Box the person cannot open, or one deleted, as filed for everyone', () => {
        expect(boxOfItem('sales', boxes)).toEqual({ id: 'sales', name: 'Sales' })
        expect(boxOfItem('private', boxes)).toBeNull()
        expect(boxOfItem(null, boxes)).toBeNull()
        const pages = [page('acme', 'sales'), page('mission', null), page('board-notes', 'private')]
        expect(pagesOfBox(null, pages, boxes).map(p => p.slug)).toEqual(['mission', 'board-notes'])
        expect(pagesOfBox('sales', pages, boxes).map(p => p.slug)).toEqual(['acme'])
    })

    it('names the coworker behind an agent author, and falls back to the last author for an old page', () => {
        const coworkers = [{ id: 'a1', name: 'Lead Finder', handle: 'lead-finder', spaceId: 'sales' }]
        expect(coworkerOfAuthor('agent:lead-finder', coworkers)).toEqual(coworkers[0])
        expect(coworkerOfAuthor('user:theo', coworkers)).toBeNull()
        expect(addedByOf(page('x', null, { createdBy: 'agent:lead-finder' }))).toBe('agent:lead-finder')
        expect(addedByOf(page('x', null))).toBe('user:theo')
    })

    it('lists an imported folder under its Box once, not each file inside it', () => {
        const files = [file('brand-kit', 'marketing'), file('brand-kit/logo.svg', 'marketing'), file('brand-kit/fonts/Inter.ttf', 'marketing'), file('keywords.xlsx', 'marketing'), file('brand-kit/old.png', 'sales')]
        expect(filesOfBox('marketing', files).map(f => f.path)).toEqual(['brand-kit', 'keywords.xlsx'])
        expect(filesOfBox('sales', files).map(f => f.path)).toEqual(['brand-kit/old.png'])
    })

    it('gives a file with no filing of its own the filing of the folder it came in', () => {
        const files = [file('brand-kit', 'marketing', ['brand']), file('brand-kit/logo.svg', 'sales')]
        expect(fileMetaOf('brand-kit/fonts/Inter.ttf', files)).toMatchObject({ path: 'brand-kit', tags: ['brand'] })
        expect(fileMetaOf('brand-kit/logo.svg', files)).toMatchObject({ spaceId: 'sales' })
        expect(fileMetaOf('elsewhere.txt', files)).toBeNull()
    })

    it('gathers every tag once, sorted', () => {
        expect(allTags([page('a', null, { tags: ['pricing', 'acme'] })], [file('f', null, ['acme', 'faq'])])).toEqual(['acme', 'faq', 'pricing'])
    })
})
