import { coworkerEndpoints, foremanEndpoints } from '@/chat/endpoints'

jest.mock('expo-crypto', () => ({ randomUUID: () => '7d3f2c1a-0000-4000-8000-000000000001' }))

const response = (status: number, headers: Record<string, string> = {}) => new Response(null, { status, headers })

describe('coworker endpoints', () => {
    const endpoints = coworkerEndpoints('agent-1')

    it('sends through /api/chat, leaving the conversation to the hub until it names one', () => {
        expect(endpoints.sendPath).toBe('/api/chat')
        expect(endpoints.sendBody(null, 'Hi')).toEqual({ agentId: 'agent-1', sessionId: undefined, text: 'Hi' })
        expect(endpoints.sendBody('s1', 'Hi')).toEqual({ agentId: 'agent-1', sessionId: 's1', text: 'Hi' })
    })

    it('opens General on its first send, then talks to it by its id', () => {
        const general = coworkerEndpoints('agent-1', { general: true })
        expect(general.sendBody(null, 'Hi')).toEqual({ agentId: 'agent-1', kind: 'general', text: 'Hi' })
        expect(general.sendBody('g1', 'Hi')).toEqual({ agentId: 'agent-1', sessionId: 'g1', text: 'Hi' })
    })

    it('learns a new conversation from the header the hub sets', () => {
        expect(endpoints.bornSessionOf(response(200, { 'X-Session-Id': 's9' }))).toBe('s9')
        expect(endpoints.bornSessionOf(response(200))).toBeNull()
    })
})

describe('Foreman endpoints', () => {
    let filesOnEngine = false
    const endpoints = foremanEndpoints(() => filesOnEngine)

    it('names a new conversation itself and keeps that name on every send', () => {
        expect(endpoints.agentId).toBe('foreman')
        expect(endpoints.sendPath).toBe('/api/chat/foreman/engine')
        expect(endpoints.sendBody(null, 'Hi')).toEqual({ sessionId: '7d3f2c1a-0000-4000-8000-000000000001', text: 'Hi' })
        expect(endpoints.sendBody('s1', 'Hi')).toEqual({ sessionId: 's1', text: 'Hi' })
    })

    it('counts the conversation as born only once the hub accepted the send', () => {
        expect(endpoints.bornSessionOf(response(200))).toBe('7d3f2c1a-0000-4000-8000-000000000001')
        expect(endpoints.bornSessionOf(response(409))).toBeNull()
    })

    it('keeps the files in the hub until the machine takes them, then in its own workspace there', () => {
        filesOnEngine = false
        expect(endpoints.fileOwner('s1')).toEqual({ kind: 'foreman', sessionId: 's1' })
        filesOnEngine = true
        expect(endpoints.fileOwner('s1')).toEqual({ kind: 'agent', agentId: 'foreman' })
    })
})
