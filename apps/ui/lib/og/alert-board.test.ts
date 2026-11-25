import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { hashedBuddyLook } from '@rerun/ui/iso-grid/buddy-look'
import { alertBoardSchema, type AlertBoard } from './alert-board'
import { stageAlertBoard } from './alert-board-tiles'
import { alertBoardUrl, isAlertBoard, readBoardImageRequest } from './board-image'

const coworker = (name: string) => ({ name, look: hashedBuddyLook(name) })
const CREW = ['Lead Scout', 'Blog Writer', 'Inbox Triage', 'Weekly Report'].map(coworker)
const ASKING = (state: 'question' | 'approval' | 'connector' | 'failed'): AlertBoard => ({ kind: 'coworker', state, coworker: CREW[0], neighbours: CREW.slice(1), app: 'gmail' })
const STOPPED = (cause: 'claude' | 'credits' | 'payment', coworkers = CREW): AlertBoard => ({ kind: 'cause', cause, coworkers })

describe('alertBoardUrl', () => {
    beforeEach(() => vi.stubEnv('BOARD_IMAGE_SECRET', 'test-board-image-secret'))
    afterEach(() => vi.unstubAllEnvs())

    it.each([ASKING('question'), STOPPED('claude')])('signs a close-up at the frame of an alert, and reads it back', board => {
        const request = readBoardImageRequest(new URL(alertBoardUrl(board)).searchParams)
        expect(request).toMatchObject({ width: 520, height: 260, scene: board })
        expect(request && isAlertBoard(request.scene)).toBe(true)
    })

    it('refuses more coworkers than there are slots', () => {
        expect(alertBoardSchema.safeParse(STOPPED('claude', [...CREW, coworker('Fifth')])).success).toBe(false)
        expect(alertBoardSchema.safeParse(STOPPED('claude', [])).success).toBe(false)
    })
})

describe('stageAlertBoard', () => {
    const tileOf = (board: AlertBoard, id: string, icons = {}) => stageAlertBoard(board, icons).tiles.find(tile => tile.id === id)

    it('raises the hand of a question in cyan and of an approval in its own colour', () => {
        expect(tileOf(ASKING('question'), 'coworker')?.style).toMatchObject({ color: '#06b6d4', badge: 'hand' })
        expect(tileOf(ASKING('approval'), 'coworker')?.style).toMatchObject({ badge: 'hand', buddy: { mood: 'idle', color: CREW[0].look.color } })
        expect(tileOf(ASKING('approval'), 'coworker')?.style.color).not.toBe('#06b6d4')
    })

    it('wears the look of the app, and says its state with no badge line', () => {
        const style = tileOf(ASKING('failed'), 'coworker')?.style
        expect(style).toMatchObject({ color: '#ef4444', buddy: CREW[0].look })
        expect(style?.status?.pinned).toBeUndefined()
    })

    it('wires the app it waits for, and draws none the catalog does not know', () => {
        expect(stageAlertBoard(ASKING('connector'), { app: '/services/gmail.svg' }).links).toEqual([{ source: 'coworker', target: 'app', variant: 'cable' }])
        expect(tileOf(ASKING('connector'), 'app', { app: '/services/gmail.svg' })?.span).toBe(1)
        expect(tileOf(ASKING('connector'), 'app')).toBeUndefined()
    })

    it('wires every stopped coworker to what stopped it, in red for an account', () => {
        expect(stageAlertBoard(STOPPED('claude'), { cause: 'x' }).links.map(link => link.color)).toEqual(Array(4).fill('#ef4444'))
        expect(stageAlertBoard(STOPPED('credits'), { cause: 'x' }).links.every(link => link.color === undefined)).toBe(true)
        expect(tileOf(STOPPED('credits'), 'coworker-0')?.style.buddy).toMatchObject({ mood: 'asleep' })
        expect(tileOf(STOPPED('payment'), 'coworker-0')?.style.badge).toBe('lock')
    })
})
