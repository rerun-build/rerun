import { beforeEach, describe, expect, it, vi } from 'vitest'

const counts = { source: 0, user: 0 }
let devices: { token: string; platform: string }[] = []
let userLocale: string | null = null
let agentRow: { data: { look: unknown } | null; error?: unknown } = { data: { look: null } }
vi.mock('@/supabase/supabase-helpers', () => ({
    selectMaybeSingle: async (_supabase: unknown, table: string) => (table === 'agents' ? agentRow : { data: table === 'users' ? { locale: userLocale } : { locale: 'en' } }),
    selectCount: async (_supabase: unknown, _table: string, filter: Record<string, unknown>) => ({ data: 'source_key' in filter ? counts.source : counts.user }),
    selectMany: async () => ({ data: devices }),
}))

const warmImage = vi.fn()
vi.mock('@/lib/og/warm', () => ({ warmImage }))

const { pushNotification } = await import('./push.service')

const inserted: unknown[] = []
const revoked: string[][] = []
const supabase = {
    from: (table: string) => ({
        insert: async (row: unknown) => {
            inserted.push({ table, row })
            return { error: null }
        },
        update: () => ({
            in: async (_column: string, tokens: string[]) => {
                revoked.push(tokens)
                return { error: null }
            },
        }),
    }),
} as never

const context = (patch: object = {}) => ({
    workspaceId: 1,
    agentId: 'agent-1',
    agentName: 'Scout',
    conversationId: 'conv-1',
    sourceKey: 'question:agent-1',
    notification: { kind: 'question', message: 'Which list first?', event: 'agent.run.waiting' } as never,
    recipients: { 'user-1': 'mine' as const },
    members: [{ id: 'user-1', prefs: null }],
    ...patch,
})

const expo = vi.fn()

