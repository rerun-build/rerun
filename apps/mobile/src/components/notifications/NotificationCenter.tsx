import { EMAIL_CATEGORIES, NOTIFICATION_SCOPES, coworkerRuleOf, hasOwnRule, type CoworkerRule, type NotificationPrefs, type NotificationPrefsPatch, type NotificationScope } from '@rerun/contracts'
import type { PermissionStatus } from 'expo-notifications'
import { SymbolView, type SFSymbol } from 'expo-symbols'
import { ActionSheetIOS, Pressable, View } from 'react-native'
import { useTranslations } from 'use-intl'

import { AppText } from '@/components/ui/AppText'
import { Badge } from '@/components/ui/Badge'
import { Card, CheckRow, GROUPED_ROW_HEIGHT, ICON_ROW_INSET, Section, SectionTitle, Separator, SettingsRow, SwitchRow } from '@/components/ui/GroupedList'
import { Skeleton } from '@/components/ui/Skeleton'
import { translatorFor } from '@/i18n/translator'
import { useTheme } from '@/theme/theme'
import { spacing } from '@/theme/tokens'

export type CoworkerOption = { id: string; name: string }

export const SCOPE_SYMBOLS: Record<NotificationScope, SFSymbol> = {
    everything: 'person.3',
    mine: 'person.crop.circle.badge.checkmark',
    needed: 'bell',
    nothing: 'bell.slash',
}

export type SettingsTranslator = ReturnType<typeof translatorFor<'mobileSettings'>>

export function ruleValue(rule: CoworkerRule, t: SettingsTranslator = translatorFor('mobileSettings')): string {
    if (rule.mode !== 'default') return t(`notifications.modes.${rule.mode}.label`)
    return rule.follow ? t('notifications.perCoworker.followsTasks') : t('notifications.perCoworker.yourSetting')
}

type NotificationCenterProps = {
    prefs: NotificationPrefs | null
    failed: boolean
    coworkers: CoworkerOption[] | null
    push: PermissionStatus | null
    onEnablePush: () => void
    onOpenIosSettings: () => void
    onPatch: (patch: NotificationPrefsPatch) => void
    onOpenCoworker: (coworker: CoworkerOption) => void
}

export function Footnote({ children }: { children: string }) {
    return (
        <AppText variant="footnote" tone="muted" style={{ paddingHorizontal: spacing.lg }}>
            {children}
        </AppText>
    )
}

function PushOff({ push, onEnablePush, onOpenIosSettings }: Pick<NotificationCenterProps, 'onEnablePush' | 'onOpenIosSettings'> & { push: PermissionStatus }) {
    const t = useTranslations('mobileSettings.notifications.push')
    return (
        <View style={{ gap: spacing.sm }}>
            <Card>
                <SettingsRow icon="bell.slash" label={t('label')} value={t('off')} />
                <Separator inset={ICON_ROW_INSET} />
                {push === 'undetermined' ? <SettingsRow label={t('turnOn')} onPress={onEnablePush} /> : <SettingsRow label={t('openIosSettings')} accessory="external" onPress={onOpenIosSettings} />}
            </Card>
            <Footnote>{t('footnote')}</Footnote>
        </View>
    )
}

// The rule is what the row is for: a long name gives way before it does.
function CoworkerRuleRow({ name, value, onPress }: { name: string; value: string; onPress: () => void }) {
    const theme = useTheme()
    const t = useTranslations('mobileSettings.notifications.perCoworker')
    return (
        <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={t('rowLabel', { name, value })} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: GROUPED_ROW_HEIGHT, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, backgroundColor: pressed ? theme.muted : 'transparent' })}>
            <AppText variant="body" numberOfLines={1} style={{ flex: 1 }}>
                {name}
            </AppText>
            <AppText variant="body" tone="muted" numberOfLines={1}>
                {value}
            </AppText>
            <SymbolView name="chevron.right" size={13} weight="medium" tintColor={theme.mutedForeground} />
        </Pressable>
    )
}

