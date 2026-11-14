import { useLocalSearchParams } from 'expo-router'
import { useState, type ReactNode } from 'react'
import { ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { ComposerAttachment } from '@/components/chat/attachments'
import { Composer } from '@/components/chat/Composer'
import { MentionSuggestions } from '@/components/chat/MentionSuggestions'
import type { MentionAgent, MentionItem } from '@/components/chat/mentions'
import { AppText } from '@/components/ui/AppText'
import { environment } from '@/config/environment'
import { findModel } from '@/mocks/models'
import { ThemeScope, useColorSchemeName } from '@/theme/theme'
import { palette, spacing, type ColorScheme } from '@/theme/tokens'

const noop = () => {}

const SKILLS = [
    { slug: 'cold-email', name: 'Cold email', description: '' },
    { slug: 'weekly-report', name: 'Weekly report', description: '' },
    { slug: 'linkedin-post', name: 'LinkedIn post', description: '' },
]
const AGENTS: MentionAgent[] = [
    { id: 'scout', name: 'Scout', handle: 'scout', preferred: true },
    { id: 'ledger', name: 'Ledger', handle: 'ledger', hint: 'Finance' },
    { id: 'pulse', name: 'Pulse', handle: 'pulse', preferred: true },
]
const ATTACHMENTS: ComposerAttachment[] = [
    { uri: `${environment.supabaseUrl}/storage/v1/object/public/blob-illustrations/green-energy-blob.webp`, name: 'IMG_2041.jpg', mimeType: 'image/jpeg' },
    { uri: 'file:///lab/Q3-board-review-final-version.pdf', name: 'Q3-board-review-final-version.pdf', mimeType: 'application/pdf' },
    { uri: 'file:///lab/renewals.csv', name: 'renewals.csv', mimeType: 'text/csv' },
]
const SKILL_ITEMS: MentionItem[] = SKILLS.map(skill => ({ kind: 'skill', ...skill }))
const AGENT_ITEMS: MentionItem[] = AGENTS.map(agent => ({ kind: 'agent', ...agent }))

function Group({ title, children }: { title: string; children: ReactNode }) {
    return (
        <View style={{ gap: spacing.md }}>
            <AppText variant="footnote" tone="muted" medium>
                {title}
            </AppText>
            {children}
        </View>
    )
}

function LiveComposer() {
    const [value, setValue] = useState('')
    const [attachments, setAttachments] = useState<ComposerAttachment[]>([])
    return <Composer value={value} onChangeText={setValue} attachments={attachments} onAttachmentsChange={setAttachments} skills={SKILLS} mentionAgents={AGENTS} onSend={() => setValue('')} onStop={noop} running={false} placeholder="Message Pulse" model={findModel('rerun-max')} onOpenModel={noop} />
}

function States({ scheme }: { scheme: ColorScheme }) {
    return (
        <ThemeScope scheme={scheme}>
            <View style={{ gap: spacing.lg, padding: spacing.md, borderRadius: 18, backgroundColor: palette[scheme].background, borderWidth: 1, borderColor: palette[scheme].border }}>
                <Group title="Attachments">
                    <Composer value="Summarise these for the board" onChangeText={noop} attachments={ATTACHMENTS} onSend={noop} onStop={noop} running={false} placeholder="Message Pulse" model={findModel('rerun-max')} onOpenModel={noop} />
                </Group>
                <Group title="/ menu">
                    <MentionSuggestions trigger="/" items={SKILL_ITEMS} onPick={noop} />
                </Group>
                <Group title="@ menu">
                    <MentionSuggestions trigger="@" items={AGENT_ITEMS} onPick={noop} />
                </Group>
            </View>
        </ThemeScope>
    )
}

export default function LabComposer() {
    const insets = useSafeAreaInsets()
    const system = useColorSchemeName()
    const { scheme } = useLocalSearchParams<{ scheme?: ColorScheme }>()
    const shown = scheme ?? system
    return (
        <View style={{ flex: 1, backgroundColor: palette[shown].background }}>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingTop: insets.top + spacing.lg, paddingHorizontal: spacing.lg, gap: spacing.xl }}>
                <States scheme="light" />
                <States scheme="dark" />
            </ScrollView>
            <View style={{ paddingHorizontal: spacing.md, paddingBottom: insets.bottom + spacing.sm }}>
                <ThemeScope scheme={shown}>
                    <LiveComposer />
                </ThemeScope>
            </View>
        </View>
    )
}
