import type { ScheduledRun, TriggerPayload } from '@rerun/contracts'
import { fullDateTime } from '@rerun/i18n/format'
import * as Clipboard from 'expo-clipboard'
import { useState, type ReactNode } from 'react'
import { Modal, Pressable, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocale, useTranslations } from 'use-intl'

import type { FileOwner } from '@/api/files'
import { AppText } from '@/components/ui/AppText'
import { Badge } from '@/components/ui/Badge'
import { GlassButton } from '@/components/ui/GlassButton'
import { Icon, type IconName } from '@/components/ui/Icon'
import { useTheme } from '@/theme/theme'
import { fonts, radius, spacing } from '@/theme/tokens'

import { useFileSize } from '../cards/FileCardView'
import { Markdown } from '../Markdown'
import { ThreadDivider } from './ThreadDivider'

const METHOD_TONES: Record<string, string> = { GET: 'cyan', POST: 'green', PUT: 'orange', PATCH: 'orange', DELETE: 'red' }

// The web's `ThreadDividerDialog`, as an iOS sheet: what the divider only names, read in full.
function OriginSheet({ open, onClose, symbol, title, aside, children }: { open: boolean; onClose: () => void; symbol: IconName; title: string; aside?: ReactNode; children: ReactNode }) {
    const theme = useTheme()
    const insets = useSafeAreaInsets()
    const tc = useTranslations('mobileCommon.actions')
    return (
        <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
            <View style={{ flex: 1, backgroundColor: theme.background }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.md }}>
                    <Icon name={symbol} size={15} color={theme.mutedForeground} />
                    <AppText variant="headline" numberOfLines={1} style={{ flex: 1 }}>
                        {title}
                    </AppText>
                    <GlassButton symbol="x" label={tc('close')} onPress={onClose} />
                </View>
                {aside ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}>{aside}</View> : null}
                <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + spacing.xl }}>{children}</ScrollView>
            </View>
        </Modal>
    )
}

function formatReceivedAt(iso: string, locale: string): string {
    return Number.isNaN(new Date(iso).getTime()) ? iso : fullDateTime(iso, locale)
}

function prettyBody(payload: TriggerPayload): string {
    if (!payload.isJson) return payload.body
    try {
        return JSON.stringify(JSON.parse(payload.body), null, 2)
    } catch {
        return payload.body
    }
}

function PayloadSummary({ payload }: { payload: TriggerPayload }) {
    const t = useTranslations('mobileChat.origins')
    const fileSize = useFileSize()
    return (
        <>
            <Badge size="xs" tone={METHOD_TONES[payload.method] ?? 'neutral'} label={payload.method} />
            {payload.truncated && <Badge size="xs" tone="orange" label={t('truncated')} />}
            <AppText variant="caption" tone="muted" style={{ fontFamily: payload.body ? fonts.mono : fonts.regular, fontVariant: ['tabular-nums'] }}>
                {payload.body ? fileSize(payload.bytes) : t('noPayload')}
            </AppText>
        </>
    )
}

