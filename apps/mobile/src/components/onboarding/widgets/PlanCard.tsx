import { View } from 'react-native'
import { useTranslations } from 'use-intl'

import { AgentBuddy } from '@/components/buddy/AgentBuddy'
import { AppText } from '@/components/ui/AppText'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { useTheme } from '@/theme/theme'
import { radius, spacing } from '@/theme/tokens'

import { readPlan, type PlanAgent, type PlanOutput } from '../parts'

function Agent({ agent }: { agent: PlanAgent }) {
    const theme = useTheme()
    return (
        <View style={{ gap: spacing.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <AgentBuddy agentId={agent.name} size={40} mood="asleep" />
                <View style={{ flex: 1, gap: 2 }}>
                    <AppText variant="headline" numberOfLines={1}>
                        {agent.name}
                    </AppText>
                    <AppText variant="footnote" tone="muted">
                        {agent.role}
                    </AppText>
                </View>
            </View>
            {agent.when.length > 0 && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                    <Icon name="clock" size={12} color={theme.mutedForeground} />
                    <AppText variant="footnote" tone="muted">
                        {agent.when}
                    </AppText>
                </View>
            )}
            {agent.gets.length > 0 && (
                <View style={{ gap: spacing.xs }}>
                    {agent.gets.map(line => (
                        <View key={line} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}>
                            <Icon name="check" size={11} bold color={theme.foreground} style={{ marginTop: 4 }} />
                            <AppText variant="callout" style={{ flex: 1 }}>
                                {line}
                            </AppText>
                        </View>
                    ))}
                </View>
            )}
        </View>
    )
}

// The coworker the assistant proposes, under the Box its work belongs to. Confirmed, the app writes it
// down and builds it; sent back, the assistant asks what to change.
export function PlanCard({ input, answered, onAnswer }: { input: unknown; answered: PlanOutput | null; onAnswer: (output: PlanOutput) => void }) {
    const theme = useTheme()
    const { title, boxes } = readPlan(input)
    const t = useTranslations('mobileOnboarding')
    return (
        <View style={{ gap: spacing.lg, padding: spacing.lg, borderRadius: radius.lg, borderCurve: 'continuous', borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card }}>
            <AppText variant="caption" tone="muted" medium>
                {title ?? t('plan.defaultTitle')}
            </AppText>
            {boxes.map(box => (
                <View key={box.name ?? 'all'} style={{ gap: spacing.md }}>
                    {box.name && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                            <Icon name="square-dashed" size={12} color={theme.mutedForeground} />
                            <AppText variant="caption" tone="muted">
                                {box.name}
                            </AppText>
                        </View>
                    )}
                    {box.agents.map(agent => (
                        <Agent key={agent.name} agent={agent} />
                    ))}
                </View>
            ))}
            {answered ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                    <Icon name={answered.answered && answered.confirmed ? 'circle-check-fill' : 'pencil'} size={13} color={theme.mutedForeground} />
                    <AppText variant="footnote" tone="muted">
                        {answered.answered && answered.confirmed ? t('plan.confirmed') : answered.answered ? t('plan.changesAsked') : t('plan.skipped')}
                    </AppText>
                </View>
            ) : (
                <View style={{ gap: spacing.sm }}>
                    <Button label={t('plan.build')} size="lg" onPress={() => onAnswer({ answered: true, confirmed: true })} />
                    <Button label={t('plan.change')} variant="outline" size="lg" onPress={() => onAnswer({ answered: true, confirmed: false })} />
                </View>
            )}
        </View>
    )
}
