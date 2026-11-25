import { describe, expect, it } from 'vitest'

import { DEFAULT_NOTIFICATION_PREFS, mergeNotificationPrefs, normalizeNotificationPrefs, taskNotifies, type NotificationPrefs } from './prefs'

const LEGACY_DEFAULT_MATRIX = {
    interactive: { done: false, error: true, info: true, question: true, approval: true, connector: true },
    scheduled: { done: false, error: true, info: true, question: true, approval: true, connector: true },
}

const ALL_OFF = {
    interactive: { done: false, error: false, info: false, question: false, approval: false, connector: false },
    scheduled: { done: false, error: false, info: false, question: false, approval: false, connector: false },
}

describe('normalizeNotificationPrefs, from the v1 matrix', () => {
    it('starts over on the recommended setting', () => {
        const prefs = normalizeNotificationPrefs({ channels: { email: LEGACY_DEFAULT_MATRIX, inApp: ALL_OFF }, runTypes: { interactive: false, scheduled: true }, sound: false })
        expect(prefs).toEqual(DEFAULT_NOTIFICATION_PREFS)
    })

    it('keeps the muted coworkers, from both legacy shapes', () => {
        const prefs = normalizeNotificationPrefs({ agents: { agt_1: { mode: 'muted' }, agt_2: { mode: 'custom' } }, mutedAgents: ['agt_3'] })
        expect(prefs.coworkers).toEqual({ agt_1: { mode: 'muted' }, agt_3: { mode: 'muted' } })
    })

    it('keeps the account categories', () => {
        expect(normalizeNotificationPrefs({ categories: { billing: false, product: true } }).categories).toEqual({ billing: false, product: true })
    })

    it('reads Email off: nobody ever chose it there', () => {
        expect(normalizeNotificationPrefs({ channels: { email: LEGACY_DEFAULT_MATRIX } }).email).toBe(false)
        expect(normalizeNotificationPrefs({}).email).toBe(false)
        expect(normalizeNotificationPrefs({ version: 2 }).email).toBe(false)
    })

    it('keeps Email on for who turned it on', () => {
        expect(normalizeNotificationPrefs({ version: 2, email: true }).email).toBe(true)
    })

    it('reads nothing stored as the defaults', () => {
        expect(normalizeNotificationPrefs(null)).toEqual(DEFAULT_NOTIFICATION_PREFS)
    })
})

describe('mergeNotificationPrefs', () => {
    it('drops a coworker rule that goes back to the default with no follow decision', () => {
        const base = normalizeNotificationPrefs({ version: 2, coworkers: { agt_1: { mode: 'muted' } } })
        expect(mergeNotificationPrefs(base, { coworkers: { agt_1: { mode: 'default' } } }).coworkers).toEqual({})
    })

    it('keeps an explicit stop following, which the owner fallback must respect', () => {
        const merged = mergeNotificationPrefs(DEFAULT_NOTIFICATION_PREFS, { coworkers: { agt_1: { mode: 'default', follow: false } } })
        expect(merged.coworkers).toEqual({ agt_1: { mode: 'default', follow: false } })
    })

    it('leaves what the patch does not name', () => {
        const merged = mergeNotificationPrefs({ ...DEFAULT_NOTIFICATION_PREFS, sound: false }, { scope: 'everything' })
        expect(merged).toMatchObject({ scope: 'everything', sound: false, toast: true })
    })
})

describe('taskNotifies', () => {
    const prefsWith = (patch: Partial<NotificationPrefs>): NotificationPrefs => ({ ...DEFAULT_NOTIFICATION_PREFS, ...patch })

    it('inherits from the coworker until the task has its own rule', () => {
        expect(taskNotifies(prefsWith({}), 'a1', 'schedule', 'digest')).toBe(false)
        expect(taskNotifies(prefsWith({ coworkers: { a1: { mode: 'default', follow: true } } }), 'a1', 'schedule', 'digest')).toBe(true)
        expect(taskNotifies(prefsWith({ coworkers: { a1: { mode: 'everything' } } }), 'a1', 'schedule', 'digest')).toBe(true)
        expect(taskNotifies(prefsWith({ scope: 'everything' }), 'a1', 'schedule', 'digest')).toBe(true)
        expect(taskNotifies(prefsWith({ coworkers: { a1: { mode: 'default', follow: true } }, tasks: { 'a1:schedule:digest': false } }), 'a1', 'schedule', 'digest')).toBe(false)
        expect(taskNotifies(prefsWith({ tasks: { 'a1:trigger:stripe': true } }), 'a1', 'trigger', 'stripe')).toBe(true)
    })

    it('stays off on a muted coworker, whatever the task says', () => {
        expect(taskNotifies(prefsWith({ coworkers: { a1: { mode: 'muted' } }, tasks: { 'a1:schedule:digest': true } }), 'a1', 'schedule', 'digest')).toBe(false)
    })
})
