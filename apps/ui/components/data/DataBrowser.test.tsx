// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DataSource } from '@/lib/data/source'
import type { EngineDbTable } from '@/lib/engine/types'

const mocks = vi.hoisted(() => ({ toastError: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError, success: vi.fn() } }))

const { DataBrowser } = await import('./DataBrowser')

const table = (name: string): EngineDbTable => ({ name, columns: [{ name: 'id', type: 'INTEGER', pk: true, notnull: false }] })

function source(listTables: DataSource['listTables']): DataSource {
    return {
        scope: 'agent',
        storageKey: 'agent:test',
        listTables,
        readRows: async () => ({ columns: ['id'], rows: [], total: 0 }),
        deleteRows: async () => ({ success: true }),
        dropTable: async () => ({ success: true }),
        purgeTable: async () => ({ success: true }),
        exportUrl: () => '',
        listViews: async () => ({ success: true, views: [] }),
        saveView: async () => ({ success: false, error: 'unused' }),
        deleteView: async () => ({ success: true }),
        readGroups: async () => ({ success: true, groups: [] }),
        updateRow: async () => ({ success: false, error: 'unused' }),
        unreachableMessage: 'Could not reach the engine for this coworker.',
        emptyTitle: 'No tables yet',
        emptyDescription: 'Your coworker has its own private database.',
    }
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mocks.toastError.mockReset()
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

async function settle() {
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 20))
    })
}

async function mount(src: DataSource, initial: { table: string; view?: string } | null) {
    await act(async () => {
        root.render(createElement(DataBrowser, { source: src, initial, onInitialConsumed: () => {} }))
    })
    await settle()
}

function button(label: string): HTMLButtonElement | undefined {
    return [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === label)
}

describe('opening a coworker database from a table link', () => {
    it('says the database is unavailable when the list cannot be read, without a toast', async () => {
        await mount(
            source(async () => {
                throw new Error('Could not reach the engine for this coworker.')
            }),
            { table: 'prospects', view: 'Prospects 200' }
        )
        expect(container.textContent).toContain('Database unavailable')
        expect(container.textContent).toContain('Could not reach the engine for this coworker.')
        expect(container.textContent).not.toContain('No tables yet')
        expect(mocks.toastError).not.toHaveBeenCalled()
    })

    it('lands on the linked table once Try again reads the list', async () => {
        const listTables = vi
            .fn<DataSource['listTables']>()
            .mockRejectedValueOnce(new Error('Could not reach the engine for this coworker.'))
            .mockResolvedValue([table('prospects')])
        await mount(source(listTables), { table: 'prospects' })

        await act(async () => {
            button('Try again')?.click()
        })
        await settle()

        expect(listTables).toHaveBeenCalledTimes(2)
        expect(container.textContent).toContain('Prospects')
        expect(container.textContent).not.toContain('Database unavailable')
        expect(mocks.toastError).not.toHaveBeenCalled()
    })

    it('shows the empty state alone when the database has no table', async () => {
        await mount(
            source(async () => []),
            { table: 'prospects' }
        )
        expect(container.textContent).toContain('No tables yet')
        expect(mocks.toastError).not.toHaveBeenCalled()
    })

    it('opens another table and says why when the linked one is gone', async () => {
        await mount(
            source(async () => [table('leads')]),
            { table: 'prospects' }
        )
        expect(container.textContent).toContain('Leads')
        expect(mocks.toastError).toHaveBeenCalledTimes(1)
        expect(mocks.toastError).toHaveBeenCalledWith('Table not found', { description: 'prospects' })
    })
})

describe('opening a coworker database from its tab', () => {
    it('shows the empty state of a database with no table, without a toast', async () => {
        await mount(
            source(async () => []),
            null
        )
        expect(container.textContent).toContain('No tables yet')
        expect(mocks.toastError).not.toHaveBeenCalled()
    })
})
