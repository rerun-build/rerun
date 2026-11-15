import { StyleSheet } from 'react-native'

import { palette, withAlpha, type ColorScheme } from '@/theme/tokens'

const SHADOW: Record<ColorScheme, string> = { light: '0 2px 8px -2px rgba(0,0,0,0.14)', dark: '0 2px 8px -2px rgba(0,0,0,0.6)' }

export function opaqueSurface(scheme: ColorScheme) {
    const colors = palette[scheme]
    return { backgroundColor: withAlpha(colors.card, 0.92), borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, boxShadow: SHADOW[scheme] }
}
