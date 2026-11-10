import type { TextStyle } from 'react-native'

import type { useTheme } from '@/theme/theme'

// No soft ring on Android: a box shadow that comes and goes swaps a TextInput's background drawable,
// and Android then resets the field's padding to the drawable's, so the text touches the border.
export function fieldOutline(theme: ReturnType<typeof useTheme>, { focused, invalid }: { focused: boolean; invalid?: boolean }): Pick<TextStyle, 'borderWidth' | 'borderColor' | 'boxShadow'> {
    const accent = invalid ? theme.destructive : focused ? theme.primary : null
    return { borderWidth: 1, borderColor: accent ?? theme.input }
}
