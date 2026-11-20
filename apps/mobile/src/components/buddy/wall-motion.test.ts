import { inverted, liftedBy, multiplied, stretchedFrom } from '@/components/buddy/wall-motion'
import type { Matrix } from '@/components/orb/orb-motion'

function applied([a, b, c, d, e, f]: number[], x: number, y: number) {
    return { x: a * x + c * y + e, y: b * x + d * y + f }
}

describe('wall motion', () => {
    it('leaves the walls alone at rest', () => {
        expect(stretchedFrom(10, 1)).toEqual([1, 0, 0, 1, 0, 0])
        expect(liftedBy(0)).toEqual([1, 0, 0, 1, 0, 0])
    })

    it('grows the walls from their floor line', () => {
        const matrix = stretchedFrom(10, 1.2)
        expect(applied(matrix, 3, 10).y).toBeCloseTo(10)
        expect(applied(matrix, 3, 0).y).toBeCloseTo(-2)
        expect(applied(matrix, 3, 0).x).toBe(3)
    })

    it('applies the inner matrix first', () => {
        const leaning: Matrix = [1, 0.5, 0, 1, 10, 71]
        const point = applied(multiplied(leaning, stretchedFrom(15, 0.5)), 4, 5)
        expect(point.x).toBeCloseTo(14)
        expect(point.y).toBeCloseTo(83)
    })

    it('closes the eyes onto their line, on a wall that leans', () => {
        const wall: Matrix = [1, 0.5, 0, 1, 10, 71]
        const closing = multiplied(multiplied(wall, stretchedFrom(6, 0.08)), inverted(wall))
        const onTheLine = applied(wall, 21, 6)
        const above = applied(wall, 21, 3)
        expect(applied(closing, onTheLine.x, onTheLine.y).y).toBeCloseTo(onTheLine.y)
        expect(applied(closing, above.x, above.y).x).toBeCloseTo(above.x)
        expect(applied(closing, above.x, above.y).y).toBeCloseTo(onTheLine.y - 3 * 0.08)
    })

    it('lifts the top by as much as the walls grew', () => {
        const depth = 20
        const stretch = 1.2
        expect(applied(liftedBy((1 - stretch) * depth), 0, 5).y).toBeCloseTo(1)
    })
})
