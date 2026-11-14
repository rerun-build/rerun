import { Stack } from 'expo-router'

import { SheetChrome } from '@/components/layout/SheetChrome'
import { useColorSchemeName } from '@/theme/theme'
import { palette } from '@/theme/tokens'

export default function SettingsLayout() {
    const scheme = useColorSchemeName()
    return (
        <>
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette[scheme].background } }} />
            <SheetChrome />
        </>
    )
}
