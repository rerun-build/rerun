import { authorTurnsOf, FORMER_MEMBER, type AuthorProfile } from '@moldwright/contracts'
import type { UIMessage } from 'ai'
import { useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { AuthoredGroup } from '@/components/chat/AuthoredGroup'
import { UserBubble } from '@/components/chat/Messages'
import { MessageView } from '@/components/chat/MessageView'
import { openViewer, type ViewerItem } from '@/components/viewer/viewer-store'
import { StartedByBanner } from '@/components/chat/origins/StartedByBanner'
import { ThemeScope } from '@/theme/theme'
import { palette, spacing, type ColorScheme } from '@/theme/tokens'

const text = (id: string, role: 'user' | 'assistant', body: string): UIMessage => ({ id, role, parts: [{ type: 'text', text: body }] })

const PROSE = `## Weekly report

The **pipeline** grew by *12 leads* this week, ~~9~~ 11 of them from LinkedIn. The full list is in [leads.csv](/data/agents/agent-scout/workspace/reports/leads.csv), and the method is on [our blog](https://rerun.build/blog).

Three things stand out:

1. **Lyon agencies** reply twice as fast as Paris ones
2. Founders answer on Tuesday mornings
   - before 10 am
   - after the weekly sync
3. \`follow_up\` sequences beyond 3 steps never convert

> A lead that has not answered in 10 days is cold. Move it to the nurture list.

### Next steps

- [x] Export the CRM
- [ ] Draft the Lyon sequence
- [ ] Book the call with Margaux

---

Want me to start the Lyon sequence now?`

export const WIDE_TABLE = `| Company | Contact | Role | City | Source | Last touch | Next step |
| --- | --- | --- | --- | --- | --- | --- |
| Atelier Lumière | Margaux Petit | Head of Growth | Lyon | LinkedIn | Replied on Tuesday | Book a call this week |
| Studio Nord | Hugo Bernard | Founder | Villeurbanne | Referral | Opened twice | Send the case study |
| Agence Rhône | Clara Morel | Marketing Lead | Lyon | Email | No reply yet | Follow up on Friday |`

const TECHNICAL = `Run this to rebuild the report:

\`\`\`ts
import { buildReport } from './report'

// Every lead of the week, newest first
const report = await buildReport({ since: '2026-10-18', limit: 50 })
console.log(report.rows.length, 'leads')
\`\`\`

The numbers by source:

| Source | Leads | Replied | Rate |
| --- | ---: | ---: | ---: |
| LinkedIn | 11 | 6 | 55% |
| Email | 4 | 1 | 25% |
| Referral | 2 | 2 | 100% |

The leads worth a call:

${WIDE_TABLE}

Here is the email I would send:

\`\`\`draft Email to Margaux
Bonjour Margaux,

Suite à notre échange, voici la proposition :

- 3 agents dédiés
- 600 €/mois

Bien à vous
\`\`\`

The growth curve:

![Leads this month](https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=900)

$$
rate = \\frac{replied}{leads}
$$`

const USER_LONG = `Here is the brief for the campaign, read it all before you start:\n\n${Array.from({ length: 14 }, (_, i) => `${i + 1}. A point of the brief that matters, with enough words to wrap on a phone.`).join('\n')}`

const tool = (id: string, name: string, state: string, input: unknown, output?: unknown, errorText?: string) => ({ type: `tool-${name}`, toolCallId: id, state, input, output, errorText })

const STEPS: UIMessage[] = [
    text('u3', 'user', 'Find the Lyon agencies that opened this year and add them to the CRM'),
    {
        id: 'a3',
        role: 'assistant',
        parts: [
            { type: 'reasoning', text: 'I need the list of agencies first, then their contacts. The CRM import wants a CSV.' },
            tool('t1', 'web_search', 'output-available', { query: 'agences marketing Lyon ouverture 2026' }, { results: 12 }),
            tool('t2', 'web_fetch', 'output-available', { url: 'https://www.lyon-entreprises.com/annuaire/agences' }, 'Agence Tilt, Studio Brume, Maison Nord…'),
            tool('t3', 'web_fetch', 'output-error', { url: 'https://www.societe.com/agences-lyon' }, undefined, 'HTTP 403: blocked by the site'),
            tool('t4', 'fs_write', 'output-available', { path: 'leads/lyon-agencies.csv' }, { duration: 0.2 }),
            { type: 'text', text: 'I found **9 agencies** opened this year in Lyon. One directory blocked me, the other had everything.' },
            tool('t5', 'shell_exec', 'output-available', { command: 'python3 import_crm.py leads/lyon-agencies.csv' }, '9 contacts created'),
            tool('t6', 'memory_write', 'output-available', { preview: 'Lyon agencies: lyon-entreprises.com is the best source' }, { ok: true }),
            { type: 'text', text: 'They are in the CRM, tagged **Lyon 2026**.' },
        ],
    } as UIMessage,
]

const RUNNING: UIMessage[] = [
    STEPS[0],
    {
        id: 'a4',
        role: 'assistant',
        parts: [tool('t1', 'web_search', 'output-available', { query: 'agences marketing Lyon ouverture 2026' }, { results: 12 }), tool('t2', 'web_fetch', 'input-available', { url: 'https://www.lyon-entreprises.com/annuaire/agences' })],
    } as UIMessage,
]

const delegation = (status: 'running' | 'done') => ({
    type: 'data-delegate',
    id: 'd1',
    data: {
        tasks: [
            { id: 't-a', title: 'Qualify Tilt and Brume', status: 'done', steps: 6, toolCalls: 9, startedAt: 0, finishedAt: 42_000 },
            { id: 't-b', title: 'Qualify Maison Nord', status, steps: 3, toolCalls: 4, startedAt: 0, ...(status === 'done' ? { finishedAt: 51_000 } : { activity: 'web_fetch', calls: [{ tool: 'web_search', summary: 'Maison Nord Lyon', durationMs: 1200 }, { tool: 'web_fetch', summary: 'maisonnord.fr', elapsedMs: 4000 }] }) },
            { id: 't-c', title: 'Find the founders', status: status === 'done' ? 'error' : 'queued', steps: 0, error: status === 'done' ? 'LinkedIn refused the session' : undefined },
        ],
    },
})

const CARDS: UIMessage[] = [
    text('u5', 'user', 'Qualify the three agencies, then connect Notion'),
    {
        id: 'a5',
        role: 'assistant',
        parts: [
            { type: 'data-compaction', id: 'k1', data: { status: 'done', messagesCompacted: 38, tokensRecovered: 41200 } },
            tool('t1', 'delegate_tasks', 'input-available', { tasks: [] }),
            delegation('running'),
            { type: 'text', text: 'While they work, I am adding the apps.' },
            tool('t2', 'rerun_hub_service_install', 'output-available', { slug: 'gmail' }, { status: 'installed', key: 'gmail', slug: 'gmail', name: 'Gmail', toolNames: ['gmail'], message: '' }),
            tool('t3', 'rerun_hub_service_install', 'output-available', { slug: 'notion' }, { status: 'needs_auth', key: 'notion', slug: 'notion', name: 'Notion', message: '' }),
            tool('t4', 'mcp_register', 'output-available', { name: 'pipedrive', url: 'https://mcp.pipedrive.com' }, 'Could not reach pipedrive via http: 401 Unauthorized. Nothing was saved.'),
        ],
    } as UIMessage,
    text('u6', 'user', 'And now?'),
    {
        id: 'a6',
        role: 'assistant',
        parts: [tool('t5', 'delegate_tasks', 'output-available', { tasks: [] }, 'Done'), { ...delegation('done'), id: 'd2' }, { type: 'text', text: 'Two are qualified, the founders search failed.' }],
    } as UIMessage,
]

const WEBHOOK_TEXT = 'Qualify this new lead and add it to the CRM.\n\n<trigger_payload trigger="typeform-leads" method="POST" received="2026-10-25T09:12:04Z" content-type="application/json" bytes="214" truncated="false">\n{"name":"Margaux Petit","company":"Studio Brume","email":"margaux@brume.studio","budget":"5-10k"}\n</trigger_payload>'

const ORIGINS: UIMessage[] = [
    { id: 'o1', role: 'user', parts: [{ type: 'text', text: '## Connect Gmail\n\nAsk the user to connect Gmail, then read the last 20 emails.' }], metadata: { install: { agentName: 'Closer' } } } as UIMessage,
    text('o2', 'assistant', 'Gmail is connected. I read the last 20 emails.'),
    { id: 'o3', role: 'user', parts: [{ type: 'text', text: 'Send the **daily digest** of new leads to #sales.' }], metadata: { scheduledRun: { slug: 'daily-digest', name: 'Daily digest' } } } as UIMessage,
    text('o4', 'assistant', 'Digest posted in #sales: 4 new leads.'),
    text('o5', 'user', WEBHOOK_TEXT),
    text('o6', 'assistant', 'Studio Brume is qualified and in the CRM.'),
]

const signed = (id: string, body: string, authorId: string): UIMessage => ({ id, role: 'user', parts: [{ type: 'text', text: body }], metadata: { authorId } })

const AUTHORS: UIMessage[] = [
    signed('m1', 'Can you pull the October numbers?', 'u-clement'),
    signed('m2', 'Split by channel please', 'u-clement'),
    text('m3', 'assistant', 'Here they are: **€48k** in October, 62% from inbound.'),
    signed('m4', 'Add the margin too', 'u-margaux'),
    text('m5', 'assistant', 'Margin is 41%, up 3 points.'),
    signed('m6', 'Thanks, archive the old report', 'u-gone'),
    signed('m7', 'Who asked for this?', 'u-loading'),
]

const PROFILES: Record<string, AuthorProfile | null> = {
    'u-clement': { id: 'u-clement', name: 'Clément Janssens', photo: 'https://i.pravatar.cc/120?img=12' },
    'u-margaux': { id: 'u-margaux', name: 'Margaux Petit' },
    'u-gone': FORMER_MEMBER,
    'u-loading': null,
}

const PHOTOS: ViewerItem[] = [
    { url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1200', name: 'dashboard.jpg' },
    { url: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=1200', name: 'analytics.jpg' },
    { url: 'https://images.unsplash.com/photo-1504868584819-f8e8b4b6d7e3?w=1200', name: 'report.jpg' },
]
const DOCUMENTS: ViewerItem[] = [{ url: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf', name: 'brief.pdf' }, ...PHOTOS.slice(0, 1)]

function ViewerLab() {
    return (
        <View style={{ gap: spacing.md }}>
            <UserBubble text="Here are the screenshots" media={PHOTOS.map(photo => ({ ...photo, image: true }))} />
            <Pressable onPress={() => openViewer(DOCUMENTS, 0)} accessibilityRole="button" style={{ padding: spacing.md, borderRadius: 12, backgroundColor: '#4d34f7' }}>
                <Text style={{ color: '#ffffff' }}>Open a PDF, then a photo</Text>
            </Pressable>
        </View>
    )
}

const PART_1: UIMessage[] = [text('u1', 'user', 'Can you write the **weekly report**? The CRM is at https://app.hubspot.com/contacts/4421/objects/0-1/views/all/list'), text('a1', 'assistant', PROSE)]
const PART_2: UIMessage[] = [text('u2', 'user', USER_LONG), text('a2', 'assistant', TECHNICAL)]

function useStreamed(full: string, active: boolean) {
    const [length, setLength] = useState(0)
    useEffect(() => {
        if (!active) return
        const timer = setInterval(() => setLength(current => (current >= full.length + 60 ? 0 : current + 8 + Math.floor(Math.random() * 12))), 90)
        return () => clearInterval(timer)
    }, [active, full])
    return full.slice(0, length)
}

export default function LabMarkdown() {
    const params = useLocalSearchParams<{ scheme?: ColorScheme; part?: string }>()
    const insets = useSafeAreaInsets()
    const scheme: ColorScheme = params.scheme === 'dark' ? 'dark' : 'light'
    const streaming = params.part === 'stream'
    const streamed = useStreamed(PROSE, streaming)
    const messages = streaming ? [text('u1', 'user', 'Write the weekly report'), text('a1', 'assistant', streamed)] : params.part === '2' ? PART_2 : params.part === 'steps' ? STEPS : params.part === 'running' ? RUNNING : params.part === 'cards' ? CARDS : params.part === 'origins' ? ORIGINS : PART_1
    return (
        <ThemeScope scheme={scheme}>
            <ScrollView style={{ flex: 1, backgroundColor: palette[scheme].background }} contentContainerStyle={{ gap: spacing.xl, paddingHorizontal: spacing.lg, paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.xxl }}>
                {params.part === 'origins' && <StartedByBanner startedBy={{ agentId: 'agent-scout', name: 'Scout' }} />}
                {params.part === 'authors' &&
                    authorTurnsOf(AUTHORS).map(turn => {
                        const views = turn.items.map(({ message }) => <MessageView key={message.id} message={message} isLastAssistant={false} running={false} agentId="agent-scout" fileOwner={null} coworkerName="Scout" hiddenCallId={null} />)
                        return turn.authorId ? (
                            <AuthoredGroup key={turn.key} author={PROFILES[turn.authorId]}>
                                {views}
                            </AuthoredGroup>
                        ) : (
                            <View key={turn.key}>{views}</View>
                        )
                    })}
                {params.part === 'viewer' && <ViewerLab />}
                {params.part !== 'authors' && params.part !== 'viewer' && messages.map((message, index) => (
                    <View key={message.id}>
                        <MessageView message={message} isLastAssistant={index === messages.length - 1} running={streaming || params.part === 'running' || (params.part === 'cards' && index === 1) || (params.part === 'origins' && index === 0)} agentId="agent-scout" fileOwner={{ kind: 'agent', agentId: 'agent-scout' }} coworkerName="Scout" hiddenCallId={null} />
                    </View>
                ))}
            </ScrollView>
        </ThemeScope>
    )
}
