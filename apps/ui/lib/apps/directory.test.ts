import { describe, expect, it, vi } from 'vitest'
import { APP_INFO, APP_LIST_TOOLS, APP_RUN_TOOL } from './catalog'
import { listedTools, readDirectory, resolveRunTool } from './directory'
import { LINKEDIN_SCOPES, LINKEDIN_TOOLS } from './linkedin/tools'
import { WHATSAPP_SCOPES, WHATSAPP_TOOLS } from './whatsapp/tools'

vi.mock('@/lib/apps/linkup/client', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/apps/linkup/client')>()), runFlatEndpoint: vi.fn(), runAction: vi.fn() }))

const linkedin = { ...APP_INFO.linkedin, tools: LINKEDIN_TOOLS, scopes: LINKEDIN_SCOPES }
const whatsapp = { ...APP_INFO.whatsapp, tools: WHATSAPP_TOOLS, scopes: WHATSAPP_SCOPES }

const loadedNames = (app: typeof linkedin | typeof whatsapp) => listedTools(app).map(tool => tool.name)

describe('the tools a paid app loads on every run', () => {
    it('keeps every LinkedIn tool coworkers already had, and the lookup its search filters need', () => {
        expect(loadedNames(linkedin)).toEqual([
            'get_my_profile',
            'get_profile',
            'search_people',
            'typeahead',
            'send_invitation',
            'check_invitation',
            'withdraw_invitation',
            'list_received_invitations',
            'accept_invitation',
            'list_sent_invitations',
            'send_message',
            'list_conversations',
            'get_conversation',
            'react_to_post',
            'comment_on_post',
            'create_post',
            'download_attachment',
            APP_LIST_TOOLS,
            APP_RUN_TOOL,
        ])
    })

    it('keeps every WhatsApp tool coworkers already had', () => {
        expect(loadedNames(whatsapp)).toEqual(['get_my_profile', 'check_numbers', 'list_conversations', 'get_conversation', 'send_message', 'post_status', 'download_attachment', APP_LIST_TOOLS, APP_RUN_TOOL])
    })

    it.each([linkedin, whatsapp])('names every scope of $name in the directory tool, with its size and the seat it needs', app => {
        const directory = listedTools(app).find(tool => tool.name === APP_LIST_TOOLS)!
        for (const [scope, { requires }] of Object.entries<{ summary: string; requires?: string }>(app.scopes)) {
            const size = app.tools.filter(tool => tool.scope === scope).length
            expect(size).toBeGreaterThan(0)
            expect(directory.description).toContain(`- ${scope} (${size} tools${requires ? `, needs ${requires}` : ''})`)
        }
        expect(directory.inputSchema.properties.scope.enum).toEqual(Object.keys(app.scopes))
    })

    // A tool a description names with the server prefix is one the coworker can call as such.
    it.each([linkedin, whatsapp])('only cites by its loaded name a tool of $name that is loaded', app => {
        const loaded = new Set(loadedNames(app).map(name => `${app.serverName}_${name}`))
        const cited = JSON.stringify([app.tools, app.scopes, listedTools(app)]).match(new RegExp(`${app.serverName}_[a-z_]+`, 'g')) ?? []
        expect(cited.filter(name => !loaded.has(name))).toEqual([])
    })
})

describe('reading the directory', () => {
    it('gives the tools of a scope with their parameters, and how to run them', () => {
        const scope = readDirectory(linkedin, 'sales_navigator')
        expect(scope).toMatchObject({ scope: 'sales_navigator', requires: 'a Sales Navigator seat', run_with: expect.stringContaining('linkedin_pro_run_tool') })
        const tools = 'tools' in scope ? scope.tools : []
        expect(tools).toHaveLength(16)
        expect(tools.find(tool => tool.name === 'sales_nav_create_list')).toEqual({
            name: 'sales_nav_create_list',
            description: expect.stringContaining('Create an empty lead or account list'),
            inputSchema: expect.objectContaining({ type: 'object' }),
        })
    })

    it('lists the scopes when none is asked, and says so when the one asked does not exist', () => {
        const all = readDirectory(whatsapp, undefined)
        expect(all).toMatchObject({ scopes: [{ scope: 'messages', tools: 8 }, { scope: 'chats', tools: 4 }, { scope: 'groups', tools: 6 }] })
        expect(all).not.toHaveProperty('error')
        expect(readDirectory(whatsapp, 'recruiter')).toMatchObject({ error: 'Unknown scope "recruiter".', scopes: expect.any(Array) })
    })
})

describe('running a tool by its name', () => {
    it('finds the tool with or without the server prefix', () => {
        const args = { profile_url: 'https://www.linkedin.com/in/jane-doe' }
        for (const tool of ['visit_profile', 'linkedin_pro_visit_profile']) {
            expect(resolveRunTool(linkedin, { tool, arguments: args })).toEqual({ tool: LINKEDIN_TOOLS.find(candidate => candidate.name === 'visit_profile'), args })
        }
    })

    it('takes the arguments as a JSON string, or laid beside the tool name', () => {
        const args = { profile_url: 'https://www.linkedin.com/in/jane-doe' }
        expect(resolveRunTool(linkedin, { tool: 'visit_profile', arguments: JSON.stringify(args) })).toMatchObject({ args })
        expect(resolveRunTool(linkedin, { tool: 'visit_profile', ...args })).toMatchObject({ args })
    })

    it('runs a loaded tool too', () => {
        expect(resolveRunTool(whatsapp, { tool: 'check_numbers', arguments: { phone_numbers: ['+33612345678'] } })).toMatchObject({ tool: { name: 'check_numbers' } })
    })

    it('refuses a tool the app does not have, pointing at the directory', () => {
        expect(resolveRunTool(linkedin, { tool: 'delete_account' })).toEqual({
            refusal: 'Unknown tool "delete_account". Nothing was run. Read a scope with linkedin_pro_list_tools for its tool names: profiles, network, posts, messages, company_pages, groups_events, sales_navigator, recruiter.',
        })
        expect(resolveRunTool(linkedin, { tool: APP_RUN_TOOL })).toHaveProperty('refusal')
        expect(resolveRunTool(whatsapp, {})).toEqual({ refusal: 'No tool was named. Nothing was run. Read a scope with whatsapp_pro_list_tools for its tool names: messages, chats, groups.' })
    })

    it('refuses a parameter the tool does not take instead of dropping it', () => {
        expect(resolveRunTool(linkedin, { tool: 'visit_profile', arguments: { profile_url: 'https://www.linkedin.com/in/jane-doe', note: 'Hi' } })).toEqual({
            refusal: 'visit_profile has no parameter note. Nothing was run. It takes profile_url (required).',
        })
    })

    it('refuses a call that misses a required parameter, or whose arguments are not an object', () => {
        expect(resolveRunTool(linkedin, { tool: 'visit_profile', arguments: {} })).toEqual({ refusal: 'Missing profile_url. Nothing was run. It takes profile_url (required).' })
        expect(resolveRunTool(linkedin, { tool: 'visit_profile', arguments: 'jane-doe' })).toEqual({ refusal: 'The arguments of visit_profile must be an object. Nothing was run. It takes profile_url (required).' })
        expect(resolveRunTool(whatsapp, { tool: 'get_my_profile', arguments: { phone_number: '+33612345678' } })).toEqual({
            refusal: 'get_my_profile has no parameter phone_number. Nothing was run. It takes no parameter.',
        })
    })
})
