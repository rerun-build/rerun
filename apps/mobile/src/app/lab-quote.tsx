import { QUOTE_FROM_USER, prependQuote } from '@rerun/contracts'
import type { UIMessage } from 'ai'
import { useLocalSearchParams } from 'expo-router'
import { useRef, useState } from 'react'
import { ScrollView, View, type ScrollViewInstance } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslations } from 'use-intl'

import { Composer, type ComposerHandle } from '@/components/chat/Composer'
import { MessageView } from '@/components/chat/MessageView'
import { QuoteBanner, QuoteReplyContext, useQuoteReply } from '@/components/chat/QuoteReply'
import { ThemeScope, useTheme } from '@/theme/theme'
import { spacing, type ColorScheme } from '@/theme/tokens'

// Dev only: reply by quoting (RER-21) over a mock thread, the web's render lab on a phone. Swipe a
// bubble right to quote it, send, tap the quote to go back to its source.
//   /lab-quote?scheme=dark
const COWORKER = 'Nova'
const ANSWER =
    'Done. I went through the 100 agencies and kept the ones with a public contact email.\n\nThe split:\n\n- 38 have fewer than 10 people\n- 12 already list Webflow or Framer\n- 7 are hiring right now\n\nMost of them list a generic contact address rather than a named person, so the cold email should open on their latest project rather than on a name.\n\nNothing was sent: you asked me to wait. Want me to draft the cold email?'
const THREAD: UIMessage[] = [
    { id: 'u-1', role: 'user', parts: [{ type: 'text', text: 'Find me 100 web agencies in Lyon with a public contact email.' }] },
    { id: 'a-1', role: 'assistant', parts: [{ type: 'text', text: ANSWER }] },
]

export default function QuoteLab() {
    const params = useLocalSearchParams<{ scheme?: ColorScheme }>()
    return (
        <ThemeScope scheme={params.scheme === 'dark' ? 'dark' : 'light'}>
            <Thread />
        </ThemeScope>
    )
}

function Thread() {
    const theme = useTheme()
    const insets = useSafeAreaInsets()
    const tQuote = useTranslations('mobileChat.quote')
    const tComposer = useTranslations('mobileChat.composer')
    const scroll = useRef<ScrollViewInstance>(null)
    const composer = useRef<ComposerHandle>(null)
    const scrollOffset = useRef(0)
    const [messages, setMessages] = useState(THREAD)
    const [draft, setDraft] = useState('')
    const { quote, setQuote, showSource, context } = useQuoteReply({ enabled: true, authorOf: side => (side === 'user' ? QUOTE_FROM_USER : COWORKER), scroll, scrollOffset, onLeaveEnd: () => {}, focusComposer: () => composer.current?.focus() })

    const send = () => {
        const text = prependQuote(draft.trim(), quote)
        if (!text) return
        const at = messages.length
        setMessages(previous => [...previous, { id: `u-${at}`, role: 'user', parts: [{ type: 'text', text }] }, { id: `a-${at}`, role: 'assistant', parts: [{ type: 'text', text: quote ? 'About that passage: the 7 hiring right now come first.' : 'On it.' }] }])
        setDraft('')
        setQuote(null)
        requestAnimationFrame(() => scroll.current?.scrollToEnd({ animated: true }))
    }

    return (
        <QuoteReplyContext value={context}>
            <View style={{ flex: 1, backgroundColor: theme.background, paddingTop: insets.top, paddingBottom: insets.bottom }}>
                <ScrollView ref={scroll} onScroll={event => {
                        scrollOffset.current = event.nativeEvent.contentOffset.y
                    }} scrollEventThrottle={32} contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
                    {messages.map((message, index) => (
                        <MessageView key={message.id} message={message} isLastAssistant={index === messages.length - 1} running={false} settled agentId={null} fileOwner={null} coworkerName={COWORKER} hiddenCallId={null} />
                    ))}
                </ScrollView>
                <View style={{ gap: spacing.sm, paddingTop: spacing.sm }}>
                    {quote && <QuoteBanner quote={quote} onShowSource={() => showSource(quote)} onRemove={() => setQuote(null)} />}
                    <View style={{ paddingHorizontal: spacing.md }}>
                        <Composer ref={composer} value={draft} onChangeText={setDraft} onSend={send} onStop={() => {}} running={false} placeholder={quote ? tQuote('placeholder') : tComposer('placeholder')} canAttach={false} />
                    </View>
                </View>
            </View>
        </QuoteReplyContext>
    )
}
