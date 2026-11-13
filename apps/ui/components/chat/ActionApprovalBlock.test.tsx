// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApprovalDecision } from '@rerun/contracts'

// "Not now" used to open a "Why not?" field that had to be confirmed, so refusing took two clicks on
// every approval of a batch. It now refuses at once; the reason sits behind its own "Explain" button.

vi.mock('motion/react', async () => {
    const { createElement: h, forwardRef } = await import('react')
    const strip = ({ initial: _initial, animate: _animate, exit: _exit, transition: _transition, ...rest }: Record<string, unknown>) => rest
    const div = forwardRef<HTMLDivElement, Record<string, unknown>>((props, ref) => h('div', { ...strip(props), ref }))
    return { AnimatePresence: ({ children }: { children: ReactNode }) => children, motion: { div } }
})

const { ActionApprovalBlock } = await import('./ActionApprovalBlock')

const BATCH = [{ action: 'Send the newsletter' }, { action: 'Delete old drafts' }]

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

function render(onSubmit: (decisions: ApprovalDecision[]) => void, approvals = BATCH) {
    act(() => root.render(createElement(ActionApprovalBlock, { approvals, onSubmit })))
}

function click(hitl: string) {
    const button = container.querySelector<HTMLButtonElement>(`[data-hitl="${hitl}"]`)
    if (!button) throw new Error(`no [data-hitl="${hitl}"] on screen`)
    act(() => button.click())
}

function type(text: string) {
    const field = container.querySelector('textarea')
    if (!field) throw new Error('no reason field on screen')
    act(() => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, text)
        field.dispatchEvent(new Event('input', { bubbles: true }))
    })
}

describe('ActionApprovalBlock', () => {
    it('refuses on "Not now" alone and moves to the next approval', () => {
        const onSubmit = vi.fn()
        render(onSubmit)
        click('decline')
        expect(container.querySelector('textarea')).toBeNull()
        expect(container.textContent).toContain('Delete old drafts')
        click('approve')
        expect(onSubmit).toHaveBeenCalledWith([
            { action: 'Send the newsletter', decision: 'declined', note: undefined },
            { action: 'Delete old drafts', decision: 'approved', note: undefined },
        ])
    })

    it('sends the reason given through "Explain"', () => {
        const onSubmit = vi.fn()
        render(onSubmit, [{ action: 'Delete old drafts' }])
        click('explain')
        type('  Too early  ')
        click('confirm-decline')
        expect(onSubmit).toHaveBeenCalledWith([{ action: 'Delete old drafts', decision: 'declined', note: 'Too early' }])
    })

    it('keeps the reason when "Not now" is pressed again on an approval already refused with one', () => {
        const onSubmit = vi.fn()
        render(onSubmit)
        click('explain')
        type('Too early')
        click('confirm-decline')
        const firstStep = container.querySelector<HTMLButtonElement>('[aria-label="Go to step 1"]')
        if (!firstStep) throw new Error('no step dot on screen')
        act(() => firstStep.click())
        click('decline')
        click('approve')
        expect(onSubmit).toHaveBeenCalledWith([
            { action: 'Send the newsletter', decision: 'declined', note: 'Too early' },
            { action: 'Delete old drafts', decision: 'approved', note: undefined },
        ])
    })

    it('goes back from "Explain" without deciding', () => {
        const onSubmit = vi.fn()
        render(onSubmit, [{ action: 'Delete old drafts' }])
        click('explain')
        click('back')
        expect(container.querySelector('textarea')).toBeNull()
        expect(container.querySelector('[data-hitl="decline"]')).not.toBeNull()
        expect(onSubmit).not.toHaveBeenCalled()
    })
})
