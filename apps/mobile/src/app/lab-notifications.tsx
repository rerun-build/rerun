import { DEFAULT_NOTIFICATION_PREFS, mergeNotificationPrefs, taskKey, type NotificationPrefs, type NotificationPrefsPatch } from '@rerun/contracts'
import type { PermissionStatus } from 'expo-notifications'
import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'

import { CoworkerPage } from '@/components/coworker/CoworkerPage'
import { CoworkerNotifications } from '@/components/notifications/CoworkerNotifications'
import { NotificationCenter } from '@/components/notifications/NotificationCenter'
import { MOCK_ROUTINES } from '@/mocks/coworkerDetails'
import { coworkers } from '@/mocks/data'

// Dev only: the notification settings and a coworker's own rule, on mock data, in each state.
// `rerun://lab-notifications?screen=center&state=normal`, `screen=coworker&state=muted`.

type LabState = 'normal' | 'loading' | 'failed' | 'push-off' | 'push-undetermined' | 'nothing' | 'rules' | 'muted' | 'no-tasks'

const COWORKERS = coworkers.filter(coworker => coworker.kind === 'coworker').map(({ id, name }) => ({ id, name }))
const SCOUT = COWORKERS.find(coworker => coworker.id === 'agent-scout')!
const back = () => router.back()

function prefsFor(state: LabState): NotificationPrefs {
    if (state === 'nothing') return { ...DEFAULT_NOTIFICATION_PREFS, scope: 'nothing' }
    if (state === 'muted') return { ...DEFAULT_NOTIFICATION_PREFS, coworkers: { [SCOUT.id]: { mode: 'muted', follow: true } } }
    if (state === 'rules' || state === 'normal')
        return {
            ...DEFAULT_NOTIFICATION_PREFS,
            coworkers: state === 'rules' ? { 'agent-scout': { mode: 'default', follow: true }, 'agent-pulse': { mode: 'everything' }, 'agent-ledger': { mode: 'muted' } } : { [SCOUT.id]: { mode: 'default', follow: true } },
            tasks: { [taskKey(SCOUT.id, 'schedule', 'weekly-digest')]: false },
        }
    return DEFAULT_NOTIFICATION_PREFS
}

function pushFor(state: LabState): PermissionStatus {
    if (state === 'push-off') return 'denied' as PermissionStatus
    if (state === 'push-undetermined') return 'undetermined' as PermissionStatus
    return 'granted' as PermissionStatus
}

function useLabPrefs(state: LabState) {
    const [prefs, setPrefs] = useState(() => prefsFor(state))
    return [prefs, (patch: NotificationPrefsPatch) => setPrefs(current => mergeNotificationPrefs(current, patch))] as const
}

function CenterLab({ state }: { state: LabState }) {
    const [prefs, patch] = useLabPrefs(state)
    const [push, setPush] = useState(() => pushFor(state))
    const empty = state === 'loading' || state === 'failed'
    return (
        <CoworkerPage title="Notifications" onBack={back}>
            <NotificationCenter prefs={empty ? null : prefs} failed={state === 'failed'} coworkers={state === 'loading' ? null : COWORKERS} push={push} onEnablePush={() => setPush('granted' as PermissionStatus)} onOpenSettings={() => {}} onPatch={patch} onOpenCoworker={coworker => router.push(`/lab-notifications?screen=coworker&state=${prefs.coworkers[coworker.id]?.mode === 'muted' ? 'muted' : 'normal'}`)} />
        </CoworkerPage>
    )
}

function CoworkerLab({ state }: { state: LabState }) {
    const [prefs, patch] = useLabPrefs(state)
    return (
        <CoworkerPage title="Notifications" onBack={back}>
            <CoworkerNotifications agentId={SCOUT.id} name={SCOUT.name} prefs={state === 'loading' ? null : prefs} routines={state === 'loading' || state === 'failed' ? null : state === 'no-tasks' ? [] : MOCK_ROUTINES} routinesFailed={state === 'failed'} onRule={rule => patch({ coworkers: { [SCOUT.id]: rule } })} onTask={(kind, slug, notify) => patch({ tasks: { [taskKey(SCOUT.id, kind, slug)]: notify } })} />
        </CoworkerPage>
    )
}

export default function LabNotifications() {
    const { screen = 'center', state = 'normal' } = useLocalSearchParams<{ screen?: 'center' | 'coworker'; state?: LabState }>()
    return screen === 'coworker' ? <CoworkerLab key={state} state={state} /> : <CenterLab key={state} state={state} />
}
