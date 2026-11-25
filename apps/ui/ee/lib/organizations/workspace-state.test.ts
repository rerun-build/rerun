import { describe, expect, it } from 'vitest'

import { organizationMachineState, organizationWorkspaceStatus } from './workspace-state'

const PUT_AWAY = '2026-11-20T00:00:00Z'

describe('organizationWorkspaceStatus', () => {
    it.each([
        ['active', null, 'active'],
        ['canceled', PUT_AWAY, 'archived'],
        ['canceled', null, 'suspended'],
        // Put away before its organization was suspended: still put away.
        ['active', PUT_AWAY, 'archived'],
        [null, null, 'suspended'],
    ] as const)('%s, archived %s: %s', (subscription_status, organization_archived_at, expected) => {
        expect(organizationWorkspaceStatus({ subscription_status, organization_archived_at })).toBe(expected)
    })
})

describe('organizationMachineState', () => {
    const base = { status: 'active' as const, boxesArchivedAt: null, instance: { status: 'claimed', provider_server_id: 'rerun-host/box' }, archiveStatus: null }

    it.each([
        ['a machine at work', base, 'running'],
        ['nobody asked for one yet', { ...base, instance: null }, 'none'],
        ['a machine in error', { ...base, instance: { status: 'error', provider_server_id: 'rerun-host/box' } }, 'error'],
        ['asked to be archived, the job not started', { ...base, status: 'archived' as const }, 'archiving'],
        ['being archived', { ...base, status: 'archived' as const, archiveStatus: 'archiving' }, 'archiving'],
        ["a machine of someone else's, its access cut", { ...base, status: 'archived' as const, instance: { status: 'claimed', provider_server_id: null } }, 'archived'],
        ['archived', { ...base, status: 'archived' as const, boxesArchivedAt: PUT_AWAY, instance: null, archiveStatus: 'archived' }, 'archived'],
        ['cut off with its organization', { ...base, status: 'suspended' as const, boxesArchivedAt: PUT_AWAY, instance: null, archiveStatus: 'archived' }, 'archived'],
        ['restored, the job not started', { ...base, boxesArchivedAt: PUT_AWAY, instance: null, archiveStatus: 'archived' }, 'restoring'],
        ['being restored', { ...base, boxesArchivedAt: PUT_AWAY, archiveStatus: 'restoring' }, 'restoring'],
        ['restored, refused by its check', { ...base, boxesArchivedAt: PUT_AWAY, archiveStatus: 'restored' }, 'error'],
        ['back for good', { ...base, archiveStatus: 'restored' }, 'running'],
        ['an archive that failed, the machine still there', { ...base, status: 'archived' as const, archiveStatus: 'failed' }, 'archiving'],
    ])('%s', (_case, input, expected) => {
        expect(organizationMachineState(input)).toBe(expected)
    })
})
