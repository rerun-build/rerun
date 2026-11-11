import { conversationSections, glyphOf, stateOf } from '@/components/chat/conversation-sections'
import { systemSymbolOf } from '@/components/ui/system-symbols'

describe('conversation sections', () => {
    it('puts what waits on the person before what runs, then what finished unread', () => {
        expect(stateOf({ status: 'awaiting_approval', unseen: true })).toBe('needs-you')
        expect(stateOf({ status: 'error' })).toBe('needs-you')
        expect(stateOf({ status: 'working', unseen: true })).toBe('running')
        expect(stateOf({ status: 'idle', unseen: true })).toBe('new')
        expect(stateOf({ status: 'idle', unseen: false })).toBe('earlier')
    })

    it('folds a conversation without a known state under Earlier', () => {
        expect(stateOf({})).toBe('earlier')
        expect(glyphOf({})).toBeUndefined()
    })

    it('keeps only the sections that have a conversation, in order', () => {
        const { sections, earlier } = conversationSections([
            { id: 'a', status: 'idle' as const, unseen: true },
            { id: 'b', status: 'awaiting_question' as const },
            { id: 'c', status: 'idle' as const },
            { id: 'd', status: 'awaiting_ack' as const },
        ])

        expect(sections.map(section => [section.state, section.conversations.map(c => c.id)])).toEqual([
            ['needs-you', ['b', 'd']],
            ['new', ['a']],
        ])
        expect(earlier.map(c => c.id)).toEqual(['c'])
    })

    it('gives a waiting conversation the glyph of what it waits on', () => {
        expect(glyphOf({ status: 'awaiting_approval' })).toBe('shield-check-fill')
        expect(glyphOf({ status: 'working' })).toBe('refresh-cw')
    })

    it('gives every glyph an SF Symbol for the system menus', () => {
        const statuses = ['awaiting_question', 'awaiting_approval', 'awaiting_connector', 'awaiting_ack', 'waiting_human', 'error', 'working'] as const
        for (const status of statuses) expect(systemSymbolOf(glyphOf({ status })!)).toMatch(/^[a-z0-9.]+$/)
        expect(systemSymbolOf(glyphOf({ unseen: true })!)).toBe('circle.fill')
    })
})
