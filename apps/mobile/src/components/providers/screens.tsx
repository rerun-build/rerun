import type { AddableProvider, AiConnectionKind, AiConnectionView, AiConnectionsView, UpdateConnectionInput } from '@rerun/contracts'
import { router } from 'expo-router'
import { useState } from 'react'
import { Alert } from 'react-native'
import { useTranslations } from 'use-intl'

import { deleteAiConnection, fetchAiConnectionUsage, replaceAiConnectionKey, setWorkspaceDefault, updateAiConnection } from '@/api/aiConnections'
import { AI_PROVIDERS_ADMIN_ONLY } from '@/auth/access'
import { useIsWorkspaceAdmin } from '@/auth/AuthProvider'
import { messageOf, useAiConnections } from '@/data/useAiConnections'
import { track } from '@/lib/analytics'
import * as Haptics from '@/lib/haptics'

import { AddProvider } from './AddProvider'
import { describeUsage, ReadOnlyNote, SheetFrame } from './bits'
import { ConnectionDetail } from './ConnectionDetail'
import { DefaultModelPicker } from './DefaultModelPicker'
import { ProvidersList } from './ProvidersList'
import { connectHref, leave } from './routes'

// The providers are the workspace's: a member reads them, only an admin changes them.
const useReadOnlyReason = () => (useIsWorkspaceAdmin() ? null : AI_PROVIDERS_ADMIN_ONLY)

// A step only an admin takes, reached by a link that does not know the caller's role.
export function ProvidersAdminOnly() {
    const t = useTranslations('mobileProviders.list')
    return (
        <SheetFrame title={t('title')} onBack={() => leave()}>
            <ReadOnlyNote reason={AI_PROVIDERS_ADMIN_ONLY} />
        </SheetFrame>
    )
}

export function ProvidersListScreen() {
    const { view, failed } = useAiConnections()
    const readOnlyReason = useReadOnlyReason()
    return (
        <ProvidersList
            view={view}
            failed={failed}
            readOnlyReason={readOnlyReason}
            onClose={() => leave()}
            onOpen={id => router.push({ pathname: '/providers/[id]', params: { id } })}
            onAdd={provider => router.push(connectHref(provider))}
            onAddKind={kind => router.push({ pathname: '/providers/add', params: { only: kind } })}
            onChangeDefault={() => router.push('/providers/default')}
        />
    )
}

export function AddProviderScreen({ only }: { only?: Exclude<AiConnectionKind, 'included'> }) {
    const { view } = useAiConnections()
    const readOnlyReason = useReadOnlyReason()
    if (readOnlyReason) return <ProvidersAdminOnly />
    if (!view) return null
    return <AddProvider addable={view.addable} only={only} onPick={provider => router.push(connectHref(provider))} onBack={() => leave()} />
}

export function DefaultModelScreen() {
    const { view, caller } = useAiConnections()
    const readOnlyReason = useReadOnlyReason()
    const t = useTranslations('mobileProviders.defaultModel')
    if (readOnlyReason) return <ProvidersAdminOnly />
    if (!view) return null
    const pick = async (choice: { connectionId: string; model: string }) => {
        if (!caller) return
        Haptics.selectionAsync()
        try {
            await setWorkspaceDefault(caller, choice)
            leave()
        } catch (err) {
            Alert.alert(t('changeFailed'), messageOf(err))
        }
    }
    return <DefaultModelPicker view={view} onPick={pick} onBack={() => leave()} />
}

// Every edit persists at once, shown before the hub answers and read back after.
export function ConnectionDetailScreen({ connectionId }: { connectionId: string }) {
    const { view, caller, reload, setView } = useAiConnections()
    const [error, setError] = useState<string | null>(null)
    const [key, setKey] = useState('')
    const [keyBusy, setKeyBusy] = useState(false)
    const [keyError, setKeyError] = useState<string | null>(null)
    const readOnlyReason = useReadOnlyReason()
    const t = useTranslations('mobileProviders.detail')
    const tUsage = useTranslations('mobileProviders.usage')
    const tCommon = useTranslations('mobileCommon.actions')
    const connection = view?.connections.find(candidate => candidate.id === connectionId)
    if (!view || !connection || !caller) return null

    const optimistic = (change: Partial<AiConnectionView>): AiConnectionsView => ({ ...view, connections: view.connections.map(candidate => (candidate.id === connectionId ? { ...candidate, ...change } : candidate)) })

    const patch = async (body: UpdateConnectionInput, change: Partial<AiConnectionView>) => {
        setView(optimistic(change))
        try {
            await updateAiConnection(caller, connectionId, body)
            setError(null)
        } catch (err) {
            setError(messageOf(err, t('saveFailed')))
        }
        reload()
    }

    const rename = () =>
        Alert.prompt(
            t('renameTitle'),
            t('renameMessage'),
            name => {
                const trimmed = name.trim()
                if (trimmed && trimmed !== connection.name) patch({ name: trimmed }, { name: trimmed })
            },
            'plain-text',
            connection.name
        )

    const onModels = (models: string[]) => {
        const enabled = new Set([...models, ...connection.extraModels])
        patch({ models }, { models: connection.models.map(model => ({ ...model, enabled: enabled.has(model.id) })) })
    }

    const saveKey = async () => {
        setKeyBusy(true)
        setKeyError(null)
        try {
            await replaceAiConnectionKey(caller, connectionId, key.trim())
            setKey('')
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
            track('ai_connection_connected', { provider: connection.provider, method: 'api_key', surface: 'reconnect' })
            reload()
        } catch (err) {
            setKeyError(messageOf(err, t('keySaveFailed')))
        } finally {
            setKeyBusy(false)
        }
    }

    const remove = async () => {
        const usage = await fetchAiConnectionUsage(caller, connectionId).catch(() => null)
        Alert.alert(t('removeTitle', { name: connection.name }), usage ? describeUsage(usage, tUsage) : undefined, [
            { text: tCommon('cancel'), style: 'cancel' },
            {
                text: t('removeConfirm'),
                style: 'destructive',
                onPress: async () => {
                    try {
                        await deleteAiConnection(caller, connectionId)
                        leave()
                    } catch (err) {
                        setError(messageOf(err, t('deleteFailed')))
                    }
                },
            },
        ])
    }

    return (
        <ConnectionDetail
            connection={connection}
            view={view}
            error={error}
            onBack={() => leave()}
            onRename={rename}
            onModels={onModels}
            onBaseUrl={baseUrl => patch({ baseUrl }, { baseUrl })}
            onExtraModels={extraModels => patch({ extraModels }, { extraModels })}
            onSignInAgain={() => connection.provider !== 'rerun' && router.push(connectHref(connection.provider, connectionId))}
            replacement={{ key, onKey: setKey, busy: keyBusy, error: keyError, onSave: saveKey }}
            onRemove={remove}
            readOnlyReason={readOnlyReason}
        />
    )
}
