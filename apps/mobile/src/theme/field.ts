import type { TextStyle } from 'react-native'

import type { useTheme } from '@/theme/theme'
import { withAlpha } from '@/theme/tokens'

export function fieldOutline(theme: ReturnType<typeof useTheme>, { focused, invalid }: { focused: boolean; invalid?: boolean }): Pick<TextStyle, 'borderWidth' | 'borderColor' | 'boxShadow'> {
    const accent = invalid ? theme.destructive : focused ? theme.primary : null
    return {
        borderWidth: 1,
        borderColor: accent ?? theme.input,
        boxShadow: accent ? `0 0 0 3px ${withAlpha(accent, invalid ? 0.2 : 0.12)}` : undefined,
    }
}
