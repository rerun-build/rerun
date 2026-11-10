import { COWORKER_MODES, coworkerRuleOf, taskNotifies, type CoworkerMode, type CoworkerRule, type NotificationPrefs, type RoutineKind, type RoutineView } from '@rerun/contracts'
import { Fragment } from 'react'
import { Switch, View } from 'react-native'
import { useTranslations } from 'use-intl'

import { routineKey, whenOf } from '@/components/coworker/CoworkerRoutines'
import { Footnote } from '@/components/notifications/NotificationCenter'
import { AppText } from '@/components/ui/AppText'
import { Card, CheckRow, GROUPED_ROW_HEIGHT, ICON_ROW_INSET, Section, Separator, SwitchRow } from '@/components/ui/GroupedList'
import type { IconName } from '@/components/ui/Icon'
import { Skeleton } from '@/components/ui/Skeleton'
import { spacing } from '@/theme/tokens'

const MODE_SYMBOLS: Record<CoworkerMode, IconName> = {
    default: 'bell',
    everything: 'bell-dot',
    muted: 'bell-off',
}

type CoworkerNotificationsProps = {
    agentId: string
    name: string
    prefs: NotificationPrefs | null
    // Null while on their way, or when the Box could not list them (`routinesFailed`).
    routines: RoutineView[] | null
    routinesFailed: boolean
    onRule: (rule: CoworkerRule) => void
    onTask: (kind: RoutineKind, slug: string, notify: boolean) => void
}

function TaskRow({ routine, value, disabled, onChange }: { routine: RoutineView; value: boolean; disabled: boolean; onChange: (notify: boolean) => void }) {
    const when = whenOf(routine)
    const t = useTranslations('mobileSettings.notifications.coworker')
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: GROUPED_ROW_HEIGHT + 8, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, opacity: disabled ? 0.45 : 1 }}>
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <AppText variant="body" numberOfLines={1}>
                    {routine.name}
                </AppText>
                {when ? (
                    <AppText variant="footnote" tone="muted" numberOfLines={2}>
                        {when}
                    </AppText>
                ) : null}
            </View>
            <Switch value={value} disabled={disabled} onValueChange={onChange} accessibilityLabel={t('taskSwitch', { name: routine.name })} />
        </View>
    )
}

// The web's bell on a coworker, as a page: whose runs of it reach you, and which of its scheduled
// tasks do.
export function CoworkerNotifications({ agentId, name, prefs, routines, routinesFailed, onRule, onTask }: CoworkerNotificationsProps) {
    const t = useTranslations('mobileSettings.notifications')
    if (!prefs) {
        return (
            <Card>
                {[0, 1, 2].map(index => (
                    <View key={index} style={{ height: GROUPED_ROW_HEIGHT + 12, justifyContent: 'center', paddingHorizontal: spacing.lg }}>
                        <Skeleton style={{ width: (['45%', '35%', '30%'] as const)[index], height: 14 }} />
                    </View>
                ))}
            </Card>
        )
    }

    const rule = coworkerRuleOf(prefs, agentId)
    const muted = rule.mode === 'muted'
    const noSchedule = routines !== null && routines.length === 0
    const hintOf = (mode: CoworkerMode) => (mode === 'default' ? t('coworker.quotedScope', { scope: t(`scopes.${prefs.scope}.label`) }) : t(`modes.${mode}.hint`))

    return (
        <>
            <Section title={t('coworker.title', { name })}>
                {COWORKER_MODES.map((mode, index) => (
                    <View key={mode}>
                        {index > 0 && <Separator inset={ICON_ROW_INSET} />}
                        <CheckRow testID={`mode-${mode}`} icon={MODE_SYMBOLS[mode]} label={mode === 'default' ? t('coworker.yourSetting') : t(`modes.${mode}.label`)} detail={hintOf(mode)} checked={rule.mode === mode} onPress={() => onRule({ ...rule, mode })} />
                    </View>
                ))}
            </Section>

            <View style={{ gap: spacing.sm }}>
                <Card>
                    <SwitchRow testID="switch-follow" label={t('coworker.follow')} value={rule.follow === true} disabled={muted || noSchedule} onValueChange={follow => onRule({ ...rule, follow })} />
                </Card>
                <Footnote>{noSchedule ? t('coworker.nothingScheduled') : routines ? t('coworker.scheduled', { count: routines.length }) : t('coworker.reachYou')}</Footnote>
            </View>

            {(routines === null || routines.length > 0) && (
                <View style={{ gap: spacing.sm }}>
                    <Section title={t('coworker.tasksTitle')}>
                        {routines === null ? (
                            routinesFailed ? (
                                <View style={{ padding: spacing.lg }}>
                                    <AppText variant="footnote" tone="muted">
                                        {t('coworker.tasksFailed')}
                                    </AppText>
                                </View>
                            ) : (
                                <View style={{ height: GROUPED_ROW_HEIGHT + 8, justifyContent: 'center', paddingHorizontal: spacing.lg }}>
                                    <Skeleton style={{ width: '50%', height: 14 }} />
                                </View>
                            )
                        ) : (
                            routines.map((routine, index) => (
                                <Fragment key={routineKey(routine)}>
                                    {index > 0 && <Separator />}
                                    <TaskRow routine={routine} value={taskNotifies(prefs, agentId, routine.kind, routine.slug)} disabled={muted} onChange={notify => onTask(routine.kind, routine.slug, notify)} />
                                </Fragment>
                            ))
                        )}
                    </Section>
                    {muted && <Footnote>{t('coworker.muted', { name })}</Footnote>}
                </View>
            )}
        </>
    )
}
