import { sleep } from '@rerun/contracts'
import { router, useLocalSearchParams } from 'expo-router'
import { View } from 'react-native'

import { AiConsent } from '@/components/consent/AiConsent'
import { OnboardingShell } from '@/components/onboarding/OnboardingShell'
import { ThemeScope, useColorSchemeName } from '@/theme/theme'
import { palette, type ColorScheme } from '@/theme/tokens'

// Dev only: the AI consent asked once per account before anything leaves for an AI provider.
//   /lab-consent?scheme=dark
export default function ConsentLab() {
    const params = useLocalSearchParams<{ scheme?: ColorScheme }>()
    const system = useColorSchemeName()
    const scheme = params.scheme === 'dark' || params.scheme === 'light' ? params.scheme : system

    return (
        <ThemeScope scheme={scheme}>
            <View style={{ flex: 1, backgroundColor: palette[scheme].background }}>
                <OnboardingShell>
                    <AiConsent onAgree={() => sleep(800)} onDecline={() => router.back()} />
                </OnboardingShell>
            </View>
        </ThemeScope>
    )
}
