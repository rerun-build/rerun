import { activePageIndex, conversationPages, GENERAL_DRAFT_KEY, GENERAL_PAGE_ID } from '@/components/chat/conversation-pages'

describe('conversation pages', () => {
    it('follows the header tabs and ends on the draft', () => {
        expect(conversationPages(['a', 'b'], {}, 'new-1')).toEqual([
            { key: 'a', sessionId: 'a' },
            { key: 'b', sessionId: 'b' },
            { key: 'new-1', sessionId: null },
        ])
    })

    it('keeps the draft key on a conversation born from it', () => {
        expect(conversationPages(['a', 'c'], { c: 'new-1' }, 'new-2')).toEqual([
            { key: 'a', sessionId: 'a' },
            { key: 'new-1', sessionId: 'c' },
            { key: 'new-2', sessionId: null },
        ])
    })

    it('opens on the active conversation, or the draft', () => {
        const pages = conversationPages(['a', 'b'], {}, 'new-1')
        expect(activePageIndex(pages, 'b')).toBe(1)
        expect(activePageIndex(pages, null)).toBe(2)
        expect(activePageIndex(pages, 'gone')).toBe(2)
    })

    it('leads with General, and leaves it out of the threads that follow', () => {
        expect(conversationPages(['a', 'g', 'b'], {}, 'new-1', { sessionId: 'g' })).toEqual([
            { key: 'g', sessionId: 'g', general: true },
            { key: 'a', sessionId: 'a' },
            { key: 'b', sessionId: 'b' },
            { key: 'new-1', sessionId: null },
        ])
    })

    it('keeps the key of a General born on its own page', () => {
        expect(conversationPages(['a'], {}, 'new-1', { sessionId: null })[0]).toEqual({ key: GENERAL_DRAFT_KEY, sessionId: null, general: true })
        expect(conversationPages(['a'], { g: GENERAL_DRAFT_KEY }, 'new-1', { sessionId: 'g' })[0]).toEqual({ key: GENERAL_DRAFT_KEY, sessionId: 'g', general: true })
    })

    it('opens General by its id or before it has one', () => {
        const pages = conversationPages(['a'], {}, 'new-1', { sessionId: null })
        expect(activePageIndex(pages, GENERAL_PAGE_ID)).toBe(0)
        expect(activePageIndex(pages, 'a')).toBe(1)
        expect(activePageIndex(pages, null)).toBe(2)
        expect(activePageIndex(conversationPages([], {}, 'new-1', { sessionId: 'g' }), 'g')).toBe(0)
    })
})
