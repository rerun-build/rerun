// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({ role: 'member' as 'admin' | 'member' | null }))

vi.mock('@/supabase/session/SessionProvider', () => ({ useSession: () => ({ user: { id: 'u1' }, role: session.role, boxScope: 'all' }) }))

vi.mock('@/stores/board.store', () => ({ useBoardStore: (select: (state: { agents: never[]; spaces: never[]; spaceGrants: never[] }) => unknown) => select({ agents: [], spaces: [], spaceGrants: [] }) }))

const { useAgentAccess } = await import('./useBoxAccess')

let root: Root
let seen: ReturnType<typeof useAgentAccess>

function Probe({ agentId, onRender }: { agentId: string; onRender: (access: ReturnType<typeof useAgentAccess>) => void }) {
    onRender(useAgentAccess(agentId))
    return null
}

async function accessOn(agentId: string, role: typeof session.role) {
    session.role = role
    await act(async () => root.render(createElement(Probe, { agentId, key: `${agentId}:${role}`, onRender: access => (seen = access) })))
    return seen
}

beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    root = createRoot(document.createElement('div'))
})

afterEach(() => {
    act(() => root.unmount())
})

describe('useAgentAccess', () => {
    // The Chief of Staff sits in no Box, so no Box's rule can answer for it.
    it('lets every member reach the Chief of Staff and a workspace admin change what it keeps', async () => {
        expect(await accessOn('foreman', 'member')).toBe('use')
        expect(await accessOn('foreman', 'admin')).toBe('manage')
    })

    it('gives nothing while the session is still loading', async () => {
        expect(await accessOn('foreman', null)).toBe('none')
    })

    it('still answers none for a coworker the board does not hold', async () => {
        expect(await accessOn('unknown', 'admin')).toBe('none')
    })
})
