import { Stack } from 'expo-router'

import { SheetChrome } from '@/components/layout/SheetChrome'
import { useColorSchemeName } from '@/theme/theme'
import { palette } from '@/theme/tokens'

// The AI providers sheet drills in like the web panel: each step slides over the one before.
export default function ProvidersLayout() {
    const scheme = useColorSchemeName()
    return (
        <>
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette[scheme].background } }} />
            <SheetChrome />
        </>
    )
}
