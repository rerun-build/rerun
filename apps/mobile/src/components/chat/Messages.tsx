import type { MessageFeedbackRating } from '@rerun/contracts'
import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import { useMemo, useState, type ReactNode } from 'react'
import { Pressable, Share, View, type ViewStyle } from 'react-native'
import Animated, { FadeInDown } from 'react-native-reanimated'
import { useTranslations } from 'use-intl'

import { AppText } from '@/components/ui/AppText'
import { CoworkerAvatar } from '@/components/ui/CoworkerAvatar'
import { Icon, type IconName } from '@/components/ui/Icon'
import type { Coworker } from '@/mocks/data'
import { EASE_OUT, MOTION } from '@/theme/motion'
import { useTheme } from '@/theme/theme'
import { brand, radius, spacing, withAlpha } from '@/theme/tokens'

import type { FileOwner } from '@/api/files'
import { isImageItem, openViewer, type ViewerItem } from '@/components/viewer/viewer-store'

import { AuthedImage } from './cards/CardParts'
import { Markdown } from './Markdown'
import { MessageTimeReveal, type MessageStamp } from './MessageTimeReveal'
import { splitIntoBubbles } from './markdown/blocks'

const THUMB = 120

// The web's agent bubble (`AGENT_BUBBLE_SURFACE`, px-3.5 py-2 on 20px corners), stacked 6 apart.
export const BUBBLE_RADIUS = 20
export const BUBBLE_PADDING_X = 14
export const BUBBLE_PADDING_Y = 8
export const BUBBLE_GAP = 6

// The web's `ExpandableMessage`: a user message taller than this opens on a pill.
const COLLAPSED_HEIGHT = 384

function ExpandableText({ children }: { children: ReactNode }) {
    const [height, setHeight] = useState(0)
    const [expanded, setExpanded] = useState(false)
    const t = useTranslations('mobileChat.messages')
    const overflows = height > COLLAPSED_HEIGHT
    return (
        <View>
            <View style={{ maxHeight: overflows && !expanded ? COLLAPSED_HEIGHT : undefined, overflow: 'hidden' }}>
                {/* Collapsed, the text is measured clamped to the cap: keeping the tallest height stops it from
                    unfolding and folding again in a loop that shakes the whole thread. */}
                <View onLayout={event => setHeight(Math.max(height, event.nativeEvent.layout.height))}>{children}</View>
            </View>
            {overflows && (
                <Pressable onPress={() => setExpanded(open => !open)} accessibilityRole="button" accessibilityState={{ expanded }} hitSlop={8} style={({ pressed }) => ({ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.sm, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', opacity: pressed ? 0.6 : 0.9 })}>
                    <AppText variant="caption" style={{ color: '#ffffff', fontSize: 11, lineHeight: 15 }}>
                        {expanded ? t('showLess') : t('showMore')}
                    </AppText>
                    <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={9} bold color="#ffffff" />
                </Pressable>
            )}
        </View>
    )
}

// Entering rises from below: the bubble a send just created rises into place. The list wraps
// the messages already there in a LayoutAnimationConfig, so only a new one moves.
// `children` takes the text's place inside the bubble: a voice message draws its player there.
// `footer` sits under the bubble, outside the tap that brings the time up, so its buttons answer alone.
// The tap that brings the time up lives inside the right-aligned column, so only the bubble answers it.
export function UserBubble({ text, media, owner = null, stamp, children, footer }: { text: string; media?: ViewerItem[]; owner?: FileOwner | null; stamp?: MessageStamp; children?: ReactNode; footer?: ReactNode }) {
    const theme = useTheme()
    const t = useTranslations('mobileChat.messages')
    const photos = media?.filter(isImageItem) ?? []
    const files = media?.filter(item => !isImageItem(item)) ?? []
    return (
        <Animated.View entering={FadeInDown.duration(MOTION.base).easing(EASE_OUT)} style={{ alignSelf: 'flex-end', alignItems: 'flex-end', maxWidth: '82%' }}>
            <MessageTimeReveal stamp={stamp} side="right">
                <View style={{ alignItems: 'flex-end', gap: spacing.xs }}>
                    {photos.length > 0 && (
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: spacing.xs }}>
                            {photos.map((photo, index) => (
                                <Pressable key={photo.url} onPress={() => openViewer(photos, index)} accessibilityRole="imagebutton" accessibilityLabel={t('open', { name: photo.name })}>
                                    <AuthedImage url={photo.url} style={{ width: THUMB, height: THUMB, borderRadius: radius.lg }} />
                                </Pressable>
                            ))}
                        </View>
                    )}
                    {files.map((file, index) => (
                        <Pressable key={file.url} onPress={() => openViewer(files, index)} accessibilityRole="button" accessibilityLabel={t('open', { name: file.name })} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, maxWidth: '100%', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.lg, borderCurve: 'continuous', borderWidth: 1, borderColor: theme.border, backgroundColor: pressed ? theme.muted : theme.card })}>
                            <Icon name="file-text" size={15} color={theme.mutedForeground} />
                            <AppText variant="footnote" medium numberOfLines={1} style={{ flexShrink: 1 }}>
                                {file.name}
                            </AppText>
                        </Pressable>
                    ))}
                    {(children || text.length > 0) && (
                        <View style={{ backgroundColor: brand.base, borderRadius: radius.xl, borderBottomRightRadius: 6, borderCurve: 'continuous', paddingHorizontal: children ? spacing.md : spacing.lg, paddingVertical: children ? spacing.sm : spacing.md - 2 }}>
                            {children ?? (
                                <ExpandableText>
                                    <Markdown text={text} surface="brand" owner={owner} shortLinks />
                                </ExpandableText>
                            )}
                        </View>
                    )}
                </View>
            </MessageTimeReveal>
            {footer}
        </Animated.View>
    )
}

