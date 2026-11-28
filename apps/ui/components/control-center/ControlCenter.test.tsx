// @vitest-environment happy-dom
import type { WorkspaceSearchHit } from '@rerun/contracts'
import { act, createElement, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ControlCenterView } from './ControlCenterView'

type ControlCenterViewProps = ComponentProps<typeof ControlCenterView>

const mocks = vi.hoisted(() => ({
    view: null as ControlCenterViewProps | null,
    machine: { hits: [] as WorkspaceSearchHit[], loading: false, unavailable: false, truncated: false },
    conversations: { hits: [], loading: false },
}))
vi.mock('./ControlCenterView', async importOriginal => ({
    ...(await importOriginal<typeof import('./ControlCenterView')>()),
    ControlCenterView: (props: ControlCenterViewProps) => {
        mocks.view = props
        return null
    },
}))
vi.mock('./useWorkspaceSearch', () => ({ useWorkspaceSearch: () => mocks.machine }))
vi.mock('./useConversationSearch', () => ({ useConversationSearch: () => mocks.conversations }))
vi.mock('@/supabase/client', () => ({ createClient: () => ({}) }))
vi.mock('@/lib/notifications/open-inbox-item', () => ({ openForemanConversation: vi.fn() }))
vi.mock('@/components/agent/agent-tabs', () => ({ useAgentTabs: () => [] }))
vi.mock('@/hooks/useBoxAccess', () => ({ useBoxViewer: () => null, useManageableSpaceIds: () => new Set() }))
vi.mock('@/hooks/useIsTemplateAuthor', () => ({ useIsTemplateAuthor: () => false }))
vi.mock('@/hooks/useWorkspaceAccess', () => ({ useWorkspaceAccess: () => ({ needsMachineReason: null }) }))
vi.mock('@/supabase/session/SessionProvider', () => ({ useIsWorkspaceAdmin: () => true, useSession: () => ({ workspace: { id: 7 }, session: null }) }))
vi.mock('@rerun/cloud/billing', async importOriginal => ({ ...(await importOriginal<object>()), isWorkspaceApiEntitled: () => true }))

const { ControlCenter } = await import('./ControlCenter')
const { ControlCenterPanel } = await import('./ControlCenterView')
const { useBoardStore } = await import('@/stores/board.store')
const { useControlCenterStore } = await import('@/stores/control-center.store')

const coworker = (id: string, name: string, description: string | null = null) => ({ id, name, handle: null, description, status: 'idle', spaceId: 'growth', disabledAt: null }) as never
const soul = (agentId: string, snippet: string): WorkspaceSearchHit => ({ kind: 'coworker', agentId, field: 'soul', line: 1, snippet })

let root: Root
const container = () => document.createElement('div')

async function search(query: string, filter?: string) {
    await act(async () => root.render(createElement(ControlCenter)))
    await act(async () => mocks.view!.onQueryChange(query))
    if (filter) await act(async () => mocks.view!.onFilterChange!(filter as never))
    return mocks.view!
}
const hits = (view: ControlCenterViewProps) => view.sections.find(section => section.id === 'hits')!
const chip = (view: ControlCenterViewProps, value: string) => view.chips!.find(entry => entry.value === value)!.count

beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    mocks.machine = { hits: [], loading: false, unavailable: false, truncated: false }
    mocks.conversations = { hits: [], loading: false }
    useBoardStore.setState({ hydrated: true, agents: [coworker('ada', 'Ada'), coworker('noor', 'Noor')], spaces: [{ id: 'growth', name: 'Growth' }] as never })
    useControlCenterStore.setState({ open: true })
    root = createRoot(container())
})

afterEach(async () => {
    await act(async () => root.unmount())
})

describe('the global search of the control center', () => {
    it('keeps the coworker found by its name, whose soul says the name too, and shows the soul of the others', async () => {
        mocks.machine.hits = [soul('ada', 'You are Ada.'), soul('noor', 'Ask Ada first.')]
        const rows = hits(await search('ada')).rows
        expect(rows.map(row => [row.id, !!row.onDrill])).toEqual([
            ['hits-agent-ada', true],
            ['hits-soul-noor', false],
        ])
    })

    it('says what could not be searched rather than a zero', async () => {
        mocks.machine.unavailable = true
        const view = await search('zzz')
        expect(hits(view).notice).toBe('Souls, skills, files, the Brain and tables could not be searched.')
        expect(['all', 'coworker', 'file', 'table'].map(value => chip(view, value))).toEqual(['unknown', 'unknown', 'unknown', 'unknown'])
        expect(chip(view, 'conversation')).toBe(0)
        const conversations = await search('zzz', 'conversation')
        expect(hits(conversations).notice).toBeUndefined()
    })

    it('says when the search stopped early', async () => {
        mocks.machine.truncated = true
        const view = await search('zzz')
        expect(hits(view).notice).toBe('The search stopped early, some results may be missing.')
        expect(chip(view, 'file')).toBe(0)
    })

    it('does not say nothing was found while the conversations load', async () => {
        mocks.conversations.loading = true
        expect(hits(await search('zzz')).loading).toBe(true)
        expect(hits(await search('zzz', 'conversation')).loading).toBe(true)
        expect(hits(await search('zzz', 'file')).loading).toBe(false)
    })
})

describe('ControlCenterPanel', () => {
    const panel = (section: object, count: 'pending' | 'unknown' | number) =>
        createElement(ControlCenterPanel, {
            query: 'zzz',
            onQueryChange: () => {},
            placeholder: '',
            pageKey: 'root',
            depth: 0,
            crumbs: [],
            onBack: () => {},
            emptyLabel: '',
            mod: 'Ctrl',
            chips: [{ value: 'file', label: 'Files', count }],
            filter: 'file',
            onFilterChange: () => {},
            sections: [{ id: 'hits', heading: 'Files', rows: [], emptyMessage: 'Nothing here', ...section }],
        })

    it('shows the notice in place of the empty message, and no number where nothing was searched', async () => {
        const host = container()
        document.body.append(host)
        const own = createRoot(host)
        await act(async () => own.render(panel({ notice: 'Could not be searched' }, 'unknown')))
        expect(host.textContent).toContain('Could not be searched')
        expect(host.textContent).not.toContain('Nothing here')
        expect(host.querySelector('[aria-pressed="true"]')!.textContent).toBe('Files')
        await act(async () => own.render(panel({}, 0)))
        expect(host.textContent).toContain('Nothing here')
        expect(host.querySelector('[aria-pressed="true"]')!.textContent).toBe('Files0')
        await act(async () => own.unmount())
    })
})
