import { FOREMAN_AGENT_ID, type Box } from '@rerun/contracts'

import { AI_PROVIDERS_ADMIN_ONLY, BOX_MANAGE_REASON, boxForNewCoworker, canManage, isAdminRole, knownCoworkerAccess, manageableBoxes, manageLock, manageReason, NO_MANAGED_BOX, newCoworkerBlocker, OPEN_LOCK, UNKNOWN_ACCESS } from '@/auth/access'

const box = (id: string, patch: Partial<Box> = {}): Box => ({ id, name: id, createdAt: null, managed: true, ...patch })

describe('access', () => {
    it('treats a member as the only role that does not run the workspace, an older hub included', () => {
        expect(isAdminRole('admin')).toBe(true)
        expect(isAdminRole('member')).toBe(false)
        expect(isAdminRole(undefined)).toBe(true)
    })

    it('lets the caller change a coworker unless they only use its Box', () => {
        expect(canManage('manage')).toBe(true)
        expect(canManage('use')).toBe(false)
        expect(canManage(undefined)).toBe(true)
        expect(manageReason('use')).toBe(BOX_MANAGE_REASON)
        expect(manageReason('manage')).toBeNull()
        expect(manageReason(undefined)).toBeNull()
    })

    it('offers a new coworker only the Boxes the caller manages, an older hub keeping every Box', () => {
        const boxes = [box('sales', { access: 'use' }), box('ops', { access: 'manage' }), box('legacy')]
        expect(manageableBoxes(boxes).map(entry => entry.id)).toEqual(['ops', 'legacy'])
        expect(manageableBoxes([box('sales', { access: 'use' })])).toEqual([])
    })

    it('keeps the Box asked for only when it can take the coworker', () => {
        const manageable = [box('ops'), box('legacy')]
        expect(boxForNewCoworker(manageable, 'legacy')).toBe('legacy')
        expect(boxForNewCoworker(manageable, 'sales')).toBe('ops')
        expect(boxForNewCoworker(manageable, null)).toBe('ops')
        expect(boxForNewCoworker([], 'sales')).toBeNull()
    })

    it('tells a member with no Box to manage what they need, an admin that the workspace has none', () => {
        expect(newCoworkerBlocker({ failed: false, manageable: null, admin: false })).toBeNull()
        expect(newCoworkerBlocker({ failed: false, manageable: [box('ops')], admin: false })).toBeNull()
        expect(newCoworkerBlocker({ failed: false, manageable: [], admin: false })).toBe(NO_MANAGED_BOX)
        expect(newCoworkerBlocker({ failed: false, manageable: [], admin: true })).toBe('noBoxYet')
        expect(newCoworkerBlocker({ failed: true, manageable: null, admin: true })).toBe('boxesFailed')
    })

    it('reads a coworker access from the board first, then from its copies in order, and says when none knows it', () => {
        expect(knownCoworkerAccess('a1', { agents: [{ id: 'a1', access: 'manage' }], views: [{ agent: { access: 'use' } }] })).toEqual({ known: true, access: 'manage' })
        expect(knownCoworkerAccess('a1', { agents: [{ id: 'a2', access: 'manage' }], views: [null, { agent: { access: 'use' } }] })).toEqual({ known: true, access: 'use' })
        expect(knownCoworkerAccess('a1', { views: [{ agent: { access: 'use' } }, { agent: { access: 'manage' } }] })).toEqual({ known: true, access: 'use' })
        expect(knownCoworkerAccess('a1', { agents: [{ id: 'a1' }] })).toEqual({ known: true, access: undefined })
        expect(knownCoworkerAccess('a2', { agents: [{ id: 'a1', access: 'use' }], views: [null, undefined] })).toEqual(UNKNOWN_ACCESS)
        expect(knownCoworkerAccess('a1', {})).toEqual(UNKNOWN_ACCESS)
    })

    it('hands the Foreman to everyone without asking', () => {
        expect(knownCoworkerAccess(FOREMAN_AGENT_ID, {})).toEqual({ known: true, access: 'manage' })
        expect(knownCoworkerAccess(FOREMAN_AGENT_ID, { agents: [{ id: FOREMAN_AGENT_ID, access: 'use' }] })).toEqual({ known: true, access: 'manage' })
    })

    it('greys a control without a word while the level is unknown, with the reason for a Box only used', () => {
        expect(manageLock(UNKNOWN_ACCESS)).toEqual({ locked: true, reason: null })
        expect(manageLock({ known: true, access: 'use' })).toEqual({ locked: true, reason: BOX_MANAGE_REASON })
        expect(manageLock({ known: true, access: 'manage' })).toEqual(OPEN_LOCK)
        expect(manageLock({ known: true, access: undefined })).toEqual(OPEN_LOCK)
    })

    it('keeps every visible copy short, English and free of em dashes and of the word agent', () => {
        for (const copy of [BOX_MANAGE_REASON, AI_PROVIDERS_ADMIN_ONLY, NO_MANAGED_BOX]) {
            expect(copy).not.toMatch(/—|\bagent/i)
            expect(copy.length).toBeLessThan(100)
        }
    })
})
