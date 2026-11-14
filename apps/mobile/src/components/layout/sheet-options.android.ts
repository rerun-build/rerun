import type { NativeStackNavigationOptions } from 'expo-router'

import { palette, radius, type ColorScheme } from '@/theme/tokens'

export function sheetOptions(scheme: ColorScheme, detents: number[]): NativeStackNavigationOptions {
    return { presentation: 'formSheet', sheetAllowedDetents: detents, sheetCornerRadius: radius.xl, contentStyle: { backgroundColor: palette[scheme].background } }
}
