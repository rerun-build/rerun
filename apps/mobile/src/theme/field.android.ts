import type { TextStyle } from 'react-native'

import type { useTheme } from '@/theme/theme'

export function fieldOutline(theme: ReturnType<typeof useTheme>, { focused, invalid }: { focused: boolean; invalid?: boolean }): Pick<TextStyle, 'borderWidth' | 'borderColor' | 'boxShadow'> {
    const accent = invalid ? theme.destructive : focused ? theme.primary : null
    return { borderWidth: 1, borderColor: accent ?? theme.input }
}
