import { beforeEach, describe, expect, it, vi } from 'vitest'

import { blobUrl } from '@/lib/blobs/catalog'
import { workspaceNameFrom } from '@/lib/naming/workspace-name'
import { faviconUrl } from '@/lib/onboarding/site-favicon'
import { fakeSupabase, type FakeSupabase } from '@/test/supabase-fake'

const WORKSPACE_ID = 7
const FOUNDER = 'user-1'
const COMPANY = { company_name: 'Acme', company_url: 'https://acme.com' }

let service: FakeSupabase
let session: { user_metadata: Record<string, unknown> } | null = null
let account: { user_metadata: Record<string, unknown> } | null = null
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => service.client }))
vi.mock('@/supabase/session/getServerSession', () => ({ getServerSession: async () => ({ session }), getAuthUser: async () => account }))
vi.mock('@/app/api/_auth/ownership', () => ({ workspaceFounderUserId: async () => FOUNDER }))

const { ensureWorkspaceNamed } = await import('./naming.service')

function workspaceWithIcon(iconUrl: string | null) {
    service = fakeSupabase(table => {
        if (table === 'workspaces') return { data: { id: WORKSPACE_ID, name: 'My workspace', icon_url: iconUrl, is_sandbox: false } }
        if (table === 'workspace_onboarding') return { data: { answers: COMPANY } }
        return undefined
    })
}

const iconWritten = () => (service.writes('workspaces')[0]?.payload as { icon_url?: string } | undefined)?.icon_url

beforeEach(() => {
    session = null
    account = null
    vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(null, { status: 200 }))
    )
})

describe('ensureWorkspaceNamed and the company favicon', () => {
    it('gives the favicon to a workspace with no icon', async () => {
        workspaceWithIcon(null)

        await ensureWorkspaceNamed({ workspaceId: WORKSPACE_ID, userId: FOUNDER })

        expect(iconWritten()).toBe(faviconUrl('acme.com'))
    })

    it('replaces an illustration nobody picked', async () => {
        workspaceWithIcon(blobUrl('green-energy-blob.webp'))

        await ensureWorkspaceNamed({ workspaceId: WORKSPACE_ID, userId: FOUNDER })

        expect(iconWritten()).toBe(faviconUrl('acme.com'))
    })

    it('keeps a logo picked by hand', async () => {
        workspaceWithIcon('https://db.rerun.test/storage/v1/object/public/workspace-logos/7/logo.webp')

        await ensureWorkspaceNamed({ workspaceId: WORKSPACE_ID, userId: FOUNDER })

        expect(iconWritten()).toBeUndefined()
    })
})

describe('ensureWorkspaceNamed and the first name', () => {
    it('names the workspace after a first name the token does not carry yet', async () => {
        service = fakeSupabase(table => (table === 'workspaces' ? { data: { id: WORKSPACE_ID, name: 'My workspace', icon_url: null, is_sandbox: false } } : undefined))
        session = { user_metadata: {} }
        account = { user_metadata: { first_name: 'ada' } }

        await ensureWorkspaceNamed({ workspaceId: WORKSPACE_ID, userId: FOUNDER })

        expect(service.writes('workspaces')[0]?.payload).toEqual(expect.objectContaining({ name: workspaceNameFrom({ firstName: 'ada' }) }))
    })
})
