// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InboxSurface, type InboxEntry } from '@rerun/ui/inbox'

const NEEDS = 50
const HEADS = 70

const items: InboxEntry[] = Array.from({ length: NEEDS + HEADS }, (_, i) => ({
    id: `session-${i}`,
    agentId: `agent-${i % 3}`,
    agentName: `Coworker ${i % 3}`,
    status: i < NEEDS ? 'awaiting_question' : 'awaiting_ack',
    title: `Task ${i}`,
    message: null,
    updatedAt: null,
}))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.useFakeTimers()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
})

const rows = () => document.querySelectorAll('[data-section] [role="button"]').length
const section = (key: string) => document.querySelector(`[data-section="${key}"]`)

function renderOpen(trigger: 'pill' | 'row') {
    act(() =>
        root.render(
            createElement(InboxSurface, { items, open: true, onOpenChange: () => {}, onOpenItem: () => {}, onMarkRead: () => {}, onMarkAllRead: () => {}, showSettings: false, trigger })
        )
    )
}

describe.each(['row', 'pill'] as const)('InboxSurface opened as a %s', trigger => {
    it('mounts the first screen of rows with the card, the rest once it has opened', () => {
        renderOpen(trigger)
        expect(rows()).toBeGreaterThan(0)
        expect(rows()).toBeLessThanOrEqual(12)
        expect(section('headsUps')).toBeNull()

        act(() => vi.advanceTimersByTime(100))
        expect(rows()).toBeLessThanOrEqual(12)

        act(() => vi.runAllTimers())
        expect(rows()).toBe(NEEDS + HEADS)
        expect(section('headsUps')).not.toBeNull()
    })

    it('mounts every row at once when a chip asks for a section not shown yet', () => {
        renderOpen(trigger)
        const chip = [...document.querySelectorAll('button')].find(button => button.textContent?.startsWith('Heads-ups'))
        expect(chip).toBeDefined()

        act(() => chip!.click())
        expect(rows()).toBe(NEEDS + HEADS)
        expect(section('headsUps')).not.toBeNull()
    })
})
