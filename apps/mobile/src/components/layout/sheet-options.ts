import type { NativeStackNavigationOptions } from 'expo-router'

import { palette, type ColorScheme } from '@/theme/tokens'

export function sheetOptions(scheme: ColorScheme, detents: number[]): NativeStackNavigationOptions {
    return { presentation: 'formSheet', sheetAllowedDetents: detents, sheetGrabberVisible: true, contentStyle: { backgroundColor: palette[scheme].background } }
}
