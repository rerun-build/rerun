import { mobileApi } from '@rerun/contracts'

import { readSalvaging, type ResponseSchema } from '@/api/salvage'

const schemaOf = (endpoint: { response: unknown }) => endpoint.response as ResponseSchema

const agent = (id: string, status: string) => ({ id, name: id, handle: null, description: null, templateId: null, status, workspaceId: 7, spaceId: 's1', disabledAt: null, disabledReason: null })

describe('readSalvaging', () => {
    it('hands a readable answer through untouched', () => {
        const answer = [agent('a1', 'idle')]
        expect(readSalvaging(schemaOf(mobileApi.listAgents), answer)).toEqual({ data: answer, dropped: [] })
    })

    it('leaves out the coworker with a status this build does not know, and shows the others', () => {
        const { data, dropped } = readSalvaging(schemaOf(mobileApi.listAgents), [agent('a1', 'idle'), agent('a2', 'hibernating'), agent('a3', 'teleporting'), agent('a4', 'working')])
        expect((data as { id: string }[]).map(item => item.id)).toEqual(['a1', 'a4'])
        expect(dropped).toEqual(['1', '1'])
    })

    it('reads a long list through, however many of its items it cannot read', () => {
        const { data, dropped } = readSalvaging(schemaOf(mobileApi.listAgents), [agent('a0', 'idle'), ...Array.from({ length: 200 }, (_, index) => agent(`b${index}`, 'hibernating'))])
        expect((data as { id: string }[]).map(item => item.id)).toEqual(['a0'])
        expect(dropped).toHaveLength(200)
    })

    it('empties an optional field it cannot read instead of the whole answer', () => {
        const me = { user: { id: 'u1', email: null, name: 'Ada', avatarUrl: null }, workspace: { id: 7, name: 'Atelier Nord', iconUrl: null, plan: 'pro', subscribed: true, role: 'owner-of-everything', boxScope: 'all' } }
        const { data, dropped } = readSalvaging(schemaOf(mobileApi.getMe), me)
        expect(data).toMatchObject({ user: { name: 'Ada' }, workspace: { id: 7, boxScope: 'all' } })
        expect((data as { workspace: { role?: string } }).workspace.role).toBeUndefined()
        expect(dropped).toEqual(['workspace.role'])
    })

    it('leaves out a kind of part it does not know and keeps the message', () => {
        const message = { id: 'm1', role: 'assistant', parts: [{ type: 'text', text: 'Found Maison Nord.' }], metadata: {} }
        const plain = readSalvaging(schemaOf(mobileApi.getConversationMessages), [message])
        const unknownPart = readSalvaging(schemaOf(mobileApi.getConversationMessages), [{ ...message, parts: [...message.parts, { kind: 'hologram' }] }])
        expect(unknownPart.data).toEqual(plain.data)
    })

    it('does the same in an answer that is one shape or another, the conversation of the Chief of Staff', () => {
        const message = { id: 'm1', role: 'assistant', parts: [{ type: 'text', text: 'Found Maison Nord.' }], metadata: {} }
        const unreadable = { ...message, parts: [...message.parts, { kind: 'hologram' }] }
        const schema = schemaOf(mobileApi.getForemanConversation)
        const conversation = readSalvaging(schema, { sessionId: 's1', messages: [unreadable] })
        expect(conversation.data).toEqual(readSalvaging(schema, { sessionId: 's1', messages: [message] }).data)
        expect(conversation.dropped).toEqual(['messages.0.parts.1'])
        const transcript = readSalvaging(schema, { messages: [unreadable] })
        expect(transcript.data).toEqual(readSalvaging(schema, { messages: [message] }).data)
        expect(transcript.dropped).toEqual(['messages.0.parts.1'])
    })

    it('fails as before when what it cannot read is the answer itself', () => {
        expect(() => readSalvaging(schemaOf(mobileApi.getActiveRun), { runId: 42 })).toThrow()
        expect(() => readSalvaging(schemaOf(mobileApi.getMe), { user: null })).toThrow()
    })

    it('never changes the answer it was given', () => {
        const answer = [agent('a1', 'idle'), agent('a2', 'hibernating')]
        readSalvaging(schemaOf(mobileApi.listAgents), answer)
        expect(answer).toHaveLength(2)
    })
})
