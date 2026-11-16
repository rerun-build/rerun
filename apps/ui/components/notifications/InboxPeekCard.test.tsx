// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InboxEntry } from '@rerun/ui/inbox'

import type { InboxPeek, PeekAnswerOutcome } from '@/hooks/useInboxPeek'

vi.mock('next-intl', async () => {
    const { createTranslator } = await import('use-intl')
    const { loadMessages } = await import('@rerun/i18n/messages')
    const messages = await loadMessages('en')
    return { useLocale: () => 'en', useTranslations: (namespace: string) => createTranslator({ locale: 'en', messages, namespace: namespace as never }) }
})

vi.mock('motion/react', async () => {
    const { createElement: h, forwardRef } = await import('react')
    const strip = ({ initial: _initial, animate: _animate, exit: _exit, transition: _transition, ...rest }: Record<string, unknown>) => rest
    const div = forwardRef<HTMLDivElement, Record<string, unknown>>((props, ref) => h('div', { ...strip(props), ref }))
    return { AnimatePresence: ({ children }: { children: ReactNode }) => children, motion: { div }, useReducedMotion: () => false }
})

const visibility = vi.hoisted(() => ({ current: 'in-view' as 'in-view' | 'out-of-view' | 'absent' }))
vi.mock('@/hooks/usePendingInView', () => ({ usePendingInView: (_scroll: unknown, _block: unknown, key: string | null) => (key === null ? 'absent' : visibility.current) }))

vi.mock('@/components/ai-elements/message', () => ({ MessageResponse: ({ children }: { children: string }) => createElement('div', null, children) }))
vi.mock('@/components/chat/HitlReceipt', () => ({ HitlReceipt: ({ reply }: { reply: { kind: string } }) => createElement('div', { 'data-receipt': reply.kind }) }))
vi.mock('@/components/chat/QuestionForm', () => ({ QuestionForm: ({ onSend }: { onSend: (text: string) => void }) => createElement('button', { 'data-hitl': 'answer', onClick: () => onSend('**How?**\nFriendly') }) }))
vi.mock('@/components/chat/SecretRequestBlock', () => ({ SecretRequestBlock: () => createElement('div', { 'data-hitl': 'secret' }) }))

const { InboxPeekCard } = await import('./InboxPeekCard')

const ENTRY: InboxEntry = { id: 'session-1', agentId: 'closer', agentName: 'Closer', status: 'awaiting_approval', title: 'Pipeline follow-ups', message: 'Send the follow-up', updatedAt: null }

const approvalPeek = (before: string | null = 'I drafted 23 follow-ups.'): InboxPeek => ({
    state: 'ready',
    sessionId: 'session-1',
    peek: { pending: { kind: 'approval', toolCallId: 'call-1', input: { approvals: [{ action: 'Send the follow-up to lena@northwind.io' }] } }, ask: 'I need your go before it leaves.', before },
})

let container: HTMLDivElement
let root: Root

beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    visibility.current = 'in-view'
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
})

function render(peek: InboxPeek, onAnswer: (text: string) => Promise<PeekAnswerOutcome> = async () => 'sent', onClose = () => {}) {
    act(() => root.render(createElement(InboxPeekCard, { entry: ENTRY, peek, onAnswer, onClose, onOpenConversation: () => {} })))
}

async function click(hitl: string) {
    const button = container.querySelector<HTMLButtonElement>(`[data-hitl="${hitl}"]`)
    if (!button) throw new Error(`no [data-hitl="${hitl}"] on screen`)
    await act(async () => button.click())
}

