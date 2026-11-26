import { useLocalSearchParams } from 'expo-router'
import { useState, type ReactNode } from 'react'
import { ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { publishCardsByMessage } from '@/components/chat/cards/cards'
import { PublishedCardView, PublishedRow, UnpublishedRow, type Answer, type PublishedRowProps } from '@/components/chat/cards/PublishedCardView'
import { AppText } from '@/components/ui/AppText'
import { Button } from '@/components/ui/Button'
import { ThemeScope, useColorSchemeName } from '@/theme/theme'
import { palette, spacing, type ColorScheme } from '@/theme/tokens'

// Dev only: the card of a link a coworker published, in every state of the render lab
// (cloud/apps/admin/app/render/lab/mobile-published-card). The first card plays the flow locally.
//   /lab-published?scheme=dark   scheme forces a theme

const TITLE = 'Pricing page, November launch'
const BASE: PublishedRowProps = {
    title: TITLE,
    url: 'https://acme.rerun.site/pricing-launch',
    access: 'workspace',
    thumbnailUrl: null,
    symbol: 'globe',
    coworkerName: 'Blog Writer',
    workspaceName: 'Acme',
    pending: false,
    answering: null,
    settled: null,
    copied: false,
    onCopy: () => {},
    onOpen: () => {},
    onAnswer: () => {},
}

const publishCall = (title: string) => ({
    type: 'tool-rerun_hub_publish_file',
    state: 'output-available',
    output: { status: 'published', slug: 'pricing-launch', url: BASE.url, path: 'pages/pricing.html', title, access: 'workspace', requestedAccess: 'public' },
})

// A coworker that publishes, fixes the page and publishes it again in one turn: the real placement and
// the real card, which reads nothing back without a session and draws the latest call.
const REPUBLISHED_TURN = [{ id: 'a1', role: 'assistant', parts: [publishCall('Pricing page, first draft'), { type: 'text', text: 'Here it is.' }, publishCall(TITLE), { type: 'text', text: 'Fixed, tap Make public below.' }] }]

function RepublishedTurn() {
    const cards = publishCardsByMessage(REPUBLISHED_TURN).get('a1') ?? []
    return (
        <View style={{ gap: spacing.md }}>
            {cards.map(card => (
                <PublishedCardView key={card.slug} card={card} coworkerName={BASE.coworkerName} />
            ))}
        </View>
    )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
    return (
        <View style={{ gap: spacing.sm }}>
            <AppText variant="footnote" tone="muted" medium>
                {title}
            </AppText>
            {children}
        </View>
    )
}

function LiveCard() {
    const [answering, setAnswering] = useState<Answer | null>(null)
    const [answer, setAnswer] = useState<Answer | null>(null)
    const [copied, setCopied] = useState(false)
    const answerWith = (choice: Answer) => {
        setAnswering(choice)
        setTimeout(() => {
            setAnswering(null)
            setAnswer(choice)
        }, 900)
    }
    return (
        <View style={{ gap: spacing.md }}>
            <PublishedRow
                {...BASE}
                access={answer === 'public' ? 'public' : 'workspace'}
                pending={answer === null}
                answering={answering}
                settled={answer ? { answer, byYou: true } : null}
                copied={copied}
                onCopy={() => {
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1500)
                }}
                onAnswer={answerWith}
            />
            {answer && (
                <View style={{ alignItems: 'flex-start' }}>
                    <Button size="sm" variant="outline" label="Replay" onPress={() => setAnswer(null)} />
                </View>
            )}
        </View>
    )
}

export default function LabPublished() {
    const { scheme: forced } = useLocalSearchParams<{ scheme?: ColorScheme }>()
    const system = useColorSchemeName()
    const scheme = forced === 'dark' || forced === 'light' ? forced : system
    const insets = useSafeAreaInsets()
    return (
        <ThemeScope scheme={scheme}>
            <ScrollView style={{ backgroundColor: palette[scheme].background }} contentContainerStyle={{ paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.xl, paddingHorizontal: spacing.lg, gap: spacing.lg }}>
                <AppText variant="largeTitle">Published link</AppText>
                <Group title="Public request (tap Make public or Keep private)">
                    <LiveCard />
                </Group>
                <Group title="Answering">
                    <PublishedRow {...BASE} pending answering="public" />
                </Group>
                <Group title="Made public">
                    <PublishedRow {...BASE} access="public" settled={{ answer: 'public', byYou: true }} />
                </Group>
                <Group title="Kept private">
                    <PublishedRow {...BASE} settled={{ answer: 'kept', byYou: true }} />
                </Group>
                <Group title="No request">
                    <PublishedRow {...BASE} />
                </Group>
                <Group title="Published twice in one turn (one card, the latest)">
                    <RepublishedTurn />
                </Group>
                <Group title="Unpublished">
                    <UnpublishedRow title={TITLE} />
                </Group>
            </ScrollView>
        </ThemeScope>
    )
}
