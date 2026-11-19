import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-members-'))

const { describe, expect, it } = await import('vitest')
const { listMembers, touchMember } = await import('./members.js')

describe('touchMember', () => {
    it('records a member the first time they write, with their zone', async () => {
        await touchMember({ id: 'u-ana', name: 'Ana', timezone: 'Europe/Paris' }, '2026-11-19T08:00:00.000Z')
        expect((await listMembers()).find(m => m.id === 'u-ana')).toEqual({ id: 'u-ana', name: 'Ana', timezone: 'Europe/Paris', firstSeenAt: '2026-11-19T08:00:00.000Z', lastSeenAt: '2026-11-19T08:00:00.000Z' })
    })

    it('moves the last visit on and keeps the first one, the name and the zone a later message forgot', async () => {
        await touchMember({ id: 'u-bo', name: 'Bo', timezone: 'America/New_York' }, '2026-11-18T08:00:00.000Z')
        await touchMember({ id: 'u-bo' }, '2026-11-19T09:00:00.000Z')
        expect((await listMembers()).find(m => m.id === 'u-bo')).toEqual({ id: 'u-bo', name: 'Bo', timezone: 'America/New_York', firstSeenAt: '2026-11-18T08:00:00.000Z', lastSeenAt: '2026-11-19T09:00:00.000Z' })
    })

    it('follows a member who moved to another zone', async () => {
        await touchMember({ id: 'u-cy', timezone: 'Europe/Paris' }, '2026-11-18T08:00:00.000Z')
        await touchMember({ id: 'u-cy', timezone: 'Asia/Tokyo' }, '2026-11-19T08:00:00.000Z')
        expect((await listMembers()).find(m => m.id === 'u-cy')?.timezone).toBe('Asia/Tokyo')
    })

    it('never stores a zone Intl does not know, and never moves the last visit back', async () => {
        await touchMember({ id: 'u-di', timezone: 'Europe/Paris' }, '2026-11-19T10:00:00.000Z')
        await touchMember({ id: 'u-di', timezone: 'Mars/Olympus' }, '2026-11-19T08:00:00.000Z')
        expect((await listMembers()).find(m => m.id === 'u-di')).toMatchObject({ timezone: 'Europe/Paris', lastSeenAt: '2026-11-19T10:00:00.000Z' })
    })

    it('lists the member who came by last first', async () => {
        await touchMember({ id: 'u-late' }, '2026-11-30T00:00:00.000Z')
        expect((await listMembers())[0].id).toBe('u-late')
    })
})
