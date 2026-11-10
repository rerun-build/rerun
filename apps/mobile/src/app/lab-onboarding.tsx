import { sleep } from '@rerun/contracts'
import type { UIMessage } from 'ai'
import { useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { View } from 'react-native'

import { IntakeView } from '@/components/onboarding/IntakeView'
import { OnboardingConversation } from '@/components/onboarding/OnboardingConversation'
import { OnboardingShell } from '@/components/onboarding/OnboardingShell'
import { useIntake } from '@/components/onboarding/useIntake'
import { WaitlistNotice, type TeamStartState } from '@/components/onboarding/widgets/TeamCards'
import { ONBOARDING_STEPS, type OnboardingLabStep } from '@/mocks/onboarding'
import { ThemeScope, useColorSchemeName } from '@/theme/theme'
import { palette, type ColorScheme } from '@/theme/tokens'

// Dev only: the onboarding of a new account, each step on mock data. Answering a card moves the mock
// conversation on, so the flow can be clicked through.
//   /lab-onboarding?step=company&scheme=dark
//   step: company | company-filled | industry | role | name | pack | choice | input | either | typed | plan | trial | failed | blocked | building | built | waitlist
type IntakeLabStep = 'company' | 'company-filled' | 'industry' | 'role' | 'name'

const INTAKE: Record<IntakeLabStep, { initial: Parameters<typeof useIntake>[0]['initial']; index: number; knownFirstName: string | null }> = {
    company: { initial: {}, index: 0, knownFirstName: null },
    'company-filled': { initial: { companyUrl: 'ateliernord.fr' }, index: 0, knownFirstName: null },
    industry: { initial: { websiteSkipped: true }, index: 1, knownFirstName: null },
    role: { initial: { companyUrl: 'ateliernord.fr', industry: 'agencies' }, index: 1, knownFirstName: null },
    name: { initial: { companyUrl: 'ateliernord.fr', position: 'Founder / Agency owner' }, index: 2, knownFirstName: null },
}

function IntakeLab({ step }: { step: IntakeLabStep }) {
    const { initial, index, knownFirstName } = INTAKE[step]
    const intake = useIntake({ knownFirstName, initial, initialIndex: index, decideIndustry: async () => (await sleep(400), 'agencies'), submit: () => sleep(1200) })
    return <IntakeView intake={intake} />
}

function withOutput(messages: UIMessage[], toolCallId: string, output: unknown): UIMessage[] {
    return messages.map(message => ({ ...message, parts: message.parts.map(part => ('toolCallId' in part && part.toolCallId === toolCallId ? ({ ...part, state: 'output-available', output } as typeof part) : part)) }))
}

function ConversationLab({ step, teamStart }: { step: keyof typeof ONBOARDING_STEPS; teamStart: TeamStartState }) {
    const [messages, setMessages] = useState<UIMessage[]>(ONBOARDING_STEPS[step])
    const [starting, setStarting] = useState(false)
    return <OnboardingConversation messages={messages} busy={false} failed={false} onRetry={() => {}} teamStart={teamStart} leadStarting={starting} onAnswer={(toolCallId, output) => setMessages(current => withOutput(current, toolCallId, output))} onSend={text => setMessages(current => [...current, { id: `u-${current.length}`, role: 'user', parts: [{ type: 'text', text }] }])} onStop={() => {}} onRetryStart={() => {}} onRetryBuild={() => {}} onStartLead={() => setStarting(true)} />
}

const TEAM_START: Partial<Record<string, TeamStartState>> = { trial: 'starting', failed: 'failed', blocked: 'blocked' }

export default function OnboardingLab() {
    const params = useLocalSearchParams<{ step?: string; scheme?: ColorScheme }>()
    const system = useColorSchemeName()
    const scheme = params.scheme === 'dark' || params.scheme === 'light' ? params.scheme : system
    const step = params.step ?? 'company'
    const conversation = (TEAM_START[step] ? 'trial' : step) as OnboardingLabStep

    return (
        <ThemeScope scheme={scheme}>
            <View key={step} style={{ flex: 1, backgroundColor: palette[scheme].background }}>
                <OnboardingShell>{step in INTAKE ? <IntakeLab step={step as IntakeLabStep} /> : step === 'waitlist' ? <WaitlistNotice /> : conversation in ONBOARDING_STEPS ? <ConversationLab step={conversation} teamStart={TEAM_START[step] ?? 'starting'} /> : null}</OnboardingShell>
            </View>
        </ThemeScope>
    )
}
