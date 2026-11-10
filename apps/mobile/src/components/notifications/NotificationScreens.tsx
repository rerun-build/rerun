import { taskKey, type RoutineView } from '@rerun/contracts'
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router'
import { useCallback, useState, type ReactNode } from 'react'
import { Linking } from 'react-native'
import { useTranslations } from 'use-intl'

import { fetchRoutines } from '@/api/coworker'
import { useAuth } from '@/auth/AuthProvider'
import { CoworkerPage } from '@/components/coworker/CoworkerPage'
import { CoworkerNotifications } from '@/components/notifications/CoworkerNotifications'
import { NotificationCenter } from '@/components/notifications/NotificationCenter'
import { SheetFrame } from '@/components/providers/bits'
import { loadCoworkerDetail, readCoworkerDetails } from '@/data/local-cache'
import { useNotificationPrefs } from '@/data/useNotificationPrefs'
import { useWorkspaceAgents } from '@/data/useWorkspaceAgents'
import { usePushPermission } from '@/notifications/usePushPermission'

// Opened straight from the inbox, the page is the first of its sheet: its button closes it.
function SettingsSheet({ title, children }: { title: string; children: ReactNode }) {
    const first = (useNavigation().getState()?.index ?? 0) === 0
    return (
        <SheetFrame title={title} onBack={first ? undefined : router.back} onClose={first ? router.back : undefined}>
            {children}
        </SheetFrame>
    )
}

export function NotificationCenterScreen() {
    const { prefs, failed, update } = useNotificationPrefs()
    const agents = useWorkspaceAgents()
    const push = usePushPermission()
    const t = useTranslations('mobileSettings.notifications')
    return (
        <SettingsSheet title={t('title')}>
            <NotificationCenter prefs={prefs} failed={failed} coworkers={agents?.map(agent => ({ id: agent.id, name: agent.name })) ?? null} push={push.status} onEnablePush={push.enable} onOpenSettings={() => Linking.openSettings()} onPatch={update} onOpenCoworker={coworker => router.push({ pathname: '/settings/coworker/[id]', params: { id: coworker.id, name: coworker.name } })} />
        </SettingsSheet>
    )
}

function useCoworkerRoutines(agentId: string) {
    const { session, me } = useAuth()
    const accessToken = session?.access_token
    const workspaceId = me?.workspace.id
    const [routines, setRoutines] = useState<RoutineView[] | null>(() => (workspaceId ? (readCoworkerDetails(workspaceId, agentId).routines ?? null) : null))
    const [failed, setFailed] = useState(false)

    useFocusEffect(
        useCallback(() => {
            if (!accessToken || !workspaceId) return
            loadCoworkerDetail(workspaceId, agentId, 'routines', () => fetchRoutines({ accessToken, workspaceId }, agentId)).then(
                list => {
                    setRoutines(list)
                    setFailed(false)
                },
                () => setFailed(true)
            )
        }, [accessToken, workspaceId, agentId])
    )

    return { routines, failed }
}

// A coworker's own rule. In the settings sheet when reached from the settings or the inbox, as a
// full page when reached from the coworker's details.
export function CoworkerNotificationsScreen({ frame }: { frame: 'sheet' | 'page' }) {
    const { id: agentId, name = '' } = useLocalSearchParams<{ id: string; name?: string }>()
    const { prefs, update, setCoworkerRule } = useNotificationPrefs()
    const { routines, failed } = useCoworkerRoutines(agentId)
    const t = useTranslations('mobileSettings.notifications')
    const content = <CoworkerNotifications agentId={agentId} name={name} prefs={prefs} routines={routines} routinesFailed={failed} onRule={rule => setCoworkerRule(agentId, rule)} onTask={(kind, slug, notify) => update({ tasks: { [taskKey(agentId, kind, slug)]: notify } })} />
    if (frame === 'page') {
        return (
            <CoworkerPage title={t('title')} onBack={() => router.back()}>
                {content}
            </CoworkerPage>
        )
    }
    return <SettingsSheet title={t('title')}>{content}</SettingsSheet>
}
