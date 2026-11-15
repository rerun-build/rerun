import { describe, expect, it } from 'vitest'

import { AGENT_SHEET_VIEWS, agentSheetViewOf, isAgentViewTab } from '@/lib/board/agent-sheet-views'
import { AGENT_FOCUS_TABS } from '@/lib/board/types'

describe('the screens of the coworker card', () => {
    it('give every panel tab but the thread a screen', () => {
        expect(AGENT_FOCUS_TABS.filter(tab => !isAgentViewTab(tab))).toEqual(['chat', 'actions'])
    })

    it('hold each tab once', () => {
        const tabs = Object.values(AGENT_SHEET_VIEWS).flat()
        expect(new Set(tabs).size).toBe(tabs.length)
    })

    it('find the screen of a tab', () => {
        expect(agentSheetViewOf('mcp')).toBe('apps')
        expect(agentSheetViewOf('triggers')).toBe('routines')
        expect(agentSheetViewOf('logs')).toBe('activity')
        expect(agentSheetViewOf('tools')).toBe('settings')
        expect(agentSheetViewOf('memories')).toBe('knowledge')
    })
})