export function Action({ symbol, label, onPress, selected }: { symbol: IconName; label: string; onPress: () => void; selected?: boolean }) {
    const theme = useTheme()
    return (
        <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={selected === undefined ? undefined : { selected }} hitSlop={8} style={({ pressed }) => ({ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
            <Icon name={symbol} size={17} color={selected ? theme.foreground : theme.mutedForeground} />
        </Pressable>
    )
}

// An answer drawn as a stack of bubbles, one per beat, the way the web's `MessageBubbles` cuts it: a
// code block, a table or an image alone stands bare at full width.
function AssistantBubbles({ text, streaming, owner }: { text: string; streaming: boolean; owner: FileOwner | null }) {
    const theme = useTheme()
    const bubbles = useMemo(() => splitIntoBubbles(text), [text])
    const frames: Record<'bubble' | 'bare' | 'media', ViewStyle> = {
        bubble: { maxWidth: '88%', paddingHorizontal: BUBBLE_PADDING_X, paddingVertical: BUBBLE_PADDING_Y, borderRadius: BUBBLE_RADIUS, borderCurve: 'continuous', backgroundColor: theme.muted },
        bare: { alignSelf: 'stretch' },
        media: { maxWidth: '88%', width: '100%' },
    }
    return (
        <View style={{ alignItems: 'flex-start', gap: BUBBLE_GAP }}>
            {bubbles.map((bubble, i) => (
                // Keyed by position: a stream only ever grows the last bubble or opens a new one after it.
                <View key={i} style={frames[bubble.frame]}>
                    <Markdown text={bubble.markdown} streaming={streaming && i === bubbles.length - 1} surface={bubble.frame === 'bubble' ? 'bubble' : 'page'} owner={owner} />
                </View>
            ))}
        </View>
    )
}

type AnswerActions = {
    onRegenerate?: () => void
    rating?: MessageFeedbackRating | null
    onRate?: (rating: MessageFeedbackRating) => void
}

export function AssistantMessage({ text, showActions, streaming = false, owner = null, actions }: { text: string; showActions: boolean; streaming?: boolean; owner?: FileOwner | null; actions?: AnswerActions }) {
    const t = useTranslations('mobileChat.messages')
    const plain = text.replace(/\*\*/g, '')
    const rate = (rating: MessageFeedbackRating) => {
        Haptics.selectionAsync()
        actions?.onRate?.(rating)
    }
    return (
        <View style={{ gap: spacing.xs }}>
            <AssistantBubbles text={text} streaming={streaming} owner={owner} />
            {showActions && (
                <View style={{ flexDirection: 'row', marginLeft: -spacing.sm }}>
                    <Action
                        symbol="copy"
                        label={t('copy')}
                        onPress={() => {
                            Clipboard.setStringAsync(plain)
                            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
                        }}
                    />
                    <Action symbol="share" label={t('share')} onPress={() => Share.share({ message: plain })} />
                    {actions?.onRegenerate && <Action symbol="rotate-cw" label={t('regenerate')} onPress={actions.onRegenerate} />}
                    {actions?.onRate && (
                        <>
                            <Action symbol={actions.rating === 'up' ? 'thumbs-up-fill' : 'thumbs-up'} label={t('goodResponse')} selected={actions.rating === 'up'} onPress={() => rate('up')} />
                            <Action symbol={actions.rating === 'down' ? 'thumbs-down-fill' : 'thumbs-down'} label={t('badResponse')} selected={actions.rating === 'down'} onPress={() => rate('down')} />
                        </>
                    )}
                </View>
            )}
        </View>
    )
}

export function NeedsYouCard({ question }: { question: string }) {
    const theme = useTheme()
    const t = useTranslations('mobileChat.messages')
    return (
        <View style={{ gap: spacing.xs, padding: spacing.lg, borderRadius: radius.lg, borderCurve: 'continuous', borderWidth: 1, borderColor: withAlpha('#06b6d4', 0.35), backgroundColor: withAlpha('#06b6d4', theme.scheme === 'dark' ? 0.1 : 0.06) }}>
            <AppText variant="caption" tone="waiting" medium>
                {t('needsYourAnswer')}
            </AppText>
            <AppText variant="body">{question}</AppText>
            <AppText variant="footnote" tone="muted">
                {t('replyBelow')}
            </AppText>
        </View>
    )
}

export function EmptyConversation({ coworker }: { coworker: Coworker }) {
    const t = useTranslations('mobileChat')
    return (
        <View style={{ alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl }}>
            <CoworkerAvatar coworker={coworker} size={96} />
            <View style={{ alignItems: 'center', gap: 2 }}>
                <AppText variant="title" numberOfLines={1}>
                    {coworker.kind === 'foreman' ? t('messages.askRerun') : coworker.name}
                </AppText>
                <AppText variant="callout" tone="muted" numberOfLines={2} style={{ textAlign: 'center' }}>
                    {coworker.role}
                </AppText>
                {coworker.status === 'offline' && (
                    <AppText variant="footnote" tone="muted" style={{ textAlign: 'center', marginTop: spacing.sm }}>
                        {t('empty.asleep')}
                    </AppText>
                )}
            </View>
        </View>
    )
}
