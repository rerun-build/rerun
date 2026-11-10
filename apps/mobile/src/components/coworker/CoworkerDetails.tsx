import { Button as MenuButton } from '@expo/ui/swift-ui'
import { disabled } from '@expo/ui/swift-ui/modifiers'
import type { CoworkerFiles, InstalledServiceView, RoutineView } from '@rerun/contracts'
import { ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslations } from 'use-intl'

import type { ManageLock } from '@/auth/access'
import { AgentBuddy } from '@/components/buddy/AgentBuddy'
import { AppText } from '@/components/ui/AppText'
import { Button } from '@/components/ui/Button'
import { moodOf } from '@/components/ui/CoworkerAvatar'
import { usePaneInsets } from '@/components/layout/PaneSize'
import { GlassButton } from '@/components/ui/GlassButton'
import { Card, ICON_ROW_INSET, Separator, SettingsRow } from '@/components/ui/GroupedList'
import { CircleTrigger, NativeMenu } from '@/components/ui/NativeMenu'
import type { CoworkerStatus } from '@/mocks/data'
import { useTheme } from '@/theme/theme'
import { spacing } from '@/theme/tokens'
import { webHost } from '@/config/environment'

const BUDDY_SIZE = 96

export type CoworkerSummary = { id: string; name: string; status: CoworkerStatus; boxName: string | null }

type CoworkerDetailsProps = {
    coworker: CoworkerSummary
    // Null while on their way.
    files: CoworkerFiles | null
    apps: InstalledServiceView[] | null
    routines: RoutineView[] | null
    // The caller's rule for this coworker in words, null while on its way.
    notifications: string | null
    // What could not be read (a switched-off coworker, a Box that did not answer): its row stays empty.
    unavailable?: Partial<Record<'files' | 'apps' | 'routines', boolean>>
    // Why the coworker's screen cannot be opened (switched off, no machine), or null when it can.
    computerUnavailable: string | null
    canDelete: boolean
    // Whether the caller can change the coworker, and why not when they cannot.
    lock: ManageLock
    onBack: () => void
    onEdit: () => void
    onDelete: () => void
    onFiles: () => void
    onApps: () => void
    onRoutines: () => void
    onComputer: () => void
    onNotifications: () => void
}

export const needsAttention = (app: InstalledServiceView) => app.status !== 'active'

type DetailsTranslator = ReturnType<typeof useTranslations<'mobileCoworker.details'>>

function appsValue(apps: InstalledServiceView[], t: DetailsTranslator): string {
    const broken = apps.filter(needsAttention).length
    if (broken > 0) return t('appsToConnect', { count: broken })
    return apps.length > 0 ? t('appsConnected', { count: apps.length }) : t('none')
}

function filesValue({ files, truncated }: CoworkerFiles, t: DetailsTranslator): string {
    if (files.length === 0) return t('none')
    return truncated ? t('filesTruncated', { count: files.length }) : t('filesCount', { count: files.length })
}

function routinesValue(routines: RoutineView[], t: DetailsTranslator): string {
    if (routines.length === 0) return t('none')
    return t('routinesOn', { count: routines.filter(routine => routine.enabled).length })
}

// The coworker at a glance, from its conversation: what it made, what it is connected to, what runs on its own, its
// screen, and what of it reaches you. Anything deeper stays on the web, or is asked in the chat.
export function CoworkerDetails({ coworker, files, apps, routines, notifications, unavailable = {}, computerUnavailable, canDelete, lock, onBack, onEdit, onDelete, onFiles, onApps, onRoutines, onComputer, onNotifications }: CoworkerDetailsProps) {
    const theme = useTheme()
    const insets = useSafeAreaInsets()
    const pane = usePaneInsets()
    const t = useTranslations('mobileCoworker.details')
    const tAccess = useTranslations('mobileCoworker.access')
    return (
        <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={{ paddingTop: insets.top + spacing.xs, paddingBottom: insets.bottom + spacing.xl, paddingLeft: spacing.lg + pane.left, paddingRight: spacing.lg + pane.right, gap: spacing.xl }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <GlassButton symbol="chevron.left" label={t('back')} onPress={onBack} />
                <NativeMenu glass="circle" label={t('more')} trigger={<CircleTrigger symbol="ellipsis" />}>
                    <MenuButton label={t('delete')} systemImage="trash" role="destructive" onPress={onDelete} modifiers={[disabled(!canDelete || lock.locked)]} />
                </NativeMenu>
            </View>

            <View style={{ alignItems: 'center', gap: spacing.sm }}>
                <AgentBuddy agentId={coworker.id} size={BUDDY_SIZE} mood={moodOf(coworker.status)} />
                <View style={{ alignItems: 'center', gap: 2, alignSelf: 'stretch' }}>
                    <AppText variant="title" numberOfLines={2} style={{ textAlign: 'center' }}>
                        {coworker.name}
                    </AppText>
                    {coworker.boxName ? (
                        <AppText variant="footnote" tone="muted" numberOfLines={1}>
                            {coworker.boxName}
                        </AppText>
                    ) : null}
                </View>
                <Button label={t('edit')} variant="secondary" size="sm" onPress={onEdit} disabled={lock.locked} />
                {lock.reason ? (
                    <AppText variant="footnote" tone="muted" style={{ textAlign: 'center' }}>
                        {tAccess(lock.reason, { host: webHost })}
                    </AppText>
                ) : null}
            </View>

            <Card>
                <SettingsRow icon="folder" label={t('files')} value={files ? filesValue(files, t) : undefined} loading={!files && !unavailable.files} accessory="chevron" onPress={onFiles} />
                <Separator inset={ICON_ROW_INSET} />
                <SettingsRow icon="square.grid.2x2" label={t('apps')} value={apps ? appsValue(apps, t) : undefined} loading={!apps && !unavailable.apps} accessory="chevron" onPress={onApps} />
                <Separator inset={ICON_ROW_INSET} />
                <SettingsRow icon="clock" label={t('routines')} value={routines ? routinesValue(routines, t) : undefined} loading={!routines && !unavailable.routines} accessory="chevron" onPress={onRoutines} />
                <Separator inset={ICON_ROW_INSET} />
                <SettingsRow icon="desktopcomputer" label={t('computer')} value={computerUnavailable ?? (coworker.status === 'working' ? t('working') : t('idle'))} accessory="chevron" disabled={!!computerUnavailable} onPress={onComputer} />
            </Card>

            <Card>
                <SettingsRow testID="row-notifications" icon="bell" label={t('notifications')} value={notifications ?? undefined} loading={notifications === null} accessory="chevron" onPress={onNotifications} />
            </Card>
        </ScrollView>
    )
}
