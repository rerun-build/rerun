// @vitest-environment happy-dom
import type { ResumeChat } from '@rerun/contracts'
import { NextIntlClientProvider } from 'next-intl'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import agent from '@rerun/i18n/messages/en/agent.json'

import { ResumeChatPill } from './ResumeChatPill'

const resume: ResumeChat = { sessionId: 'digest', title: 'Weekly funnel digest', deviceKind: 'computer', changedAt: '2026-11-24T09:00:00.000Z' }

let container: HTMLDivElement
let root: Root

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

const show = (value: ResumeChat | null, onContinue = vi.fn(), onDismiss = vi.fn()) => {
    act(() =>
        root.render(
            <NextIntlClientProvider locale="en" messages={{ agent }}>
                <ResumeChatPill resume={value} onContinue={onContinue} onDismiss={onDismiss} />
            </NextIntlClientProvider>
        )
    )
    return { onContinue, onDismiss }
}
const buttons = () => [...container.querySelectorAll('button')]

describe('the conversation offered from another device', () => {
    it('opens on a click, and goes away on its cross', () => {
        const { onContinue, onDismiss } = show(resume)
        expect(buttons()[0].textContent).toBe('Continue Weekly funnel digest')
        act(() => buttons()[0].click())
        expect(onContinue).toHaveBeenCalledWith('digest', 'Weekly funnel digest')
        act(() => buttons()[1].click())
        expect(onDismiss).toHaveBeenCalledOnce()
        expect(buttons()[1].getAttribute('aria-label')).toBe('Dismiss')
    })

    it('names a conversation that has no title yet', () => {
        show({ ...resume, title: null })
        expect(buttons()[0].textContent).toBe('Continue New conversation')
    })

    it('shows nothing with nothing to offer', () => {
        show(null)
        expect(buttons()).toHaveLength(0)
    })
})
