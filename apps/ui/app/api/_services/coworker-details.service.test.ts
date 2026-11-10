import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import { normalizeNotificationPrefs } from '@/lib/notifications/prefs'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({
    assertAgentAccess: vi.fn(),
    resolveAgentTarget: vi.fn(),
    renameAgent: vi.fn(),
    deleteAgent: vi.fn(),
    patchNotificationPrefs: vi.fn(),
    readNotificationPrefs: vi.fn(),
    listSchedules: vi.fn(),
    listTriggers: vi.fn(),
    updateSchedule: vi.fn(),
    updateTrigger: vi.fn(),
    listFiles: vi.fn(),
    recipientLocale: vi.fn(),
}))
vi.mock('@/app/api/_auth/access', async importOriginal => ({ ...(await importOriginal<typeof import('@/app/api/_auth/access')>()), assertAgentAccess: mocks.assertAgentAccess }))
vi.mock('@/app/api/_services/agent.service', () => ({ renameAgent: mocks.renameAgent, deleteAgent: mocks.deleteAgent }))
vi.mock('@/app/api/_services/notification-prefs.service', () => ({ patchNotificationPrefs: mocks.patchNotificationPrefs, readNotificationPrefs: mocks.readNotificationPrefs }))
vi.mock('@/app/api/_services/chat.service', () => ({ resolveAgentTarget: mocks.resolveAgentTarget }))
vi.mock('@/lib/i18n/recipient-locale', () => ({ recipientLocale: mocks.recipientLocale }))
vi.mock('@/lib/engine/client', () => ({ listFiles: mocks.listFiles, listSchedules: mocks.listSchedules, listTriggers: mocks.listTriggers, updateSchedule: mocks.updateSchedule, updateTrigger: mocks.updateTrigger }))

const { AccessDeniedError } = await import('@/app/api/_auth/access')
const { AuthorizationError } = await import('@/app/api/_auth/ownership')
const { deleteCoworker, listCoworkerFiles, listCoworkerRoutines, readCoworkerNotifications, renameCoworker, setCoworkerNotifications, setCoworkerRoutineEnabled } = await import('./coworker-details.service')

const ctx = { userId: 'u1', role: 'member', boxScope: 'all', workspace: { id: 7 }, supabase: {} } as unknown as WorkspaceContext
const actor = { kind: 'user', userId: 'u1', workspaceId: 7, role: 'member', boxScope: 'all' }

// What the caller reaches on the coworker's Box: `none` stands for a coworker of another workspace,
// of a Box closed to them, or one that is gone.
function rowsAre({ access = 'manage', prefs = null }: { access?: 'none' | 'use' | 'manage'; prefs?: unknown }) {
    mocks.assertAgentAccess.mockImplementation(async (_agentId: string, need: 'use' | 'manage') => {
        if (access === 'none') throw new AuthorizationError('coworkerNotFound')
        if (need === 'manage' && access !== 'manage') throw new AccessDeniedError()
        return { actor, access, agent: { workspace_id: 7, space_id: 'box', engine_agent_id: 'eng-1' } }
    })
    mocks.readNotificationPrefs.mockResolvedValue(normalizeNotificationPrefs(prefs))
}

const storedPrefs = (coworkers: Record<string, unknown>) => ({ version: 2, scope: 'mine', toast: true, sound: true, email: true, coworkers, tasks: {}, categories: { billing: true, product: true } })

