import { AndroidHaptics, ImpactFeedbackStyle, NotificationFeedbackType, performAndroidHapticsAsync } from 'expo-haptics'

export { ImpactFeedbackStyle, NotificationFeedbackType }

export function selectionAsync(): Promise<void> {
    return performAndroidHapticsAsync(AndroidHaptics.Segment_Tick)
}

export function impactAsync(style: ImpactFeedbackStyle = ImpactFeedbackStyle.Medium): Promise<void> {
    const heavy = style === ImpactFeedbackStyle.Heavy || style === ImpactFeedbackStyle.Rigid
    return performAndroidHapticsAsync(heavy ? AndroidHaptics.Long_Press : style === ImpactFeedbackStyle.Medium ? AndroidHaptics.Context_Click : AndroidHaptics.Virtual_Key)
}

export function notificationAsync(type: NotificationFeedbackType = NotificationFeedbackType.Success): Promise<void> {
    return performAndroidHapticsAsync(type === NotificationFeedbackType.Success ? AndroidHaptics.Confirm : AndroidHaptics.Reject)
}
