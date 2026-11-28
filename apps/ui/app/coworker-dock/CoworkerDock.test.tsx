// @vitest-environment happy-dom
import { DESKTOP_SHELL_API_VERSION, type CoworkerDockView } from '@rerun/contracts'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key, useLocale: () => 'en' }))
vi.mock('@/stores/board.store', () => ({ useBoardStore: (select: (state: { agents: [] }) => unknown) => select({ agents: [] }) }))

const { CoworkerDock } = await import('./CoworkerDock')

let container: HTMLDivElement
let root: Root

// The dock window has no board of its own: what it draws is only what the shell hands it.
async function renderDock(view: CoworkerDockView) {
    window.rerunShell = {
        apiVersion: DESKTOP_SHELL_API_VERSION,
        capabilities: ['coworkerDock'],
        coworkerDock: { get: async () => view, onChange: () => () => {}, setInteractive: () => {} },
    } as unknown as typeof window.rerunShell
    await act(async () => root.render(createElement(CoworkerDock)))
}

const buddyOf = (id: string) => container.querySelector(`[data-coworker="${id}"]`)

beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
})

afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    delete window.rerunShell
})

describe('CoworkerDock', () => {
    it('dresses each buddy in the look its coworker was given, and leaves the others hashed', async () => {
        await renderDock({
            state: {
                coworkers: [
                    { id: 'dressed', name: 'Dressed', mood: 'idle', pending: 0, look: { eyes: 'heart', mouth: 'cat', color: '#00b862', material: 'fluffy' } },
                    { id: 'plain', name: 'Plain', mood: 'idle', pending: 0 },
                ],
                createBlockedReason: null,
            },
            edge: 'right',
            collapsed: false,
            y: 0.5,
            maxHeight: null,
        })

        expect(buddyOf('dressed')?.querySelector('svg')).not.toBeNull()
        expect(buddyOf('dressed')?.innerHTML).toContain('#00b862')
        expect(buddyOf('dressed')?.innerHTML).toContain('feTurbulence')
        expect(buddyOf('plain')?.innerHTML).not.toContain('feTurbulence')
    })

    it('keeps the hashed look for a look this page cannot draw', async () => {
        await renderDock({
            state: {
                coworkers: [{ id: 'newer', name: 'Newer', mood: 'idle', pending: 0, look: { eyes: 'heart', mouth: 'cat', color: '#00b862', material: 'velvet' } as never }],
                createBlockedReason: null,
            },
            edge: 'right',
            collapsed: false,
            y: 0.5,
            maxHeight: null,
        })

        expect(buddyOf('newer')?.querySelector('svg')).not.toBeNull()
        expect(buddyOf('newer')?.innerHTML).not.toContain('#00b862')
    })
})
