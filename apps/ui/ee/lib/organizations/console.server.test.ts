import { RERUN_BRAND } from '@rerun/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ADMIN, CLIENT, CLIENT_ADMIN, NORDLYS, organizationWorld, OWNER, RIVAL_WORKSPACE, STRANGER, type OrganizationWorld } from '@/ee/test/organization-world'

const mocks = vi.hoisted(() => ({ client: null as unknown, enabled: true, getSessionIdentity: vi.fn() }))
vi.mock('react', async importOriginal => ({ ...(await importOriginal<object>()), cache: (read: unknown) => read }))
vi.mock('next/navigation', () => ({
    notFound: () => {
        throw new Error('NOT FOUND')
    },
    redirect: (to: string) => {
        throw new Error(`REDIRECT ${to}`)
    },
}))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => mocks.client }))
vi.mock('@/supabase/session/getServerSession', () => ({ getSessionIdentity: mocks.getSessionIdentity, getAuthUser: vi.fn(), getServerSession: vi.fn(), getSessionWorkspace: vi.fn() }))
vi.mock('@/lib/brand/server', () => ({ getBrand: async () => RERUN_BRAND }))
vi.mock('@rerun/cloud/organizations', () => ({ get ORGANIZATIONS_ENABLED() { return mocks.enabled } }))
vi.mock('@rerun/cloud/organizations.server', () => ({ organizationBrandOfWorkspace: async () => null, readOrganizationMachine: async () => null, readOrganizationMachines: async () => new Map() }))
vi.mock('@rerun/cloud/illustrations', () => ({ ILLUSTRATION_ENTRIES: [] }))
vi.mock('@rerun/cloud/email', () => ({ EMAIL_DELIVERY: false, sendWorkspaceInviteEmail: vi.fn() }))
vi.mock('next/server', () => ({ after: () => {} }))
vi.mock('@/trigger/sync-agent-activation', () => ({ requestAgentActivationSync: vi.fn() }))
vi.mock('@/app/api/_services/remote-computers.service', () => ({ revokeMemberComputers: vi.fn() }))
vi.mock('@/lib/workspace/read-logo', () => ({ readWorkspaceLogo: vi.fn() }))
vi.mock('@/lib/apps/lifecycle', () => ({ syncWorkspaceAppsSafely: vi.fn() }))

const { openConsole, openConsoleWorkspace } = await import('./console.server')

let world: OrganizationWorld
const signedIn = (id: string) => mocks.getSessionIdentity.mockResolvedValue({ id, email: 'someone@nordlys.test', is_anonymous: false, user_metadata: {}, app_metadata: {} })

beforeEach(() => {
    world = organizationWorld()
    mocks.client = world.client
    mocks.enabled = true
    signedIn(OWNER)
})

describe('openConsole', () => {
    it('opens for the team, owner and admin', async () => {
        await expect(openConsole()).resolves.toMatchObject({ organization: { id: NORDLYS }, role: 'owner' })
        signedIn(ADMIN)
        await expect(openConsole()).resolves.toMatchObject({ role: 'admin' })
    })

    it('opens under a suspended organization, to be read', async () => {
        world.rows('organizations')[0].status = 'suspended'
        await expect(openConsole()).resolves.toMatchObject({ organization: { status: 'suspended' } })
    })

    it('does not exist for a client, a stranger, nor an install without organizations', async () => {
        for (const id of [CLIENT_ADMIN, STRANGER]) {
            signedIn(id)
            await expect(openConsole()).rejects.toThrow('NOT FOUND')
        }
        signedIn(OWNER)
        mocks.enabled = false
        await expect(openConsole()).rejects.toThrow('NOT FOUND')
    })

    it('sends a visitor to the sign-in, then back', async () => {
        mocks.getSessionIdentity.mockResolvedValue(null)
        await expect(openConsole()).rejects.toThrow('REDIRECT /auth?next=%2Forganization')
    })

    it('never takes an outage for an address that does not exist', async () => {
        mocks.getSessionIdentity.mockRejectedValue(new Error('down'))
        await expect(openConsole()).rejects.toThrow('down')
    })
})

describe('openConsoleWorkspace', () => {
    it('opens one of theirs', async () => {
        await expect(openConsoleWorkspace(String(CLIENT))).resolves.toMatchObject({ id: CLIENT, name: 'Acme' })
    })

    it.each([String(RIVAL_WORKSPACE), '999999', '0', '-1', '1e3', `${CLIENT}abc`, '', '9'.repeat(30), '../credit'])('answers %j like one that does not exist', async id => {
        await expect(openConsoleWorkspace(id)).rejects.toThrow('NOT FOUND')
    })
})
