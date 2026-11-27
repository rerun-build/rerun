import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-members-'))

const { describe, expect, it } = await import('vitest')
const { listMembers, readMemberInstructions, saveMemberInstructions, touchMember } = await import('./members.js')

describe('touchMember', () => {
    it('records a member the first time they write, with their zone', async () => {
        await touchMember({ id: 'u-ana', name: 'Ana', timezone: 'Europe/Paris' }, '2026-11-19T08:00:00.000Z')
        expect((await listMembers()).find(m => m.id === 'u-ana')).toEqual({ id: 'u-ana', name: 'Ana', timezone: 'Europe/Paris', instructions: null, firstSeenAt: '2026-11-19T08:00:00.000Z', lastSeenAt: '2026-11-19T08:00:00.000Z' })
    })

    it('moves the last visit on and keeps the first one, the name and the zone a later message forgot', async () => {
        await touchMember({ id: 'u-bo', name: 'Bo', timezone: 'America/New_York' }, '2026-11-18T08:00:00.000Z')
        await touchMember({ id: 'u-bo' }, '2026-11-19T09:00:00.000Z')
        expect((await listMembers()).find(m => m.id === 'u-bo')).toEqual({ id: 'u-bo', name: 'Bo', timezone: 'America/New_York', instructions: null, firstSeenAt: '2026-11-18T08:00:00.000Z', lastSeenAt: '2026-11-19T09:00:00.000Z' })
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

describe('the instructions of a member', () => {
    it('reads none for a member who never wrote any, nor for one the box never saw', async () => {
        await touchMember({ id: 'u-ed', name: 'Ed' }, '2026-11-19T08:00:00.000Z')
        expect(await readMemberInstructions('u-ed')).toBeNull()
        expect(await readMemberInstructions('u-nobody')).toBeNull()
    })

    it('saves them whole, replaces them, and clears them, keeping the rest of the member', async () => {
        await touchMember({ id: 'u-fa', name: 'Fa', timezone: 'Europe/Paris' }, '2026-11-19T08:00:00.000Z')
        await saveMemberInstructions('u-fa', "Don't call me by my first name.")
        expect(await readMemberInstructions('u-fa')).toBe("Don't call me by my first name.")
        await saveMemberInstructions('u-fa', 'Be brief.')
        expect(await readMemberInstructions('u-fa')).toBe('Be brief.')
        await saveMemberInstructions('u-fa', null)
        expect(await readMemberInstructions('u-fa')).toBeNull()
        expect((await listMembers()).find(m => m.id === 'u-fa')).toMatchObject({ name: 'Fa', timezone: 'Europe/Paris', firstSeenAt: '2026-11-19T08:00:00.000Z' })
    })

    it('keeps the instructions of a member who never wrote, without counting them among the people who wrote', async () => {
        await saveMemberInstructions('u-gi', 'Use formal French.', '2026-11-20T08:00:00.000Z')
        expect(await readMemberInstructions('u-gi')).toBe('Use formal French.')
        expect((await listMembers()).some(m => m.id === 'u-gi')).toBe(false)
    })

    it('dates a member from their first message, not from the instructions they saved before it', async () => {
        await saveMemberInstructions('u-ha', 'Be brief.', '2026-11-20T08:00:00.000Z')
        await touchMember({ id: 'u-ha', name: 'Ha' }, '2026-11-21T08:00:00.000Z')
        await touchMember({ id: 'u-ha' }, '2026-11-22T08:00:00.000Z')
        expect((await listMembers()).find(m => m.id === 'u-ha')).toEqual({ id: 'u-ha', name: 'Ha', timezone: null, instructions: 'Be brief.', firstSeenAt: '2026-11-21T08:00:00.000Z', lastSeenAt: '2026-11-22T08:00:00.000Z' })
    })
})