function CenterSkeleton() {
    return (
        <View style={{ gap: spacing.xl }}>
            {[4, 1, 2].map((rows, index) => (
                <View key={index} style={{ gap: spacing.sm }}>
                    <Skeleton style={{ width: 120, height: 12, marginLeft: spacing.lg }} />
                    <Card>
                        {Array.from({ length: rows }, (_, row) => (
                            <View key={row} style={{ height: 52, justifyContent: 'center', paddingHorizontal: spacing.lg }}>
                                <Skeleton style={{ width: '60%', height: 14 }} />
                            </View>
                        ))}
                    </Card>
                </View>
            ))}
        </View>
    )
}

// The web's notification settings: which runs are worth hearing about, the email, a rule for a
// coworker apart, and the account emails. Toast and sound live in the browser, so they stay there.
export function NotificationCenter({ prefs, failed, coworkers, push, onEnablePush, onOpenIosSettings, onPatch, onOpenCoworker }: NotificationCenterProps) {
    const t = useTranslations('mobileSettings.notifications')
    const tSettings = useTranslations('mobileSettings')
    const pushOff = push !== null && push !== 'granted' && <PushOff push={push} onEnablePush={onEnablePush} onOpenIosSettings={onOpenIosSettings} />

    if (!prefs) {
        return (
            <>
                {pushOff}
                {failed ? <Footnote>{t('loadFailed')}</Footnote> : <CenterSkeleton />}
            </>
        )
    }

    const silent = prefs.scope === 'nothing'
    const listed = (coworkers ?? []).filter(coworker => hasOwnRule(coworkerRuleOf(prefs, coworker.id)))
    const addable = (coworkers ?? []).filter(coworker => !listed.includes(coworker))

    const pickCoworker = () =>
        ActionSheetIOS.showActionSheetWithOptions({ title: t('perCoworker.pickTitle'), options: [...addable.map(coworker => coworker.name), t('perCoworker.cancel')], cancelButtonIndex: addable.length }, index => {
            const coworker = addable[index]
            if (coworker) onPatch({ coworkers: { [coworker.id]: { ...coworkerRuleOf(prefs, coworker.id), mode: 'everything' } } })
        })

    return (
        <>
            {pushOff}

            <Section title={t('scopeTitle')}>
                {NOTIFICATION_SCOPES.map((scope, index) => (
                    <View key={scope}>
                        {index > 0 && <Separator inset={ICON_ROW_INSET} />}
                        <CheckRow testID={`scope-${scope}`} icon={SCOPE_SYMBOLS[scope]} label={t(`scopes.${scope}.label`)} detail={t(`scopes.${scope}.detail`)} badge={scope === 'mine' ? <Badge label={t('recommended')} tone="brand" size="xs" /> : undefined} checked={prefs.scope === scope} onPress={() => onPatch({ scope })} />
                    </View>
                ))}
            </Section>

            <View style={{ gap: spacing.sm }}>
                <Card>
                    <SwitchRow testID="switch-email" label={t('email.label')} value={prefs.email} disabled={silent} onValueChange={email => onPatch({ email })} />
                </Card>
                <Footnote>{t('email.footnote')}</Footnote>
            </View>

            <View style={{ gap: spacing.sm }}>
                <SectionTitle>{t('perCoworker.title')}</SectionTitle>
                <Card>
                    {listed.map(coworker => (
                        <View key={coworker.id}>
                            <CoworkerRuleRow name={coworker.name} value={ruleValue(coworkerRuleOf(prefs, coworker.id), tSettings)} onPress={() => onOpenCoworker(coworker)} />
                            <Separator />
                        </View>
                    ))}
                    <SettingsRow icon="plus" label={t('perCoworker.add')} loading={coworkers === null} disabled={coworkers !== null && addable.length === 0} onPress={coworkers === null ? undefined : pickCoworker} />
                </Card>
                <Footnote>{listed.length === 0 ? t('perCoworker.empty') : t('perCoworker.detail')}</Footnote>
            </View>

            <Section title={t('accountEmails.title')}>
                {EMAIL_CATEGORIES.map((category, index) => (
                    <View key={category}>
                        {index > 0 && <Separator />}
                        <SwitchRow label={t(`accountEmails.${category}`)} value={prefs.categories[category]} onValueChange={on => onPatch({ categories: { [category]: on } })} />
                    </View>
                ))}
            </Section>
        </>
    )
}
