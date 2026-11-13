import type { SessionKind, SessionStatus } from '@rerun/contracts'
import { Pressable, View } from 'react-native'
import Animated, { Extrapolation, FadeIn, interpolate, LayoutAnimationConfig, useAnimatedStyle, type SharedValue } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslations } from 'use-intl'

import { conversationSections, glyphOf, stateOf } from '@/components/chat/conversation-sections'
import { usePaneInsets, usePaneSize } from '@/components/layout/PaneSize'
import { AppText } from '@/components/ui/AppText'
import { CoworkerAvatar } from '@/components/ui/CoworkerAvatar'
import { EdgeFade } from '@/components/ui/EdgeFade'
import { GlassButton, GLASS_BUTTON_SIZE, useGlassStyle } from '@/components/ui/GlassButton'
import { GlassSurface } from '@/components/ui/GlassSurface'
import { Icon } from '@/components/ui/Icon'
import { CircleTrigger, MenuItem, MenuSection, MenuToggle, NativeMenu, SubMenu } from '@/components/ui/NativeMenu'
import { Skeleton } from '@/components/ui/Skeleton'
import { useMessageTimes } from '@/lib/time'
import type { Coworker } from '@/mocks/data'
import { useTheme } from '@/theme/theme'
import { fonts, spacing } from '@/theme/tokens'

const PILL_HEIGHT = GLASS_BUTTON_SIZE
const AVATAR = 32
const AVATAR_INSET = (PILL_HEIGHT - AVATAR) / 2
const AVATAR_SPACE = AVATAR_INSET + AVATAR + spacing.sm
export const CHAT_HEADER_HEIGHT = PILL_HEIGHT + spacing.sm
const CHIP_MAX_WIDTH = 240

// A conversation as the header shows it. `title` is null until the first message names it, and
// `loading` while the hub has not said yet what the conversation is called. `status`, `unseen` and
// `ask` sort it into the menu's sections; without them it sits in a single list.
// `automationName` and `updatedAt` are set on a scheduled or triggered run, whose title says what it did.
// `kind` is `general` on the coworker's General, pinned first: the others are then its threads.
export type ChatTab = { id: string; title: string | null; running: boolean; empty: boolean; loading?: boolean; status?: SessionStatus; unseen?: boolean; ask?: string | null; automationName?: string | null; updatedAt?: string; kind?: SessionKind }

// The draft the pager ends on, as the last page of the chip.
const DRAFT_TAB: ChatTab = { id: 'draft', title: null, running: false, empty: true }

type ChatCoworker = Pick<Coworker, 'id' | 'kind' | 'name' | 'status'>

type ChipPageProps = {
    coworker: ChatCoworker
    session: ChatTab
    active: boolean
    width: number
    // The pager's position and this page's index: the page fades as it slides out of the chip.
    progress?: SharedValue<number>
    index?: number
    untitled?: string
}

// One conversation inside the header's pill, beside the coworker's face: its name over the conversation's title.
export function ChipPage({ coworker, session, active, width, progress, index = 0, untitled }: ChipPageProps) {
    const theme = useTheme()
    const t = useTranslations('mobileChat.header')
    const general = session.kind === 'general'
    const title = general ? t('general') : (session.title ?? untitled ?? t('newConversation'))
    const settledDistance = active ? 0 : 1
    const fade = useAnimatedStyle(() => {
        const distance = progress ? Math.abs(progress.value - index) : settledDistance
        return { opacity: interpolate(distance, [0, 0.6], [1, 0], Extrapolation.CLAMP) }
    })
    return (
        <Animated.View style={[{ width, height: PILL_HEIGHT, justifyContent: 'center', paddingRight: spacing.md }, fade]}>
            <View style={{ maxWidth: '100%', alignItems: 'flex-start' }}>
                <AppText variant="caption" tone="muted" medium numberOfLines={1} maxFontSizeMultiplier={1.2}>
                    {coworker.name}
                </AppText>
                {session.loading ? (
                    <Skeleton style={{ width: 96, height: 12, marginVertical: 3 }} />
                ) : (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: '100%' }}>
                        {general && <Icon name="messages-square-fill" size={12} color={theme.foreground} />}
                        <Animated.Text key={title} entering={FadeIn.duration(400)} numberOfLines={1} maxFontSizeMultiplier={1.2} style={{ flexShrink: 1, fontFamily: fonts.medium, fontSize: 14, lineHeight: 18, letterSpacing: -0.2, color: general || session.title ? theme.foreground : theme.mutedForeground }}>
                            {title}
                        </Animated.Text>
                    </View>
                )}
            </View>
        </Animated.View>
    )
}