describe('InboxPeekCard', () => {
    it('shows the thread around the request, then the request itself', () => {
        render(approvalPeek())
        expect(container.textContent).toContain('I drafted 23 follow-ups.')
        expect(container.textContent).toContain('I need your go before it leaves.')
        expect(container.textContent).toContain('Send the follow-up to lena@northwind.io')
    })

    it('sends the decision the way the chat writes it, then shows what was sent', async () => {
        const onAnswer = vi.fn(async () => 'sent' as const)
        render(approvalPeek(), onAnswer)
        await click('approve')
        expect(onAnswer).toHaveBeenCalledWith(expect.stringContaining('APPROVED'))
        expect(container.textContent).toContain('Sent to Closer')
        expect(container.querySelector('[data-receipt="approval"]')).not.toBeNull()
    })

    it('folds back on its own once the receipt has been read', async () => {
        vi.useFakeTimers()
        const onClose = vi.fn()
        render({ state: 'ready', sessionId: 'session-1', peek: { pending: { kind: 'question', toolCallId: 'call-2', input: { questions: [{ question: 'How?', options: ['Friendly'] }] } }, ask: 'One thing first.', before: null } }, async () => 'sent', onClose)
        await click('answer')
        expect(onClose).not.toHaveBeenCalled()
        act(() => vi.advanceTimersByTime(3000))
        expect(onClose).toHaveBeenCalled()
    })

    it('says so when the request was answered elsewhere in the meantime', async () => {
        render(approvalPeek(), async () => 'stale')
        await click('approve')
        expect(container.textContent).toContain('This was already answered.')
        expect(container.querySelector('[data-hitl="approve"]')).toBeNull()
    })

    it('gives a fresh widget back when the answer did not go through', async () => {
        render(approvalPeek(), async () => 'failed')
        await click('approve')
        expect(container.textContent).toContain('Your answer did not go through.')
        expect(container.querySelector<HTMLButtonElement>('[data-hitl="approve"]')?.disabled).toBe(false)
    })

    it('offers only the conversation for a request the card cannot answer', () => {
        render({ state: 'ready', sessionId: 'session-1', peek: { pending: { kind: 'service', toolCallId: 'call-3', input: { services: [{ slug: 'stripe' }] } }, ask: 'Connect Stripe so I can read invoices.', before: null } })
        expect(container.textContent).toContain('Open the conversation to answer.')
    })

    it('goes back to the list without closing the inbox', async () => {
        const onBack = vi.fn()
        const onClose = vi.fn()
        act(() => root.render(createElement(InboxPeekCard, { entry: ENTRY, peek: approvalPeek(), onAnswer: async () => 'sent' as const, onClose, onBack })))
        const back = container.querySelector<HTMLButtonElement>('button[aria-label="Back"]')
        if (!back) throw new Error('no Back button on screen')
        await act(async () => back.click())
        expect(onBack).toHaveBeenCalledOnce()
        expect(onClose).not.toHaveBeenCalled()
    })

    it('has no way back when opened on its own', () => {
        render(approvalPeek())
        expect(container.querySelector('button[aria-label="Back"]')).toBeNull()
    })

    it('points down to the request while it is out of sight, and scrolls to it', async () => {
        visibility.current = 'out-of-view'
        render(approvalPeek())
        const pill = container.querySelector<HTMLButtonElement>('button[aria-label="Approval needed, go to it"]')
        if (!pill) throw new Error('no pending pill on screen')
        const body = pill.closest('.relative')?.querySelector<HTMLDivElement>('.overflow-y-auto')
        if (!body) throw new Error('no scrolling body')
        const scrollTo = vi.fn()
        body.scrollTo = scrollTo as typeof body.scrollTo
        await act(async () => pill.click())
        expect(scrollTo).toHaveBeenCalledOnce()
    })

    it('leaves the pill out once the request is in sight', () => {
        render(approvalPeek())
        expect(container.querySelector('button[aria-label="Approval needed, go to it"]')).toBeNull()
    })

    it('has no pill for a request answered in the conversation only', () => {
        visibility.current = 'out-of-view'
        render({ state: 'ready', sessionId: 'session-1', peek: { pending: { kind: 'service', toolCallId: 'call-3', input: { services: [{ slug: 'stripe' }] } }, ask: 'Connect Stripe.', before: null } })
        expect(container.textContent).not.toContain('App to connect')
    })

    it('reads a conversation that waits on nothing anymore as answered', () => {
        render({ state: 'ready', sessionId: 'session-1', peek: { pending: null, ask: 'Done, all sent.', before: null } })
        expect(container.textContent).toContain('This was already answered.')
    })
})
