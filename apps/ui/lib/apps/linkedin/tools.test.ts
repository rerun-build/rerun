import { describe, expect, it, vi } from 'vitest'
import * as engine from '@/lib/engine/client'
import { runAction, runFlatEndpoint } from '@/lib/apps/linkup/client'
import { missingRequired, toolParams } from '@/lib/apps/tools'
import { LINKEDIN_TOOLS, linkedinTool } from './tools'

vi.mock('@/lib/apps/linkup/client', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/apps/linkup/client')>()), runFlatEndpoint: vi.fn(), runAction: vi.fn() }))
vi.mock('@/lib/engine/client', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/engine/client')>()), supportsStreamedUploads: vi.fn(), uploadFileStream: vi.fn() }))

describe('the LinkedIn tool set', () => {
    it('never hands the coworker the account itself: no login, no checkpoint, no account deletion, no webhook', () => {
        for (const tool of LINKEDIN_TOOLS) {
            expect(tool.action).not.toMatch(/login|checkpoint|account|webhook/)
            expect(['profiles', 'network', 'messages', 'content', 'recruiter', 'jobs']).toContain(tool.category)
        }
        expect(new Set(LINKEDIN_TOOLS.map(tool => tool.name)).size).toBe(LINKEDIN_TOOLS.length)
    })

    it('meters every action LinkedIn could restrict the account for', () => {
        for (const name of ['send_invitation', 'send_message', 'get_profile', 'search_people', 'comment_on_post', 'visit_profile', 'follow', 'answer_comment', 'repost', 'create_post', 'search_jobs', 'apply_to_job']) {
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
    it('invites to an event without spending the connection invitations of the day', () => {
        const invite = linkedinTool('invite_to_event')!
        expect([invite.category, invite.action, invite.quota]).toEqual(['network', 'invite_to_event', undefined])
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

describe('Sales Navigator', () => {
    const salesNavTools = LINKEDIN_TOOLS.filter(tool => tool.name.startsWith('sales_nav_'))

    it('tells the coworker every Sales Navigator tool needs a seat', () => {
        expect(salesNavTools.length).toBeGreaterThan(10)
        for (const tool of salesNavTools) expect(tool.description).toMatch(/^Needs a Sales Navigator seat\./)
    })

    it('meters a lead search per result and passes its filters through', () => {
        const search = linkedinTool('sales_nav_search_people')!
        expect(search.quota?.action).toBe('search_result')
        const filters = { seniority_level: ['Director', 'CXO'], geography: ['DACH'], exclude: { industry: ['Banking'] }, ignored: true }
        expect(toolParams(search, filters)).toEqual({ seniority_level: ['Director', 'CXO'], geography: ['DACH'], exclude: { industry: ['Banking'] }, count: 10 })
    })

    it('saves a search with the filters of either search', () => {
        const save = linkedinTool('sales_nav_save_search')!
        expect(toolParams(save, { name: 'CTOs', type: 'people', current_title: ['CTO'], company_headcount: ['51-200'] })).toEqual({
            name: 'CTOs',
            type: 'people',
            current_title: ['CTO'],
            company_headcount: ['51-200'],
        })
    })

    it('reads the InMail balance from its own endpoint', async () => {
        vi.mocked(runFlatEndpoint).mockResolvedValueOnce({ inmail_credits: 12 })
        await linkedinTool('sales_nav_inmail_balance')!.run!({ slug: 'linkedin', accountId: 'acc-1', connectionId: 'c', engineAgentId: 'a', engine: vi.fn() }, {})
        expect(runFlatEndpoint).toHaveBeenCalledWith('acc-1', 'balance', { action: 'get' })
    })

    it('reads and answers the Sales Navigator inbox through the classic tools', () => {
        for (const name of ['get_profile', 'list_conversations', 'get_conversation', 'send_message']) {
            expect(Object.keys(linkedinTool(name)!.inputSchema.properties)).toContain('sales_nav')
        }
    })
})

describe('Recruiter', () => {
    const context = { slug: 'linkedin' as const, accountId: 'acc-1', connectionId: 'c', engineAgentId: 'a', engine: vi.fn() }

    it('tells the coworker every Recruiter tool needs a seat', () => {
        const recruiterTools = LINKEDIN_TOOLS.filter(tool => tool.name.startsWith('recruiter_'))
        expect(recruiterTools.length).toBeGreaterThan(15)
        for (const tool of recruiterTools) expect(tool.description).toMatch(/^Needs a LinkedIn Recruiter seat\./)
    })

    it('sets the Recruiter flag itself on the classic actions it reuses', async () => {
        vi.mocked(runAction).mockResolvedValue({})
        await linkedinTool('recruiter_send_inmail')!.run!(context, { recipient_urn: 'urn:li:ts_profile:1', subject: 'Role', message_text: 'Hi' })
        expect(runAction).toHaveBeenLastCalledWith('acc-1', 'messages', 'send', { recipient_urn: 'urn:li:ts_profile:1', subject: 'Role', message_text: 'Hi', recruiter: true })
        await linkedinTool('recruiter_get_candidate')!.run!(context, { profile_urn: 'urn:li:ts_profile:1' })
        expect(runAction).toHaveBeenLastCalledWith('acc-1', 'profiles', 'get', { profile_urn: 'urn:li:ts_profile:1', recruiter: true })
    })

    it('saves the CV of an applicant into the files instead of answering its bytes', async () => {
        vi.mocked(engine.supportsStreamedUploads).mockResolvedValue(true)
        vi.mocked(engine.uploadFileStream).mockImplementation(async (_conn, _base, input) => ({ path: `${input.dir}/${input.name}`, bytes: (await new Response(input.body).arrayBuffer()).byteLength }))
        const content = Buffer.from('%PDF-1.4 cv').toString('base64')
        vi.mocked(runAction).mockResolvedValueOnce({ application_id: '269', candidate: { name: 'Jane Doe' }, cv: { content, encoding: 'base64', filename: 'Jane_Doe_CV.pdf', content_type: 'application/pdf', size_bytes: 11 } })

        const answer = await linkedinTool('recruiter_get_cv')!.run!(context, { application_id: '269' })

        expect(runAction).toHaveBeenLastCalledWith('acc-1', 'recruiter', 'get_cv', { application_id: '269' })
        expect(answer).toEqual({
            application_id: '269',
            candidate: { name: 'Jane Doe' },
            cv: { filename: 'Jane_Doe_CV.pdf', content_type: 'application/pdf', size: 11, path: expect.stringMatching(/^attachments\/linkedin\/\d{8}-\d{6}-Jane_Doe_CV\.pdf$/) },
        })
        expect(JSON.stringify(answer)).not.toContain(content)
    })

    it('says so when the CV could not be saved, still without its bytes', async () => {
        vi.mocked(engine.supportsStreamedUploads).mockResolvedValue(false)
        const content = Buffer.from('%PDF-1.4 cv').toString('base64')
        vi.mocked(runAction).mockResolvedValueOnce({ application_id: '269', cv: { content, filename: 'Jane_Doe_CV.pdf', content_type: 'application/pdf' } })

        const answer = await linkedinTool('recruiter_get_cv')!.run!(context, { application_id: '269' })

        expect(answer).toEqual({ application_id: '269', cv: { filename: 'Jane_Doe_CV.pdf', content_type: 'application/pdf', size: 11, fileError: 'Your machine is updating and cannot take the file yet.' } })
    })

    it('meters InMails, candidate views and searches', () => {
        expect(linkedinTool('recruiter_send_inmail')?.quota?.action).toBe('message')
        expect(linkedinTool('recruiter_get_candidate')?.quota?.action).toBe('profile_view')
        expect(linkedinTool('recruiter_search_people')?.quota?.action).toBe('search_result')
    })

    it('runs jobs and projects on the recruiter endpoint', () => {
        for (const name of ['recruiter_list_jobs', 'recruiter_create_job', 'recruiter_move_candidate']) expect(linkedinTool(name)?.category).toBe('recruiter')
        expect(missingRequired(linkedinTool('recruiter_create_job')!, { title: 'CTO' })).toEqual(['company_url', 'place', 'html_description'])
    })
})

describe('LinkedIn jobs', () => {
    it('reads job postings on the jobs endpoint, apart from the Recruiter postings', () => {
        expect(['search_jobs', 'get_job', 'get_job_apply_form', 'apply_to_job'].map(name => [linkedinTool(name)?.category, linkedinTool(name)?.action, linkedinTool(name)?.scope])).toEqual([
            ['jobs', 'search', 'jobs'],
            ['jobs', 'get', 'jobs'],
            ['jobs', 'get_apply_form', 'jobs'],
            ['jobs', 'apply', 'jobs'],
        ])
    })

    it('counts every job a search returns, a hundred at most per page', () => {
        const search = linkedinTool('search_jobs')!
        expect(toolParams(search, { keywords: 'account executive', location: 'Paris', count: 500 })).toEqual({ keywords: 'account executive', location: 'Paris', count: 100 })
        expect(toolParams(search, { keywords: 'designer' })).toEqual({ keywords: 'designer', count: 10 })
        expect(search.quota?.action).toBe('search_result')
        expect(search.quota?.amount?.({ count: 40 })).toBe(40)
    })

    it('applies to one job at a time, against its own daily limit', () => {
        const apply = linkedinTool('apply_to_job')!
        expect(apply.quota?.action).toBe('job_application')
        expect(missingRequired(apply, toolParams(apply, { answers: { q1: '5' } }))).toEqual(['job_id'])
        expect(toolParams(apply, { job_id: '4178681638', answers: { q1: '5' }, account_id: 'someone-else' })).toEqual({ job_id: '4178681638', answers: { q1: '5' } })
    })

    it('reads a job and its form for free', () => {
        expect(linkedinTool('get_job')?.quota).toBeUndefined()
        expect(linkedinTool('get_job_apply_form')?.quota).toBeUndefined()
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
