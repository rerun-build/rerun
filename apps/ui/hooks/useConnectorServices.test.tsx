// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Several parts of an opening chat read the coworker's connectors at once: the chat, its panel, each
// tool row. A second one arriving while the first read was under way used to queue a second read of
// the same registry behind it.

const mocks = vi.hoisted(() => ({ listAgentConnectorsAction: vi.fn() }))

vi.mock('@/app/api/_actions/custom-mcp.actions', () => ({ listAgentConnectorsAction: mocks.listAgentConnectorsAction }))

let root: Root | null = null
let container: HTMLElement | null = null
let release: (value: { services: never[]; custom: never[] }) => void = () => {}

describe('useConnectorServices', () => {
    beforeEach(() => {
        vi.resetModules()
        mocks.listAgentConnectorsAction.mockReset().mockImplementation(() => new Promise(resolve => (release = resolve)))
    })
    afterEach(() => {
        act(() => root?.unmount())
        root = null
        container?.remove()
    })

    async function mountTwoReaders() {
        const { useConnectorServices } = await import('./useConnectorServices')
        const loaded: boolean[] = []
        function Reader() {
            loaded.push(useConnectorServices('agent-1').loaded)
            return null
        }
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
        await act(async () => root!.render(createElement('div', null, createElement(Reader), createElement(Reader))))
        return loaded
    }

    it('reads the connectors once for readers that mount together', async () => {
        const loaded = await mountTwoReaders()
        expect(mocks.listAgentConnectorsAction).toHaveBeenCalledTimes(1)

        await act(async () => release({ services: [], custom: [] }))

        expect(mocks.listAgentConnectorsAction).toHaveBeenCalledTimes(1)
        expect(loaded.at(-1)).toBe(true)
    })

    it('still reads again when a change is announced while the first read runs', async () => {
        await mountTwoReaders()
        const { invalidateConnectorServices } = await import('./useConnectorServices')
        invalidateConnectorServices('agent-1')

        await act(async () => release({ services: [], custom: [] }))

        expect(mocks.listAgentConnectorsAction).toHaveBeenCalledTimes(2)
    })
})
