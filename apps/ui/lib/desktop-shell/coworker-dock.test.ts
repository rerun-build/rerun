import { COWORKER_DOCK_FOREMAN_ID } from '@rerun/contracts'
import { describe, expect, it } from 'vitest'

import { foremanDockEntry, foremanDockOrbState, isForemanDockEntry } from '@/lib/desktop-shell/coworker-dock'
import { IDLE_DOCK_FEED } from '@/lib/foreman/dock-feed'
import type { PendingWidget } from '@/lib/foreman/pending-widget'

const question: PendingWidget = { toolName: 'ask_user', toolCallId: 'c1', input: { questions: [{ question: 'Which shop?' }] } }

describe('foremanDockEntry', () => {
    it('rests with nothing for the person', () => {
        expect(foremanDockEntry({ feed: IDLE_DOCK_FEED, activity: 'idle', name: 'Chief of Staff' })).toEqual({ id: COWORKER_DOCK_FOREMAN_ID, name: 'Chief of Staff', mood: 'idle', pending: 0 })
    })

    it('works while its run streams', () => {
        expect(foremanDockEntry({ feed: { ...IDLE_DOCK_FEED, busy: true }, activity: 'idle', name: 'Ada' }).mood).toBe('working')
        expect(foremanDockEntry({ feed: IDLE_DOCK_FEED, activity: 'speaking', name: 'Ada' }).mood).toBe('working')
    })

    it('waits on a question, and counts it', () => {
        const entry = foremanDockEntry({ feed: { ...IDLE_DOCK_FEED, pending: question }, activity: 'idle', name: 'Ada' })
        expect(entry).toMatchObject({ mood: 'waiting', pending: 1 })
    })

    it('says when its turn failed', () => {
        expect(foremanDockEntry({ feed: { ...IDLE_DOCK_FEED, failed: true }, activity: 'idle', name: 'Ada' }).mood).toBe('error')
    })
})

describe('the dock entry of the Chief of Staff', () => {
    it('is told apart from the coworkers by its id', () => {
        expect(isForemanDockEntry({ id: COWORKER_DOCK_FOREMAN_ID })).toBe(true)
        expect(isForemanDockEntry({ id: 'lead-scout' })).toBe(false)
    })

    it('thinks while it works', () => {
        expect(foremanDockOrbState('working')).toBe('thinking')
        expect(foremanDockOrbState('waiting')).toBe('idle')
    })
})
