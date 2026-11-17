import type { BoardAgent } from '@rerun/contracts'

import { insertAtCaret, insertMention, mentionAgentsOf, mentionItems, mentionQueryAt, mentionText, type MentionAgent } from './mentions'

const agents: MentionAgent[] = [
    { id: 'b', name: 'Bob', handle: 'sales-bob' },
    { id: 'a', name: 'Alice', handle: 'alice', hint: 'Ops' },
    { id: 'z', name: 'Zed', handle: null, preferred: true },
]
const skills = [
    { slug: 'weekly-report', name: 'Weekly report', description: '' },
    { slug: 'cold-email', name: 'Cold email', description: '' },
]

describe('mentionQueryAt', () => {
    it('opens on a trigger at the start or after a space', () => {
        expect(mentionQueryAt('/wee', 4)).toEqual({ trigger: '/', query: 'wee', start: 0 })
        expect(mentionQueryAt('ask @al', 7)).toEqual({ trigger: '@', query: 'al', start: 4 })
    })

    it('stays closed inside a word, a path or past a space', () => {
        expect(mentionQueryAt('mail@x', 6)).toBeNull()
        expect(mentionQueryAt('src/app', 7)).toBeNull()
        expect(mentionQueryAt('@alice ', 7)).toBeNull()
    })

    it('reads only what is before the caret', () => {
        expect(mentionQueryAt('hi @bo there', 6)).toEqual({ trigger: '@', query: 'bo', start: 3 })
    })
})

describe('mentionItems', () => {
    it('filters skills on name or slug, sorted by name', () => {
        expect(mentionItems({ trigger: '/', query: '', start: 0 }, agents, skills).map(item => item.name)).toEqual(['Cold email', 'Weekly report'])
        expect(mentionItems({ trigger: '/', query: 'weekly-', start: 0 }, agents, skills).map(item => item.name)).toEqual(['Weekly report'])
    })

    it('filters coworkers on name, handle or Box, the preferred first', () => {
        expect(mentionItems({ trigger: '@', query: '', start: 0 }, agents, skills).map(item => item.name)).toEqual(['Zed', 'Alice', 'Bob'])
        expect(mentionItems({ trigger: '@', query: 'sales', start: 0 }, agents, skills).map(item => item.name)).toEqual(['Bob'])
        expect(mentionItems({ trigger: '@', query: 'ops', start: 0 }, agents, skills).map(item => item.name)).toEqual(['Alice'])
    })
})

describe('insertMention', () => {
    it('replaces the query with the token and a space, the caret after it', () => {
        const text = 'run /wee now'
        const mention = mentionQueryAt(text, 8)!
        expect(insertMention(text, 8, mention, { kind: 'skill', ...skills[0] })).toEqual({ text: 'run /weekly-report  now', caret: 19 })
    })

    it('falls back on the name for a coworker without a handle', () => {
        expect(insertMention('@z', 2, mentionQueryAt('@z', 2)!, { kind: 'agent', ...agents[2] }).text).toBe('@Zed ')
    })
})

describe('insertAtCaret', () => {
    it('spaces the token from the word before it', () => {
        expect(insertAtCaret('please', 6, '/cold-email')).toEqual({ text: 'please /cold-email ', caret: 19 })
        expect(insertAtCaret('', 0, '/cold-email')).toEqual({ text: '/cold-email ', caret: 12 })
    })
})

describe('mentionAgentsOf', () => {
    const board = (id: string, spaceId: string, disabledAt: string | null = null): BoardAgent => ({ id, name: id, handle: id, description: null, templateId: null, status: 'idle', workspaceId: 1, spaceId, disabledAt, disabledReason: null })

    it('leaves out the coworker itself and the switched off, names the other Boxes', () => {
        const list = mentionAgentsOf([board('self', 's1'), board('mate', 's1'), board('far', 's2'), board('off', 's1', '2026-01-01')], [{ id: 's2', name: 'Ops', createdAt: null, managed: true }], 'self')
        expect(list).toEqual([
            { id: 'mate', name: 'mate', handle: 'mate', hint: undefined, preferred: true },
            { id: 'far', name: 'far', handle: 'far', hint: 'Ops', preferred: false },
        ])
    })
})

describe('# and the linked computers', () => {
    const computers = [
        { id: 'c1', name: 'Studio PC', handle: 'studio-pc', online: true },
        { id: 'c2', name: 'Old laptop', handle: 'old-laptop', online: false },
        { id: 'c3', name: 'Render box', handle: 'render-box', online: true },
    ]

    it('opens on # typed at the start of a word, and filters by name or handle, online first', () => {
        const query = mentionQueryAt('Encode it on #', 14)!
        expect(query).toEqual({ trigger: '#', query: '', start: 13 })
        expect(mentionItems(query, [], [], computers).map(item => mentionText(item))).toEqual(['#render-box', '#studio-pc', '#old-laptop'])
        expect(mentionItems(mentionQueryAt('on #stu', 7)!, [], [], computers).map(item => mentionText(item))).toEqual(['#studio-pc'])
    })

    it('stays closed for a hashtag that names no computer, and inside a word', () => {
        expect(mentionItems(mentionQueryAt('Post with #marketing', 20)!, [], [], computers)).toEqual([])
        expect(mentionQueryAt('issue#12', 8)).toBeNull()
    })

    it('writes #handle and a space in place of what was typed', () => {
        const query = mentionQueryAt('Run on #ren please', 11)!
        const [item] = mentionItems(query, [], [], computers)
        expect(insertMention('Run on #ren please', 11, query, item)).toEqual({ text: 'Run on #render-box  please', caret: 19 })
    })
})
