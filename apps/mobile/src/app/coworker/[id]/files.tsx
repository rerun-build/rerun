import type { CoworkerFile, CoworkerFiles as CoworkerFilesView } from '@moldwright/contracts'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'

import { fetchCoworkerFiles } from '@/api/coworker'
import { rawFileUrl } from '@/api/files'
import { useAuth } from '@/auth/AuthProvider'
import { CoworkerFiles } from '@/components/coworker/CoworkerFiles'
import { openViewer } from '@/components/viewer/viewer-store'
import { loadCoworkerDetail, readCoworkerDetails } from '@/data/local-cache'

export default function CoworkerFilesScreen() {
    const { id: agentId, name = '' } = useLocalSearchParams<{ id: string; name?: string }>()
    const { session, me } = useAuth()
    const [view, setView] = useState<CoworkerFilesView | null>(() => (me ? (readCoworkerDetails(me.workspace.id, agentId).files ?? null) : null))
    const [failed, setFailed] = useState(false)
    const accessToken = session?.access_token
    const workspaceId = me?.workspace.id

    useEffect(() => {
        if (!accessToken || !workspaceId) return
        loadCoworkerDetail(workspaceId, agentId, 'files', () => fetchCoworkerFiles({ accessToken, workspaceId }, agentId)).then(setView, () => setFailed(true))
    }, [accessToken, workspaceId, agentId])

    const urlOf = (file: CoworkerFile) => rawFileUrl({ agentId, path: file.path })

    const open = (file: CoworkerFile) => {
        const siblings = view?.files.filter(other => other.kind === file.kind) ?? [file]
        openViewer(
            siblings.map(other => ({ url: urlOf(other), name: other.name })),
            Math.max(0, siblings.indexOf(file))
        )
    }

    return <CoworkerFiles name={name} view={view} failed={failed} urlOf={urlOf} onOpen={open} onBack={() => router.back()} />
}
