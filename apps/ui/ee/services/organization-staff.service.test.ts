import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ADMIN, AGENCY_HOME, CLIENT, HAVRE, memberRow, NORDLYS, organizationContext, organizationTables, organizationWorld, OWNER, RIVAL_WORKSPACE, workspaceRow, type OrganizationWorld } from '@/ee/test/organization-world'
import type { SupabaseCall } from '@/test/supabase-fake'
import { writeMethodOf } from '@/test/supabase-fake'

const mocks = vi.hoisted(() => ({ client: null as unknown, revokeMemberComputers: vi.fn(async () => {}) }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => mocks.client }))
vi.mock('@/supabase/session/getServerSession', () => ({ getSessionIdentity: vi.fn() }))
vi.mock('@rerun/cloud/organizations', () => ({ ORGANIZATIONS_ENABLED: true }))
vi.mock('@rerun/cloud/illustrations', () => ({ ILLUSTRATION_ENTRIES: [] }))
vi.mock('@/app/api/_services/remote-computers.service', () => ({ revokeMemberComputers: mocks.revokeMemberComputers }))

const { leaveOrganizations, openOrganizationWorkspace, removeStaff, removeStaffFromWorkspace } = await import('./organization-staff.service')

let world: OrganizationWorld

function open(overrides = {}, before?: (table: string, calls: readonly SupabaseCall[]) => undefined) {
    world = organizationWorld(overrides, before)
    mocks.client = world.client
}

const membership = (userId: string, workspaceId: number) => world.rows('workspace_members').find(row => row.user_id === userId && row.workspace_id === workspaceId)
const currentOf = (userId: string) => world.rows('users').find(row => row.id === userId)!.workspace_id

beforeEach(() => {
    vi.clearAllMocks()
    open()
})

describe('opening a client’s workspace', () => {
    it('makes the caller an invisible admin of it and takes them there', async () => {
        await openOrganizationWorkspace(organizationContext(world, { role: 'admin', userId: ADMIN }), CLIENT)
        expect(membership(ADMIN, CLIENT)).toMatchObject({ role: 'admin', organization_staff: true })
        expect(currentOf(ADMIN)).toBe(CLIENT)
    })

    it('is the same twice', async () => {
        const ctx = organizationContext(world)
        await Promise.all([openOrganizationWorkspace(ctx, CLIENT), openOrganizationWorkspace(ctx, CLIENT)])
        expect(world.rows('workspace_members').filter(row => row.user_id === OWNER && row.workspace_id === CLIENT)).toHaveLength(1)
    })

    it('leaves an ordinary member ordinary, with the role they have', async () => {
        world.rows('workspace_members').push(memberRow(OWNER, CLIENT, { role: 'member' }))
        await openOrganizationWorkspace(organizationContext(world), CLIENT)
        expect(membership(OWNER, CLIENT)).toMatchObject({ role: 'member', organization_staff: false })
        expect(currentOf(OWNER)).toBe(CLIENT)
    })

    it('refuses another organization’s', async () => {
        await expect(openOrganizationWorkspace(organizationContext(world), RIVAL_WORKSPACE)).rejects.toMatchObject({ code: 'workspaceNotFound' })
        expect(membership(OWNER, RIVAL_WORKSPACE)).toBeUndefined()
        expect(currentOf(OWNER)).toBe(AGENCY_HOME)
    })

    it('leaves nothing behind when the caller is taken off the team meanwhile', async () => {
        open({}, (table, calls) => {
            if (table === 'workspace_members' && writeMethodOf(calls) === 'upsert') world.tables.organization_members = world.rows('organization_members').filter(row => row.user_id !== ADMIN)
            return undefined
        })
        await expect(openOrganizationWorkspace(organizationContext(world, { role: 'admin', userId: ADMIN }), CLIENT)).rejects.toMatchObject({ code: 'notAuthorized' })
        expect(membership(ADMIN, CLIENT)).toBeUndefined()
        expect(currentOf(ADMIN)).toBe(AGENCY_HOME)
    })
})

