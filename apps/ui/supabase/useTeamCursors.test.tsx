// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ organizationStaff: undefined as boolean | undefined, subscribed: null as ((status: string) => void) | null, receive: null as ((message: { payload: unknown }) => void) | null }))

const channel = {
    state: 'joined',
    on: (kind: string, { event }: { event: string }, listen: (message: { payload: unknown }) => void) => {
        if (kind === 'broadcast' && event === 'cursor') state.receive = listen
        return channel
    },
    subscribe: (callback: (status: string) => void) => {
        state.subscribed = callback
        return channel
    },
    track: vi.fn(),
    send: vi.fn(),
}

vi.mock('@/supabase/client', () => ({ createClient: () => ({ channel: () => channel, getChannels: () => [], removeChannel: async () => {} }) }))
vi.mock('@/supabase/session/SessionProvider', () => ({ useSession: () => ({ session: { user: { id: 'me' } }, organizationStaff: state.organizationStaff }) }))
vi.mock('@/hooks/useMemberProfiles', () => ({ useMemberDirectory: () => (id: string) => (id === 'ada' ? { id, name: 'Ada' } : id === 'organization' ? { id, name: 'Nordlys' } : null) }))

const { useTeamCursors } = await import('./useTeamCursors')

let root: Root | null = null
const drawn = vi.fn<(board: ReturnType<typeof useTeamCursors>) => void>()
const board = () => drawn.mock.lastCall![0]

function Probe() {
    drawn(useTeamCursors(7))
    return null
}

async function openBoard(organizationStaff: boolean | undefined) {
    state.organizationStaff = organizationStaff
    root = createRoot(document.createElement('div'))
    await act(async () => root!.render(createElement(Probe)))
    await act(async () => state.subscribed?.('SUBSCRIBED'))
}

async function learn(organizationStaff: boolean) {
    state.organizationStaff = organizationStaff
    await act(async () => root!.render(createElement(Probe)))
}

beforeEach(() => vi.clearAllMocks())

afterEach(() => {
    act(() => root?.unmount())
    root = null
})

describe('useTeamCursors', () => {
    it('shows a member to the others', async () => {
        await openBoard(false)
        board().onPointerWorldMove({ x: 1, y: 2 })
        expect(channel.track).toHaveBeenCalledWith({ userId: 'me' })
        expect(channel.send).toHaveBeenCalledWith({ type: 'broadcast', event: 'cursor', payload: { userId: 'me', x: 1, y: 2 } })
    })

    it.each([
        ['the team of the organization', true],
        ['anyone while it is not known who they are', undefined],
    ])('never shows %s', async (_who, organizationStaff) => {
        await openBoard(organizationStaff)
        board().onPointerWorldMove({ x: 1, y: 2 })
        board().onPointerWorldMove(null)
        expect(channel.track).not.toHaveBeenCalled()
        expect(channel.send).not.toHaveBeenCalled()
    })

    it('shows a member as soon as they are known to be one', async () => {
        await openBoard(undefined)
        await learn(false)
        board().onPointerWorldMove({ x: 1, y: 2 })
        expect(channel.track).toHaveBeenCalledWith({ userId: 'me' })
        expect(channel.send).toHaveBeenCalledTimes(1)
    })

    it('lets the team of the organization see the members', async () => {
        await openBoard(true)
        await act(async () => state.receive?.({ payload: { userId: 'ada', x: 3, y: 4 } }))
        expect(board().cursors).toMatchObject([{ userId: 'ada', name: 'Ada', x: 3, y: 4 }])
    })

    it('draws no cursor for the brand, nor for an id no member holds', async () => {
        await openBoard(false)
        await act(async () => state.receive?.({ payload: { userId: 'organization', x: 3, y: 4 } }))
        await act(async () => state.receive?.({ payload: { userId: 'staff', name: 'Solveig', x: 3, y: 4 } }))
        expect(board().cursors).toEqual([])
    })
})
