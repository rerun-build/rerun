import { AndroidHaptics, performAndroidHapticsAsync } from 'expo-haptics'
import { Platform } from 'react-native'

import * as Haptics from '@/lib/haptics'

const describeOnAndroid = Platform.OS === 'android' ? describe : describe.skip

describeOnAndroid('haptics on Android', () => {
    beforeEach(() => jest.mocked(performAndroidHapticsAsync).mockClear())

    it("plays the system's own feedback rather than a vibrator pattern", async () => {
        await Haptics.selectionAsync()
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
        expect(jest.mocked(performAndroidHapticsAsync).mock.calls.map(([type]) => type)).toEqual([
            AndroidHaptics.Segment_Tick,
            AndroidHaptics.Virtual_Key,
            AndroidHaptics.Context_Click,
            AndroidHaptics.Long_Press,
            AndroidHaptics.Confirm,
            AndroidHaptics.Reject,
        ])
    })
})
