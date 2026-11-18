import { sleep } from '@rerun/contracts'
import { useLocalSearchParams } from 'expo-router'
import { View } from 'react-native'

import { IntakeView } from '@/components/onboarding/IntakeView'
import { SetupNotice, WaitlistNotice, type SetupState } from '@/components/onboarding/notices'
import { OnboardingShell } from '@/components/onboarding/OnboardingShell'
import { useIntake } from '@/components/onboarding/useIntake'
import { ThemeScope, useColorSchemeName } from '@/theme/theme'
import { palette, type ColorScheme } from '@/theme/tokens'

// Dev only: the onboarding of a new account, each step on mock data.
//   /lab-onboarding?step=company&scheme=dark
//   step: company | company-filled | industry | role | name | starting | failed | blocked | waitlist
type IntakeLabStep = 'company' | 'company-filled' | 'industry' | 'role' | 'name'

const INTAKE: Record<IntakeLabStep, { initial: Parameters<typeof useIntake>[0]['initial']; index: number; knownFirstName: string | null }> = {
    company: { initial: {}, index: 0, knownFirstName: null },
    'company-filled': { initial: { companyUrl: 'ateliernord.fr' }, index: 0, knownFirstName: null },
    industry: { initial: { websiteSkipped: true }, index: 1, knownFirstName: null },
    role: { initial: { companyUrl: 'ateliernord.fr', industry: 'agencies' }, index: 1, knownFirstName: null },
    name: { initial: { companyUrl: 'ateliernord.fr', position: 'Founder / Agency owner' }, index: 2, knownFirstName: null },
}

const SETUP: readonly SetupState[] = ['starting', 'failed', 'blocked']

function IntakeLab({ step }: { step: IntakeLabStep }) {
    const { initial, index, knownFirstName } = INTAKE[step]
    const intake = useIntake({ knownFirstName, initial, initialIndex: index, decideIndustry: async () => (await sleep(400), 'agencies'), submit: () => sleep(1200) })
    return <IntakeView intake={intake} />
}

export default function OnboardingLab() {
    const params = useLocalSearchParams<{ step?: string; scheme?: ColorScheme }>()
    const system = useColorSchemeName()
    const scheme = params.scheme === 'dark' || params.scheme === 'light' ? params.scheme : system
    const step = params.step ?? 'company'
    const setup = SETUP.find(state => state === step)

    return (
        <ThemeScope scheme={scheme}>
            <View key={step} style={{ flex: 1, backgroundColor: palette[scheme].background }}>
                <OnboardingShell>{step in INTAKE ? <IntakeLab step={step as IntakeLabStep} /> : step === 'waitlist' ? <WaitlistNotice /> : setup ? <SetupNotice state={setup} onRetry={() => {}} /> : null}</OnboardingShell>
            </View>
        </ThemeScope>
    )
}
