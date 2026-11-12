import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LinkupError, runAction } from '@/lib/apps/linkup/client'
import { missingRequired, toolParams } from '@/lib/apps/tools'
import { WHATSAPP_TOOLS, isNewConversation } from './tools'

vi.mock('@/lib/apps/linkup/client', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/apps/linkup/client')>()), runAction: vi.fn() }))

const tool = (name: string) => WHATSAPP_TOOLS.find(candidate => candidate.name === name)!

describe('the WhatsApp tool set', () => {
    it('never hands the coworker a login, a deletion or a webhook', () => {
        const actions = WHATSAPP_TOOLS.map(candidate => candidate.action)
        expect(actions).not.toContain('login')
        expect(actions.some(action => /delete|webhook/.test(action))).toBe(false)
        expect(new Set(WHATSAPP_TOOLS.map(candidate => candidate.name)).size).toBe(WHATSAPP_TOOLS.length)
    })

    it('meters every message, and a first one twice', () => {
        expect(tool('send_message').quota?.action).toBe('message')
        expect(tool('send_message').extraQuota).toBe(isNewConversation)
    })

    it('keeps only the declared parameters and needs a number to write to', () => {
        const send = tool('send_message')
        expect(toolParams(send, { phone_number: '+33612345678', message_text: 'Hi', account_id: 'someone-else' })).toEqual({ phone_number: '+33612345678', message_text: 'Hi' })
        expect(missingRequired(send, toolParams(send, { message_text: 'Hi' }))).toEqual(['phone_number'])
    })

    it('posts a Status through Linkup content, unmetered, with only its own parameters', () => {
        const post = tool('post_status')
        expect([post.category, post.action, post.quota]).toEqual(['content', 'create', undefined])
        expect(toolParams(post, { message: 'Open today', background_color: '#25D366', font: 0, account_id: 'someone-else' })).toEqual({
            message: 'Open today',
            background_color: '#25D366',
            font: 0,
        })
        expect(missingRequired(post, toolParams(post, { file: 'https://example.com/promo.jpg' }))).toEqual([])
    })

    it('lists the chats and reads a group by its conversation_id', () => {
        expect(tool('list_conversations').action).toBe('list_inbox')
        expect(toolParams(tool('list_conversations'), {})).toEqual({ count: 20 })
        const read = tool('get_conversation')
        expect(missingRequired(read, toolParams(read, { conversation_id: '120363431168837418@g.us' }))).toEqual([])
    })
})

describe('isNewConversation', () => {
    beforeEach(() => {
        vi.mocked(runAction).mockReset()
    })

    it('counts a number with history as a reply', async () => {
        vi.mocked(runAction).mockResolvedValue({ total_message_count: 12, messages: [{}] })
        await expect(isNewConversation('acc', { phone_number: '+33612345678' })).resolves.toBeNull()
    })

    it('counts an empty chat, or one Linkup has never seen, as a new conversation', async () => {
        vi.mocked(runAction).mockResolvedValue({ total_message_count: 0, messages: [] })
        await expect(isNewConversation('acc', { phone_number: '+33612345678' })).resolves.toBe('new_conversation')
        vi.mocked(runAction).mockRejectedValue(new LinkupError('CHANNEL_ERROR', 'CHAT_NOT_FOUND', 422))
        await expect(isNewConversation('acc', { phone_number: '+33612345678' })).resolves.toBe('new_conversation')
    })

    it('lets a signed-out account fail the call', async () => {
        vi.mocked(runAction).mockRejectedValue(new LinkupError('ACCOUNT_INACTIVE', 'NOT_CONNECTED', 401))
        await expect(isNewConversation('acc', { phone_number: '+33612345678' })).rejects.toThrow('NOT_CONNECTED')
    })

    it('lets a closed linked device fail the call instead of counting a new conversation', async () => {
        vi.mocked(runAction).mockRejectedValue(new LinkupError('CHANNEL_ERROR', 'Connection Closed', 400))
        await expect(isNewConversation('acc', { phone_number: '+33612345678' })).rejects.toThrow('Connection Closed')
    })
})