function ConversationItem({ session, active, untitled, onSelect }: { session: ChatTab; active: boolean; untitled: string; onSelect: (sessionId: string) => void }) {
    const times = useMessageTimes()
    const title = session.title ?? untitled
    if (active) return <MenuToggle label={title} isOn onChange={() => {}} />
    const subtitle = (stateOf(session) === 'needs-you' ? session.ask : null) ?? automationLine(session, times.stamp)
    return <MenuItem label={title} icon={glyphOf(session)} subtitle={subtitle} onPress={() => onSelect(session.id)} />
}

// "Daily missions apply · Yesterday 4:30 PM". The routine is left out while the title still is its name.
function automationLine({ title, automationName, updatedAt }: ChatTab, stamp: (iso: string) => string): string | null {
    if (!automationName || !updatedAt) return null
    return [automationName !== title && automationName, stamp(updatedAt)].filter(Boolean).join(' · ')
}

function ConversationsMenu({ sessions, activeId, threaded, onSelect }: { sessions: ChatTab[]; activeId: string | undefined; threaded: boolean; onSelect: (sessionId: string) => void }) {
    const t = useTranslations('mobileChat.header')
    const { sections, earlier } = conversationSections(sessions)
    const untitled = threaded ? t('newThread') : t('newConversation')
    if (sections.length === 0) {
        return (
            <SubMenu label={threaded ? t('threads') : t('conversations')}>
                {sessions.map(session => (
                    <MenuToggle key={session.id} label={session.title ?? untitled} isOn={session.id === activeId} onChange={() => onSelect(session.id)} />
                ))}
            </SubMenu>
        )
    }
    return (
        <>
            {sections.map(section => (
                <MenuSection key={section.state} title={t(`sections.${section.state}`)}>
                    {section.conversations.map(session => (
                        <ConversationItem key={session.id} session={session} active={session.id === activeId} untitled={untitled} onSelect={onSelect} />
                    ))}
                </MenuSection>
            ))}
            {earlier.length > 0 && (
                <MenuSection title={t('earlier')}>
                    <SubMenu label={threaded ? t('threadCount', { count: earlier.length }) : t('conversationCount', { count: earlier.length })}>
                        {earlier.map(session => (
                            <ConversationItem key={session.id} session={session} active={session.id === activeId} untitled={untitled} onSelect={onSelect} />
                        ))}
                    </SubMenu>
                </MenuSection>
            )}
        </>
    )
}

type ChatHeaderProps = {
    coworker: ChatCoworker
    // The open conversations in the pager's order. The pager ends on a draft, the chip's last page.
    tabs: ChatTab[]
    // Undefined on the draft.
    activeId: string | undefined
    // The pager's position, in pages: the chip's content slides with the finger.
    progress: SharedValue<number>
    allSessions: ChatTab[]
    // Absent beside the sidebar of a wide window, where the conversation is the root of its pane.
    onBack?: () => void
    onSelect: (sessionId: string) => void
    onNewSession: () => void
    onOpenDetails?: () => void
}

