import { describe, expect, it } from 'vitest'
import { arrangeDock, arrangementKey, cleanArrangement, cleanArrangements, EMPTY_ARRANGEMENT, reorderArrangement, setHidden, withArrangement } from '../src/main/coworker-dock-arrangement'

const published = ['chief-of-staff', 'lead-scout', 'writer', 'analyst'].map((id) => ({ id }))
const ids = (list: readonly { id: string }[]) => list.map((entry) => entry.id)

describe('arrangeDock', () => {
    it('shows everyone in the order the main window published, the Chief of Staff first', () => {
        expect(ids(arrangeDock(published, EMPTY_ARRANGEMENT))).toEqual(['chief-of-staff', 'lead-scout', 'writer', 'analyst'])
    })

    it('follows the order the person chose and leaves out the ones they hid', () => {
        expect(ids(arrangeDock(published, { order: ['writer', 'chief-of-staff', 'analyst', 'lead-scout'], hidden: ['analyst'] }))).toEqual(['writer', 'chief-of-staff', 'lead-scout'])
    })

    it('shows a new coworker, right after the one published before it', () => {
        const withNewcomer = [...published.slice(0, 2), { id: 'newcomer' }, ...published.slice(2)]
        expect(ids(arrangeDock(withNewcomer, { order: ['writer', 'analyst', 'lead-scout', 'chief-of-staff'], hidden: [] }))).toEqual(['writer', 'analyst', 'lead-scout', 'newcomer', 'chief-of-staff'])
        expect(ids(arrangeDock([{ id: 'first' }, ...published], { order: ['writer'], hidden: [] }))[0]).toBe('first')
    })

    it('forgets a coworker that is gone', () => {
        expect(ids(arrangeDock(published.slice(0, 2), { order: ['deleted', 'lead-scout'], hidden: ['deleted'] }))).toEqual(['chief-of-staff', 'lead-scout'])
    })
})

describe('reorderArrangement', () => {
    it('keeps the dragged order and the hidden coworkers after it', () => {
        const arrangement = { order: [], hidden: ['analyst'] }
        const next = reorderArrangement(arrangement, ['writer', 'chief-of-staff', 'lead-scout'], ids(published))
        expect(next).toEqual({ order: ['writer', 'chief-of-staff', 'lead-scout', 'analyst'], hidden: ['analyst'] })
        expect(ids(arrangeDock(published, setHidden(next, 'analyst', false)))).toEqual(['writer', 'chief-of-staff', 'lead-scout', 'analyst'])
    })

    it('ignores ids the main window never published', () => {
        expect(reorderArrangement(EMPTY_ARRANGEMENT, ['intruder', 'writer'], ids(published)).order).toEqual(['writer', 'chief-of-staff', 'lead-scout', 'analyst'])
    })
})

describe('setHidden', () => {
    it('hides and shows a coworker again', () => {
        const hidden = setHidden(EMPTY_ARRANGEMENT, 'writer', true)
        expect(hidden.hidden).toEqual(['writer'])
        expect(setHidden(hidden, 'writer', true).hidden).toEqual(['writer'])
        expect(setHidden(hidden, 'writer', false).hidden).toEqual([])
    })
})

describe('stored arrangements', () => {
    it('keeps only lists of ids from settings.json', () => {
        expect(cleanArrangement({ order: ['a', 3, '', 'a', 'b'], hidden: 'x' })).toEqual({ order: ['a', 'b'], hidden: [] })
        expect(cleanArrangement(null)).toEqual(EMPTY_ARRANGEMENT)
        expect(cleanArrangements('nope')).toEqual({})
    })

    it('keys each server and workspace apart, and keeps the twenty last ones', () => {
        expect(arrangementKey('https://app.rerun.build', '42')).not.toBe(arrangementKey('https://rerun.example.com', '42'))
        let arrangements = {}
        for (let index = 0; index < 25; index += 1) arrangements = withArrangement(arrangements, `server ${index}`, { order: [`agent-${index}`], hidden: [] })
        arrangements = withArrangement(arrangements, 'server 5', { order: ['moved'], hidden: [] })
        expect(Object.keys(arrangements)).toHaveLength(20)
        expect(Object.keys(arrangements).at(-1)).toBe('server 5')
        expect(arrangements).not.toHaveProperty('server 4')
    })
})