describe('pushNotification', () => {
    beforeEach(() => {
        counts.source = 0
        counts.user = 0
        devices = [{ token: 'ExponentPushToken[a]', platform: 'ios' }]
        userLocale = null
        agentRow = { data: null }
        warmImage.mockReset()
        inserted.length = 0
        revoked.length = 0
        expo.mockReset().mockResolvedValue(new Response(JSON.stringify({ data: [{ status: 'ok' }] })))
        vi.stubGlobal('fetch', expo)
    })

    it('rings every device of a recipient, with what the app needs to open the conversation, and counts it', async () => {
        await pushNotification(supabase, context())
        const [, init] = expo.mock.calls[0]
        expect(JSON.parse(init.body)).toEqual([{ to: 'ExponentPushToken[a]', title: 'Scout', subtitle: 'Question', body: 'Which list first?', sound: 'default', _contentAvailable: true, data: { workspaceId: 1, agentId: 'agent-1', conversationId: 'conv-1', kind: 'question' } }])
        expect(inserted).toEqual([{ table: 'notification_push_dispatches', row: { user_id: 'user-1', source_key: 'question:agent-1' } }])
    })

    it('puts the approval buttons and the card they answer on both platforms', async () => {
        devices = [
            { token: 'ExponentPushToken[ios]', platform: 'ios' },
            { token: 'ExponentPushToken[android]', platform: 'android' },
        ]
        expo.mockResolvedValue(new Response(JSON.stringify({ data: [{ status: 'ok' }, { status: 'ok' }] })))
        await pushNotification(supabase, context({ notification: { kind: 'approval', message: 'Send the 12 emails?', event: 'agent.notification', metadata: { toolCallId: 'call-1', toolName: 'request_approval' } } }))
        const [ios, android] = JSON.parse(expo.mock.calls[0][1].body)
        for (const message of [ios, android]) {
            expect(message.categoryId).toBe('rerun.approval')
            expect(message.data).toEqual({ workspaceId: 1, agentId: 'agent-1', conversationId: 'conv-1', kind: 'approval', toolCallId: 'call-1' })
        }
    })

    it('writes in the language the recipient picked', async () => {
        userLocale = 'es'
        await pushNotification(supabase, context())
        const [, init] = expo.mock.calls[0]
        expect(JSON.parse(init.body)[0].subtitle).toBe('Pregunta')
    })

    it('lands a finished run without a sound', async () => {
        await pushNotification(supabase, context({ notification: { kind: 'done', message: 'Here is the list.', event: 'agent.message.completed' } }))
        const [, init] = expo.mock.calls[0]
        expect(JSON.parse(init.body)[0]).not.toHaveProperty('sound')
    })

    it('stays quiet past the cap, for someone whose scope says nothing, and for someone without a device', async () => {
        counts.source = 3
        await pushNotification(supabase, context())
        counts.source = 0
        await pushNotification(supabase, context({ members: [{ id: 'user-1', prefs: { version: 2, scope: 'nothing' } }] }))
        devices = []
        await pushNotification(supabase, context())
        expect(expo).not.toHaveBeenCalled()
    })

    it('revokes a token Expo says is gone, and does not count a batch nobody received', async () => {
        expo.mockResolvedValue(new Response(JSON.stringify({ data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }] })))
        await pushNotification(supabase, context())
        expect(revoked).toEqual([['ExponentPushToken[a]']])
        expect(inserted).toEqual([])
    })

    it('sends an Android phone its channel, a high priority and the state in the title, and leaves iOS as it was', async () => {
        devices = [
            { token: 'ExponentPushToken[ios]', platform: 'ios' },
            { token: 'ExponentPushToken[android]', platform: 'android' },
        ]
        expo.mockResolvedValue(new Response(JSON.stringify({ data: [{ status: 'ok' }, { status: 'ok' }] })))
        await pushNotification(supabase, context())
        const [ios, android] = JSON.parse(expo.mock.calls[0][1].body)
        expect(ios).toEqual({ to: 'ExponentPushToken[ios]', title: 'Scout', subtitle: 'Question', body: 'Which list first?', sound: 'default', _contentAvailable: true, data: { workspaceId: 1, agentId: 'agent-1', conversationId: 'conv-1', kind: 'question' } })
        expect(android).toEqual({ to: 'ExponentPushToken[android]', title: 'Scout · Question', body: 'Which list first?', channelId: 'messages', priority: 'high', data: { workspaceId: 1, agentId: 'agent-1', conversationId: 'conv-1', kind: 'question' } })
    })

    it('lands a finished run on the silent Android channel, at the normal priority', async () => {
        devices = [{ token: 'ExponentPushToken[android]', platform: 'android' }]
        await pushNotification(supabase, context({ notification: { kind: 'done', message: 'Here is the list.', event: 'agent.message.completed' } }))
        const [android] = JSON.parse(expo.mock.calls[0][1].body)
        expect(android).toMatchObject({ title: 'Scout · Done', channelId: 'silent' })
        expect(android).not.toHaveProperty('priority')
        expect(android).not.toHaveProperty('sound')
    })

    it('revokes a dead Android token and keeps the live iOS one', async () => {
        devices = [
            { token: 'ExponentPushToken[ios]', platform: 'ios' },
            { token: 'ExponentPushToken[android]', platform: 'android' },
        ]
        expo.mockResolvedValue(new Response(JSON.stringify({ data: [{ status: 'ok' }, { status: 'error', details: { error: 'DeviceNotRegistered' } }] })))
        await pushNotification(supabase, context())
        expect(revoked).toEqual([['ExponentPushToken[android]']])
        expect(inserted).toHaveLength(1)
    })

    describe('the portrait', () => {
        const LOOK = { eyes: 'heart', mouth: 'cat', color: '#f0127f', material: 'knit' }
        const sent = () => JSON.parse(expo.mock.calls[0][1].body)

        beforeEach(() => {
            devices = [
                { token: 'ExponentPushToken[ios]', platform: 'ios' },
                { token: 'ExponentPushToken[android]', platform: 'android' },
            ]
            expo.mockResolvedValue(new Response(JSON.stringify({ data: [{ status: 'ok' }, { status: 'ok' }] })))
        })

        it('names the coworker, its picture and the state on both platforms, and lets iOS put it on', async () => {
            agentRow = { data: { look: LOOK } }
            await pushNotification(supabase, context())
            const [ios, android] = sent()
            const sender = { name: 'Scout', image: expect.stringMatching(/\/og\/coworker\/heart-cat-f0127f-knit\?v=/), state: 'Question' }
            expect(ios.data.sender).toEqual(sender)
            expect(android.data.sender).toEqual(sender)
            expect(ios.mutableContent).toBe(true)
            expect(android).not.toHaveProperty('mutableContent')
            expect(warmImage).toHaveBeenCalledWith(ios.data.sender.image, expect.any(Number))
        })

        it('draws a coworker nobody dressed, or whose look is no longer one, from its id', async () => {
            agentRow = { data: { look: { eyes: 'gone' } } }
            await pushNotification(supabase, context())
            expect(sent()[0].data.sender.image).toMatch(/\/og\/coworker\/[a-z]+-[a-z]+-[0-9a-f]{6}-classic\?v=/)
        })

        it('gives the Chief of Staff its orb without reading a row', async () => {
            agentRow = { data: null, error: new Error('invalid input syntax for type uuid') }
            await pushNotification(supabase, context({ agentId: 'foreman', agentName: 'Max' }))
            expect(sent()[0].data.sender).toEqual({ name: 'Max', image: expect.stringContaining('/og/coworker/foreman?v='), state: 'Question' })
        })

        it('leaves a push of no coworker, and one whose look cannot be read, as they were', async () => {
            await pushNotification(supabase, context({ agentId: null }))
            vi.spyOn(console, 'error').mockImplementation(() => {})
            agentRow = { data: null, error: new Error('down') }
            await pushNotification(supabase, context())
            for (const [, init] of expo.mock.calls) {
                for (const message of JSON.parse(init.body)) {
                    expect(message.data).not.toHaveProperty('sender')
                    expect(message).not.toHaveProperty('mutableContent')
                }
            }
            expect(expo).toHaveBeenCalledTimes(2)
            expect(warmImage).not.toHaveBeenCalled()
        })
    })

    it('never throws when Expo is unreachable', async () => {
        expo.mockRejectedValue(new Error('offline'))
        await expect(pushNotification(supabase, context())).resolves.toBeUndefined()
    })
})
