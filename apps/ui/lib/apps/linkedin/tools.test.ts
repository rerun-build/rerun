import { describe, expect, it, vi } from 'vitest'
import { runFlatEndpoint } from '@/lib/apps/linkup/client'
import { missingRequired, toolParams } from '@/lib/apps/tools'
import { LINKEDIN_TOOLS, linkedinTool } from './tools'

vi.mock('@/lib/apps/linkup/client', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/apps/linkup/client')>()), runFlatEndpoint: vi.fn() }))

describe('the LinkedIn tool set', () => {
    it('never hands the coworker the account itself: no login, no checkpoint, no account deletion, no webhook', () => {
        for (const tool of LINKEDIN_TOOLS) {
            expect(tool.action).not.toMatch(/login|checkpoint|account|webhook/)
            expect(['profiles', 'network', 'messages', 'content']).toContain(tool.category)
        }
        expect(new Set(LINKEDIN_TOOLS.map(tool => tool.name)).size).toBe(LINKEDIN_TOOLS.length)
    })

    it('meters every action LinkedIn could restrict the account for', () => {
        for (const name of ['send_invitation', 'send_message', 'get_profile', 'search_people', 'comment_on_post', 'visit_profile', 'invite_to_event', 'follow', 'answer_comment', 'repost', 'create_post']) {
            expect(linkedinTool(name)?.quota).toBeDefined()
        }
    })
})

describe('reading LinkedIn', () => {
    it('scrolls the home feed page by page', () => {
        const feed = linkedinTool('read_feed')!
        expect([feed.category, feed.action, feed.quota]).toEqual(['content', 'get_feed', undefined])
        expect(toolParams(feed, { cursor: 'abc', count: 5000 })).toEqual({ cursor: 'abc', count: 100 })
    })

    it('lists the connections up to the page Linkup allows', () => {
        const connections = linkedinTool('list_connections')!
        expect([connections.category, connections.action]).toEqual(['network', 'list_connections'])
        expect(toolParams(connections, {})).toEqual({ count: 50 })
        expect(toolParams(connections, { count: 4000, offset: 1000 })).toEqual({ count: 1000, offset: 1000 })
    })

    it('tells a profile action from the post action of the same Linkup name', () => {
        expect([linkedinTool('get_profile_comments')?.category, linkedinTool('get_profile_comments')?.action]).toEqual(['profiles', 'get_comments'])
        expect([linkedinTool('get_post_comments')?.category, linkedinTool('get_post_comments')?.action]).toEqual(['content', 'get_comments'])
        expect(missingRequired(linkedinTool('get_post_comments')!, {})).toEqual(['post_url'])
    })

    it('counts a post search and a contact lookup against the account', () => {
        expect(linkedinTool('search_posts')?.quota?.action).toBe('search_result')
        expect(linkedinTool('search_posts')?.quota?.amount?.({ count: 40 })).toBe(40)
        expect(linkedinTool('get_contact_info')?.quota?.action).toBe('profile_view')
    })

    it('resolves typeahead ids through its own endpoint', async () => {
        const typeahead = linkedinTool('typeahead')!
        expect(toolParams(typeahead, { type: 'company', keyword: 'Stripe', limit: 500 })).toEqual({ type: 'company', keyword: 'Stripe', limit: 100 })
        vi.mocked(runFlatEndpoint).mockResolvedValueOnce({ items: [] })
        await typeahead.run!({ slug: 'linkedin', accountId: 'acc-1', connectionId: 'c', engineAgentId: 'a', engine: vi.fn() }, { type: 'company', keyword: 'Stripe', limit: 10 })
        expect(runFlatEndpoint).toHaveBeenCalledWith('acc-1', 'typeahead', { type: 'company', keyword: 'Stripe', limit: 10 })
    })
})

describe('acting on LinkedIn', () => {
    it('counts an event invitation once per person invited', () => {
        const invite = linkedinTool('invite_to_event')!
        expect(invite.quota?.action).toBe('invitation')
        expect(invite.quota?.amount?.({ profiles: ['a', 'b', 'c'] })).toBe(3)
        expect(missingRequired(invite, toolParams(invite, { event_url: 'https://www.linkedin.com/events/1' }))).toEqual(['profiles'])
    })

    it('replies in a conversation or sends an InMail with only the text required', () => {
        const send = linkedinTool('send_message')!
        expect(missingRequired(send, toolParams(send, { conversation_id: '2-abc', message_text: 'Thanks' }))).toEqual([])
        expect(toolParams(send, { profile_url: 'https://www.linkedin.com/in/jane', message_text: 'Hi', subject: 'Intro', inmail: true })).toEqual({
            profile_url: 'https://www.linkedin.com/in/jane',
            message_text: 'Hi',
            subject: 'Intro',
            inmail: true,
        })
    })

    it('publishes a post with a file and no text', () => {
        const post = linkedinTool('create_post')!
        expect(missingRequired(post, toolParams(post, { file: 'https://example.com/deck.pdf', document_title: 'Deck' }))).toEqual([])
    })

    it('edits and unsends the messages the user sent', () => {
        expect([linkedinTool('edit_message')?.action, linkedinTool('delete_message')?.action, linkedinTool('react_to_message')?.action]).toEqual(['edit_message', 'delete_message', 'react_message'])
        expect(missingRequired(linkedinTool('delete_message')!, {})).toEqual(['message_id'])
    })

    it('passes profile edits through whole', () => {
        const update = linkedinTool('update_my_profile')!
        const experience = [{ title: 'Founder', company: 'Rerun', start_date: '2024-01', is_current: true }]
        expect(toolParams(update, { headline: 'Building Rerun', experience, skills: { add: ['AI'] } })).toEqual({ headline: 'Building Rerun', experience, skills: { add: ['AI'] } })
    })
})

describe('company pages', () => {
    it('reads and searches company pages', () => {
        expect([linkedinTool('get_company')?.category, linkedinTool('get_company')?.action]).toEqual(['profiles', 'get_company'])
        expect(linkedinTool('search_companies')?.quota?.action).toBe('search_result')
    })

    it('posts on a page, metered like a post of the user', () => {
        const post = linkedinTool('create_company_post')!
        expect([post.category, post.action, post.quota?.action]).toEqual(['content', 'create_company', 'post'])
        expect(missingRequired(post, toolParams(post, { message: 'We are hiring' }))).toEqual(['company_url'])
    })

    it('reacts, comments and reposts as a page it is given', () => {
        for (const name of ['react_to_post', 'comment_on_post', 'repost']) {
            expect(Object.keys(linkedinTool(name)!.inputSchema.properties)).toContain('company_url')
        }
    })
})

describe('toolParams', () => {
    it('drops what the tool does not declare and caps the page size', () => {
        const search = linkedinTool('search_people')!
        expect(toolParams(search, { title: 'CEO', count: 500, account_id: 'someone-else' })).toEqual({ title: 'CEO', count: 50 })
        expect(toolParams(search, { title: 'CEO' })).toEqual({ title: 'CEO', count: 10 })
    })

    it('reports what a call is missing', () => {
        const invite = linkedinTool('send_invitation')!
        expect(missingRequired(invite, toolParams(invite, { message: 'Hi' }))).toEqual(['profile_url'])
    })
})
