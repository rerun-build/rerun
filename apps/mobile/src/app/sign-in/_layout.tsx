import { Stack } from 'expo-router'

import { SignInFlowProvider } from '@/components/auth/SignInFlow'
import { sheetOptions } from '@/components/layout/sheet-options'
import { useColorSchemeName } from '@/theme/theme'

export default function SignInLayout() {
    const scheme = useColorSchemeName()
    return (
        <SignInFlowProvider>
            <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="index" />
                <Stack.Screen name="country" options={sheetOptions(scheme, [1])} />
            </Stack>
        </SignInFlowProvider>
    )
}
