import { paidDataSourcesByTurn, type PaidTurnSources } from '@moldwright/contracts'
import type { UIMessage } from 'ai'
import { useLocalSearchParams } from 'expo-router'
import { useEffect, useState, type ReactNode } from 'react'
import { ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { MessageView } from '@/components/chat/MessageView'
import type { MessageStamp } from '@/components/chat/MessageTimeReveal'
import { AppText } from '@/components/ui/AppText'
import { PAID_DATA_TURN } from '@/mocks/paid-data'
import { LIVE_STEPS, STEP_SCENARIOS, stepsMessage } from '@/mocks/steps'
import { ThemeScope, useColorSchemeName } from '@/theme/theme'
import { palette, spacing, type ColorScheme } from '@/theme/tokens'

const LIVE_TICK_MS = 1100
const LIVE_PAUSE_TICKS = 4

function useLiveCount(): number {
    const [tick, setTick] = useState(0)
    useEffect(() => {
        const timer = setInterval(() => setTick(current => current + 1), LIVE_TICK_MS)
        return () => clearInterval(timer)
    }, [])
    return (tick % (LIVE_STEPS.length + LIVE_PAUSE_TICKS)) + 1
}

function useStamp(): MessageStamp {
    const [shown, setShown] = useState(false)
    return { createdAt: '2026-10-28T09:12:00.000Z', shown, onToggle: () => setShown(!shown) }
}

const LAB_AGENT = 'scout'

function Turn({ message, running = false, agentId = LAB_AGENT, paidSources }: { message: UIMessage; running?: boolean; agentId?: string | null; paidSources?: PaidTurnSources }) {
    const stamp = useStamp()
    return <MessageView message={message} isLastAssistant={running} running={running} agentId={agentId} fileOwner={null} coworkerName="Scout" hiddenCallId={null} stamp={stamp} paidSources={paidSources} />
}

const PAID_SOURCES = paidDataSourcesByTurn(PAID_DATA_TURN)
const PAID_REPLY = PAID_DATA_TURN[PAID_DATA_TURN.length - 1]

function LiveScenario({ agentId }: { agentId?: string | null }) {
    const count = useLiveCount()
    const running = count <= LIVE_STEPS.length
    const message = stepsMessage('live', LIVE_STEPS.slice(0, Math.min(count, LIVE_STEPS.length)), { running })
    return <Turn message={message} running={running} agentId={agentId} />
}

function Group({ title, children }: { title: string; children: ReactNode }) {
    return (
        <View style={{ gap: spacing.md }}>
            <AppText variant="footnote" tone="muted" medium>
                {title}
            </AppText>
            {children}
        </View>
    )
}

export default function LabSteps() {
    const { scenario, scheme: forced } = useLocalSearchParams<{ scenario?: string; scheme?: ColorScheme }>()
    const system = useColorSchemeName()
    const scheme = forced === 'dark' || forced === 'light' ? forced : system
    const insets = useSafeAreaInsets()
    const settled = Object.entries(STEP_SCENARIOS).filter(([id]) => !scenario || id === scenario)
    return (
        <ThemeScope scheme={scheme}>
            <ScrollView style={{ backgroundColor: palette[scheme].background }} contentContainerStyle={{ paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.xl, paddingHorizontal: spacing.lg, gap: spacing.xl }}>
                <AppText variant="largeTitle">Tool steps</AppText>
                {(!scenario || scenario === 'live') && (
                    <>
                        <Group title="Running">
                            <LiveScenario />
                        </Group>
                        <Group title="Running, Foreman">
                            <LiveScenario agentId={null} />
                        </Group>
                    </>
                )}
                {(!scenario || scenario === 'paid') && (
                    <Group title="Paid data sources">
                        <Turn message={PAID_REPLY} paidSources={PAID_SOURCES.get(PAID_REPLY.id)} />
                    </Group>
                )}
                {settled.map(([id, { label, kinds, failing }]) => (
                    <Group key={id} title={label}>
                        <Turn message={stepsMessage(id, kinds, { failing })} />
                    </Group>
                ))}
            </ScrollView>
        </ThemeScope>
    )
}
