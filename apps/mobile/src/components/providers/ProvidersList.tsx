import type { AddableProvider, AiConnectionKind, AiConnectionView, AiConnectionsView } from '@rerun/contracts'
import { Fragment } from 'react'
import { Pressable, View } from 'react-native'
import { useTranslations } from 'use-intl'

import type { AccessReason } from '@/auth/access'

import { AppText } from '@/components/ui/AppText'
import { Button } from '@/components/ui/Button'
import { Card, GROUPED_ROW_HEIGHT, Section, SectionTitle, Separator } from '@/components/ui/GroupedList'
import { Icon } from '@/components/ui/Icon'
import { Skeleton } from '@/components/ui/Skeleton'
import { useTheme } from '@/theme/theme'
import { radius, spacing } from '@/theme/tokens'

import { ConnectionBadge, LOGO_TILE, ProviderRow, ReadOnlyNote, SheetFrame, UsageBar } from './bits'
import { signsIn } from './routes'

const ROW_INSET = spacing.lg + LOGO_TILE + spacing.md

type ProvidersListProps = {
    view: AiConnectionsView | null
    failed?: boolean
    onClose: () => void
    onOpen: (connectionId: string) => void
    onAdd: (provider: AddableProvider) => void
    onAddKind: (kind: Exclude<AiConnectionKind, 'included'>) => void
    onChangeDefault: () => void
    // Why the caller can only read the providers (a member), or null when they run them.
    readOnlyReason?: AccessReason | null
}

// The web's AI providers panel: the default model, what comes with Rerun, then the user's own plans
// and keys. An empty group offers its providers in place, a full one ends on its Add row.
export function ProvidersList({ view, failed, onClose, onOpen, onAdd, onAddKind, onChangeDefault, readOnlyReason }: ProvidersListProps) {
    const t = useTranslations('mobileProviders.list')
    const readOnly = !!readOnlyReason
    const of = (kind: AiConnectionKind) => view?.connections.filter(connection => connection.kind === kind) ?? []

    return (
        <SheetFrame title={t('title')} onClose={onClose}>
            <ReadOnlyNote reason={readOnlyReason} />

            {failed && (
                <AppText variant="callout" tone="muted" style={{ textAlign: 'center' }}>
                    {t('notAnswering')}
                </AppText>
            )}

            {!view && !failed && <ProvidersSkeleton />}

            {view && (
                <>
                    <View style={{ gap: spacing.sm }}>
                        <SectionTitle>{t('defaultModel')}</SectionTitle>
                        <DefaultCard view={view} readOnly={readOnly} onChange={onChangeDefault} onFix={onOpen} />
                    </View>

                    <Section title={t('included')}>
                        {of('included').map(source => (
                            <ProviderRow key={source.id} id={`provider-${source.id}`} provider={source.provider} title={source.name} subtitle={source.summary} trailing={<ConnectionBadge connection={source} />} onPress={() => onOpen(source.id)}>
                                <View style={{ marginTop: spacing.xs, maxWidth: 200 }}>
                                    <UsageBar percent={view.credit.percent} />
                                </View>
                            </ProviderRow>
                        ))}
                    </Section>

                    <SourceGroup title={t('subscriptions')} kind="plan" sources={of('plan')} view={view} pitch={t('subscriptionsPitch')} addLabel={t('addSubscription')} readOnly={readOnly} onOpen={onOpen} onAdd={onAdd} onAddKind={onAddKind} />
                    <SourceGroup title={t('apiKeys')} kind="key" sources={of('key')} view={view} pitch={t('apiKeysPitch')} addLabel={t('addApiKey')} readOnly={readOnly} onOpen={onOpen} onAdd={onAdd} onAddKind={onAddKind} />
                </>
            )}
        </SheetFrame>
    )
}

function DefaultCard({ view, readOnly, onChange, onFix }: { view: AiConnectionsView; readOnly: boolean; onChange: () => void; onFix: (connectionId: string) => void }) {
    const source = view.connections.find(connection => connection.id === view.default.connectionId)
    const broken = source !== undefined && source.status !== 'connected'
    const creditGone = source?.status === 'credit_used_up'
    const canChange = view.connections.some(connection => connection.status === 'connected')
    const t = useTranslations('mobileProviders.list')
    const subtitle = !broken
        ? t('via', { name: source?.name ?? 'Rerun' })
        : creditGone
          ? canChange
              ? t('creditsUsedUpPickModel', { backOn: view.credit.backOn })
              : t('creditsUsedUpAddSource', { backOn: view.credit.backOn })
          : t('defaultBroken', { name: source.name })

    return (
        <Card>
            <ProviderRow id="provider-default" provider={source?.provider ?? 'rerun'} title={view.default.label} subtitle={subtitle} subtitleLines={broken ? 0 : 2} onPress={canChange ? onChange : undefined} disabled={readOnly} />
            {broken && !creditGone && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }}>
                    <Button label={signsIn(source.provider) ? t('signInAgain') : t('addKey')} size="sm" disabled={readOnly} onPress={() => onFix(source.id)} />
                </View>
            )}
        </Card>
    )
}

