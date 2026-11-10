import type { CoworkerFiles as CoworkerFilesView, InstalledServiceView, RoutineView } from '@rerun/contracts'
import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Alert } from 'react-native'

import { BOX_MANAGE_REASON, OPEN_LOCK, type ManageLock } from '@/auth/access'
import { CoworkerApps } from '@/components/coworker/CoworkerApps'
import { CoworkerDetails } from '@/components/coworker/CoworkerDetails'
import { CoworkerFiles } from '@/components/coworker/CoworkerFiles'
import { CoworkerRoutines, routineKey } from '@/components/coworker/CoworkerRoutines'
import { MOCK_APPS, MOCK_APPS_TO_CONNECT, MOCK_FILES, MOCK_ROUTINES, mockFileUrl } from '@/mocks/coworkerDetails'
import { coworkers } from '@/mocks/data'

// Dev only: the coworker details and the pages they open, on mock data, in each state.
// `rerun://lab-coworker?screen=details&state=normal`.

// `use`: the caller only uses the coworker's Box, so what changes the coworker is greyed.
type LabState = 'normal' | 'loading' | 'to-connect' | 'empty' | 'off' | 'muted' | 'use'

const SCOUT = coworkers.find(coworker => coworker.id === 'agent-scout')!
const back = () => router.back()

function appsFor(state: LabState): InstalledServiceView[] | null {
    if (state === 'loading') return null
    if (state === 'empty') return []
    return state === 'to-connect' || state === 'use' ? MOCK_APPS_TO_CONNECT : MOCK_APPS
}

function filesFor(state: LabState): CoworkerFilesView | null {
    if (state === 'loading') return null
    if (state === 'empty') return { files: [], truncated: false }
    return state === 'to-connect' ? { ...MOCK_FILES, truncated: true } : MOCK_FILES
}

const lockFor = (state: LabState): ManageLock => (state === 'use' ? { locked: true, reason: BOX_MANAGE_REASON } : OPEN_LOCK)

const routinesFor = (state: LabState): RoutineView[] | null => (state === 'loading' ? null : state === 'empty' ? [] : MOCK_ROUTINES)

export function DetailsLab({ state }: { state: LabState }) {
    const [name, setName] = useState(SCOUT.name)
    const rename = () => Alert.prompt('Rename', undefined, next => next?.trim() && setName(next.trim()), 'plain-text', name)
    const remove = () =>
        Alert.alert(`Delete ${name}?`, 'This permanently deletes the coworker and its data. This cannot be undone.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: back },
        ])
    return (
        <CoworkerDetails
            coworker={{ id: SCOUT.id, name, status: state === 'off' ? 'offline' : 'working', boxName: 'Sales' }}
            files={filesFor(state)}
            apps={appsFor(state)}
            routines={routinesFor(state)}
            notifications={state === 'loading' ? null : state === 'muted' ? 'Muted' : 'Your setting'}
            computerUnavailable={state === 'off' ? 'Off' : null}
            canDelete={state !== 'off'}
            lock={lockFor(state)}
            onBack={back}
            onEdit={rename}
            onDelete={remove}
            onFiles={() => router.push(`/lab-coworker?screen=files&state=${state}`)}
            onApps={() => router.push(`/lab-coworker?screen=apps&state=${state}`)}
            onRoutines={() => router.push(`/lab-coworker?screen=routines&state=${state}`)}
            onComputer={() => {}}
            onNotifications={() => router.push(`/lab-notifications?screen=coworker&state=${state === 'muted' ? 'muted' : 'normal'}`)}
        />
    )
}

function RoutinesLab({ state }: { state: LabState }) {
    const [routines, setRoutines] = useState(routinesFor(state))
    const toggle = (routine: RoutineView, enabled: boolean) => setRoutines(list => list?.map(entry => (routineKey(entry) === routineKey(routine) ? { ...entry, enabled } : entry)) ?? null)
    return <CoworkerRoutines name={SCOUT.name} routines={routines} savingKeys={[]} lock={lockFor(state)} onToggle={toggle} onBack={back} />
}

export default function CoworkerLab() {
    const params = useLocalSearchParams<{ screen?: string; state?: LabState }>()
    const state = params.state ?? 'normal'
    switch (params.screen) {
        case 'apps':
            return <CoworkerApps name={SCOUT.name} apps={appsFor(state)} connectingKey={null} lock={lockFor(state)} onConnect={() => {}} onBack={back} />
        case 'files':
            return <CoworkerFiles name={SCOUT.name} view={filesFor(state)} urlOf={mockFileUrl} onOpen={() => {}} onBack={back} />
        case 'routines':
            return <RoutinesLab key={state} state={state} />
        default:
            return <DetailsLab key={state} state={state} />
    }
}
