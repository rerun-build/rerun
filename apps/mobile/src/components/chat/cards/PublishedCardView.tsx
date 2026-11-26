import { publishedHostOf, type PublishedAccessMode, type PublishedLink } from '@rerun/contracts'
import * as Clipboard from 'expo-clipboard'
import { useEffect, useState } from 'react'
import { Alert, View } from 'react-native'
import { useTranslations } from 'use-intl'

import { dismissPublishedAccessRequest, fetchPublishedLink, makePublishedLinkPublic } from '@/api/published'
import { useAuth } from '@/auth/AuthProvider'
import { AppText } from '@/components/ui/AppText'
import { Button } from '@/components/ui/Button'
import { Icon, type IconName } from '@/components/ui/Icon'
import * as Haptics from '@/lib/haptics'
import { openExternalUrl, openInPhoneBrowser } from '@/lib/url'
import { useTheme } from '@/theme/theme'
import { fonts, radius, spacing } from '@/theme/tokens'

import { AuthedImage, useCaller } from './CardParts'
import type { PublishCard } from './cards'

const THUMB = 52
const ACCESS_BADGE = 22
const COPIED_MS = 1500
const THUMBNAIL_POLL_MS = 3_000
const CAPTURE_WINDOW_MS = 90_000

export type Answer = 'public' | 'kept'

const ACCESS_SYMBOLS: Record<PublishedAccessMode, IconName> = { public: 'globe', workspace: 'users', password: 'lock', invited: 'mail' }

function kindSymbol(link: Pick<PublishedLink, 'contentType' | 'path'> & { kind?: PublishedLink['kind'] }): IconName {
    const type = link.contentType
    if (link.kind === 'site' || type.startsWith('text/html')) return 'globe'
    if (type.startsWith('image/')) return 'image'
    if (type.includes('csv') || link.path.toLowerCase().endsWith('.csv')) return 'table'
    if (type.startsWith('text/') || type === 'application/pdf') return 'file-text'
    return 'file'
}

export type PublishedRowProps = {
    title: string
    url: string
    access: PublishedAccessMode
    thumbnailUrl: string | null
    symbol: IconName
    coworkerName: string
    workspaceName: string
    pending: boolean
    answering: Answer | null
    settled: { answer: Answer; byYou: boolean } | null
    copied: boolean
    onCopy: () => void
    onOpen: () => void
    onAnswer: (answer: Answer) => void
}

// The link a coworker published, on the muted surface of the thread's cards: its thumbnail with who can
// open it, its title and host, Copy and Open, then the public link it asked for, or how that was settled.
export function PublishedRow({ title, url, access, thumbnailUrl, symbol, coworkerName, workspaceName, pending, answering, settled, copied, onCopy, onOpen, onAnswer }: PublishedRowProps) {
    const theme = useTheme()
    const t = useTranslations('mobileCards.published')
    return (
        <View style={{ gap: 10, padding: spacing.md, borderRadius: radius.lg, borderCurve: 'continuous', backgroundColor: theme.muted }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <View>
                    <AuthedImage url={thumbnailUrl} fallback={symbol} style={{ width: THUMB, height: THUMB, borderRadius: radius.sm, borderCurve: 'continuous', borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card }} />
                    <View
                        accessible
                        accessibilityLabel={t(`access.${access}`, { workspace: workspaceName })}
                        style={{ position: 'absolute', right: -5, bottom: -5, width: ACCESS_BADGE, height: ACCESS_BADGE, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.card, borderWidth: 2, borderColor: theme.muted }}
                    >
                        <Icon name={ACCESS_SYMBOLS[access]} size={12} color={theme.foreground} />
                    </View>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                    <AppText variant="callout" medium numberOfLines={2}>
                        {title}
                    </AppText>
                    <AppText variant="caption" tone="muted" numberOfLines={1} style={{ fontFamily: fonts.mono }}>
                        {publishedHostOf(url)}
                    </AppText>
                </View>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                    <Button size="sm" variant="outline" iconOnly symbol={copied ? 'check' : 'copy'} label={copied ? t('copied') : t('copy')} onPress={onCopy} />
                    <Button size="sm" variant="outline" iconOnly symbol="arrow-up-right" label={t('open')} onPress={onOpen} />
                </View>
            </View>
            {pending ? (
                <>
                    <AppText variant="footnote">{t('asksPublic', { coworker: coworkerName })}</AppText>
                    <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                        <Button size="sm" variant="outline" stretch label={t('keepPrivate')} loading={answering === 'kept'} disabled={answering === 'public'} onPress={() => onAnswer('kept')} />
                        <Button size="sm" stretch symbol="globe" label={t('makePublic')} loading={answering === 'public'} disabled={answering === 'kept'} onPress={() => onAnswer('public')} />
                    </View>
                </>
            ) : settled ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Icon name={settled.answer === 'public' ? 'check' : 'lock'} size={14} color={theme.mutedForeground} />
                    <AppText variant="footnote" tone="muted" style={{ flex: 1 }}>
                        {settled.answer === 'public' ? (settled.byYou ? t('madePublicByYou') : t('madePublic')) : t('keptFor', { workspace: workspaceName })}
                    </AppText>
                </View>
            ) : null}
        </View>
    )
}

