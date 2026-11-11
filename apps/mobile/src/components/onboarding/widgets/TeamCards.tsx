import { ActivityIndicator, View } from 'react-native'
import { useTranslations } from 'use-intl'

import { ForemanOrb } from '@/components/orb/ForemanOrb'
import { AppText } from '@/components/ui/AppText'
import { Button } from '@/components/ui/Button'
import { Icon, type IconName } from '@/components/ui/Icon'
import { webHost } from '@/config/environment'
import { useTheme } from '@/theme/theme'
import { radius, spacing } from '@/theme/tokens'

import type { BuildResult, BuildTask } from '../parts'

function Frame({ children }: { children: React.ReactNode }) {
    const theme = useTheme()
    return <View style={{ gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, borderCurve: 'continuous', borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card }}>{children}</View>
}

export type TeamStartState = 'starting' | 'failed' | 'blocked' | 'started'

// The step between the confirmed plan and the build. The app sells nothing: it starts the workspace on
// its own the moment the plan is confirmed, and only says something when that did not go through.
export function TeamStartCard({ state, onRetry }: { state: TeamStartState; onRetry: () => void }) {
    const theme = useTheme()
    const t = useTranslations('mobileOnboarding')
    if (state === 'started') {
        return (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                <Icon name="circle-check-fill" size={13} color={theme.mutedForeground} />
                <AppText variant="footnote" tone="muted">
                    {t('team.ready')}
                </AppText>
            </View>
        )
    }
    return (
        <Frame>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <ForemanOrb size={32} state={state === 'starting' ? 'thinking' : 'idle'} />
                <View style={{ flex: 1, gap: 2 }}>
                    <AppText variant="headline">{t(`team.${state}.title`)}</AppText>
                    <AppText variant="footnote" tone="muted">
                        {t(`team.${state}.body`, { host: webHost })}
                    </AppText>
                </View>
            </View>
            {state === 'failed' && <Button label={t('team.tryAgain')} onPress={onRetry} />}
        </Frame>
    )
}

const TASK_LOOK: Record<BuildTask['status'], { symbol: IconName | null; tone: 'default' | 'muted' | 'destructive' }> = {
    queued: { symbol: 'circle-dashed', tone: 'muted' },
    dispatched: { symbol: 'circle-dashed', tone: 'muted' },
    running: { symbol: null, tone: 'default' },
    done: { symbol: 'circle-check-fill', tone: 'default' },
    error: { symbol: 'circle-alert-fill', tone: 'destructive' },
    stopped: { symbol: 'circle-minus', tone: 'muted' },
}

function TaskRow({ task }: { task: BuildTask }) {
    const theme = useTheme()
    const look = TASK_LOOK[task.status]
    const color = look.tone === 'destructive' ? theme.destructive : look.tone === 'muted' ? theme.mutedForeground : theme.foreground
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 28 }}>
            <View style={{ width: 18, alignItems: 'center' }}>{look.symbol ? <Icon name={look.symbol} size={16} color={color} /> : <ActivityIndicator size="small" color={theme.mutedForeground} />}</View>
            <AppText variant="callout" tone={look.tone === 'muted' ? 'muted' : 'default'} numberOfLines={1} style={{ flex: 1 }}>
                {task.title}
            </AppText>
        </View>
    )
}

// The build, live: one row per thing being put on the board. Once it is done, the coworker it put first
// is the one to start, as the button the web leaves under its build. A build that put nobody on the board
// is run again from here: the composer is gone past the plan.
export function BuildCard({ tasks, result, starting, onStartLead, onRetry }: { tasks: BuildTask[]; result: BuildResult | null; starting: boolean; onStartLead: () => void; onRetry: (() => void) | null }) {
    const done = result !== null
    const t = useTranslations('mobileOnboarding')
    const empty = done && result.agents === 0
    return (
        <Frame>
            <AppText variant="headline">{!done ? t('build.building') : empty ? t('build.empty') : t('build.ready')}</AppText>
            <View style={{ gap: spacing.xs }}>
                {tasks.map((task, index) => (
                    <TaskRow key={`${index}-${task.title}`} task={task} />
                ))}
            </View>
            {empty && (
                <AppText variant="footnote" tone="muted">
                    {t('build.nothingLost')}
                </AppText>
            )}
            {done && !empty && result.failed.length > 0 && (
                <AppText variant="footnote" tone="muted">
                    {result.failed.length === 1 ? t('build.oneFailed', { name: result.failed[0] }) : t('build.someFailed', { count: result.failed.length })}
                </AppText>
            )}
            {empty && onRetry && <Button label={t('build.tryAgain')} onPress={onRetry} />}
            {done && result.lead && <Button label={t('build.startLead', { name: result.lead.name })} size="lg" loading={starting} onPress={onStartLead} />}
        </Frame>
    )
}

// No machine is free for the build: the web's waitlist wall. Their answers are kept, and the screen opens
// on its own once a machine frees up.
export function WaitlistNotice() {
    const t = useTranslations('mobileOnboarding')
    return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, paddingHorizontal: spacing.xl }}>
            <ForemanOrb size={64} />
            <View style={{ alignItems: 'center', gap: spacing.xs }}>
                <AppText variant="title" style={{ textAlign: 'center' }}>
                    {t('waitlist.title')}
                </AppText>
                <AppText variant="callout" tone="muted" style={{ textAlign: 'center' }}>
                    {t('waitlist.body')}
                </AppText>
            </View>
        </View>
    )
}
