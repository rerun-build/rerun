// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { parseHitlReply, type FeatureRequestDraft } from '@/lib/chat-hitl'

vi.mock('next-intl', async () => {
    const { createTranslator } = await import('use-intl')
    const { loadMessages } = await import('@rerun/i18n/messages')
    const messages = await loadMessages('en')
    return { useLocale: () => 'en', useTranslations: (namespace: string) => createTranslator({ locale: 'en', messages, namespace: namespace as never }) }
})

const action = vi.hoisted(() => ({ send: vi.fn(), sentEarlier: vi.fn() }))
vi.mock('@/app/api/_actions/feature-requests.actions', () => ({ sendFeatureRequestAction: action.send, featureRequestSentAction: action.sentEarlier }))
const toast = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

const { FeatureRequestBlock } = await import('./FeatureRequestBlock')
const { FeatureRequestConversationProvider } = await import('./FeatureRequestConversation')
const { FeatureRequestSkippedRow } = await import('./FeatureRequestReceipt')

const DRAFT: FeatureRequestDraft = {
    kind: 'feature',
    title: 'Generate videos directly in the chat',
    description: 'Let a coworker generate a short video from a prompt.',
    workaround: 'Connect HeyGen or Runway in Apps.',
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    action.send.mockReset()
    action.send.mockResolvedValue({ ok: true })
    action.sentEarlier.mockReset()
    action.sentEarlier.mockResolvedValue(false)
    toast.error.mockReset()
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

const conversation = { sessionId: '7c1c6a7e-1f0b-4e8e-9d39-0a7d0c9f6d11', scope: 'agent' as const }

function render(element: ReturnType<typeof createElement>) {
    act(() => root.render(createElement(FeatureRequestConversationProvider, { value: conversation }, element)))
}

const button = (hitl: string) => container.querySelector<HTMLButtonElement>(`[data-hitl="${hitl}"]`)

async function click(hitl: string) {
    const target = button(hitl)
    if (!target) throw new Error(`no [data-hitl="${hitl}"] on screen`)
    await act(async () => target.click())
}

function type(field: HTMLTextAreaElement, text: string) {
    act(() => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, text)
        field.dispatchEvent(new Event('input', { bubbles: true }))
    })
}

