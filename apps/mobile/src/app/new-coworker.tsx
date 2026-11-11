import type { Box } from '@rerun/contracts'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { Alert, Pressable, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslations } from 'use-intl'

import { createCoworker, fetchBoxes } from '@/api/board'
import { boxForNewCoworker, manageableBoxes, newCoworkerBlocker } from '@/auth/access'
import { useAuth, useIsWorkspaceAdmin } from '@/auth/AuthProvider'
import { SheetChrome } from '@/components/layout/SheetChrome'
import { AppText } from '@/components/ui/AppText'
import { GlassButton, GLASS_BUTTON_SIZE } from '@/components/ui/GlassButton'
import { Icon } from '@/components/ui/Icon'
import { PillButton } from '@/components/ui/PillButton'
import { TextField } from '@/components/ui/TextField'
import * as Haptics from '@/lib/haptics'
import { useTheme } from '@/theme/theme'
import { brand, radius, spacing } from '@/theme/tokens'
import { webHost } from '@/config/environment'

const NAME_MAX = 60

function BoxRow({ box, selected, onPress, divided }: { box: Box; selected: boolean; onPress: () => void; divided: boolean }) {
    const theme = useTheme()
    const t = useTranslations('mobileHome')
    const label = box.name || t('untitledBox')
    return (
        <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 48, paddingHorizontal: spacing.lg, borderTopWidth: divided ? 1 : 0, borderTopColor: theme.border, backgroundColor: pressed ? theme.muted : 'transparent' })}>
            <Icon name="square-dashed" size={16} color={theme.mutedForeground} />
            <AppText variant="body" numberOfLines={1} style={{ flex: 1 }}>
                {label}
            </AppText>
            {selected && <Icon name="check" size={16} bold color={theme.scheme === 'dark' ? brand.soft : brand.base} />}
        </Pressable>
    )
}

// A new coworker in one of the Boxes the caller manages. What it should do is also its first message,
// so it starts working as soon as it exists, as on the web. `box` preselects a Box.
export default function NewCoworker() {
    const theme = useTheme()
    const insets = useSafeAreaInsets()
    const { box: preselected } = useLocalSearchParams<{ box?: string }>()
    const { session, me } = useAuth()
    const t = useTranslations('mobileCoworker.create')
    const tAccess = useTranslations('mobileCoworker.access')
    const tCommon = useTranslations('mobileCommon')
    const [boxes, setBoxes] = useState<Box[] | null>(null)
    const [boxId, setBoxId] = useState<string | null>(preselected ?? null)
    const [name, setName] = useState('')
    const [description, setDescription] = useState('')
    const [creating, setCreating] = useState(false)
    const [failed, setFailed] = useState(false)
    const workspaceAdmin = useIsWorkspaceAdmin()
    const accessToken = session?.access_token
    const workspaceId = me?.workspace.id

    useEffect(() => {
        if (!accessToken || !workspaceId) return
        fetchBoxes({ accessToken, workspaceId })
            .then(list => {
                const manageable = manageableBoxes(list)
                setBoxes(manageable)
                setBoxId(current => boxForNewCoworker(manageable, current))
            })
            .catch(() => setFailed(true))
    }, [accessToken, workspaceId])

    const blocked = newCoworkerBlocker({ failed, manageable: boxes, admin: workspaceAdmin })

    const create = async () => {
        if (!accessToken || !workspaceId || !boxId || !name.trim()) return
        setCreating(true)
        try {
            const created = await createCoworker({ accessToken, workspaceId }, { name: name.trim(), description: description.trim() || undefined, spaceId: boxId })
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
            router.replace({ pathname: '/chat/[id]', params: { id: created.sessionId ?? 'new', to: created.agentId } })
            if (!created.active) Alert.alert(t('pausedTitle', { name: name.trim() }), t('pausedMessage'))
        } catch (err) {
            setCreating(false)
            Alert.alert(t('failed'), err instanceof Error ? err.message : tCommon('errors.tryAgainShortly'))
        }
    }

    // A form sheet lays out its scroll view itself: wrapped in a view, it is laid out at no height.
    return (
        <>
            <ScrollView style={{ backgroundColor: theme.background }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.xl, paddingBottom: insets.bottom + spacing.xl, gap: spacing.xl }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <GlassButton symbol="x" label={tCommon('actions.close')} onPress={() => router.back()} />
                    <AppText variant="headline" numberOfLines={1} maxFontSizeMultiplier={1.2} style={{ flex: 1, textAlign: 'center' }}>
                        {t('title')}
                    </AppText>
                    <View style={{ width: GLASS_BUTTON_SIZE }} />
                </View>

                {blocked ? (
                    <AppText variant="callout" tone="muted">
                        {tAccess(blocked, { host: webHost })}
                    </AppText>
                ) : (
                    <>
                        <TextField id="coworker-name" label={t('nameLabel')} value={name} onChangeText={setName} placeholder={t('namePlaceholder')} maxLength={NAME_MAX} autoFocus />
                        <TextField id="coworker-description" label={t('descriptionLabel')} value={description} onChangeText={setDescription} placeholder={t('descriptionPlaceholder')} multiline help={t('descriptionHelp')} />
                    </>
                )}

                {boxes && boxes.length > 0 && (
                    <View style={{ gap: spacing.sm }}>
                        <AppText variant="footnote" medium>
                            {t('boxLabel')}
                        </AppText>
                        <View style={{ borderRadius: radius.lg, borderCurve: 'continuous', backgroundColor: theme.card, overflow: 'hidden' }}>
                            {boxes.map((box, index) => (
                                <BoxRow key={box.id} box={box} selected={box.id === boxId} divided={index > 0} onPress={() => setBoxId(box.id)} />
                            ))}
                        </View>
                    </View>
                )}
                {!blocked && <PillButton label={t('submit')} onPress={create} loading={creating} disabled={!name.trim() || !boxId} />}
            </ScrollView>
            <SheetChrome />
        </>
    )
}
