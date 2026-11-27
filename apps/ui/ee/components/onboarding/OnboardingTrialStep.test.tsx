// @vitest-environment happy-dom
import { act, createElement, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SubscribeFooter } from '@/ee/components/dialogs/billing/SubscribeCheckout'

const FRESH = { id: 7, subscription_status: null, trial_ends_at: null, is_sandbox: false, boxes_archived_at: null }

const mocks = vi.hoisted(() => ({
    workspace: null as unknown,
    track: vi.fn(),
    refreshWorkspace: vi.fn(async () => {}),
    paneMounts: 0,
    pane: null as null | { copy: { cta: string }; onTrialRefused: () => void; onDone: (trial: boolean) => void; footer: SubscribeFooter },
}))

vi.mock('@/supabase/session/SessionProvider', () => ({ useSession: () => ({ workspace: mocks.workspace, refreshWorkspace: mocks.refreshWorkspace }) }))
vi.mock('@/hooks/useWorkspaceAccess', () => ({ useWorkspaceAccess: () => ({ access: 'full', keptUntil: null }) }))
vi.mock('@rerun/analytics/client', () => ({ track: mocks.track }))
// The Stripe form itself needs a live session: the stand-in draws only the footer the step hands it.
vi.mock('@/ee/components/dialogs/billing/SubscribeCheckout', () => ({
    SubscribePane: (props: NonNullable<typeof mocks.pane>) => {
        mocks.pane = props
        useEffect(() => {
            mocks.paneMounts += 1
        }, [])
        return createElement('div', { 'data-pane': '' }, props.footer({ cta: props.copy.cta, footnote: null, onClick: () => {}, loading: false, disabled: false, error: null, consent: null }))
    },
}))

const { OnboardingTrialStep } = await import('./OnboardingTrialStep')

let root: Root
let host: HTMLElement
const onBack = vi.fn()

async function draw(waitlisted = false) {
    await act(async () => root.render(createElement(OnboardingTrialStep, { onBack, waitlisted })))
    return document.body.textContent ?? ''
}

function button(label: RegExp | string): HTMLButtonElement {
    const found = [...document.body.querySelectorAll('button')].find(element => (typeof label === 'string' ? element.textContent?.trim() === label : label.test(element.textContent ?? '')))
    if (!found) throw new Error(`no button ${label}`)
    return found
}

async function click(label: RegExp | string) {
    await act(async () => button(label).click())
}

beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.clearAllMocks()
    mocks.workspace = FRESH
    mocks.pane = null
    mocks.paneMounts = 0
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    document.body.innerHTML = ''
})

describe('the trial step of the onboarding page', () => {
    it('opens on the offer, and creates no checkout before the card is asked for', async () => {
        const text = await draw()
        expect(text).toContain('Start your free trial')
        expect(text).toContain('Trial starts')
        expect(text).toContain('Cancel in a click')
        expect(button('Add a card, $0 today')).toBeTruthy()
        expect(mocks.pane).toBeNull()
        expect(mocks.track).toHaveBeenCalledWith('paywall_viewed', { trigger: 'onboarding', variant: 'start_trial' })
        expect(mocks.track).not.toHaveBeenCalledWith('checkout_started', expect.anything())
    })

    it('goes back to the last question from the offer', async () => {
        await draw()
        await click(/Back/)
        expect(onBack).toHaveBeenCalledOnce()
    })

    it('moves to the card in the same card, and back to the offer', async () => {
        await draw()
        await click('Add a card, $0 today')
        expect(mocks.track).toHaveBeenCalledWith('checkout_started', { plan: 'base', source: 'onboarding' })
        expect(mocks.pane?.copy.cta).toBe('Start free trial')
        expect(button('Start free trial')).toBeTruthy()

        await click(/Back/)
        expect(onBack).not.toHaveBeenCalled()
        expect(document.body.textContent).toContain('Add a card, $0 today')
    })

    it('reads the workspace once the trial is paid for, so the flow moves on as soon as it is entitled', async () => {
        await draw()
        await click('Add a card, $0 today')
        await act(async () => mocks.pane?.onDone(true))
        expect(mocks.refreshWorkspace).toHaveBeenCalledOnce()
    })

    it.each(['trialing', 'active'])('keeps the trial and its card form while a workspace turned %s slides out', async status => {
        await draw()
        await click('Add a card, $0 today')
        mocks.workspace = { ...FRESH, subscription_status: status, trial_ends_at: '2026-12-01T12:00:00Z' }
        const text = await draw()
        expect(document.querySelector('h1')?.textContent).toBe('Start your free trial')
        expect(text).not.toContain('Upgrade to Pro')
        expect(button('Start free trial')).toBeTruthy()
        expect(mocks.paneMounts).toBe(1)
    })

    it('turns to the paid plan when the card already had a trial', async () => {
        await draw()
        await click('Add a card, $0 today')
        await act(async () => mocks.pane?.onTrialRefused())
        const text = document.body.textContent ?? ''
        expect(text).toContain('Subscribe to Pro')
        expect(text).not.toContain('$0 today')
        await click('Add a card')
        expect(mocks.pane?.copy.cta).toBe('Subscribe')
    })

    it('sells the paid plan to a workspace that already spent its trial', async () => {
        mocks.workspace = { ...FRESH, trial_ends_at: '2026-09-01T12:00:00Z' }
        const text = await draw()
        expect(text).toContain('Subscribe to Pro')
        expect(mocks.track).toHaveBeenCalledWith('paywall_viewed', { trigger: 'onboarding', variant: 'no_plan' })
    })

    it('counts no paywall while the waitlist wall stands over it', async () => {
        await draw(true)
        expect(mocks.track).not.toHaveBeenCalled()
    })
})
