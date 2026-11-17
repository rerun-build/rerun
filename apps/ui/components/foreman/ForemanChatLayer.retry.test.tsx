// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { UIMessage } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A Codex turn that failed with a transient error ("thread … already has an active writer", RER-128)
// left the Chief of Staff's card with nothing to press: the coworker chat offers Retry, this one did not.

const notices = vi.hoisted(() => [] as Array<{ kind: string; onRetry?: () => void }>)

vi.mock('@/components/chat/ProviderErrorNotice', () => ({
    ProviderErrorNotice: (props: { kind: string; onRetry?: () => void }) => {
        notices.push(props)
        return null
    },
}))
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key, useLocale: () => 'en' }))
vi.mock('@/supabase/session/SessionProvider', () => ({ useSession: () => ({ workspace: null }) }))
vi.mock('@rerun/cloud/billing.client', () => ({ BudgetExhaustedNotice: () => null, usePriceArm: () => null }))
vi.mock('@/supabase/client', () => ({ createClient: () => ({}) }))
vi.mock('./useForemanMentionAgents', () => ({ useForemanMentionAgents: () => [] }))

const { ForemanChatLayer } = await import('./ForemanChatLayer')

const messages: UIMessage[] = [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Draft the weekly report' }] }]
const error = { kind: 'generic' as const, message: 'JSON-RPC error -32600: thread 01a1df16 already has an active writer' }

let container: HTMLDivElement
let root: Root

beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    notices.length = 0
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

describe('the Chief of Staff error card', () => {
    it('hands the retry to the notice', () => {
        const onRetry = vi.fn()
        act(() => root.render(createElement(ForemanChatLayer, { messages, restored: true, error, onRetry })))
        const notice = notices.at(-1)
        expect(notice?.kind).toBe('generic')
        notice?.onRetry?.()
        expect(onRetry).toHaveBeenCalledOnce()
    })
})
