import { beforeEach, describe, expect, it, vi } from 'vitest'

const counts = { source: 0, user: 0 }
let devices: { token: string }[] = []
let userLocale: string | null = null
vi.mock('@/supabase/supabase-helpers', () => ({
    selectMaybeSingle: async (_supabase: unknown, table: string) => ({ data: table === 'users' ? { locale: userLocale } : { locale: 'en' } }),
    selectCount: async (_supabase: unknown, _table: string, filter: Record<string, unknown>) => ({ data: 'source_key' in filter ? counts.source : counts.user }),
    selectMany: async () => ({ data: devices }),
}))

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
        devices = [{ token: 'ExponentPushToken[a]' }]
        userLocale = null
        inserted.length = 0
        revoked.length = 0
        expo.mockReset().mockResolvedValue(new Response(JSON.stringify({ data: [{ status: 'ok' }] })))
        vi.stubGlobal('fetch', expo)
    })

    it('rings every device of a recipient, with what the app needs to open the conversation, and counts it', async () => {
        await pushNotification(supabase, context())
        const [, init] = expo.mock.calls[0]
        expect(JSON.parse(init.body)).toEqual([{ to: 'ExponentPushToken[a]', title: 'Scout', subtitle: 'Question', body: 'Which list first?', sound: 'default', data: { agentId: 'agent-1', conversationId: 'conv-1', kind: 'question' } }])
        expect(inserted).toEqual([{ table: 'notification_push_dispatches', row: { user_id: 'user-1', source_key: 'question:agent-1' } }])
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

    it('never throws when Expo is unreachable', async () => {
        expo.mockRejectedValue(new Error('offline'))
        await expect(pushNotification(supabase, context())).resolves.toBeUndefined()
    })
})
