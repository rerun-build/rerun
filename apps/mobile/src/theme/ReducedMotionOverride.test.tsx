import { render } from '@testing-library/react-native'
import { Platform } from 'react-native'
import { ReducedMotionConfig, ReduceMotion } from 'react-native-reanimated'

import { ReducedMotionOverride } from '@/theme/ReducedMotionOverride'

jest.mock('react-native-reanimated', () => ({ ...jest.requireActual('react-native-reanimated/mock'), ReducedMotionConfig: jest.fn(() => null) }))

describe('ReducedMotionOverride', () => {
    beforeEach(() => jest.mocked(ReducedMotionConfig).mockClear())

    it('lets the system decide on iOS, and keeps the layout animations running on Android', async () => {
        await render(<ReducedMotionOverride />)
        if (Platform.OS === 'android') {
            expect(ReducedMotionConfig).toHaveBeenCalledWith({ mode: ReduceMotion.Never }, undefined)
        } else {
            expect(ReducedMotionConfig).not.toHaveBeenCalled()
        }
    })
})
