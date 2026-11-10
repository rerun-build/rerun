import { Stack } from 'expo-router'

import { SheetChrome } from '@/components/layout/SheetChrome'
import { useColorSchemeName } from '@/theme/theme'
import { palette } from '@/theme/tokens'

// The preferences drill in like the AI providers: each page slides over the one before.
export default function SettingsLayout() {
    const scheme = useColorSchemeName()
    return (
        <>
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette[scheme].background } }} />
            <SheetChrome />
        </>
    )
}
