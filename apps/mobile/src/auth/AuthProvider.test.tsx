import { act, render } from '@testing-library/react-native'
import type { Me } from '@rerun/contracts'
import { useEffect } from 'react'

import { AuthProvider, useAuth } from './AuthProvider'

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void }
function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<T>((res, rej) => {
        resolve = res
        reject = rej
    })
    return { promise, resolve, reject }
}

const meOf = (workspaceId: number, role = 'admin') => ({ workspace: { id: workspaceId, role, subscribed: true } }) as unknown as Me

const mockSession = { user: { id: 'user-1', email: 'person@example.com' }, access_token: 'jwt' }
jest.mock('@/auth/supabase', () => ({
    supabase: {
        auth: {
            getSession: async () => ({ data: { session: mockSession } }),
            onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
            signOut: async () => ({}),
        },
    },
}))
const mockBootstrap = jest.fn<Promise<Me>, [string]>()
jest.mock('@/auth/sign-in', () => ({ bootstrap: (accessToken: string) => mockBootstrap(accessToken) }))
const mockFetchMe = jest.fn<Promise<Me>, [{ accessToken: string; workspaceId: number }]>()
jest.mock('@/api/account', () => ({ fetchMe: (caller: { accessToken: string; workspaceId: number }) => mockFetchMe(caller) }))
jest.mock('@/api/client', () => {
    class ApiError extends Error {
        status: number
        constructor(httpStatus: number) {
            super(`HTTP ${httpStatus}`)
            this.status = httpStatus
        }
    }
    return { ApiError }
})
// The account as the disk would keep it: what `load` is told to keep, as the real cache does.
let mockCached: Me | null = null
jest.mock('@/data/local-cache', () => ({
    cachedMe: () => ({
        read: () => null,
        load: (fetch: () => Promise<Me>, keep?: (value: Me) => boolean) =>
            fetch().then(value => {
                if (keep?.(value) ?? true) mockCached = value
                return value
            }),
    }),
    clearLocalCache: () => {},
}))
const mockStore = new Map<string, string>()
jest.mock('expo-secure-store', () => ({
    getItemAsync: async (key: string) => mockStore.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => void mockStore.set(key, value),
    deleteItemAsync: async (key: string) => void mockStore.delete(key),
}))
jest.mock('@/auth/google', () => ({ forgetGoogleAccount: () => {} }))
jest.mock('@/lib/analytics', () => ({ identifyPerson: () => {}, registerWorkspace: () => {}, forgetPerson: async () => {} }))
jest.mock('@/notifications/push', () => ({ registerDevice: async () => {}, unregisterDevice: async () => {} }))

function Probe({ onAuth }: { onAuth: (value: ReturnType<typeof useAuth>) => void }) {
    const value = useAuth()
    useEffect(() => {
        onAuth(value)
    })
    return null
}

let auth: ReturnType<typeof useAuth>
let rendered: { unmount: () => void } | null = null
afterEach(() => {
    rendered?.unmount()
    rendered = null
})

async function renderSignedIn() {
    rendered = await render(
        <AuthProvider>
            <Probe onAuth={value => (auth = value)} />
        </AuthProvider>
    )
    await act(async () => {})
}

const B = 18259
const A = 1

describe('the active workspace', () => {
    beforeEach(() => {
        mockStore.clear()
        mockCached = null
        mockBootstrap.mockReset()
        mockFetchMe.mockReset()
    })

    it('keeps the workspace a push switched to when the launch read of the account answers after it, on screen and on disk', async () => {
        const launchRead = deferred<Me>()
        mockBootstrap.mockReturnValue(launchRead.promise)
        mockFetchMe.mockImplementation(async ({ workspaceId }) => meOf(workspaceId))
        await renderSignedIn()

        await act(() => auth.switchWorkspace(A))
        await act(async () => launchRead.resolve(meOf(B)))

        expect(auth.me?.workspace.id).toBe(A)
        expect(mockCached?.workspace.id).toBe(A)
    })

    it('follows the last switch asked for when an earlier one answers after it', async () => {
        mockBootstrap.mockResolvedValue(meOf(B))
        await renderSignedIn()

        const C = 42
        const switchToA = deferred<Me>()
        mockFetchMe.mockImplementation(({ workspaceId }) => (workspaceId === A ? switchToA.promise : Promise.resolve(meOf(workspaceId))))
        const switchingToA = auth.switchWorkspace(A)
        await act(() => auth.switchWorkspace(C))
        await act(async () => {
            switchToA.resolve(meOf(A))
            await switchingToA
        })

        expect(auth.me?.workspace.id).toBe(C)
        expect(mockCached?.workspace.id).toBe(C)
        expect(mockStore.get('rerun.workspace-id')).toBe(String(C))
    })

    it('keeps the workspace a push switched to when a refresh of the previous one answers after it', async () => {
        mockBootstrap.mockResolvedValue(meOf(B))
        await renderSignedIn()
        expect(auth.me?.workspace.id).toBe(B)

        const refreshOfB = deferred<Me>()
        mockFetchMe.mockImplementation(({ workspaceId }) => (workspaceId === B ? refreshOfB.promise : Promise.resolve(meOf(workspaceId))))
        const refreshing = auth.refreshMe()
        await act(() => auth.switchWorkspace(A))
        await act(async () => {
            refreshOfB.resolve(meOf(B))
            await refreshing
        })

        expect(auth.me?.workspace.id).toBe(A)
    })

    it('stays on the workspace it was on when the switch is refused, and still takes its refreshes', async () => {
        const { ApiError } = jest.requireMock('@/api/client') as { ApiError: new (status: number) => Error }
        mockBootstrap.mockResolvedValue(meOf(B))
        await renderSignedIn()

        mockFetchMe.mockImplementation(async ({ workspaceId }) => {
            if (workspaceId === A) throw new ApiError(403)
            return meOf(workspaceId, 'member')
        })
        await act(async () => {
            await expect(auth.switchWorkspace(A)).rejects.toThrow('HTTP 403')
        })
        expect(auth.me?.workspace.id).toBe(B)

        await act(() => auth.refreshMe())
        expect(auth.me?.workspace).toMatchObject({ id: B, role: 'member' })
    })
})
