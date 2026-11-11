import type { NativeStackNavigationOptions } from 'expo-router'

import { palette, radius, type ColorScheme } from '@/theme/tokens'

// The same sheet as iOS on Android's bottom sheet: rounded top corners, which Android leaves square by
// default, and the back gesture closes it. Android draws no grabber.
export function sheetOptions(scheme: ColorScheme, detents: number[]): NativeStackNavigationOptions {
    return { presentation: 'formSheet', sheetAllowedDetents: detents, sheetCornerRadius: radius.xl, contentStyle: { backgroundColor: palette[scheme].background } }
}
