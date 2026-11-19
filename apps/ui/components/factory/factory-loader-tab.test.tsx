// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { factorySnapshotSchema } from '@moldwright/contracts'

const ROOT = path.resolve(import.meta.dirname, '../../../..')
const sample = () => factorySnapshotSchema.parse(JSON.parse(readFileSync(path.join(ROOT, 'packages/contracts/fixtures/factory-snapshot.sample.json'), 'utf8')))

const h = vi.hoisted(() => ({
    answer: null as unknown,
    open: null as ((name: string) => void) | null,
    focus: vi.fn(),
    select: vi.fn(),
}))

vi.mock('@/app/api/_actions/factory.actions', () => ({ readFactorySnapshotAction: () => Promise.resolve(h.answer) }))
vi.mock('@/components/agent/AgentPanel', () => ({ AgentPanel: () => null }))
vi.mock('@/components/layout/WorkspaceSwitcher', () => ({ WorkspaceSwitcher: () => createElement('div', { 'data-workspace-switcher': '' }) }))
vi.mock('@/components/control-center/ControlCenter', () => ({ ControlCenter: () => createElement('div', { 'data-control-center': '' }) }))
vi.mock('@/supabase/session/SessionProvider', () => ({ useSession: () => ({ workspace: null }) }))
vi.mock('@/components/factory/FactoryWorld', () => ({
    FactoryWorld: (p: { onOpenCoworker?: (n: string) => void }) => { h.open = p.onOpenCoworker ?? null; return null },
}))
vi.mock('@/stores/board.store', () => {
    const state = { hydrated: true, hydrate: () => {}, agents: [{ id: 'b1', handle: 'boss', name: 'Boss' }], focusAgentOnBoard: h.focus, selectAgent: h.select }
    const useBoardStore = Object.assign((sel: (s: typeof state) => unknown) => sel(state), { getState: () => state })
    return { useBoardStore }
})

import { FactoryPage } from '@/components/factory/FactoryPage'

let host: HTMLDivElement
let root: Root
const flush = () => act(async () => { await Promise.resolve() })
const mount = async () => { await act(async () => { root.render(createElement(FactoryPage)) }); await flush() }
const loaderPanel = () => host.querySelector('[data-loader-panel]')

beforeEach(() => {
    h.answer = { snapshot: sample() }
    h.open = null
    h.focus.mockClear()
    h.select.mockClear()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('Loader panel on the Factory floor', () => {
    it('opens the Loader panel on the right when the Loader is clicked', async () => {
        await mount()
        expect(loaderPanel()).toBeNull()
        await act(async () => { h.open?.('Delegator') })
        expect(loaderPanel()).not.toBeNull()
        expect(loaderPanel()?.textContent).toContain('Beat 412')
    })

    it('closes the Loader panel with its close button', async () => {
        await mount()
        await act(async () => { h.open?.('Delegator') })
        await act(async () => { host.querySelector<HTMLButtonElement>('[data-loader-close]')?.click() })
        expect(loaderPanel()).toBeNull()
    })

    it('a coworker click replaces the Loader panel with the coworker panel', async () => {
        const snap = sample()
        const first = snap.pools.flatMap(p => p.coworkers).find(c => c.id)!
        h.answer = { snapshot: snap }
        await mount()
        await act(async () => { h.open?.('Delegator') })
        expect(loaderPanel()).not.toBeNull()
        await act(async () => { h.open?.(first.name) })
        expect(h.focus).toHaveBeenCalledWith(first.id, 'logs')
        expect(loaderPanel()).toBeNull()
    })
})
