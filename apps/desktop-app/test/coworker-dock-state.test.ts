import { describe, expect, it } from 'vitest'
import { COWORKER_DOCK_MAX_NOTES } from '@rerun/contracts'
import { cleanDockState, cleanRects } from '../src/main/coworker-dock-state'

const coworker = { id: 'closer', name: 'Closer', mood: 'waiting', pending: 2 }
const note = { id: 'session-1', agentId: 'closer', status: 'awaiting_question', title: 'Pipeline follow-ups', text: 'How should the follow-ups sound?', updatedAt: '2026-11-20T10:00:00.000Z', sessionId: 'session-1', engineSessionId: 'engine-1' }

describe('cleanDockState', () => {
    it('keeps the notes a main window publishes, bounded', () => {
        const state = cleanDockState({ coworkers: [coworker], notes: [note, { ...note, id: 'done:1', status: 'done', text: 'x'.repeat(5000), count: 3, sessionId: null }] })
        expect(state?.notes?.[0]).toEqual(note)
        expect(state?.notes?.[1]).toMatchObject({ status: 'done', count: 3, sessionId: null })
        expect(state?.notes?.[1].text).toHaveLength(2000)
    })

    it('drops a note without an id, a coworker or a plain status, and caps their number', () => {
        const state = cleanDockState({ coworkers: [coworker], notes: [{ ...note, id: '' }, { ...note, agentId: 7 }, { ...note, status: 'done<script>' }, 'note'] })
        expect(state?.notes).toEqual([])
        const many = cleanDockState({ coworkers: [coworker], notes: Array.from({ length: 80 }, (_, index) => ({ ...note, id: `n${index}` })) })
        expect(many?.notes).toHaveLength(COWORKER_DOCK_MAX_NOTES)
    })

    it('keeps the workspace of the main window, as a short text', () => {
        expect(cleanDockState({ coworkers: [coworker], workspaceKey: '42' })?.workspaceKey).toBe('42')
        expect(cleanDockState({ coworkers: [coworker], workspaceKey: 'x'.repeat(300) })?.workspaceKey).toHaveLength(100)
        for (const workspaceKey of [42, '', null]) expect(cleanDockState({ coworkers: [coworker], workspaceKey })).not.toHaveProperty('workspaceKey')
    })

    it('leaves the notes out when a main window publishes none, as before them', () => {
        expect(cleanDockState({ coworkers: [coworker] })).toEqual({ coworkers: [{ ...coworker, mood: 'waiting' }], createBlockedReason: null })
        expect(cleanDockState(null)).toBeNull()
    })

    it('keeps the look a coworker was given, so its buddy on the dock wears the same as on the board', () => {
        const look = { eyes: 'heart', mouth: 'cat', color: '#00B862', material: 'fluffy' }
        expect(cleanDockState({ coworkers: [{ ...coworker, look }] })?.coworkers[0].look).toEqual({ ...look, color: '#00b862' })
    })

    it('keeps eyes and a material this build does not know: the page served by the hub draws them', () => {
        const look = { eyes: 'laser', mouth: 'cat', color: '#00b862', material: 'velvet' }
        expect(cleanDockState({ coworkers: [{ ...coworker, look }] })?.coworkers[0].look).toEqual(look)
    })

    it('drops a look that is not one and keeps the coworker', () => {
        for (const look of [{ eyes: 'Not an eye', mouth: 'cat', color: '#00b862' }, { eyes: 'heart', color: '#00b862' }, { eyes: 'heart', mouth: 'cat', color: 'red' }, 'fluffy', null]) {
            expect(cleanDockState({ coworkers: [{ ...coworker, look }] })?.coworkers).toEqual([coworker])
        }
    })
})

describe('cleanRects', () => {
    it('keeps the finite rectangles of the page', () => {
        expect(cleanRects([{ x: 10, y: 20, width: 44, height: 300 }, { x: 'a', y: 0, width: 1, height: 1 }, null])).toEqual([{ x: 10, y: 20, width: 44, height: 300 }])
        expect(cleanRects('rail')).toEqual([])
    })
})
