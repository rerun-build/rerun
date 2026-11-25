import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { HostScope } from '@/lib/workspace/host-workspace'

const mocks = vi.hoisted(() => ({
    requested: null as number | null,
    page: true,
    scope: null as { organizationId: string | null } | null,
    cookie: undefined as string | undefined,
    memberships: [] as { workspace_id: number; created_at: string; user_id: string }[],
    stored: 1,
    reads: [] as string[],
}))

// One's own, two of Nordlys', one of Havre's.
const OWNERS: Record<number, string | null> = { 1: null, 2: 'nordlys', 3: 'nordlys', 4: 'havre' }

vi.mock('react', () => ({ cache: <T>(fn: T) => fn }))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (name: string) => (name === 'rerun-last-workspace' && mocks.cookie ? { value: mocks.cookie } : undefined) }) }))
vi.mock('@/lib/brand/host-scope', () => ({ requestHostScope: async () => mocks.scope }))
vi.mock('@/supabase/server', () => ({
    createClient: async () => ({ auth: { getClaims: async () => ({ data: { claims: { sub: 'u1', email: 'me@acme.test' } } }) } }),
    getRequestAccessToken: async () => null,
    getRequestWorkspaceId: async () => mocks.requested,
    isPageRequest: async () => mocks.page,
}))
vi.mock('../supabase-helpers', () => ({
    selectSingle: async (_c: unknown, table: string, _cols: unknown, filters: { id?: number }) => (table === 'users' ? { data: { id: 'u1', workspace_id: mocks.stored } } : { data: { id: filters.id, organization_id: OWNERS[filters.id!] } }),
    selectMaybeSingle: async (_c: unknown, table: string, _cols: unknown, filters: { workspace_id?: number; id?: number }) => {
        mocks.reads.push(table)
        if (table === 'workspaces') return { data: filters.id! in OWNERS ? { organization_id: OWNERS[filters.id!] } : null }
        return { data: mocks.memberships.some(row => row.workspace_id === filters.workspace_id) ? { workspace_id: filters.workspace_id, role: 'member', box_scope: 'all', organization_staff: filters.workspace_id === 3 } : null }
    },
    selectMany: async (_c: unknown, table: string, _cols: unknown, filters: { id?: number[] }) => {
        mocks.reads.push(`${table}[]`)
        return { data: table === 'workspace_members' ? mocks.memberships : filters.id!.map(id => ({ id, organization_id: OWNERS[id] })) }
    },
}))

const { getServerSession, getSessionWorkspace } = await import('./getServerSession')

const on = (scope: HostScope | null) => {
    mocks.scope = scope
}
const member = (...ids: number[]) => {
    mocks.memberships = ids.map((workspace_id, index) => ({ user_id: 'u1', workspace_id, created_at: `2026-11-0${index + 1}` }))
}
const opened = async () => (await getServerSession()).user?.workspace_id ?? null

beforeEach(() => {
    mocks.requested = null
    mocks.page = true
    mocks.cookie = undefined
    mocks.stored = 1
    mocks.reads = []
    member(1, 2, 3, 4)
    on(null)
})

describe('where organizations have no address', () => {
    it('follows the stored workspace, with the one read it always made', async () => {
        mocks.stored = 4
        expect(await opened()).toBe(4)
        expect(mocks.reads).toEqual(['workspace_members'])
    })
})

describe('on an organization’s address', () => {
    beforeEach(() => on({ organizationId: 'nordlys' }))

    it('opens the stored workspace when it is one of its', async () => {
        mocks.stored = 3
        expect(await opened()).toBe(3)
    })

    it('opens the one last opened there when the stored one is elsewhere', async () => {
        mocks.stored = 4
        mocks.cookie = '3'
        expect(await opened()).toBe(3)
    })

    it.each(['1', '4', '99', 'x', '2;3'])('does not follow a cookie that says %j out of it', async cookie => {
        mocks.cookie = cookie
        expect(await opened()).toBe(2)
    })

    it('opens the one joined first with nothing to go by', async () => {
        expect(await opened()).toBe(2)
    })

    it('opens the staff’s own row like a member’s', async () => {
        member(3)
        const session = await getServerSession()
        expect(session.user?.workspace_id).toBe(3)
        expect(session.membership?.organization_staff).toBe(true)
    })

    it('chooses for what is not a page too: a callback, a call with a token', async () => {
        mocks.page = false
        expect(await opened()).toBe(2)
    })

    it('opens nothing for someone with none of its workspaces, who stays signed in', async () => {
        member(1, 4)
        const session = await getServerSession()
        expect(session).toMatchObject({ user: null, workspace: null, workspaceRefused: true, session: { id: 'u1' } })
    })

    it('takes the workspace a tab names when it is one of its', async () => {
        mocks.requested = 3
        expect(await opened()).toBe(3)
    })

    it.each([1, 4, 99])('refuses workspace %i named by a tab rather than act in another', async requested => {
        mocks.requested = requested
        const session = await getSessionWorkspace()
        expect(session.user).toBeNull()
        expect(session.workspaceRefused).toBe(true)
    })

    it('refuses one of its that they were removed from', async () => {
        member(1, 2)
        mocks.requested = 3
        expect(await opened()).toBeNull()
    })

    it('refuses a header that is not an id', async () => {
        mocks.requested = Number.NaN
        expect(await opened()).toBeNull()
    })
})

describe('two agencies and the same person', () => {
    it('opens each one’s own on each address', async () => {
        on({ organizationId: 'nordlys' })
        expect(await opened()).toBe(2)
        on({ organizationId: 'havre' })
        expect(await opened()).toBe(4)
    })
})

describe('on Rerun’s own address', () => {
    beforeEach(() => on({ organizationId: null }))

    it('opens a page on one’s own workspace, whatever was opened last', async () => {
        mocks.stored = 4
        expect(await opened()).toBe(1)
    })

    it('keeps the stored one for someone who has nothing but organizations’, whose page is then sent away', async () => {
        member(2)
        mocks.stored = 2
        expect(await opened()).toBe(2)
    })

    it('changes nothing for what is not a page: a phone, a provider coming back, a call', async () => {
        mocks.page = false
        mocks.stored = 4
        expect(await opened()).toBe(4)
        expect(mocks.reads).toEqual(['workspace_members'])
    })

    it('takes whatever workspace a tab or a phone names, as before', async () => {
        mocks.requested = 2
        expect(await opened()).toBe(2)
        expect(mocks.reads).toEqual(['workspace_members'])
    })
})

describe('on a host that is nobody’s', () => {
    it('opens nothing', async () => {
        on({ organizationId: 'nobody' })
        expect(await opened()).toBeNull()
    })
})