export function ChatHeader({ coworker, tabs, activeId, progress, allSessions, onBack, onSelect, onNewSession, onOpenDetails }: ChatHeaderProps) {
    const theme = useTheme()
    const glass = useGlassStyle()
    const insets = useSafeAreaInsets()
    const pane = usePaneInsets()
    const t = useTranslations('mobileChat.header')
    const { width: paneWidth } = usePaneSize()
    const chipWidth = Math.min(CHIP_MAX_WIDTH, paneWidth - 2 * (spacing.lg + GLASS_BUTTON_SIZE + spacing.sm))
    const titleWidth = chipWidth - AVATAR_SPACE
    const hasConversations = tabs.length > 0
    const general = tabs[0]?.kind === 'general' ? tabs[0] : null
    const untitled = general ? t('newThread') : t('newConversation')
    // General sits as its own item of the menu; the submenu lists the rest, and is left out while empty.
    const listed = general ? allSessions.filter(session => session.kind !== 'general') : allSessions
    const pages = [...tabs, DRAFT_TAB]
    const activeIndex = hasConversations && activeId ? tabs.findIndex(session => session.id === activeId) : tabs.length
    const activeTitle = tabs[activeIndex]?.kind === 'general' ? t('general') : (tabs[activeIndex]?.title ?? untitled)
    const running = tabs[activeIndex]?.running ?? false
    const track = useAnimatedStyle(() => ({ transform: [{ translateX: hasConversations ? -progress.value * titleWidth : 0 }] }))
    const identityLabel = t('identityLabel', { name: coworker.name, title: hasConversations ? activeTitle : t('newChat') })
    // The coworker's face beside its name and the conversation, in one glass pill; a tap opens the coworker.
    const pill = (
        <GlassSurface isInteractive={Boolean(onOpenDetails)} colorScheme={theme.scheme} glassEffectStyle={glass} style={{ width: chipWidth, height: PILL_HEIGHT, flexDirection: 'row', alignItems: 'center', borderRadius: PILL_HEIGHT / 2, overflow: 'hidden' }}>
            <View style={{ marginLeft: AVATAR_INSET, marginRight: spacing.sm }}>
                <CoworkerAvatar coworker={{ ...coworker, status: running ? 'working' : coworker.status === 'working' ? 'idle' : coworker.status }} size={AVATAR} />
            </View>
            <View style={{ width: titleWidth, height: PILL_HEIGHT, overflow: 'hidden' }}>
                {/* A title known when the chat opens is there at once; on Android its fade could hold it hidden for seconds. */}
                <LayoutAnimationConfig skipEntering>
                    <Animated.View style={[{ flexDirection: 'row', width: pages.length * titleWidth }, track]}>
                        {pages.map((session, index) => (
                            <ChipPage key={session.id} coworker={coworker} session={hasConversations ? session : { ...session, title: t('newChat') }} active={index === activeIndex} width={titleWidth} progress={hasConversations ? progress : undefined} index={index} untitled={untitled} />
                        ))}
                    </Animated.View>
                </LayoutAnimationConfig>
            </View>
        </GlassSurface>
    )

    return (
        <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
            {/* What scrolls under the pill is hidden down to its bottom (its glass lets text through), then
                fades out until where the thread starts, so the first message is never dimmed. */}
            <EdgeFade edge="top" height={insets.top + CHAT_HEADER_HEIGHT + spacing.lg} solid={insets.top + spacing.xs + PILL_HEIGHT} />
            <View pointerEvents="box-none" style={{ paddingTop: insets.top + spacing.xs, paddingLeft: spacing.lg + pane.left, paddingRight: spacing.lg + pane.right, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                {onBack ? <GlassButton symbol="chevron-left" label={t('back')} onPress={onBack} /> : <View style={{ width: GLASS_BUTTON_SIZE }} />}
                <View pointerEvents="box-none" style={{ flex: 1, alignItems: 'center' }}>
                    {onOpenDetails ? (
                        <Pressable onPress={onOpenDetails} accessibilityRole="button" accessibilityLabel={identityLabel} accessibilityHint={t('coworkerDetails')}>
                            {pill}
                        </Pressable>
                    ) : (
                        <View accessible accessibilityLabel={identityLabel}>
                            {pill}
                        </View>
                    )}
                </View>
                {hasConversations ? (
                    <NativeMenu glass="circle" label={general ? t('threads') : t('conversations')} trigger={<CircleTrigger symbol="messages-square" />}>
                        <MenuItem label={untitled} icon="plus" onPress={onNewSession} disabled={!activeId} />
                        {general && <MenuToggle label={t('general')} icon="messages-square" isOn={activeId === general.id} onChange={() => onSelect(general.id)} />}
                        {listed.length > 0 && <ConversationsMenu sessions={listed} activeId={activeId} threaded={Boolean(general)} onSelect={onSelect} />}
                    </NativeMenu>
                ) : (
                    <View style={{ width: GLASS_BUTTON_SIZE }} />
                )}
            </View>
        </View>
    )
}