describe('FeatureRequestBlock', () => {
    it('shows the draft: title, type, description and what works today', () => {
        render(createElement(FeatureRequestBlock, { request: DRAFT, toolCallId: 'call-1', onSent: vi.fn(), onSkip: vi.fn() }))
        const text = container.textContent ?? ''
        expect(text).toContain(DRAFT.title)
        expect(text).toContain('Feature')
        expect(text).toContain(DRAFT.description)
        expect(text).toContain('Today: Connect HeyGen or Runway in Apps.')
    })

    it('sends the text as edited, then resumes the coworker with it', async () => {
        const onSent = vi.fn()
        render(createElement(FeatureRequestBlock, { request: DRAFT, toolCallId: 'call-1', onSent, onSkip: vi.fn() }))
        await click('edit')
        const [title, description] = container.querySelectorAll('textarea')
        type(title, 'Videos in the chat')
        type(description, 'Short clips from a prompt, cost shown first.')
        await click('send')
        expect(action.send).toHaveBeenCalledWith({ ...conversation, toolCallId: 'call-1', kind: 'feature', title: 'Videos in the chat', description: 'Short clips from a prompt, cost shown first.', workaround: DRAFT.workaround })
        expect(parseHitlReply(onSent.mock.calls[0][0])).toEqual({ kind: 'feature', request: { kind: 'feature', title: 'Videos in the chat', description: 'Short clips from a prompt, cost shown first.' } })
    })

    it('keeps the card when the request could not be saved', async () => {
        action.send.mockResolvedValue({ ok: false, error: 'nope' })
        const onSent = vi.fn()
        render(createElement(FeatureRequestBlock, { request: DRAFT, toolCallId: 'call-1', onSent, onSkip: vi.fn() }))
        await click('send')
        expect(onSent).not.toHaveBeenCalled()
        expect(button('send')?.disabled).toBe(false)
    })

    it('says why a refused request cannot go, in the reader\'s words', async () => {
        action.send.mockResolvedValue({ ok: false, error: 'Conversation not found', code: 'conversationNotFound' })
        render(createElement(FeatureRequestBlock, { request: DRAFT, toolCallId: 'call-1', onSent: vi.fn(), onSkip: vi.fn() }))
        await click('send')
        expect(toast.error).toHaveBeenCalledWith('Conversation not found')
    })

    it('keeps the card, to send again, when the chat cannot take the reply yet', async () => {
        const onSent = vi.fn(() => false)
        render(createElement(FeatureRequestBlock, { request: DRAFT, toolCallId: 'call-1', onSent, onSkip: vi.fn() }))
        await click('send')
        expect(toast.error).toHaveBeenCalledWith('The coworker is still working. Try again in a moment.')
        expect(button('send')?.disabled).toBe(false)
    })

    it('stops the fields at what the hub accepts', async () => {
        render(createElement(FeatureRequestBlock, { request: DRAFT, toolCallId: 'call-1', onSent: vi.fn(), onSkip: vi.fn() }))
        await click('edit')
        const [title, description] = container.querySelectorAll('textarea')
        expect(title.maxLength).toBe(200)
        expect(description.maxLength).toBe(5_000)
    })

    it('cannot send without a title', async () => {
        render(createElement(FeatureRequestBlock, { request: DRAFT, toolCallId: 'call-1', onSent: vi.fn(), onSkip: vi.fn() }))
        await click('edit')
        type(container.querySelectorAll('textarea')[0], '  ')
        expect(button('send')?.disabled).toBe(true)
    })

    it('skips without sending anything', async () => {
        const onSkip = vi.fn()
        render(createElement(FeatureRequestBlock, { request: DRAFT, toolCallId: 'call-1', onSent: vi.fn(), onSkip }))
        await click('skip')
        expect(onSkip).toHaveBeenCalled()
        expect(action.send).not.toHaveBeenCalled()
    })
})

describe('a skipped request', () => {
    const call = { type: 'tool-request_feature', toolCallId: 'call-1', input: DRAFT }

    it('reopens on Review it and sends from there', async () => {
        const onSendMessage = vi.fn()
        render(createElement(FeatureRequestSkippedRow, { call, onSendMessage }))
        expect(container.textContent).toContain('Request not sent')
        const review = [...container.querySelectorAll('button')].find(item => item.textContent === 'Review it')
        await act(async () => review?.click())
        await click('send')
        expect(action.send).toHaveBeenCalledWith(expect.objectContaining({ toolCallId: 'call-1', title: DRAFT.title }))
        expect(onSendMessage).toHaveBeenCalledTimes(1)
        expect(container.textContent).toContain('Request not sent')
        expect(container.querySelector('button')).toBeNull()
    })

    it('stays on Review it when the chat could not take the reply', async () => {
        render(createElement(FeatureRequestSkippedRow, { call, onSendMessage: vi.fn(() => false) }))
        const review = [...container.querySelectorAll('button')].find(item => item.textContent === 'Review it')
        await act(async () => review?.click())
        await click('send')
        expect(button('send')).not.toBeNull()
    })

    it('keeps the skip as history but drops the offer once the team has it, after a reload too', async () => {
        action.sentEarlier.mockResolvedValue(true)
        await act(async () => root.render(createElement(FeatureRequestConversationProvider, { value: conversation }, createElement(FeatureRequestSkippedRow, { call, onSendMessage: vi.fn() }))))
        expect(action.sentEarlier).toHaveBeenCalledWith('call-1')
        expect(container.textContent).toContain('Request not sent')
        expect(container.querySelector('button')).toBeNull()
    })

    it('offers no review once the thread lost the request', () => {
        render(createElement(FeatureRequestSkippedRow, { onSendMessage: vi.fn() }))
        expect(container.querySelector('button')).toBeNull()
    })
})
