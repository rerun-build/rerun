import { describe, expect, it, vi } from 'vitest'
import { runFlatEndpoint } from '@/lib/apps/linkup/client'
import { missingRequired, toolParams } from '@/lib/apps/tools'
import { LINKEDIN_TOOLS, linkedinTool } from './tools'

vi.mock('@/lib/apps/linkup/client', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/apps/linkup/client')>()), runFlatEndpoint: vi.fn() }))

describe('the LinkedIn tool set', () => {
    it('never hands the coworker a login, a deletion or a webhook', () => {
        const actions = LINKEDIN_TOOLS.map(tool => tool.action)
        expect(actions).not.toContain('login')
        expect(actions.some(action => /delete|webhook/.test(action))).toBe(false)
        expect(new Set(LINKEDIN_TOOLS.map(tool => tool.name)).size).toBe(LINKEDIN_TOOLS.length)
    })

    it('meters every action LinkedIn could restrict the account for', () => {
        for (const name of ['send_invitation', 'send_message', 'get_profile', 'search_people', 'comment_on_post']) {
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
