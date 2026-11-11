import { StyleSheet, View } from 'react-native'

import { useTheme } from '@/theme/theme'
import { radius, withAlpha } from '@/theme/tokens'

const GRABBER = { width: 36, height: 4, top: 8 }

// react-native-screens draws neither a grabber nor an edge on Android, and a dark sheet on the dimmed
// screen behind it has no visible top. The sheet's route lays both over its content, as its last child
// so they stay on top. The edge follows the sheet's corners (sheetCornerRadius in sheet-options).
export function SheetChrome() {
    const theme = useTheme()
    return (
        <>
            <View testID="sheet-edge" pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: radius.xl, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, borderBottomWidth: 0, borderColor: theme.scheme === 'dark' ? withAlpha(theme.foreground, 0.16) : theme.border }} />
            <View testID="sheet-grabber" pointerEvents="none" style={{ position: 'absolute', top: GRABBER.top, alignSelf: 'center', width: GRABBER.width, height: GRABBER.height, borderRadius: GRABBER.height / 2, backgroundColor: withAlpha(theme.mutedForeground, 0.4) }} />
        </>
    )
}
