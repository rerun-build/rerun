import { Button, Image, Menu, Section, Text, Toggle } from '@expo/ui/swift-ui'
import { router, useLocalSearchParams } from 'expo-router'
import { GlassView } from 'expo-glass-effect'
import { Pressable, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { CHAT_HEADER_HEIGHT, ChipPage } from '@/components/chat/ChatHeader'
import { CONVERSATION_SECTIONS, glyphOf, stateOf } from '@/components/chat/conversation-sections'
import { AppText } from '@/components/ui/AppText'
import { EdgeFade } from '@/components/ui/EdgeFade'
import { GlassButton, GLASS_BUTTON_SIZE, useGlassStyle } from '@/components/ui/GlassButton'
import { NativeMenu } from '@/components/ui/NativeMenu'
import { LAB_CONVERSATIONS, type LabConversation } from '@/mocks/conversations'
import { useTheme } from '@/theme/theme'
import { spacing } from '@/theme/tokens'

import { MockPane } from './lab-foreman'

// Dev only: ways to find a conversation by its state from a coworker's chat header.
//   /lab-conversations?variant=a   a: the native menu, in sections; b and c: the chip opens a sheet,
//   see lab-conversations-sheet
const ACTIVE = LAB_CONVERSATIONS[0]
const COWORKER = { id: 'agent-pulse', kind: 'coworker' as const, name: 'clem cv', status: 'working' as const }
const CHIP_MAX_WIDTH = 220

function MenuRow({ conversation }: { conversation: LabConversation }) {
    if (conversation.id === ACTIVE.id) return <Toggle label={conversation.title} isOn onIsOnChange={() => {}} />
    const glyph = glyphOf(conversation)
    const detail = stateOf(conversation) === 'needs-you' ? conversation.ask : undefined
    return (
        <Button onPress={() => {}}>
            {glyph ? <Image systemName={glyph} /> : <Text>{''}</Text>}
            <Text>{conversation.title}</Text>
            {detail ? <Text>{detail}</Text> : <Text>{''}</Text>}
        </Button>
    )
}

// What waits elsewhere, on the chip: the count of the other conversations that need the person.
function ChipBadge({ count }: { count: number }) {
    const theme = useTheme()
    if (count === 0) return null
    return (
        <View pointerEvents="none" style={{ position: 'absolute', top: -2, right: -2, minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.waiting, borderWidth: 2, borderColor: theme.background }}>
            <AppText variant="caption" medium maxFontSizeMultiplier={1} style={{ color: '#ffffff', fontSize: 10, lineHeight: 12 }}>
                {count}
            </AppText>
        </View>
    )
}

const SECTION_TITLES = { 'needs-you': 'Needs you', running: 'Running', new: 'Unread' } as const

export default function ConversationsLab() {
    const theme = useTheme()
    const glass = useGlassStyle()
    const insets = useSafeAreaInsets()
    const { width: screenWidth } = useWindowDimensions()
    const params = useLocalSearchParams<{ variant?: string }>()
    const variant = params.variant ?? 'a'
    const chipWidth = Math.min(CHIP_MAX_WIDTH, screenWidth - 2 * (spacing.lg + GLASS_BUTTON_SIZE + spacing.sm))
    const waiting = LAB_CONVERSATIONS.filter(conversation => conversation.id !== ACTIVE.id && stateOf(conversation) === 'needs-you').length
    const chip = <ChipPage coworker={COWORKER} session={{ id: ACTIVE.id, title: ACTIVE.title, running: false, empty: false }} active width={chipWidth} />
    const earlier = LAB_CONVERSATIONS.filter(conversation => stateOf(conversation) === 'earlier')

    return (
        <View style={{ flex: 1, backgroundColor: theme.background }}>
            <MockPane state="conversation" topInset={insets.top + CHAT_HEADER_HEIGHT + spacing.lg} seeThrough={false} coworkerName={COWORKER.name} />
            <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
                <EdgeFade edge="top" height={insets.top + CHAT_HEADER_HEIGHT + 16} />
                <View pointerEvents="box-none" style={{ paddingTop: insets.top + spacing.xs, paddingHorizontal: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    <GlassButton symbol="chevron.left" label="Back" onPress={() => router.back()} />
                    <View pointerEvents="box-none" style={{ flex: 1, alignItems: 'center' }}>
                        {variant === 'a' ? (
                            <NativeMenu glass="capsule" label={`${COWORKER.name}, conversations`} trigger={chip}>
                                <Button label="Coworker details" systemImage="info.circle" onPress={() => {}} />
                                <Button label="New conversation" systemImage="square.and.pencil" onPress={() => {}} />
                                {CONVERSATION_SECTIONS.map(section => {
                                    const conversations = LAB_CONVERSATIONS.filter(conversation => stateOf(conversation) === section.state)
                                    if (conversations.length === 0) return null
                                    return (
                                        <Section key={section.state} title={SECTION_TITLES[section.state]}>
                                            {conversations.map(conversation => (
                                                <MenuRow key={conversation.id} conversation={conversation} />
                                            ))}
                                        </Section>
                                    )
                                })}
                                <Section title="Earlier">
                                    <Menu label={`${earlier.length} conversations`}>
                                        {earlier.map(conversation => (
                                            <MenuRow key={conversation.id} conversation={conversation} />
                                        ))}
                                    </Menu>
                                </Section>
                            </NativeMenu>
                        ) : (
                            <Pressable onPress={() => router.push({ pathname: '/lab-conversations-sheet', params: { variant } })} accessibilityRole="button" accessibilityLabel={`${COWORKER.name}, conversations`}>
                                <GlassView colorScheme={theme.scheme} glassEffectStyle={glass} isInteractive style={{ borderRadius: GLASS_BUTTON_SIZE / 2 }}>
                                    {chip}
                                </GlassView>
                                <ChipBadge count={waiting} />
                            </Pressable>
                        )}
                    </View>
                    <View style={{ width: GLASS_BUTTON_SIZE }} />
                </View>
            </View>
        </View>
    )
}
