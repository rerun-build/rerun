// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type AuthEvent = 'INITIAL_SESSION' | 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED'
type Read = { table: string; filters: unknown }

const mocks = vi.hoisted(() => ({
    onAuth: null as null | ((event: AuthEvent, session: { user: { id: string; email?: string } } | null) => void),
    reads: [] as Read[],
    pending: [] as Array<() => void>,
    rows: {} as Record<string, unknown>,
    urlWorkspace: null as number | null,
    tabWorkspace: null as number | null,
    signOut: vi.fn<(options?: { scope: string }) => Promise<void>>(async () => {}),
    resetCrisp: vi.fn(),
}))

// Every read waits until the test lets it through: what the provider shows before that came from
// somewhere else than a read.
function heldRead(table: string, filters: unknown, many = false) {
    mocks.reads.push({ table, filters })
    const row = mocks.rows[table] ?? null
    return new Promise(resolve => mocks.pending.push(() => resolve({ data: many ? (row ? [row] : []) : row, error: null })))
}

vi.mock('@/supabase/client', () => ({
    createClient: () => ({
        auth: {
            onAuthStateChange: (callback: typeof mocks.onAuth) => {
                mocks.onAuth = callback
                return { data: { subscription: { unsubscribe: () => {} } } }
            },
            signOut: mocks.signOut,
        },
    }),
}))
vi.mock('../supabase-helpers', () => ({
    selectSingle: (_client: unknown, table: string, _columns: unknown, filters: unknown) => heldRead(table, filters),
    selectMaybeSingle: (_client: unknown, table: string, _columns: unknown, filters: unknown) => heldRead(table, filters),
    selectMany: (_client: unknown, table: string, _columns: unknown, filters: unknown) => heldRead(table, filters, true),
}))
vi.mock('@/lib/workspace/tab-workspace', () => ({
    installWorkspaceHeader: () => {},
    readUrlWorkspace: () => mocks.urlWorkspace,
    readTabWorkspace: () => mocks.tabWorkspace,
    pinTabWorkspace: (id: number) => {
        mocks.tabWorkspace = id
    },
    clearTabWorkspace: () => {
        mocks.tabWorkspace = null
    },
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }))
vi.mock('@/supabase/useRealtimeSubscription', () => ({ useRealtimeSubscription: () => {} }))
vi.mock('@/hooks/usePresenceHeartbeat', () => ({ usePresenceHeartbeat: () => {} }))
vi.mock('@/stores/board.store', () => ({ useBoardStore: { getState: () => ({ reset: () => {} }) } }))
vi.mock('@/stores/foreman.store', () => ({ useForemanStore: { getState: () => ({ reset: () => {} }) } }))
vi.mock('@/lib/workspace/workspace-switch', () => ({ enterActiveWorkspace: () => {}, isWorkspaceSwitchInFlight: () => false }))
vi.mock('posthog-js', () => ({ default: { register: () => {}, unregister: () => {}, reset: () => {}, setPersonProperties: () => {} } }))
vi.mock('@rerun/analytics/client', () => ({ track: () => {}, readAttribution: () => ({}), getCookie: () => undefined, identifyPerson: () => {}, setSharedCookie: () => {}, deleteSharedCookie: () => {} }))
vi.mock('@rerun/analytics/experiments', () => ({ experimentProperties: () => ({}), readExperimentCookie: () => ({}), STALE_EXPERIMENT_PROPERTIES: [], writeExperimentVariants: () => {} }))
vi.mock('@rerun/cloud/billing', () => ({ parsePriceArm: () => null, PRICE_EXPERIMENT_KEY: 'price', PRICE_PROPERTY: 'price', isSubscriptionEntitled: () => false, TRIAL_CARD_PROPERTY: 'trial', trialArm: () => null }))
vi.mock('@/lib/crisp', () => ({ resetCrisp: mocks.resetCrisp }))
vi.mock('@rerun/cloud/phone', () => ({ PHONE_STATUS_COLUMNS: ['user_id'], phoneStatusOf: () => 'verified' }))

const { SessionProvider, useSession } = await import('./SessionProvider')

const USER = { id: 'u1', created_at: '2026-01-01T00:00:00Z', workspace_id: 7, email_notification_prefs: null, account_role: 'user', expert_profile_id: null, signed_up_at: '2026-01-01T00:00:00Z', locale: null }
const WORKSPACE = { id: 7, name: 'Acme', onboarded_at: '2026-01-02T00:00:00Z' }
const INITIAL = { user: USER, workspace: WORKSPACE, role: 'admin', boxScope: 'all' } as never

let root: Root
let seen: ReturnType<typeof useSession>

function Probe({ onRender }: { onRender: (session: ReturnType<typeof useSession>) => void }) {
    onRender(useSession())
    return null
}

async function mount(initial: unknown) {
    await act(async () => root.render(createElement(SessionProvider, { initial: initial as never }, createElement(Probe, { onRender: session => (seen = session) }))))
}

async function authEvent(event: AuthEvent, userId: string | null) {
    await act(async () => mocks.onAuth?.(event, userId ? { user: { id: userId } } : null))
}

