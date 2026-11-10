import type { Locale } from '@rerun/i18n'
import * as Application from 'expo-application'
import { router } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { Linking, Pressable, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocale, useTranslations } from 'use-intl'

import { appBuild } from '@/api/client'
import { useAuth } from '@/auth/AuthProvider'
import { askToDeleteAccount, askToLeaveServer, contactSupport, initialsOf } from '@/components/home/account-actions'
import { useGroupMode, type GroupMode } from '@/components/home/useGroupMode'
import { workspaceLabel } from '@/components/home/workspace-logos'
import { AppText } from '@/components/ui/AppText'
import { GlassButton, GLASS_BUTTON_SIZE } from '@/components/ui/GlassButton'
import { Card, Section, SectionTitle, Separator, SettingsRow } from '@/components/ui/GroupedList'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { environment, onCustomServer, webHost } from '@/config/environment'
import { track } from '@/lib/analytics'
import { usePushPermission } from '@/notifications/usePushPermission'
import { useAppearancePreference, type AppearancePreference } from '@/theme/appearance'
import { useTheme } from '@/theme/theme'
import { radius, spacing } from '@/theme/tokens'

const APPEARANCES: { value: AppearancePreference; label: 'appearanceSystem' | 'appearanceLight' | 'appearanceDark' }[] = [
    { value: 'system', label: 'appearanceSystem' },
    { value: 'light', label: 'appearanceLight' },
    { value: 'dark', label: 'appearanceDark' },
]

const GROUPINGS: { value: GroupMode; label: 'groupRecent' | 'groupByBox' }[] = [
    { value: 'recent', label: 'groupRecent' },
    { value: 'box', label: 'groupByBox' },
]

// Each language in its own words, whatever the current one: Hermes has no Intl.DisplayNames.
const LANGUAGE_NAMES: Record<Locale, string> = { en: 'English', fr: 'Français', es: 'Español', pt: 'Português', de: 'Deutsch' }

const AVATAR_SIZE = 44

const isPhoneAlias = (email: string) => email.endsWith('@phone.rerun.build')

export function PreferencesSheet() {
    const theme = useTheme()
    const insets = useSafeAreaInsets()
    const { me, session, signOut } = useAuth()
    const [appearance, chooseAppearance] = useAppearancePreference()
    const [group, chooseGroup] = useGroupMode()
    const push = usePushPermission().status
    const t = useTranslations('mobileSettings.preferences')
    const locale = useLocale()

    const user = me?.user
    const email = user?.email && !isPhoneAlias(user.email) ? user.email : null
    const version = `${Application.nativeApplicationVersion ?? '0.0.0'} (${appBuild})`

    const openAiProviders = () => {
        track('connection_cta_clicked', { source: 'ios_settings' })
        router.push('/providers')
    }

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

            <Card>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg }}>
                    <View style={{ width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.muted }}>
                        <AppText variant="headline" maxFontSizeMultiplier={1}>
                            {initialsOf(user) ?? '?'}
                        </AppText>
                    </View>
                    <View style={{ flex: 1 }}>
                        <AppText variant="headline" numberOfLines={1}>
                            {user?.name?.trim() || email || t('yourAccount')}
                        </AppText>
                        {email && user?.name?.trim() ? (
                            <AppText variant="footnote" tone="muted" numberOfLines={1}>
                                {email}
                            </AppText>
                        ) : null}
                    </View>
                </View>
                <Separator />
                <SettingsRow label={t('workspace')} value={workspaceLabel(me?.workspace)} />
                <Separator />
                <SettingsRow label={t('aiProviders')} onPress={openAiProviders} />
            </Card>

            <View style={{ gap: spacing.sm }}>
                <SectionTitle>{t('appearance')}</SectionTitle>
                <SegmentedControl options={APPEARANCES.map(option => ({ value: option.value, label: t(option.label) }))} value={appearance} onChange={chooseAppearance} />
            </View>

            <View style={{ gap: spacing.sm }}>
                <SectionTitle>{t('coworkers')}</SectionTitle>
                <SegmentedControl options={GROUPINGS.map(option => ({ value: option.value, label: t(option.label) }))} value={group} onChange={chooseGroup} />
            </View>

            <Section>
                <SettingsRow testID="row-language" label={t('language')} value={LANGUAGE_NAMES[locale]} accessory="external" onPress={() => Linking.openSettings()} />
            </Section>

            <Section>
                <SettingsRow testID="row-notifications" label={t('notifications')} value={push !== null && push !== 'granted' ? t('pushOff') : undefined} accessory="chevron" onPress={() => router.push('/settings/notifications')} />
            </Section>

            <Section title={t('support')}>
                {!onCustomServer && (
                    <>
                        <SettingsRow label={t('contactSupport')} onPress={() => contactSupport(user)} />
                        <Separator />
                    </>
                )}
                <SettingsRow label={t('privacy')} accessory="external" onPress={() => WebBrowser.openBrowserAsync('https://rerun.build/privacy')} />
                <Separator />
                <SettingsRow label={t('terms')} accessory="external" onPress={() => WebBrowser.openBrowserAsync('https://rerun.build/terms')} />
            </Section>

            <Section title={t('about')}>
                <SettingsRow label={t('version')} value={version} />
                {onCustomServer ? (
                    <>
                        <Separator />
                        <SettingsRow testID="row-server" label={t('server')} value={webHost} onPress={() => askToLeaveServer(signOut)} />
                    </>
                ) : (
                    environment.name !== 'production' && (
                        <>
                            <Separator />
                            <SettingsRow label={t('environment')} value={environment.name} />
                        </>
                    )
                )}
            </Section>

            <Section>
                <SettingsRow label={t('signOut')} onPress={signOut} />
            </Section>

            <Pressable onPress={() => session && askToDeleteAccount(session.access_token, signOut)} accessibilityRole="button" hitSlop={spacing.md} style={({ pressed }) => ({ alignSelf: 'center', opacity: pressed ? 0.5 : 1 })}>
                <AppText variant="footnote" tone="destructive">
                    {t('deleteAccount')}
                </AppText>
            </Pressable>
        </ScrollView>
    )
}
