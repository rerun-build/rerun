import type { InstalledServiceView } from '@rerun/contracts'
import { Image } from 'expo-image'
import { Fragment } from 'react'
import { View } from 'react-native'
import { useTranslations } from 'use-intl'

import { OPEN_LOCK, type ManageLock } from '@/auth/access'
import { AppText } from '@/components/ui/AppText'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, GROUPED_ROW_HEIGHT, Separator } from '@/components/ui/GroupedList'
import { Skeleton } from '@/components/ui/Skeleton'
import { useTheme } from '@/theme/theme'
import { radius, spacing } from '@/theme/tokens'
import { webHost } from '@/config/environment'

import { CoworkerPage, LoadFailed } from './CoworkerPage'

const ICON_SIZE = 32
const ROW_INSET = spacing.lg + ICON_SIZE + spacing.md

// The web's ServiceList words.
const ATTENTION: Partial<Record<InstalledServiceView['status'], { label: 'needsSignIn' | 'needsSetup' | 'error'; tone: 'orange' | 'red' }>> = {
    needs_auth: { label: 'needsSignIn', tone: 'orange' },
    needs_config: { label: 'needsSetup', tone: 'orange' },
    error: { label: 'error', tone: 'red' },
}

function AppIcon({ app }: { app: InstalledServiceView }) {
    const theme = useTheme()
    return (
        <View style={{ width: ICON_SIZE, height: ICON_SIZE, borderRadius: radius.sm, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: theme.muted, alignItems: 'center', justifyContent: 'center' }}>
            {app.icon?.startsWith('http') ? (
                <Image source={{ uri: app.icon }} contentFit="contain" style={{ width: 22, height: 22 }} />
            ) : (
                <AppText variant="headline" tone="muted" maxFontSizeMultiplier={1}>
                    {app.name.charAt(0)}
                </AppText>
            )}
        </View>
    )
}

type AppRowProps = { app: InstalledServiceView; connecting: boolean; readOnly: boolean; onConnect: () => void }

function AppRow({ app, connecting, readOnly, onConnect }: AppRowProps) {
    const t = useTranslations('mobileCoworker.apps')
    const attention = ATTENTION[app.status]
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: GROUPED_ROW_HEIGHT + 8, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm }}>
            <AppIcon app={app} />
            <View style={{ flex: 1, minWidth: 0, gap: 2, alignItems: 'flex-start' }}>
                <AppText variant="body" medium numberOfLines={1}>
                    {app.name}
                </AppText>
                {attention ? (
                    <Badge label={t(`status.${attention.label}`)} tone={attention.tone} size="xs" />
                ) : app.label ? (
                    <AppText variant="footnote" tone="muted" numberOfLines={1}>
                        {app.label}
                    </AppText>
                ) : null}
            </View>
            {app.status === 'needs_auth' && <Button label={t('connect')} variant="outline" size="sm" loading={connecting} disabled={readOnly} onPress={onConnect} />}
        </View>
    )
}

function AppsSkeleton() {
    return (
        <Card>
            {[0, 1, 2].map(index => (
                <Fragment key={index}>
                    {index > 0 && <Separator inset={ROW_INSET} />}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: GROUPED_ROW_HEIGHT + 8, paddingHorizontal: spacing.lg }}>
                        <Skeleton style={{ width: ICON_SIZE, height: ICON_SIZE }} />
                        <Skeleton style={{ width: [120, 90, 140][index], height: 14 }} />
                    </View>
                </Fragment>
            ))}
        </Card>
    )
}

type CoworkerAppsProps = {
    name: string
    // Null while on its way.
    apps: InstalledServiceView[] | null
    connectingKey: string | null
    onConnect: (app: InstalledServiceView) => void
    failed?: boolean
    // Whether the caller can change the coworker's apps, and why not when they cannot.
    lock?: ManageLock
    onBack: () => void
}

// What the coworker is connected to. Adding an app goes through the chat: the coworker picks it, and
// its card connects it.
export function CoworkerApps({ name, apps, connectingKey, onConnect, failed, lock = OPEN_LOCK, onBack }: CoworkerAppsProps) {
    const t = useTranslations('mobileCoworker.apps')
    const tAccess = useTranslations('mobileCoworker.access')
    return (
        <CoworkerPage title={t('title')} onBack={onBack}>
            <View style={{ gap: spacing.sm }}>
                {!apps ? (
                    failed ? <LoadFailed /> : <AppsSkeleton />
                ) : apps.length === 0 ? (
                    <Card>
                        <View style={{ padding: spacing.lg }}>
                            <AppText variant="body" tone="muted">
                                {t('empty')}
                            </AppText>
                        </View>
                    </Card>
                ) : (
                    <Card>
                        {apps.map((app, index) => {
                            const key = app.key ?? app.slug
                            return (
                                <Fragment key={key}>
                                    {index > 0 && <Separator inset={ROW_INSET} />}
                                    <AppRow app={app} connecting={connectingKey === key} readOnly={lock.locked} onConnect={() => onConnect(app)} />
                                </Fragment>
                            )
                        })}
                    </Card>
                )}
                <AppText variant="footnote" tone="muted" style={{ paddingHorizontal: spacing.lg }}>
                    {lock.reason ? tAccess(lock.reason, { host: webHost }) : t('askInChat', { name })}
                </AppText>
            </View>
        </CoworkerPage>
    )
}
