import { describe, expect, it } from 'vitest'

import { awaitedApp, holdsARun, incidentMessage, opensConversation } from './incident-email'
import type { StoredNotification } from './inbound'

const notification = (kind: StoredNotification['kind'], metadata: Record<string, unknown> = {}, message = 'Set up gmail') => ({ event: 'agent.notification', kind, agentId: 'a', message, metadata, timestamp: '2026-11-24T10:00:00Z' }) as StoredNotification
const tErrors = ((key: string) => key) as never

describe('awaitedApp', () => {
    it('reads the one app a coworker suggests', () => {
        expect(awaitedApp(notification('connector', { toolName: 'suggest_service', input: { services: [{ slug: 'gmail', reason: ' Sort the inbox ' }] } }))).toEqual({ slug: 'gmail', reason: 'Sort the inbox' })
        expect(awaitedApp(notification('connector', { toolName: 'suggest_service', input: { services: '[{"slug":"gmail"}]' } }))).toEqual({ slug: 'gmail', reason: undefined })
    })

    it('names no app when several are asked for, or only a key', () => {
        expect(awaitedApp(notification('connector', { toolName: 'suggest_service', input: { services: [{ slug: 'gmail' }, { slug: 'notion' }] } }))).toEqual({})
        expect(awaitedApp(notification('connector', { toolName: 'request_secret', input: { items: [] } }))).toEqual({})
        expect(awaitedApp(notification('connector'))).toEqual({})
    })

    it('names a server outside the catalog', () => {
        expect(awaitedApp(notification('connector', { toolName: 'request_mcp_sign_in', input: { name: 'Supabase', reason: 'Read the tables' } }))).toEqual({ name: 'Supabase', reason: 'Read the tables' })
    })
})

describe('incidentMessage', () => {
    it('keeps the words of the coworker', () => {
        expect(incidentMessage(notification('question', {}, 'Which one?'), tErrors)).toBe('Which one?')
        expect(incidentMessage(notification('connector'), tErrors)).toBe('Set up gmail')
    })

    it('never shows the raw line of a failed run', () => {
        expect(incidentMessage(notification('error', { error: 'The token expired.' }, 'Schedule "weekly" failed: The token expired.'), tErrors)).toBe('The token expired.')
    })
})

it('tells what holds a run from what does not, and what is neither approved nor denied', () => {
    expect(holdsARun(notification('approval', { toolName: 'skill_propose' }))).toBe(false)
    expect(holdsARun(notification('approval', { toolName: 'request_approval' }))).toBe(true)
    expect(opensConversation(notification('approval', { toolName: 'request_takeover' }))).toBe(true)
    expect(opensConversation(notification('approval', { toolName: 'request_spend' }))).toBe(false)
})
