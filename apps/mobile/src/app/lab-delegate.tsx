import type { SubRunTask } from '@rerun/contracts'
import type { UIMessage } from 'ai'
import { useLocalSearchParams } from 'expo-router'
import { useEffect, useState, type ReactNode } from 'react'
import { ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { MessageView } from '@/components/chat/MessageView'
import { AppText } from '@/components/ui/AppText'
import { ALL_DONE, ALL_FAILED, callAgentMessage, cliDelegateMessage, delegateMessage, LIVE_END_AT, liveTasksAt, LOOPING, ONE_CUT, QUEUED, RUNNING, STALLED, STOPPED_ONE } from '@/mocks/delegate'
import { ThemeScope, useColorSchemeName } from '@/theme/theme'
import { palette, spacing, type ColorScheme } from '@/theme/tokens'

const DONE = { state: 'output-available' as const, output: 'Done' }

const SCENARIOS: Record<string, { label: string; message: UIMessage }> = {
    running: { label: 'Running', message: delegateMessage('running', RUNNING) },
    retries: { label: 'Retries', message: delegateMessage('retries', LOOPING) },
    stalled: { label: 'Stalled', message: delegateMessage('stalled', STALLED) },
    queued: { label: 'Queued', message: delegateMessage('queued', QUEUED) },
    cli: { label: 'Through a CLI bridge', message: cliDelegateMessage('cli', RUNNING) },
    done: { label: 'Done', message: delegateMessage('done', ALL_DONE, DONE) },
    partial: { label: 'Partial', message: delegateMessage('partial', ONE_CUT, DONE) },
    stopped: { label: 'Stopped', message: delegateMessage('stopped', STOPPED_ONE, DONE) },
    failed: { label: 'Failed', message: delegateMessage('failed', ALL_FAILED, { state: 'output-error', errorText: 'Every task failed to start.' }) },
    call: { label: 'Call a coworker', message: callAgentMessage('call', 'Growth', { status: 'running', steps: 3, toolCalls: 4, activity: 'web_search', idleMs: 3_000, startedAt: Date.now() }) },
    answered: { label: 'Coworker answered', message: callAgentMessage('answered', 'Growth', { status: 'done', steps: 6, toolCalls: 8, startedAt: 0, finishedAt: 42_000 }, DONE) },
}

function useLiveTasks(): { round: number; tasks: SubRunTask[] } {
    const [elapsed, setElapsed] = useState(0)
    useEffect(() => {
        const startedAt = Date.now()
        const timer = setInterval(() => setElapsed(Date.now() - startedAt), 250)
        return () => clearInterval(timer)
    }, [])
    return { round: Math.floor(elapsed / LIVE_END_AT), tasks: liveTasksAt(elapsed % LIVE_END_AT) }
}

function LiveScenario() {
    const { round, tasks } = useLiveTasks()
    const live = tasks.some(task => task.status === 'running')
    return <Scenario key={round} message={delegateMessage(`live-${round}`, tasks, live ? { state: 'input-available' } : DONE)} />
}

function Scenario({ message }: { message: UIMessage }) {
    return <MessageView message={message} isLastAssistant={false} running={false} agentId={null} fileOwner={null} coworkerName="Scout" hiddenCallId={null} />
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

export default function LabDelegate() {
    const { scenario, scheme: forced } = useLocalSearchParams<{ scenario?: string; scheme?: ColorScheme }>()
    const system = useColorSchemeName()
    const scheme = forced === 'dark' || forced === 'light' ? forced : system
    const insets = useSafeAreaInsets()
    const picked = scenario && scenario !== 'live' ? SCENARIOS[scenario] : undefined
    return (
        <ThemeScope scheme={scheme}>
            <ScrollView style={{ backgroundColor: palette[scheme].background }} contentContainerStyle={{ paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.xl, paddingHorizontal: spacing.lg, gap: spacing.xl }}>
                <AppText variant="largeTitle">Delegation</AppText>
                {(!scenario || scenario === 'live') && (
                    <Group title="Live">
                        <LiveScenario />
                    </Group>
                )}
                {picked ? (
                    <Group title={picked.label}>
                        <Scenario message={picked.message} />
                    </Group>
                ) : (
                    !scenario &&
                    Object.entries(SCENARIOS).map(([id, { label, message }]) => (
                        <Group key={id} title={label}>
                            <Scenario message={message} />
                        </Group>
                    ))
                )}
            </ScrollView>
        </ThemeScope>
    )
}