describe('a workspace that leaves the organization', () => {
    it('loses its team and nobody else', async () => {
        await openOrganizationWorkspace(organizationContext(world), CLIENT)
        world.rows('workspace_members').push(memberRow(OWNER, RIVAL_WORKSPACE, { organization_staff: true }))
        await removeStaffFromWorkspace(world.client, CLIENT)
        expect(membership(OWNER, CLIENT)).toBeUndefined()
        expect(membership(OWNER, RIVAL_WORKSPACE)).toBeDefined()
        expect(world.rows('workspace_members').some(row => row.workspace_id === CLIENT && !row.organization_staff)).toBe(true)
        expect(currentOf(OWNER)).toBe(AGENCY_HOME)
        expect(mocks.revokeMemberComputers).toHaveBeenCalledExactlyOnceWith(CLIENT, OWNER)
    })

    it('is not opened by someone who was opening it meanwhile', async () => {
        open({}, (table, calls) => {
            if (table === 'workspace_members' && writeMethodOf(calls) === 'upsert') world.rows('workspaces').find(row => row.id === CLIENT)!.organization_id = null
            return undefined
        })
        await expect(openOrganizationWorkspace(organizationContext(world), CLIENT)).rejects.toMatchObject({ code: 'notAuthorized' })
        expect(membership(OWNER, CLIENT)).toBeUndefined()
        expect(currentOf(OWNER)).toBe(AGENCY_HOME)
    })
})

describe('leaving the team', () => {
    it('takes every staff row of the organization, and the person back to a workspace of their own', async () => {
        open({ workspaces: [...organizationTables().workspaces, workspaceRow(21)] })
        for (const id of [CLIENT, 21]) await openOrganizationWorkspace(organizationContext(world), id)
        await removeStaff(world.client, NORDLYS, OWNER)

        expect(membership(OWNER, CLIENT)).toBeUndefined()
        expect(membership(OWNER, 21)).toBeUndefined()
        expect(membership(OWNER, AGENCY_HOME)).toBeDefined()
        expect(currentOf(OWNER)).toBe(AGENCY_HOME)
        expect(mocks.revokeMemberComputers).toHaveBeenCalledWith(CLIENT, OWNER)
    })

    it('keeps an ordinary membership, and the staff rows of another organization', async () => {
        world.rows('workspace_members').push(memberRow(OWNER, CLIENT), memberRow(OWNER, RIVAL_WORKSPACE, { organization_staff: true }))
        await removeStaff(world.client, NORDLYS, OWNER)
        expect(membership(OWNER, CLIENT)).toBeDefined()
        expect(membership(OWNER, RIVAL_WORKSPACE)).toBeDefined()
    })

    it('opens a workspace for someone left with none, so that their account outlives it', async () => {
        world.tables.workspace_members = world.rows('workspace_members').filter(row => row.user_id !== ADMIN)
        await openOrganizationWorkspace(organizationContext(world, { role: 'admin', userId: ADMIN }), CLIENT)
        await removeStaff(world.client, NORDLYS, ADMIN)

        const home = currentOf(ADMIN) as number
        expect(home).not.toBe(CLIENT)
        expect(membership(ADMIN, home)).toMatchObject({ role: 'admin', organization_staff: false })
        expect(world.rows('workspaces').find(row => row.id === home)).toMatchObject({ organization_id: null, rerun_budget_micros: 0, rerun_topup_micros: 0 })
    })

    it('leaves the workspace they are in alone when it is not one of these', async () => {
        world.rows('workspace_members').push(memberRow(OWNER, CLIENT, { organization_staff: true }))
        await removeStaff(world.client, NORDLYS, OWNER)
        expect(currentOf(OWNER)).toBe(AGENCY_HOME)
    })

    it('does it for every team before an account goes', async () => {
        world.rows('organization_members').push({ organization_id: HAVRE, user_id: OWNER, role: 'admin', created_at: '2026-11-05T00:00:00Z' })
        world.rows('workspace_members').push(memberRow(OWNER, CLIENT, { organization_staff: true }), memberRow(OWNER, RIVAL_WORKSPACE, { organization_staff: true }))
        await leaveOrganizations(OWNER)
        expect(world.rows('organization_members').filter(row => row.user_id === OWNER)).toEqual([])
        expect(world.rows('workspace_members').filter(row => row.user_id === OWNER && row.organization_staff)).toEqual([])
    })
})