async function releaseReads() {
    while (mocks.pending.length) {
        const pending = mocks.pending.splice(0)
        await act(async () => {
            for (const release of pending) release()
        })
    }
}

const readTables = () => mocks.reads.map(read => read.table)

beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    mocks.onAuth = null
    mocks.reads = []
    mocks.pending = []
    mocks.rows = { users: USER, workspaces: WORKSPACE, workspace_members: { role: 'member', box_scope: 'assigned', workspace_id: 7 } }
    mocks.urlWorkspace = null
    mocks.tabWorkspace = null
    mocks.resetCrisp.mockClear()
    root = createRoot(document.createElement('div'))
})

afterEach(() => {
    act(() => root.unmount())
})

describe('SessionProvider with the session the server read', () => {
    it('renders like before until the browser knows its account: the HTML of the server stays the same', async () => {
        await mount(INITIAL)
        expect(seen.user).toBeNull()
        expect(seen.loading).toBe(true)
    })

    it('shows the user, the workspace and the role as soon as the session is known, without waiting for a read', async () => {
        await mount(INITIAL)
        await authEvent('INITIAL_SESSION', 'u1')
        expect(mocks.pending.length).toBeGreaterThan(0)
        expect(seen.user?.id).toBe('u1')
        expect(seen.workspace?.id).toBe(7)
        expect(seen.role).toBe('admin')
        expect(seen.boxScope).toBe('all')
        expect(seen.loading).toBe(false)
    })

    it('still reads them again behind it, and keeps what the reads find', async () => {
        await mount(INITIAL)
        await authEvent('INITIAL_SESSION', 'u1')
        await releaseReads()
        expect(readTables()).toEqual(expect.arrayContaining(['users', 'workspaces', 'workspace_members']))
        expect(seen.role).toBe('member')
        expect(seen.boxScope).toBe('assigned')
        expect(seen.loading).toBe(false)
    })

    it('ignores it in a tab pinned to another workspace', async () => {
        mocks.tabWorkspace = 9
        await mount(INITIAL)
        await authEvent('INITIAL_SESSION', 'u1')
        expect(seen.user).toBeNull()
        expect(seen.loading).toBe(true)
    })

    it('ignores it when the address names a workspace', async () => {
        mocks.urlWorkspace = 7
        await mount(INITIAL)
        await authEvent('INITIAL_SESSION', 'u1')
        expect(seen.user).toBeNull()
        expect(seen.loading).toBe(true)
    })

    it('ignores it when the browser holds another account', async () => {
        await mount(INITIAL)
        await authEvent('INITIAL_SESSION', 'u2')
        expect(seen.user).toBeNull()
        expect(seen.loading).toBe(true)
    })

    it('is used once: signing in again later goes through the reads', async () => {
        await mount(INITIAL)
        await authEvent('INITIAL_SESSION', null)
        await authEvent('SIGNED_IN', 'u1')
        expect(seen.user).toBeNull()
        await releaseReads()
        expect(seen.user?.id).toBe('u1')
    })
})

describe('SessionProvider without it', () => {
    it('reads the users row once, as before', async () => {
        await mount(null)
        await authEvent('INITIAL_SESSION', 'u1')
        expect(seen.user).toBeNull()
        await releaseReads()
        expect(readTables().filter(table => table === 'users')).toHaveLength(1)
        expect(seen.user?.id).toBe('u1')
        expect(seen.workspace?.id).toBe(7)
        expect(seen.loading).toBe(false)
    })

    it('reads nothing for a visitor without a session', async () => {
        await mount(null)
        await authEvent('INITIAL_SESSION', null)
        expect(readTables()).toEqual([])
        expect(seen.user).toBeNull()
    })
})

describe('SessionProvider signing out', () => {
    it('closes the session of this browser only', async () => {
        await mount(INITIAL)
        await authEvent('INITIAL_SESSION', 'u1')
        await act(async () => seen.signOut())
        expect(mocks.signOut).toHaveBeenCalledExactlyOnceWith({ scope: 'local' })
    })
})

// The support chat stays loaded in the tab: whoever signs in next on this browser must not read the
// conversation of the account that left.
describe('SessionProvider and the support chat', () => {
    it('empties it when the account signs out', async () => {
        await mount(INITIAL)
        await authEvent('INITIAL_SESSION', 'u1')
        await authEvent('SIGNED_OUT', null)
        expect(mocks.resetCrisp).toHaveBeenCalledOnce()
    })

    it('empties it when another account signs in in its place', async () => {
        await mount(INITIAL)
        await authEvent('INITIAL_SESSION', 'u1')
        await authEvent('SIGNED_IN', 'u2')
        expect(mocks.resetCrisp).toHaveBeenCalledOnce()
    })

    it('keeps it for the same account, and on a first sign-in', async () => {
        await mount(null)
        await authEvent('INITIAL_SESSION', null)
        await authEvent('SIGNED_IN', 'u1')
        await authEvent('TOKEN_REFRESHED', 'u1')
        await authEvent('SIGNED_IN', 'u1')
        expect(mocks.resetCrisp).not.toHaveBeenCalled()
    })
})