describe('coworker details', () => {
    beforeEach(() => {
        Object.values(mocks).forEach(mock => mock.mockReset())
        mocks.resolveAgentTarget.mockResolvedValue({ conn: { host: 'box' }, engineAgentId: 'eng-1', contentLocked: false })
        mocks.recipientLocale.mockResolvedValue('en')
        rowsAre({})
    })

    it('renames and deletes only a coworker whose Box the caller manages', async () => {
        await renameCoworker(ctx, 'a1', { name: 'Scout' })
        await deleteCoworker(ctx, 'a1')
        expect(mocks.renameAgent).toHaveBeenCalledWith('a1', 'Scout')
        expect(mocks.deleteAgent).toHaveBeenCalledWith('a1')
        expect(mocks.assertAgentAccess).toHaveBeenCalledWith('a1', 'manage', actor)

        rowsAre({ access: 'use' })
        await expect(renameCoworker(ctx, 'a2', { name: 'X' })).rejects.toBeInstanceOf(AccessDeniedError)
        await expect(deleteCoworker(ctx, 'a2')).rejects.toBeInstanceOf(AccessDeniedError)
        rowsAre({ access: 'none' })
        await expect(deleteCoworker(ctx, 'gone')).rejects.toMatchObject({ name: 'AuthorizationError' })
        expect(mocks.renameAgent).toHaveBeenCalledTimes(1)
        expect(mocks.deleteAgent).toHaveBeenCalledTimes(1)
    })

    it('lists schedules then triggers, with the cron in words and no prompt', async () => {
        mocks.listSchedules.mockResolvedValue([
            { slug: 'digest', name: 'Daily digest', enabled: true, cron: '0 9 * * *', runAt: null, timezone: 'Europe/Paris', body: 'secret prompt' },
            { slug: 'once', name: 'Reminder', enabled: false, cron: null, runAt: '2026-11-01T08:00:00.000Z', timezone: null, body: '' },
        ])
        mocks.listTriggers.mockResolvedValue([{ slug: 'stripe', name: 'Stripe webhook', enabled: true, body: 'x' }])

        const { routines } = await listCoworkerRoutines(ctx, 'a1')

        expect(routines).toEqual([
            { kind: 'schedule', slug: 'digest', name: 'Daily digest', enabled: true, cronLabel: 'At 09:00 AM', runAt: null, timezone: 'Europe/Paris' },
            { kind: 'schedule', slug: 'once', name: 'Reminder', enabled: false, cronLabel: null, runAt: '2026-11-01T08:00:00.000Z', timezone: null },
            { kind: 'trigger', slug: 'stripe', name: 'Stripe webhook', enabled: true, cronLabel: null, runAt: null, timezone: null },
        ])
        expect(mocks.recipientLocale).toHaveBeenCalledWith(ctx.supabase, 'u1', 7)

        mocks.recipientLocale.mockResolvedValueOnce('fr')
        expect((await listCoworkerRoutines(ctx, 'a1')).routines[0].cronLabel).toBe('À 09:00')
    })

    it('switches a schedule or a trigger with nothing but its enabled flag', async () => {
        await setCoworkerRoutineEnabled(ctx, 'a1', 'schedule', 'digest', false)
        await setCoworkerRoutineEnabled(ctx, 'a1', 'trigger', 'stripe', true)
        expect(mocks.updateSchedule).toHaveBeenCalledWith({ host: 'box' }, 'eng-1', 'digest', { enabled: false })
        expect(mocks.updateTrigger).toHaveBeenCalledWith({ host: 'box' }, 'eng-1', 'stripe', { enabled: true })
        expect(mocks.resolveAgentTarget).toHaveBeenCalledWith('a1', actor, 'manage')
    })

    it('reads the routines, skills and files at the use level', async () => {
        mocks.listSchedules.mockResolvedValue([])
        mocks.listTriggers.mockResolvedValue([])
        await listCoworkerRoutines(ctx, 'a1')
        expect(mocks.resolveAgentTarget).toHaveBeenCalledWith('a1', actor)
    })

    it('reads the default rule for a coworker the caller never set', async () => {
        expect(await readCoworkerNotifications(ctx, 'a1')).toEqual({ mode: 'default' })
    })

    it('mutes a coworker and keeps following its scheduled tasks', async () => {
        rowsAre({ prefs: storedPrefs({ a1: { mode: 'everything', follow: true }, other: { mode: 'muted' } }) })

        await setCoworkerNotifications(ctx, 'a1', 'muted')

        expect(mocks.patchNotificationPrefs).toHaveBeenCalledWith('u1', { coworkers: { a1: { mode: 'muted', follow: true } } })
    })

    it('lets a member who only uses the Box set their own notifications for its coworker', async () => {
        rowsAre({ access: 'use' })
        await setCoworkerNotifications(ctx, 'a1', 'muted')
        expect(mocks.patchNotificationPrefs).toHaveBeenCalled()
    })

    it('never touches the rules of a coworker outside the caller reach', async () => {
        rowsAre({ access: 'none' })
        await expect(setCoworkerNotifications(ctx, 'a2', 'muted')).rejects.toMatchObject({ name: 'AuthorizationError' })
        await expect(readCoworkerNotifications(ctx, 'a2')).rejects.toMatchObject({ name: 'AuthorizationError' })
        expect(mocks.patchNotificationPrefs).not.toHaveBeenCalled()
    })

    it('walks the folders into one list, newest first, images apart, hidden and dependency folders left out', async () => {
        const tree: Record<string, object[]> = {
            '.': [
                { name: 'reports', type: 'dir', size: 0 },
                { name: 'node_modules', type: 'dir', size: 0 },
                { name: '.rerun', type: 'dir', size: 0 },
                { name: '.env', type: 'file', size: 10 },
                { name: 'leads.csv', type: 'file', size: 2048, modifiedAt: '2026-10-20T10:00:00.000Z' },
            ],
            reports: [{ name: 'chart.PNG', type: 'file', size: 9000, modifiedAt: '2026-10-22T10:00:00.000Z' }],
        }
        mocks.listFiles.mockImplementation(async (_conn: unknown, base: string, path: string) => {
            expect(base).toBe('/agents/eng-1/files')
            return tree[path] ?? []
        })

        expect(await listCoworkerFiles(ctx, 'a1')).toEqual({
            files: [
                { path: 'reports/chart.PNG', name: 'chart.PNG', size: 9000, modifiedAt: '2026-10-22T10:00:00.000Z', kind: 'media' },
                { path: 'leads.csv', name: 'leads.csv', size: 2048, modifiedAt: '2026-10-20T10:00:00.000Z', kind: 'doc' },
            ],
            truncated: false,
        })
        expect(mocks.listFiles).toHaveBeenCalledTimes(2)
    })

    it('stops walking a deep or wide folder and says the list is partial', async () => {
        mocks.listFiles.mockImplementation(async () => Array.from({ length: 30 }, (_, i) => ({ name: `d${i}`, type: 'dir', size: 0 })))
        const result = await listCoworkerFiles(ctx, 'a1')
        expect(result.truncated).toBe(true)
        expect(mocks.listFiles.mock.calls.length).toBeLessThanOrEqual(40)
    })
})
