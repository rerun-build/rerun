// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CustomMcpLiveStatus } from '@/lib/services/types'

// RER-401: the card answered "connected" on a status probed before the token expired, and the agent
// went straight back to "needs sign-in". It now offers Continue only on a probe made since it opened.

vi.mock('@rerun/ui', () => ({ BorderBeam: () => null }))
vi.mock('@/components/agent/McpOAuthAuthorize', () => ({ McpOAuthAuthorize: () => null }))
vi.mock('@/components/services/CustomMcpStatusBadge', () => ({ CustomMcpStatusBadge: () => null }))
vi.mock('@/components/ui/icon', () => ({ Icon: () => null }))
vi.mock('@/hooks/useConnectorServices', () => ({
    invalidateConnectorServices: vi.fn(),
    useConnectorServices: () => ({ map: new Map(), needsConfig: false, loaded: true, custom: [{ name: 'BrowserAct', signInUrl: 'https://mcp.browseract.test/mcp' }] }),
}))

const { McpSignInBlock } = await import('./McpSignInBlock')
const { refreshMcpServerStatuses } = await import('@/hooks/useMcpServerStatuses')

const originalFetch = globalThis.fetch
let liveStatus: CustomMcpLiveStatus
let probes = 0
let container: HTMLDivElement
let root: Root

const flush = () => act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve()
})

beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    probes = 0
    globalThis.fetch = vi.fn(async () => {
        probes++
        return Response.json({ servers: [{ name: 'BrowserAct', status: liveStatus, toolCount: liveStatus === 'connected' ? 3 : 0 }] })
    }) as unknown as typeof fetch
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
    globalThis.fetch = originalFetch
})

async function openCard(agentId: string, onDone = vi.fn()) {
    act(() => root.render(createElement(McpSignInBlock, { agentId, name: 'BrowserAct', onDone, onSkip: vi.fn() })))
    await flush()
    return onDone
}

const buttonLabels = () => [...container.querySelectorAll('button')].map(button => button.textContent)

describe('McpSignInBlock', () => {
    it('asks to connect again when the status read earlier in the page no longer holds', async () => {
        liveStatus = 'connected'
        refreshMcpServerStatuses('agent-stale')
        await flush()
        liveStatus = 'needs_auth'

        await openCard('agent-stale')

        expect(probes).toBe(2)
        expect(buttonLabels()).toContain('Connect')
        expect(buttonLabels()).not.toContain('Continue')
    })

    it('offers to continue once a probe made since it opened says connected', async () => {
        liveStatus = 'connected'
        const onDone = await openCard('agent-fresh')

        expect(probes).toBe(1)
        const proceed = [...container.querySelectorAll('button')].find(button => button.textContent === 'Continue')
        act(() => proceed?.click())
        expect(onDone).toHaveBeenCalledWith('MCP sign-in result:\n- BrowserAct: connected\n\nIts tools are available now. Please continue.')
    })
})
