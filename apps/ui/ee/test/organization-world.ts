import type { OrganizationContext, OrganizationRole, OrganizationRow } from '@/ee/services/organization-context.service'
import { memoryDatabase, type MemoryRow, type MemoryTables } from '@/ee/test/memory-database'
import type { SupabaseCall, SupabaseResult } from '@/test/supabase-fake'

// Two agencies, one client each, and their people.
export const NORDLYS = '00000000-0000-4000-8000-0000000e0001'
export const HAVRE = '00000000-0000-4000-8000-0000000e0002'
export const OWNER = '00000000-0000-4000-8000-0000000a0001'
export const ADMIN = '00000000-0000-4000-8000-0000000a0002'
export const RIVAL = '00000000-0000-4000-8000-0000000a0003'
export const CLIENT_ADMIN = '00000000-0000-4000-8000-0000000a0004'
export const RIVAL_CLIENT = '00000000-0000-4000-8000-0000000a0005'
export const STRANGER = '00000000-0000-4000-8000-0000000a0006'
export const AGENCY_HOME = 10
export const CLIENT = 20
export const RIVAL_WORKSPACE = 30

export const EMAILS: Record<string, string> = { [OWNER]: 'owner@nordlys.test', [ADMIN]: 'admin@nordlys.test', [RIVAL]: 'owner@havre.test', [CLIENT_ADMIN]: 'client@acme.test', [RIVAL_CLIENT]: 'client@rival.test', [STRANGER]: 'stranger@else.test' }

export function organizationRow(overrides: MemoryRow = {}): MemoryRow {
    return { id: NORDLYS, name: 'Nordlys', slug: 'nordlys', status: 'active', max_workspaces: 3, icon_url: 'https://cdn.test/nordlys.webp', color: '#0a7d5a', support_email: 'help@nordlys.test', docs_url: null, terms_url: null, privacy_url: null, ...overrides }
}

export function workspaceRow(id: number, overrides: MemoryRow = {}): MemoryRow {
    return {
        id,
        name: `Workspace ${id}`,
        icon_url: null,
        locale: 'en',
        max_seats: null,
        max_agents: null,
        created_at: `2026-11-01T00:00:${String(id).padStart(2, '0')}.000Z`,
        last_active_at: null,
        plan: 'organization',
        subscription_status: 'active',
        organization_id: NORDLYS,
        organization_archived_at: null,
        boxes_archived_at: null,
        boxes_disabled_at: null,
        stripe_customer_id: null,
        rerun_budget_micros: 0,
        rerun_used_micros: 0,
        rerun_topup_micros: 0,
        rerun_period_anchor: null,
        ...overrides,
    }
}

let joined = 0

export function memberRow(userId: string, workspaceId: number, overrides: MemoryRow = {}): MemoryRow {
    joined += 1
    return { user_id: userId, workspace_id: workspaceId, role: 'admin', box_scope: 'all', organization_staff: false, created_at: new Date(Date.UTC(2026, 10, 1, 0, 0, joined)).toISOString(), ...overrides }
}

export function organizationTables(overrides: MemoryTables = {}): MemoryTables {
    return {
        organizations: [organizationRow(), organizationRow({ id: HAVRE, name: 'Havre', slug: 'havre' })],
        organization_members: [
            { organization_id: NORDLYS, user_id: OWNER, role: 'owner', created_at: '2026-11-01T00:00:00.000Z' },
            { organization_id: NORDLYS, user_id: ADMIN, role: 'admin', created_at: '2026-11-02T00:00:00.000Z' },
            { organization_id: HAVRE, user_id: RIVAL, role: 'owner', created_at: '2026-11-01T00:00:00.000Z' },
        ],
        organization_invitations: [],
        organization_credit_movements: [],
        workspaces: [workspaceRow(AGENCY_HOME, { organization_id: null, plan: 'base' }), workspaceRow(CLIENT, { name: 'Acme' }), workspaceRow(RIVAL_WORKSPACE, { name: 'Rival client', organization_id: HAVRE })],
        workspace_members: [memberRow(OWNER, AGENCY_HOME), memberRow(ADMIN, AGENCY_HOME, { role: 'member' }), memberRow(CLIENT_ADMIN, CLIENT), memberRow(RIVAL_CLIENT, RIVAL_WORKSPACE), memberRow(STRANGER, 99)],
        workspace_invitations: [],
        users: [
            { id: OWNER, workspace_id: AGENCY_HOME, locale: null },
            { id: ADMIN, workspace_id: AGENCY_HOME, locale: null },
            { id: RIVAL, workspace_id: RIVAL_WORKSPACE, locale: null },
            { id: CLIENT_ADMIN, workspace_id: CLIENT, locale: 'fr' },
            { id: RIVAL_CLIENT, workspace_id: RIVAL_WORKSPACE, locale: null },
            { id: STRANGER, workspace_id: 99, locale: null },
        ],
        agents: [],
        spaces: [],
        engine_pool: [],
        workspace_archives: [],
        remote_computers: [],
        ...overrides,
    }
}

let nextWorkspace = 1000

export function organizationWorld(overrides: MemoryTables = {}, before?: (table: string, calls: readonly SupabaseCall[]) => SupabaseResult | undefined | void, emails: Record<string, string> = EMAILS) {
    const created = () => new Date().toISOString()
    return memoryDatabase(organizationTables(overrides), {
        before,
        emails,
        unique: {
            organization_credit_movements: [['organization_id', 'seq'], ['request_id'], ['reversal_of']],
            organization_members: [['organization_id', 'user_id']],
            workspace_members: [['user_id', 'workspace_id']],
            engine_pool: [['claimed_by_workspace_id']],
        },
        defaults: {
            workspaces: () => workspaceRow(++nextWorkspace, { organization_id: null, plan: 'base', created_at: created() }),
            workspace_members: () => ({ role: 'admin', box_scope: 'all', organization_staff: false, created_at: created() }),
            workspace_invitations: () => ({ status: 'pending', role: 'member', box_scope: 'all', created_at: created() }),
            organization_invitations: () => ({ status: 'pending', created_at: created(), accepted_at: null }),
            organization_members: () => ({ created_at: created() }),
            organization_credit_movements: () => ({ applied_at: null, reversal_of: null, workspace_id: null, workspace_name: null, note: null, created_at: created() }),
        },
    })
}

export type OrganizationWorld = ReturnType<typeof organizationWorld>

export function organizationContext(world: OrganizationWorld, { role = 'owner', userId = OWNER, organizationId = NORDLYS }: { role?: OrganizationRole; userId?: string; organizationId?: string } = {}): OrganizationContext {
    return { organization: world.rows('organizations').find(row => row.id === organizationId) as OrganizationRow, role, userId, userEmail: EMAILS[userId] ?? null, supabase: world.client }
}
