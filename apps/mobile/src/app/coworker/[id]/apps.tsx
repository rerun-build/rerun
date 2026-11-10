import type { InstalledServiceView } from '@rerun/contracts'
import { router, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { Alert } from 'react-native'
import { useTranslations } from 'use-intl'

import { fetchInstalledServices } from '@/api/coworker'
import { manageLock } from '@/auth/access'
import { useAuth } from '@/auth/AuthProvider'
import { CoworkerApps } from '@/components/coworker/CoworkerApps'
import { loadCoworkerDetail, readCoworkerDetails } from '@/data/local-cache'
import { useCoworkerAccess } from '@/data/useCoworkerAccess'
import { runConnect } from '@/lib/oauth-connect'

const keyOf = (app: InstalledServiceView) => app.key ?? app.slug

export default function CoworkerAppsScreen() {
    const { id: agentId, name = '' } = useLocalSearchParams<{ id: string; name?: string }>()
    const { session, me } = useAuth()
    const t = useTranslations('mobileCoworker.apps')
    const [apps, setApps] = useState<InstalledServiceView[] | null>(() => (me ? (readCoworkerDetails(me.workspace.id, agentId).apps ?? null) : null))
    const [failed, setFailed] = useState(false)
    const [connectingKey, setConnectingKey] = useState<string | null>(null)
    const lock = manageLock(useCoworkerAccess(agentId))
    const accessToken = session?.access_token
    const workspaceId = me?.workspace.id

    const load = useCallback(() => {
        if (!accessToken || !workspaceId) return
        loadCoworkerDetail(workspaceId, agentId, 'apps', () => fetchInstalledServices({ accessToken, workspaceId }, agentId)).then(
            list => {
                setApps(list)
                setFailed(false)
            },
            () => setFailed(true)
        )
    }, [accessToken, workspaceId, agentId])

    useEffect(load, [load])

    const connect = async (app: InstalledServiceView) => {
        if (!accessToken || !workspaceId || connectingKey || lock.locked) return
        setConnectingKey(keyOf(app))
        const outcome = await runConnect({ accessToken, workspaceId }, agentId, keyOf(app))
        setConnectingKey(null)
        if (outcome.status === 'error') Alert.alert(t('connectFailed', { name: app.name }), outcome.message)
        if (outcome.status === 'connected') load()
    }

    return <CoworkerApps name={name} apps={apps} failed={failed} lock={lock} connectingKey={connectingKey} onConnect={connect} onBack={() => router.back()} />
}
