import type { AgentView, Box, CoworkerFiles, InstalledServiceView, RoutineView } from '@rerun/contracts'
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useCallback, useState } from 'react'
import { Alert } from 'react-native'
import { useTranslations } from 'use-intl'

import { fetchBoxes } from '@/api/board'
import { fetchAgentView } from '@/api/chat'
import { deleteCoworker, fetchCoworkerFiles, fetchInstalledServices, fetchRoutines, renameCoworker } from '@/api/coworker'
import { knownCoworkerAccess, manageLock } from '@/auth/access'
import { useAuth } from '@/auth/AuthProvider'
import { CoworkerDetails } from '@/components/coworker/CoworkerDetails'
import { ruleValue } from '@/components/notifications/NotificationCenter'
import { promptText } from '@/components/ui/system-dialogs'
import { cachedBoard, loadCoworkerDetail, readCoworkerDetails, type CoworkerDetailsRead } from '@/data/local-cache'
import { useNotificationPrefs } from '@/data/useNotificationPrefs'
import { setPendingDesktopOpen } from '@/desktop/pending-open'

type Unavailable = Partial<Record<'files' | 'apps' | 'routines', boolean>>

// The coworker's details, opened from its conversation. Every value is read again when the page comes
// back on screen, so a routine switched off or an app connected one level down shows at once.
export default function CoworkerDetailsScreen() {
    const { id: agentId, name: nameParam } = useLocalSearchParams<{ id: string; name?: string }>()
    const { session, me } = useAuth()
    const t = useTranslations('mobileCoworker.details')
    const tCommon = useTranslations('mobileCommon')
    const errorText = (err: unknown) => (err instanceof Error ? err.message : tCommon('errors.tryAgainShortly'))
    const rule = useNotificationPrefs().ruleOf(agentId)
    // Opens on what the last visit read, every value is replaced as the hub answers.
    const [kept] = useState(() => (me ? readCoworkerDetails(me.workspace.id, agentId) : {}))
    const [view, setView] = useState<AgentView | null>(kept.view ?? null)
    const [boxes, setBoxes] = useState<Box[]>(kept.boxes ?? [])
    const [files, setFiles] = useState<CoworkerFiles | null>(kept.files ?? null)
    const [apps, setApps] = useState<InstalledServiceView[] | null>(kept.apps ?? null)
    const [routines, setRoutines] = useState<RoutineView[] | null>(kept.routines ?? null)
    const [unavailable, setUnavailable] = useState<Unavailable>({})
    const [name, setName] = useState(kept.view?.agent.name ?? nameParam ?? '')
    const accessToken = session?.access_token
    const workspaceId = me?.workspace.id
    const caller = accessToken && workspaceId ? { accessToken, workspaceId } : null

    useFocusEffect(
        useCallback(() => {
            if (!accessToken || !workspaceId) return
            const who = { accessToken, workspaceId }
            const failed = (key: keyof Unavailable) => () => setUnavailable(current => ({ ...current, [key]: true }))
            const read = <T,>(key: keyof Unavailable, load: Promise<T>, set: (value: T) => void) =>
                load.then(value => {
                    set(value)
                    setUnavailable(current => ({ ...current, [key]: false }))
                }, failed(key))
            const detail = <K extends keyof CoworkerDetailsRead>(part: K, fetch: () => Promise<NonNullable<CoworkerDetailsRead[K]>>) => loadCoworkerDetail(workspaceId, agentId, part, fetch)
            detail('view', () => fetchAgentView(who, agentId))
                .then(next => {
                    setView(next)
                    setName(next.agent.name)
                })
                .catch(() => {})
            detail('boxes', () => fetchBoxes(who)).then(setBoxes, () => {})
            read('files', detail('files', () => fetchCoworkerFiles(who, agentId)), setFiles)
            read('apps', detail('apps', () => fetchInstalledServices(who, agentId)), setApps)
            read('routines', detail('routines', () => fetchRoutines(who, agentId)), setRoutines)
        }, [accessToken, workspaceId, agentId])
    )

    const agent = view?.agent
    const switchedOff = !!agent?.disabledAt
    const boxName = boxes.find(box => box.id === agent?.spaceId)?.name ?? null
    // The level comes with the coworker's copy: until one is read, the board the chat came from answers.
    const lock = manageLock(agent ? { access: agent.access, known: true } : knownCoworkerAccess(agentId, { agents: workspaceId ? cachedBoard(workspaceId).read()?.agents : null }))

    const openScreen = () => {
        setPendingDesktopOpen({ agentId, name })
        router.push({ pathname: '/desktop', params: { agent: agentId } })
    }

    const rename = () => {
        if (!caller || lock.locked) return
        promptText({
            title: t('renameTitle'),
            defaultValue: name,
            cancelLabel: tCommon('actions.cancel'),
            submitLabel: t('save'),
            onSubmit: value => {
                const next = value.trim()
                if (!next || next === name) return
                const previous = name
                setName(next)
                renameCoworker(caller, agentId, next).catch(err => {
                    setName(previous)
                    Alert.alert(t('renameFailed'), errorText(err))
                })
            },
        })
    }

    const remove = () => {
        if (!caller || lock.locked) return
        Alert.alert(t('deleteTitle', { name }), t('deleteMessage'), [
            { text: tCommon('actions.cancel'), style: 'cancel' },
            {
                text: t('deleteConfirm'),
                style: 'destructive',
                onPress: () =>
                    deleteCoworker(caller, agentId)
                        .then(() => router.dismissTo('/'))
                        .catch(err => Alert.alert(t('deleteFailed'), errorText(err))),
            },
        ])
    }

    const page = (screen: 'files' | 'apps' | 'routines' | 'notifications') => router.push({ pathname: `/coworker/[id]/${screen}`, params: { id: agentId, name } })

    return (
        <CoworkerDetails
            coworker={{ id: agentId, name, status: switchedOff ? 'offline' : (agent?.status ?? 'idle'), boxName }}
            files={files}
            apps={apps}
            routines={routines}
            notifications={rule ? ruleValue(rule) : null}
            unavailable={unavailable}
            computerUnavailable={switchedOff ? t('off') : null}
            canDelete={!!caller}
            lock={lock}
            onBack={() => router.back()}
            onEdit={rename}
            onDelete={remove}
            onFiles={() => page('files')}
            onApps={() => page('apps')}
            onRoutines={() => page('routines')}
            onComputer={openScreen}
            onNotifications={() => page('notifications')}
        />
    )
}