function PayloadDetails({ payload }: { payload: TriggerPayload }) {
    const theme = useTheme()
    const t = useTranslations('mobileChat.origins')
    const locale = useLocale()
    const [copied, setCopied] = useState(false)
    const facts = [payload.receivedAt && formatReceivedAt(payload.receivedAt, locale), payload.contentType, payload.query && `?${payload.query}`].filter((fact): fact is string => !!fact)
    return (
        <View style={{ gap: spacing.md }}>
            {facts.length > 0 && (
                <Text selectable style={{ fontFamily: fonts.mono, fontSize: 12, lineHeight: 18, color: theme.mutedForeground }}>
                    {facts.join('   ')}
                </Text>
            )}
            {payload.body ? (
                <View style={{ gap: spacing.xs }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <AppText variant="caption" tone="muted" medium style={{ fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase' }}>
                            {t('payload')}
                        </AppText>
                        <Pressable
                            onPress={() => {
                                Clipboard.setStringAsync(payload.body)
                                setCopied(true)
                                setTimeout(() => setCopied(false), 1500)
                            }}
                            accessibilityRole="button"
                            hitSlop={8}
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                        >
                            <Icon name={copied ? 'check' : 'copy'} size={11} color={theme.mutedForeground} />
                            <AppText variant="caption" tone="muted">
                                {copied ? t('copied') : t('copy')}
                            </AppText>
                        </Pressable>
                    </View>
                    <ScrollView horizontal style={{ borderRadius: radius.md, backgroundColor: theme.muted }} contentContainerStyle={{ padding: spacing.md }}>
                        <Text selectable style={{ fontFamily: fonts.mono, fontSize: 12, lineHeight: 18, color: theme.foreground }}>
                            {prettyBody(payload)}
                        </Text>
                    </ScrollView>
                </View>
            ) : null}
        </View>
    )
}

// The webhook speaks, not the user: a divider marks where it fired. The web links its prompt and
// what the caller sent separately; a phone line has room for one link, so one sheet holds both.
export function WebhookRunDivider({ payload, owner }: { payload: TriggerPayload; owner: FileOwner | null }) {
    const t = useTranslations('mobileChat.origins')
    const [open, setOpen] = useState(false)
    return (
        <>
            <ThreadDivider
                symbol="webhook"
                pieces={[
                    { kind: 'text', text: t('webhookReceived') },
                    { kind: 'name', text: payload.slug },
                    { kind: 'link', text: payload.prompt ? t('viewDetails') : t('viewPayload'), onPress: () => setOpen(true) },
                ]}
            />
            <OriginSheet open={open} onClose={() => setOpen(false)} symbol="webhook" title={payload.slug} aside={<PayloadSummary payload={payload} />}>
                <View style={{ gap: spacing.xl }}>
                    {payload.prompt ? (
                        <View style={{ gap: spacing.xs }}>
                            <AppText variant="caption" tone="muted" medium style={{ fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase' }}>
                                {t('prompt')}
                            </AppText>
                            <Markdown text={payload.prompt} owner={owner} />
                        </View>
                    ) : null}
                    <PayloadDetails payload={payload} />
                </View>
            </OriginSheet>
        </>
    )
}

// The routine speaks, not the user: a divider marks where it fired, its prompt a tap away.
export function ScheduledRunDivider({ run, owner }: { run: Pick<ScheduledRun, 'name' | 'prompt'>; owner: FileOwner | null }) {
    const t = useTranslations('mobileChat.origins')
    const [open, setOpen] = useState(false)
    return (
        <>
            <ThreadDivider
                symbol="calendar-clock"
                pieces={[
                    { kind: 'text', text: t('scheduledRun') },
                    { kind: 'name', text: run.name },
                    { kind: 'link', text: t('viewPrompt'), onPress: () => setOpen(true) },
                ]}
            />
            <OriginSheet open={open} onClose={() => setOpen(false)} symbol="calendar-clock" title={t('promptOf', { name: run.name })}>
                <Markdown text={run.prompt} owner={owner} />
            </OriginSheet>
        </>
    )
}

// The coworker installs itself from a guide: the divider flows while it works through it.
export function InstallDivider({ agentName, guide, installing, owner }: { agentName: string; guide: string; installing: boolean; owner: FileOwner | null }) {
    const t = useTranslations('mobileChat.origins')
    const [open, setOpen] = useState(false)
    return (
        <>
            <ThreadDivider
                symbol={installing ? 'package' : 'circle-check'}
                symbolTint={installing ? undefined : '#10b981'}
                flowing={installing}
                pieces={[
                    { kind: 'text', text: installing ? t('installStarted') : t('installComplete') },
                    { kind: 'link', text: t('viewGuide'), onPress: () => setOpen(true) },
                ]}
            />
            <OriginSheet open={open} onClose={() => setOpen(false)} symbol="package" title={t('installGuideOf', { name: agentName })}>
                <Markdown text={guide} owner={owner} />
            </OriginSheet>
        </>
    )
}
