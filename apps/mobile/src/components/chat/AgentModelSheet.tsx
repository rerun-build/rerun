import type { AgentModels, SetAgentModelInput } from '@rerun/contracts'
import * as Haptics from 'expo-haptics'
import { router, useFocusEffect } from 'expo-router'
import { Fragment, useCallback, useState } from 'react'
import { ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslations } from 'use-intl'

import { fetchAgentModels, setAgentModel } from '@/api/models'
import { AI_PROVIDERS_ADMIN_ONLY, manageLock } from '@/auth/access'
import { useAuth, useIsWorkspaceAdmin } from '@/auth/AuthProvider'
import { ReadOnlyNote } from '@/components/providers/bits'
import { AppText } from '@/components/ui/AppText'
import { GlassButton, GLASS_BUTTON_SIZE } from '@/components/ui/GlassButton'
import { Card, SectionTitle, Separator } from '@/components/ui/GroupedList'
import { Icon } from '@/components/ui/Icon'
import { ModelRow } from '@/components/ui/ModelRow'
import { ProviderLogo } from '@/components/ui/ProviderLogo'
import { useCoworkerAccess } from '@/data/useCoworkerAccess'
import { track } from '@/lib/analytics'
import { useTheme } from '@/theme/theme'
import { spacing } from '@/theme/tokens'

// The model a coworker runs, pinned on the coworker as the web picker does: every conversation with it
// follows. The groups come from the hub, built by the web picker's own rules.
export function AgentModelSheet({ agentId }: { agentId: string }) {
    const theme = useTheme()
    const insets = useSafeAreaInsets()
    const { session, me } = useAuth()
    const t = useTranslations('mobileProviders.modelSheet')
    const [models, setModels] = useState<AgentModels | null>(null)
    const [failed, setFailed] = useState(false)
    // A coworker the caller only uses keeps the model its managers picked; the rows stay greyed until
    // the caller's level is known.
    const lock = manageLock(useCoworkerAccess(agentId))
    const workspaceAdmin = useIsWorkspaceAdmin()
    const caller = session && me ? { accessToken: session.access_token, workspaceId: me.workspace.id } : null
    const accessToken = session?.access_token
    const workspaceId = me?.workspace.id

    // Read again on focus: a provider added from this sheet comes back with its models.
    useFocusEffect(
        useCallback(() => {
            if (!accessToken || !workspaceId) return
            fetchAgentModels({ accessToken, workspaceId }, agentId)
                .then(setModels)
                .catch(() => setFailed(true))
        }, [accessToken, workspaceId, agentId])
    )

    const addProvider = () => {
        track('connection_cta_clicked', { source: 'ios_model_sheet' })
        router.push('/providers/add')
    }

    const pick = async (choice: SetAgentModelInput) => {
        if (!caller || lock.locked) return
        Haptics.selectionAsync()
        await setAgentModel(caller, agentId, choice).catch(() => setFailed(true))
        router.back()
    }

    const pinned = models?.pinned
    const boxDefault = models?.boxDefault
    const defaultGroup = models?.groups.find(group => group.connectionId === boxDefault?.connectionId)

    // A form sheet lays out its scroll view itself: wrapped in a view, it is laid out at no height.
    return (
        <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.xl, paddingBottom: insets.bottom + spacing.xl, gap: spacing.xl }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <GlassButton symbol="x" label={t('close')} onPress={() => router.back()} />
                    <AppText variant="headline" numberOfLines={1} maxFontSizeMultiplier={1.2} style={{ flex: 1, textAlign: 'center' }}>
                        {t('title')}
                    </AppText>
                    <View style={{ width: GLASS_BUTTON_SIZE }} />
                </View>

                {failed && (
                    <AppText variant="callout" tone="muted" style={{ textAlign: 'center' }}>
                        {t('notAnswering')}
                    </AppText>
                )}

                <ReadOnlyNote reason={lock.reason} />

                {models && boxDefault && (
                    <Card>
                        <ModelRow id="model-default" label={t('workspaceDefault')} description={defaultGroup?.models.find(model => model.id === boxDefault.model)?.label ?? boxDefault.model} selected={!pinned} disabled={lock.locked} leading={<Icon name="layers" size={16} color={theme.mutedForeground} />} onPress={() => pick({ connectionId: null, model: null })} />
                    </Card>
                )}

                {models?.groups.map(group => (
                    <View key={group.connectionId} style={{ gap: spacing.sm }}>
                        <SectionTitle>{group.label}</SectionTitle>
                        <Card>
                            {group.models.map((model, index) => (
                                <Fragment key={model.id}>
                                    {index > 0 && <Separator inset={spacing.lg + 20 + spacing.md} />}
                                    <ModelRow id={`model-${group.connectionId}-${model.id}`} label={model.label} description={model.description} locked={model.locked} disabled={lock.locked} selected={pinned?.connectionId === group.connectionId && pinned.model === model.id} leading={<ProviderLogo provider={group.provider} size={18} />} onPress={() => pick({ connectionId: group.connectionId, model: model.id })} />
                                </Fragment>
                            ))}
                        </Card>
                    </View>
                ))}

                {models && (
                    <View style={{ gap: spacing.sm }}>
                        <Card>
                            <ModelRow id="model-add-provider" label={t('addProvider')} selected={false} disabled={!workspaceAdmin} leading={<Icon name="plus" size={15} bold color={theme.foreground} />} onPress={addProvider} />
                        </Card>
                        {!workspaceAdmin && <ReadOnlyNote reason={AI_PROVIDERS_ADMIN_ONLY} />}
                    </View>
                )}
        </ScrollView>
    )
}