export function UnpublishedRow({ title }: { title: string }) {
    const theme = useTheme()
    const t = useTranslations('mobileCards.published')
    return (
        <View style={{ gap: 2, padding: spacing.md, borderRadius: radius.lg, borderCurve: 'continuous', borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card }}>
            <AppText variant="callout" medium numberOfLines={1}>
                {title}
            </AppText>
            <AppText variant="footnote" tone="muted">
                {t('unpublished')}
            </AppText>
        </View>
    )
}

// The tool output only tells what the link was at the time of the call: the card reads it again, so a
// change made since (here, on the web, or a link taken down) shows, as the web's card does.
export function PublishedCardView({ card, coworkerName }: { card: PublishCard; coworkerName: string }) {
    const t = useTranslations('mobileCards.published')
    const { me } = useAuth()
    const caller = useCaller()
    const [live, setLive] = useState<PublishedLink | null | undefined>(undefined)
    const [answer, setAnswer] = useState<Answer | null>(null)
    const [answering, setAnswering] = useState<Answer | null>(null)
    const [copied, setCopied] = useState(false)
    const accessToken = caller?.accessToken
    const workspaceId = caller?.workspaceId
    const slug = card.slug

    useEffect(() => {
        if (!accessToken || !workspaceId) return
        let alive = true
        fetchPublishedLink({ accessToken, workspaceId }, slug)
            .then(found => alive && setLive(found))
            .catch(() => {})
        return () => {
            alive = false
        }
    }, [accessToken, workspaceId, slug])

    const awaitingCapture = live && !live.thumbnailUrl ? Date.parse(live.updatedAt) + CAPTURE_WINDOW_MS : null
    useEffect(() => {
        if (!accessToken || !workspaceId || awaitingCapture === null || Date.now() >= awaitingCapture) return
        let alive = true
        const timer = setInterval(() => {
            if (Date.now() >= awaitingCapture) return clearInterval(timer)
            fetchPublishedLink({ accessToken, workspaceId }, slug)
                .then(next => {
                    if (!alive || !next?.thumbnailUrl) return
                    clearInterval(timer)
                    setLive(next)
                })
                .catch(() => {})
        }, THUMBNAIL_POLL_MS)
        return () => {
            alive = false
            clearInterval(timer)
        }
    }, [accessToken, workspaceId, slug, awaitingCapture])

    useEffect(() => {
        if (!copied) return
        const timer = setTimeout(() => setCopied(false), COPIED_MS)
        return () => clearTimeout(timer)
    }, [copied])

    if (live === null) return <UnpublishedRow title={card.title} />

    const url = live?.url ?? card.url
    const access = live?.access ?? card.access
    const asked = card.requestedAccess === 'public'
    const pending = answer === null && (live ? live.requestedAccess === 'public' : asked)
    const settledAnswer: Answer | null = answer ?? (asked && live && live.requestedAccess === null ? (live.access === 'public' ? 'public' : 'kept') : null)

    const respond = async (choice: Answer) => {
        if (!caller) return
        setAnswering(choice)
        try {
            if (choice === 'public') setLive(await makePublishedLinkPublic(caller, slug))
            else await dismissPublishedAccessRequest(caller, slug)
            setAnswer(choice)
        } catch (error) {
            Alert.alert(t('updateFailed'), error instanceof Error ? error.message : undefined)
        } finally {
            setAnswering(null)
        }
    }

    return (
        <PublishedRow
            title={live?.title ?? card.title}
            url={url}
            access={access}
            thumbnailUrl={live?.thumbnailUrl ?? null}
            symbol={kindSymbol(live ?? { contentType: '', path: card.path })}
            coworkerName={coworkerName || t('fallbackCoworker')}
            workspaceName={me?.workspace.name || t('fallbackWorkspace')}
            pending={pending}
            answering={answering}
            settled={settledAnswer ? { answer: settledAnswer, byYou: answer !== null } : null}
            copied={copied}
            onCopy={() => {
                void Clipboard.setStringAsync(url)
                void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
                setCopied(true)
            }}
            // A link that is not public opens on its gate, which signs in on the hub: Rerun's browser
            // shares no session with it, so it goes to the phone's browser whatever the Preferences.
            onOpen={() => void (access === 'public' ? openExternalUrl(url) : openInPhoneBrowser(url))}
            onAnswer={choice => void respond(choice)}
        />
    )
}