type SourceGroupProps = {
    title: string
    kind: Exclude<AiConnectionKind, 'included'>
    sources: AiConnectionView[]
    view: AiConnectionsView
    pitch: string
    addLabel: string
    readOnly: boolean
    onOpen: (connectionId: string) => void
    onAdd: (provider: AddableProvider) => void
    onAddKind: (kind: Exclude<AiConnectionKind, 'included'>) => void
}

function SourceGroup({ title, kind, sources, view, pitch, addLabel, readOnly, onOpen, onAdd, onAddKind }: SourceGroupProps) {
    if (sources.length === 0) {
        const providers = view.addable.filter(entry => entry.kind === kind)
        if (providers.length === 0) return null
        return (
            <View style={{ gap: spacing.sm }}>
                <SectionTitle>{title}</SectionTitle>
                <AppText variant="footnote" tone="muted" style={{ paddingHorizontal: spacing.lg }}>
                    {pitch}
                </AppText>
                <Card>
                    {providers.map((entry, index) => (
                        <Fragment key={entry.provider}>
                            {index > 0 && <Separator inset={ROW_INSET} />}
                            <ProviderRow id={`add-${entry.provider}`} provider={entry.provider} title={entry.title} subtitle={entry.hint} disabled={readOnly} onPress={() => onAdd(entry.provider)} />
                        </Fragment>
                    ))}
                </Card>
            </View>
        )
    }

    return (
        <Section title={title}>
            {sources.map(source => {
                const tightest = source.status === 'connected' ? Math.max(0, ...source.planWindows.map(window => window.usedPercent)) : 0
                return (
                    <Fragment key={source.id}>
                        <ProviderRow id={`provider-${source.id}`} provider={source.provider} title={source.name} subtitle={source.summary} trailing={<ConnectionBadge connection={source} />} onPress={() => onOpen(source.id)}>
                            {source.planWindows.length > 0 && source.status === 'connected' && (
                                <View style={{ marginTop: spacing.xs, maxWidth: 200 }}>
                                    <UsageBar percent={tightest} />
                                </View>
                            )}
                        </ProviderRow>
                        <Separator inset={ROW_INSET} />
                    </Fragment>
                )
            })}
            <AddRow testID={`add-row-${kind}`} label={addLabel} disabled={readOnly} onPress={() => onAddKind(kind)} />
        </Section>
    )
}

function AddRow({ testID, label, disabled, onPress }: { testID: string; label: string; disabled: boolean; onPress: () => void }) {
    const theme = useTheme()
    return (
        <Pressable testID={testID} onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: GROUPED_ROW_HEIGHT, paddingHorizontal: spacing.lg, backgroundColor: pressed ? theme.muted : 'transparent', opacity: disabled ? 0.45 : 1 })}>
            <View style={{ width: LOGO_TILE, alignItems: 'center' }}>
                <Icon name="plus" size={15} bold color={theme.foreground} />
            </View>
            <AppText variant="body">{label}</AppText>
        </Pressable>
    )
}

function ProvidersSkeleton() {
    return (
        <View style={{ gap: spacing.xl }}>
            {[1, 1, 2, 1].map((rows, group) => (
                <View key={group} style={{ gap: spacing.sm }}>
                    <Skeleton style={{ width: 110, height: 12, marginLeft: spacing.lg, borderRadius: radius.sm }} />
                    <Card>
                        {Array.from({ length: rows }, (_, row) => (
                            <View key={row} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg }}>
                                <Skeleton style={{ width: LOGO_TILE, height: LOGO_TILE, borderRadius: radius.sm + 2 }} />
                                <View style={{ flex: 1, gap: 6 }}>
                                    <Skeleton style={{ width: 120, height: 14, borderRadius: radius.sm }} />
                                    <Skeleton style={{ width: 180, height: 11, borderRadius: radius.sm }} />
                                </View>
                                <Skeleton style={{ width: 48, height: 18, borderRadius: radius.pill }} />
                            </View>
                        ))}
                    </Card>
                </View>
            ))}
        </View>
    )
}
