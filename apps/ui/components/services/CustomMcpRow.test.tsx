// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CustomMcpRow } from '@/components/services/CustomMcpRow'
import type { CustomMcpStatus } from '@/lib/services/types'

vi.mock('next-intl', () => ({
    useTranslations: () => (key: string, values?: Record<string, unknown>) => (values ? [key, ...Object.values(values)].join('|') : key),
}))
vi.mock('@/components/services/CustomMcpStatusBadge', () => ({ CustomMcpStatusBadge: () => createElement('span') }))

const server = { name: 'x', displayName: 'X', transport: 'http' } as never
const checkedAt = Date.UTC(2026, 10, 12, 21, 30)
const time = new Date(checkedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

let root: Root | null = null
let container: HTMLElement | null = null

async function render(status: CustomMcpStatus) {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
        root!.render(createElement(CustomMcpRow, { server, status, statusLoading: false, onConnect: vi.fn(), onEdit: vi.fn(), onRemove: vi.fn(), checkedAt }))
    })
    return container.textContent ?? ''
}

afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    root = null
    container = null
})

describe('CustomMcpRow', () => {
    it('shows the error text and the time of the test in the row', async () => {
        const text = await render({ name: 'x', status: 'error', toolCount: 0, error: 'no answer within 15s' })
        expect(text).toContain('no answer within 15s')
        expect(text).toContain(`status.checkedAt|${time}`)
    })

    it('falls back to the no-answer text when the error has none', async () => {
        const text = await render({ name: 'x', status: 'error', toolCount: 0 })
        expect(text).toContain('status.noAnswer')
    })

    it.each(['connected', 'needs_auth'] as const)('shows no error line for a %s server', async state => {
        const text = await render({ name: 'x', status: state, toolCount: 1 })
        expect(text).not.toContain('status.checkedAt')
    })
})
