import { toolLabelOf, type ToolCopy } from '@rerun/contracts'
import { describe, expect, it } from 'vitest'
import { agentIdOf, toolHeadline } from './tool-headline'

const AGENT_ID = 'f0fee808-1a9d-4f71-95d9-86d8f4fbc505'

describe('toolHeadline', () => {
    it('prefers a known argument over anything else', () => {
        expect(toolHeadline({ agentId: AGENT_ID, query: 'pricing page' }, 'Scout')).toBe('pricing page')
    })

    it('shows the agent name in place of its id', () => {
        expect(toolHeadline({ agentId: AGENT_ID }, 'Scout')).toBe('Scout')
        expect(toolHeadline({ agentId: AGENT_ID, message: 'Draft the recap' }, 'Scout')).toBe('Scout')
    })

    it('skips the id when the agent is unknown', () => {
        expect(toolHeadline({ agentId: AGENT_ID, message: 'Draft the recap' })).toBe('Draft the recap')
    })

    it('shows nothing when the input only holds ids', () => {
        expect(toolHeadline({ agentId: AGENT_ID, sessionId: AGENT_ID.toUpperCase() })).toBeUndefined()
    })

    it('never surfaces an id passed as a known argument', () => {
        expect(toolHeadline({ query: AGENT_ID, tab: 'chat' })).toBe('chat')
    })

    it('shows what a paid_data call looked up, not the capability its label already names', () => {
        expect(toolHeadline({ capability: 'tiktok.user.profile', params: { username: 'khaby.lame' } })).toBe('khaby.lame')
    })

    it('shows what a tool run by name was given, not the name its label already carries', () => {
        expect(toolHeadline({ tool: 'sales_nav_search_people', arguments: { keyword: 'CTO', geography: ['Paris'] } })).toBe('CTO')
        expect(toolHeadline({ tool: 'sales_nav_inmail_balance', arguments: {} })).toBeUndefined()
    })

    it('ignores an input that is not an object', () => {
        expect(toolHeadline(undefined)).toBeUndefined()
        expect(toolHeadline('plain text')).toBeUndefined()
    })
})

describe('agentIdOf', () => {
    it('reads the agent id off the input', () => {
        expect(agentIdOf({ agentId: AGENT_ID })).toBe(AGENT_ID)
    })

    it('returns nothing without a string agent id', () => {
        expect(agentIdOf({ agentId: 42 })).toBeUndefined()
        expect(agentIdOf(undefined)).toBeUndefined()
    })
})

// The label the mobile app and the web fallback share, when no installed connector names the step.
describe('toolLabelOf for a tool an app runs from its directory', () => {
    const t: ToolCopy = key => key

    it('names the step after the tool that ran, under the server of the call', () => {
        expect(toolLabelOf('linkedin_pro_run_tool', { tool: 'sales_nav_search_people', arguments: { keyword: 'CTO' } }, t)).toBe('Linkedin Pro Sales Nav Search People')
        expect(toolLabelOf('mcp__linkedin_pro__run_tool', { tool: 'linkedin_pro_recruiter_list_jobs' }, t)).toBe('Linkedin Pro Recruiter List Jobs')
    })

    it('keeps the name of the call while its input has not streamed in, and of every other tool', () => {
        expect(toolLabelOf('linkedin_pro_run_tool', undefined, t)).toBe('Linkedin Pro Run Tool')
        expect(toolLabelOf('linkedin_pro_get_profile', { tool: 'send_message' }, t)).toBe('Linkedin Pro Get Profile')
    })
})
