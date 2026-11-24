// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/supabase/session/SessionProvider', () => ({ useSession: () => ({ workspace: null }) }))
vi.mock('@rerun/cloud/billing.client', () => ({ BudgetExhaustedNotice: () => null, usePriceArm: () => null }))
vi.mock('@/supabase/client', () => ({ createClient: () => ({}) }))
vi.mock('./useForemanMentionAgents', () => ({ useForemanMentionAgents: () => [] }))

const { ForemanChatLayer } = await import('./ForemanChatLayer')

// The transcript is only read once the column opens: on a phone that never opened it, the skeleton
// pulsed behind every screen for as long as the page lived (RER-291).

let container: HTMLDivElement
let root: Root

const render = (orbPaused: boolean) => act(() => root.render(createElement(ForemanChatLayer, { messages: [], restored: false, orbPaused })))
const skeleton = () => container.querySelector('[data-slot="skeleton"]')!.closest('[aria-hidden]')!
const STILL = '[&_[data-slot=skeleton]]:animate-none'

beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

describe('the skeleton of the Chief of Staff conversation', () => {
    it('stands still while the column is closed', () => {
        render(true)
        expect(skeleton().classList.contains(STILL)).toBe(true)
    })

    it('pulses while the column is open', () => {
        render(false)
        expect(skeleton().classList.contains(STILL)).toBe(false)
    })
})
