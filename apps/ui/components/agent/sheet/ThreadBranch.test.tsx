// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ThreadRow } from '@/app/api/_services/conversation.service'
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

vi.mock('@/stores/board.store', () => ({ useBoardStore: (select: (state: { agents: [] }) => unknown) => select({ agents: [] }) }))
vi.mock('@/components/agent/sheet/OpenChatsTabs', () => ({ StateDot: () => null }))
vi.mock('@rerun/ui/steps', () => ({ AnimatedSize: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/components/ai-elements/message', () => ({ MessageResponse: ({ children }: { children: string }) => createElement('div', null, children) }))
vi.mock('@/components/chat/HitlReceipt', () => ({ HitlReceipt: ({ reply }: { reply: { kind: string } }) => createElement('div', { 'data-receipt': reply.kind }) }))

const inbox = vi.hoisted(() => ({
    peek: { state: 'loading' } as InboxPeek,
    answer: (async () => 'sent') as (text: string) => Promise<PeekAnswerOutcome>,
    enabled: [] as boolean[],
    revisions: [] as (string | undefined)[],
}))
vi.mock('@/hooks/useInboxPeek', () => ({
    useInboxPeek: (_target: unknown, enabled: boolean, revision?: string) => {
        inbox.enabled.push(enabled)
        inbox.revisions.push(revision)
        return { peek: inbox.peek, answer: inbox.answer, decide: async () => 'stale' as const }
    },
}))

const { ThreadBranch } = await import('./ThreadBranch')

const OWNER = { agentId: 'closer', agentName: 'Closer' }

const CREATED_AT = '2026-11-17T10:00:00.000Z'
let updatedAt = CREATED_AT

const thread = (status: ThreadRow['status']): ThreadRow => ({
    id: 'session-1',
    title: 'Pipeline follow-ups',
    status,
    source: 'schedule',
    createdAt: CREATED_AT,
    updatedAt,
    originAgentId: null,
    automationName: 'Pipeline follow-ups',
    outcome: null,
    firstMessage: null,
})

const approval = (toolCallId = 'call-1'): InboxPeek => ({
    state: 'ready',
    sessionId: 'session-1',
    peek: { pending: { kind: 'approval', toolCallId, input: { approvals: [{ action: 'Send the follow-up to lena@northwind.io' }] } }, ask: 'I need your go before it leaves.', before: 'I drafted 23 follow-ups.', proposal: null },
})

let container: HTMLDivElement
let root: Root

beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    inbox.peek = approval()
    inbox.answer = async () => 'sent'
    inbox.enabled = []
    inbox.revisions = []
    updatedAt = CREATED_AT
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
})

function render(status: ThreadRow['status'], onOpen = () => {}, owner: typeof OWNER | null = OWNER) {
    act(() => root.render(createElement(ThreadBranch, { thread: thread(status), owner: owner ?? undefined, onOpen })))
}

const row = () => {
    const button = container.querySelector<HTMLButtonElement>('[data-thread-row] button')
    if (!button) throw new Error('no thread row on screen')
    return button
}

async function press(element: Element | null) {
    if (!element) throw new Error('nothing to press')
    await act(async () => (element as HTMLElement).click())
}

const button = (label: string) => [...container.querySelectorAll('button')].find(element => element.textContent?.includes(label)) ?? null

describe('ThreadBranch in General', () => {
    it('opens a thread that waits on nothing in its tab, without reading any request', async () => {
        const onOpen = vi.fn()
        render('idle', onOpen)
        await press(row())
        expect(onOpen).toHaveBeenCalledOnce()
        expect(row().getAttribute('aria-expanded')).toBeNull()
        expect(inbox.enabled).toEqual([])
    })

    it('opens a thread that only wants to be read in its tab: there is nothing to answer', async () => {
        const onOpen = vi.fn()
        render('awaiting_ack', onOpen)
        expect(row().textContent).toContain('Needs you')
        await press(row())
        expect(onOpen).toHaveBeenCalledOnce()
        expect(inbox.enabled).toEqual([])
    })

    it('starts reading once a plain row comes to wait on an answer', async () => {
        render('idle')
        expect(inbox.enabled).toEqual([])
        render('awaiting_approval')
        expect(inbox.enabled.at(-1)).toBe(true)
        expect(row().getAttribute('aria-expanded')).toBe('false')
    })

    it('reads the request as soon as the row needs us, and unfolds it on a click', async () => {
        const onOpen = vi.fn()
        render('awaiting_approval', onOpen)
        expect(inbox.enabled.at(-1)).toBe(true)
        expect(row().getAttribute('aria-expanded')).toBe('false')
        expect(container.querySelector('[data-hitl="approve"]')).toBeNull()

        await press(row())
        expect(onOpen).not.toHaveBeenCalled()
        expect(row().getAttribute('aria-expanded')).toBe('true')
        expect(container.textContent).toContain('I need your go before it leaves.')
        expect(container.querySelector('[data-hitl="approve"]')).not.toBeNull()

        await press(row())
        expect(row().getAttribute('aria-expanded')).toBe('false')
    })

    it('answers from the row, shows the receipt without the badge, then folds back', async () => {
        vi.useFakeTimers()
        const answer = vi.fn(async () => 'sent' as const)
        inbox.answer = answer
        render('awaiting_approval')
        await press(row())
        await press(container.querySelector('[data-hitl="approve"]'))
        expect(answer).toHaveBeenCalledWith(expect.stringContaining('APPROVED'))
        expect(container.textContent).toContain('Sent to Closer')
        expect(container.querySelector('[data-receipt="approval"]')).not.toBeNull()
        expect(row().textContent).not.toContain('Needs you')

        act(() => vi.advanceTimersByTime(3000))
        expect(row().getAttribute('aria-expanded')).toBe('false')
    })

    it('keeps the receipt on screen when the thread is already running again', async () => {
        render('awaiting_approval')
        await press(row())
        await press(container.querySelector('[data-hitl="approve"]'))
        render('working')
        expect(container.textContent).toContain('Sent to Closer')
    })

    it('gives a fresh widget back when the answer did not go through', async () => {
        inbox.answer = async () => 'busy'
        render('awaiting_approval')
        await press(row())
        await press(container.querySelector('[data-hitl="approve"]'))
        expect(container.textContent).toContain('Closer is still working')
        expect(container.querySelector<HTMLButtonElement>('[data-hitl="approve"]')?.disabled).toBe(false)
    })

    it('goes to the conversation from the foot of the card', async () => {
        const onOpen = vi.fn()
        render('awaiting_approval', onOpen)
        await press(row())
        await press(button('Open conversation'))
        expect(onOpen).toHaveBeenCalledOnce()
        expect(row().getAttribute('aria-expanded')).toBe('false')
    })

    it('folds back when the request is answered elsewhere', async () => {
        render('awaiting_approval')
        await press(row())
        render('working')
        expect(row().getAttribute('aria-expanded')).toBeNull()
        expect(container.querySelector('[data-hitl="approve"]')).toBeNull()
    })

    it('starts folded on the next request after one was answered elsewhere', async () => {
        render('awaiting_approval')
        await press(row())
        render('working')
        inbox.peek = approval('call-2')
        render('awaiting_approval')
        expect(row().getAttribute('aria-expanded')).toBe('false')
        expect(container.querySelector('[data-hitl="approve"]')).toBeNull()
    })

    it('gives the form back for the next request after an answer that came too late', async () => {
        inbox.answer = async () => 'stale'
        render('awaiting_approval')
        await press(row())
        await press(container.querySelector('[data-hitl="approve"]'))
        expect(container.textContent).toContain('This was already answered.')

        inbox.peek = approval('call-2')
        render('awaiting_approval')
        expect(container.textContent).not.toContain('This was already answered.')
        expect(container.querySelector('[data-hitl="approve"]')).not.toBeNull()
    })

    it('keeps the card while the answer is on its way, even if the thread already runs again', async () => {
        let settle: (outcome: PeekAnswerOutcome) => void = () => {}
        inbox.answer = () => new Promise<PeekAnswerOutcome>(resolve => (settle = resolve))
        render('awaiting_approval')
        await press(row())
        await press(container.querySelector('[data-hitl="approve"]'))
        render('working')
        expect(button('Open conversation')).not.toBeNull()

        await act(async () => settle('sent'))
        expect(container.textContent).toContain('Sent to Closer')
    })

    it('reads the request again when the thread has moved, but not under an answer on its way', async () => {
        let settle: (outcome: PeekAnswerOutcome) => void = () => {}
        inbox.answer = () => new Promise<PeekAnswerOutcome>(resolve => (settle = resolve))
        render('awaiting_approval')
        expect(inbox.revisions.at(-1)).toBe(CREATED_AT)

        updatedAt = '2026-11-17T10:05:00.000Z'
        render('awaiting_approval')
        expect(inbox.revisions.at(-1)).toBe('2026-11-17T10:05:00.000Z')

        await press(row())
        await press(container.querySelector('[data-hitl="approve"]'))
        updatedAt = '2026-11-17T10:06:00.000Z'
        render('awaiting_approval')
        expect(inbox.revisions.at(-1)).toBe('2026-11-17T10:05:00.000Z')

        await act(async () => settle('busy'))
        expect(inbox.revisions.at(-1)).toBe('2026-11-17T10:06:00.000Z')
    })

    it('stays a plain row without its coworker', async () => {
        const onOpen = vi.fn()
        render('awaiting_approval', onOpen, null)
        await press(row())
        expect(onOpen).toHaveBeenCalledOnce()
        expect(inbox.enabled).toEqual([])
    })
})
