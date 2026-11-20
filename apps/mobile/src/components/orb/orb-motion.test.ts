import { advance, facePose, layerTransform, restPose, restingPose, startClock } from '@/components/orb/orb-motion'

describe('orb motion', () => {
    it('rests the face where the web puts it', () => {
        const rest = restPose('left')
        // packages/ui foremanFacePose at rest: translate(41 41) matrix(1 0.2 0 1 0 0) scale(1 1)
        const { matrix, shown } = facePose(rest.yaw, rest.pitch)
        expect(shown).toBe(true)
        expect(matrix.map(value => Number(value.toFixed(3)))).toEqual([1, 0.2, 0, 1, 41, 41])
        expect(facePose(restPose('right').yaw, rest.pitch).matrix[1]).toBeCloseTo(-0.2)
    })

    it('hides the face once the ball has turned it away', () => {
        expect(facePose(Math.PI / 2 + 0.01, 0).shown).toBe(false)
        expect(facePose(Math.PI, 0).shown).toBe(false)
    })

    it('drifts away from rest and stays on the plate', () => {
        const clock = startClock()
        const rest = restingPose('left')
        let pose = rest
        for (let frame = 0; frame < 600; frame++) {
            pose = advance(clock, 1 / 60, false, 'left')
            expect(Math.abs(pose.eyes[4])).toBeLessThan(1)
            expect(Math.abs(pose.eyes[5])).toBeLessThan(1)
            expect(pose.faceShown).toBe(true)
        }
        expect(pose.face).not.toEqual(rest.face)
        expect(pose.sheen[4]).toBeGreaterThanOrEqual(0)
    })

    it('moves a layer the way the matrix moves its drawing', () => {
        const [{ matrix }] = layerTransform([0.9, 0.18, 0, 1, 41, 40], 0.5)
        const moved = (x: number, y: number) => ({ x: matrix[0] * x + matrix[4] * y + matrix[12], y: matrix[1] * x + matrix[5] * y + matrix[13] })
        expect(moved(0, 0)).toEqual({ x: 20.5, y: 20 })
        expect(moved(10, 0).x).toBeCloseTo(29.5)
        expect(moved(10, 0).y).toBeCloseTo(21.8)
        expect(moved(0, 10)).toEqual({ x: 20.5, y: 30 })
    })

    it('spins the whole ball while it thinks', () => {
        const clock = startClock()
        let hidden = false
        for (let frame = 0; frame < 60; frame++) hidden ||= !advance(clock, 1 / 60, true, 'left').faceShown
        expect(hidden).toBe(true)
    })
})
