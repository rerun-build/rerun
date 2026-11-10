import type { NativeStackNavigationOptions } from 'expo-router'

import { palette, type ColorScheme } from '@/theme/tokens'

// A screen presented as the system's sheet, resting at each of `detents` (fractions of the screen).
export function sheetOptions(scheme: ColorScheme, detents: number[]): NativeStackNavigationOptions {
    return { presentation: 'formSheet', sheetAllowedDetents: detents, sheetGrabberVisible: true, contentStyle: { backgroundColor: palette[scheme].background } }
}
