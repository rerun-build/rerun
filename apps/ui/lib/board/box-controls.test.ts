import type { Container, Tile } from '@moldwright/ui/iso-grid'
import { describe, expect, it } from 'vitest'
import { BOX_MANAGE_ACTION_REASON } from './box-access'
import { boxContainerFor, boxTileFor, emptyBoardOffersBox, placementNeedsBoxFirst } from './box-controls'

const box: Container = { id: 'b', label: 'Sales', color: '#fff', col_start: 0, row_start: 0, col_end: 7, row_end: 7 }
const tile: Tile = { id: 't', position: { col: 1, row: 1 }, containerId: 'b', style: { color: '#fff', label: 'Scout' }, draggable: true }

describe('boxContainerFor', () => {
    it('leaves a managed Box as it is', () => {
        expect(boxContainerFor({ ...box, cta: 'Recruit' }, true)).toEqual({ ...box, cta: 'Recruit' })
    })

    it('closes a used Box to resizing, moving and drops, and its recruit pill says why', () => {
        expect(boxContainerFor({ ...box, cta: 'Recruit', ctaExamples: ['An SDR'] }, false)).toEqual({ ...box, readOnly: true, cta: BOX_MANAGE_ACTION_REASON, ctaDisabled: true, ctaExamples: ['An SDR'] })
    })

    it('adds no pill to a used Box that had none', () => {
        expect(boxContainerFor(box, false)).toEqual({ ...box, readOnly: true })
    })
})

describe('boxTileFor', () => {
    it('holds a coworker of a used Box in place', () => {
        expect(boxTileFor(tile, false).draggable).toBe(false)
        expect(boxTileFor(tile, true).draggable).toBe(true)
    })
})

describe('emptyBoardOffersBox', () => {
    it('offers a member with no Box open to them a Box of their own', () => {
        expect(emptyBoardOffersBox('member', 0)).toBe(true)
    })

    it('keeps the workspace onboarding for an admin, and the board for anyone who sees a Box', () => {
        expect(emptyBoardOffersBox('admin', 0)).toBe(false)
        expect(emptyBoardOffersBox('member', 2)).toBe(false)
        expect(emptyBoardOffersBox(null, 0)).toBe(false)
    })
})

describe('placementNeedsBoxFirst', () => {
    it('asks a member who manages no Box to name one before the coworker lands', () => {
        expect(placementNeedsBoxFirst({ placing: true, role: 'member', manageableSpaceCount: 0 })).toBe(true)
    })

    it('lets the placement go on when there is a Box to land in, or for an admin', () => {
        expect(placementNeedsBoxFirst({ placing: true, role: 'member', manageableSpaceCount: 1 })).toBe(false)
        expect(placementNeedsBoxFirst({ placing: true, role: 'admin', manageableSpaceCount: 0 })).toBe(false)
        expect(placementNeedsBoxFirst({ placing: false, role: 'member', manageableSpaceCount: 0 })).toBe(false)
    })
})
