import type { RoutineView } from '@rerun/contracts'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { Alert } from 'react-native'
import { useTranslations } from 'use-intl'

import { fetchRoutines, setRoutineEnabled } from '@/api/coworker'
import { manageLock } from '@/auth/access'
import { useAuth } from '@/auth/AuthProvider'
import { CoworkerRoutines, routineKey } from '@/components/coworker/CoworkerRoutines'
import { loadCoworkerDetail, readCoworkerDetails } from '@/data/local-cache'
import { useCoworkerAccess } from '@/data/useCoworkerAccess'

export default function CoworkerRoutinesScreen() {
    const { id: agentId, name = '' } = useLocalSearchParams<{ id: string; name?: string }>()
    const { session, me } = useAuth()
    const t = useTranslations('mobileCoworker.routines')
    const tCommon = useTranslations('mobileCommon')
    const [routines, setRoutines] = useState<RoutineView[] | null>(() => (me ? (readCoworkerDetails(me.workspace.id, agentId).routines ?? null) : null))
    // A switch flips what the hub holds: it waits for the hub's copy, never the one kept from the last visit.
    const [fresh, setFresh] = useState(false)
    const [failed, setFailed] = useState(false)
    const [savingKeys, setSavingKeys] = useState<string[]>([])
    const lock = manageLock(useCoworkerAccess(agentId))
    const accessToken = session?.access_token
    const workspaceId = me?.workspace.id

    useEffect(() => {
        if (!accessToken || !workspaceId) return
        loadCoworkerDetail(workspaceId, agentId, 'routines', () => fetchRoutines({ accessToken, workspaceId }, agentId)).then(
            list => {
                setRoutines(list)
                setFresh(true)
            },
            () => setFailed(true)
        )
    }, [accessToken, workspaceId, agentId])

    const withEnabled = (key: string, enabled: boolean) => (list: RoutineView[] | null) => list?.map(entry => (routineKey(entry) === key ? { ...entry, enabled } : entry)) ?? null

    const toggle = (routine: RoutineView, enabled: boolean) => {
        if (!accessToken || !workspaceId || lock.locked) return
        const key = routineKey(routine)
        setRoutines(withEnabled(key, enabled))
        setSavingKeys(keys => [...keys, key])
        setRoutineEnabled({ accessToken, workspaceId }, agentId, routine.kind, routine.slug, enabled)
            .catch(err => {
                setRoutines(withEnabled(key, !enabled))
                Alert.alert(enabled ? t('turnOnFailed', { name: routine.name }) : t('turnOffFailed', { name: routine.name }), err instanceof Error ? err.message : tCommon('errors.tryAgainShortly'))
            })
            .finally(() => setSavingKeys(keys => keys.filter(saving => saving !== key)))
    }

    return <CoworkerRoutines name={name} routines={routines} failed={failed} lock={lock} savingKeys={fresh ? savingKeys : (routines?.map(routineKey) ?? [])} onToggle={toggle} onBack={() => router.back()} />
}
