import { missedFrames } from './FrameMonitor'

describe('missed frames', () => {
    it('counts nothing for a steady second, jitter included', () => {
        expect(missedFrames([16.6, 16.8, 16.5, 17.1, 16.7, 16.4])).toEqual({ drawn: 6, missed: 0 })
    })

    it('counts the frames a long one swallowed', () => {
        expect(missedFrames([16.7, 16.7, 16.7, 100, 16.7, 16.7])).toEqual({ drawn: 6, missed: 5 })
    })

    it('reads a 120 Hz screen at its own pace', () => {
        expect(missedFrames([8.3, 8.4, 8.3, 8.3, 25, 8.3])).toEqual({ drawn: 6, missed: 2 })
    })
})
