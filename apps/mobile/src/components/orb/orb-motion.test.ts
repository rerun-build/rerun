import { advance, facePose, restPose, restingPose, startClock } from '@/components/orb/orb-motion'

describe('orb motion', () => {
    it('rests the face where the web puts it', () => {
        const rest = restPose('left')
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

    it('spins the whole ball while it thinks', () => {
        const clock = startClock()
        let hidden = false
        for (let frame = 0; frame < 60; frame++) hidden ||= !advance(clock, 1 / 60, true, 'left').faceShown
        expect(hidden).toBe(true)
    })
})
