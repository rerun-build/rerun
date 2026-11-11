// Mock data for the design phase: no API is wired yet. Shapes follow what the hub already serves
// (agents and their `sessions`), so swapping in /api/v1 later changes the source, not the UI.

import { FOREMAN_DISPLAY_NAME } from '@rerun/contracts'

export type CoworkerStatus = 'idle' | 'working' | 'waiting_human' | 'error' | 'offline'

export type Message = { id: string; role: 'user' | 'assistant'; text: string; images?: string[] }

export type RunPhase = 'waking' | 'thinking' | 'working'

export type Coworker = {
    id: string
    kind: 'foreman' | 'coworker'
    name: string
    role: string
    status: CoworkerStatus
    unread: boolean
    // Minutes ago, so the mock always reads as fresh.
    updatedMinutesAgo: number
    modelId: string
    suggestions: string[]
}

export type Session = {
    id: string
    coworkerId: string
    // Null until the hub names it from the first message, like `generateSessionTitle` on the web.
    title: string | null
    messages: Message[]
    updatedMinutesAgo: number
    // What a coworker in `waiting_human` asks; answered from the composer.
    pendingQuestion?: string
    run?: { phase: RunPhase; startedAt: number }
}

export const FOREMAN_ID = 'foreman'

export const coworkers: Coworker[] = [
    {
        id: FOREMAN_ID,
        kind: 'foreman',
        name: FOREMAN_DISPLAY_NAME,
        role: 'Your Chief of Staff',
        status: 'idle',
        unread: false,
        updatedMinutesAgo: 35,
        modelId: 'rerun-max',
        suggestions: ['What needs me today?', 'Summarize this week', 'Create a new coworker'],
    },
    { id: 'agent-scout', kind: 'coworker', name: 'Scout', role: 'Lead finder', status: 'waiting_human', unread: true, updatedMinutesAgo: 2, modelId: 'rerun-max', suggestions: ['Find leads like my best customer', 'Who opened my last email?', 'Clean up my lead lists'] },
    { id: 'agent-pulse', kind: 'coworker', name: 'Pulse', role: 'Social media', status: 'working', unread: false, updatedMinutesAgo: 1, modelId: 'claude-opus-5-5', suggestions: ['Draft a post about our launch', 'What did best last month?', 'Plan next week'] },
    { id: 'agent-ledger', kind: 'coworker', name: 'Ledger', role: 'Invoices and payments', status: 'error', unread: true, updatedMinutesAgo: 48, modelId: 'rerun-smart', suggestions: ['Who has not paid yet?', 'Send the October invoices', 'Revenue this month'] },
    { id: 'agent-inbox', kind: 'coworker', name: 'Inbox Zero', role: 'Email triage', status: 'idle', unread: false, updatedMinutesAgo: 180, modelId: 'rerun-fast', suggestions: ['Anything urgent?', 'Draft a reply to Marie', 'Unsubscribe me from the noise'] },
    { id: 'agent-recap', kind: 'coworker', name: 'Recap', role: 'Weekly report', status: 'offline', unread: false, updatedMinutesAgo: 60 * 26, modelId: 'rerun-max', suggestions: ['Write this week’s recap', 'Compare with last week', 'Send it to the team'] },
    { id: 'cw-inbox', kind: 'coworker', name: 'Echo', role: 'Customer support', status: 'idle', unread: false, updatedMinutesAgo: 60 * 50, modelId: 'gpt-6-sol', suggestions: ['Answer the open tickets', 'What are customers asking about?', 'Draft a help article'] },
]

const PULSE_STARTED_SECONDS_AGO = 42

export const sessions: Session[] = [
    {
        id: 'foreman-1',
        coworkerId: FOREMAN_ID,
        title: 'Overnight catch-up',
        updatedMinutesAgo: 35,
        messages: [
            { id: 'f1', role: 'user', text: 'What happened while I was away?' },
            {
                id: 'f2',
                role: 'assistant',
                text: 'Quiet night, mostly good news.\n\n- **Scout** found 14 new leads and needs you to pick a list.\n- **Pulse** is drafting tomorrow’s LinkedIn post.\n- **Ledger** could not reach Stripe, the key looks expired.\n\nWant me to open Ledger’s settings on the web?',
            },
        ],
    },
    {
        id: 'foreman-0',
        coworkerId: FOREMAN_ID,
        title: 'New coworker for support',
        updatedMinutesAgo: 60 * 30,
        messages: [
            { id: 'f0a', role: 'user', text: 'I need someone to answer support tickets.' },
            { id: 'f0b', role: 'assistant', text: 'Done: **Echo** is set up on your help desk. It drafts every answer and waits for your go before sending.' },
        ],
    },
    {
        id: 'scout-1',
        coworkerId: 'agent-scout',
        title: 'Agencies in Lyon',
        updatedMinutesAgo: 2,
        messages: [
            { id: 's1', role: 'user', text: 'Find 10 agencies in Lyon that might need a booking tool.' },
            { id: 's2', role: 'assistant', text: 'Done, I found 14 that match. 9 have a contact email, 5 only a contact form.' },
        ],
        pendingQuestion: 'Should I add the 14 leads to “Q4 prospects” or create a new list called “Lyon agencies”?',
    },
    {
        id: 'scout-0',
        coworkerId: 'agent-scout',
        title: 'Clean up duplicate leads',
        updatedMinutesAgo: 60 * 72,
        messages: [
            { id: 's0a', role: 'user', text: 'Remove the duplicates from my lead lists.' },
            { id: 's0b', role: 'assistant', text: 'Merged 37 duplicates across 4 lists. Nothing was deleted, the merged rows keep both notes.' },
        ],
    },
    {
        id: 'pulse-1',
        coworkerId: 'agent-pulse',
        title: 'LinkedIn post on pricing',
        updatedMinutesAgo: 1,
        messages: [{ id: 'p1', role: 'user', text: 'Draft tomorrow’s LinkedIn post about the new pricing.' }],
        run: { phase: 'working', startedAt: Date.now() - PULSE_STARTED_SECONDS_AGO * 1000 },
    },
    {
        id: 'ledger-1',
        coworkerId: 'agent-ledger',
        title: 'October invoices',
        updatedMinutesAgo: 48,
        messages: [
            { id: 'l1', role: 'user', text: 'Send the October invoices.' },
            { id: 'l2', role: 'assistant', text: 'I could not reach Stripe: the API key was refused. Nothing was sent. Once the key is fixed on the web, ask me again and I will pick up where I stopped.' },
        ],
    },
    {
        id: 'inbox-1',
        coworkerId: 'agent-inbox',
        title: 'Urgent emails',
        updatedMinutesAgo: 180,
        messages: [
            { id: 'i1', role: 'user', text: 'Anything urgent in my inbox?' },
            {
                id: 'i2',
                role: 'assistant',
                text: 'Two things worth your time:\n\n- **Marie from Acme** wants to move Thursday’s call to Friday 10am.\n- **Your accountant** needs the Q3 receipts by Monday.\n\nThe other 23 emails are newsletters and notifications, I archived them.',
            },
            { id: 'i3', role: 'user', text: 'Tell Marie Friday works.' },
            { id: 'i4', role: 'assistant', text: 'Sent. I also moved the event in your calendar to Friday 10:00.' },
        ],
    },
]

const STATUS_RANK: Record<CoworkerStatus, number> = { waiting_human: 0, error: 1, working: 2, idle: 3, offline: 4 }

// The Foreman first, then whoever needs you, then by recency.
export function orderCoworkers(list: Coworker[]): Coworker[] {
    const foreman = list.filter(coworker => coworker.kind === 'foreman')
    const others = list.filter(coworker => coworker.kind === 'coworker').sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.updatedMinutesAgo - b.updatedMinutesAgo)
    return [...foreman, ...others]
}

export const CANNED_REPLIES = ['On it. I will come back to you here as soon as it is done.', 'Got it. I updated the list and kept a copy of the old one, just in case.', 'Done. Anything else you want me to look at?']

export const MOCK_TRANSCRIPT = 'Can you check what is left to do on this before Friday?'

// A spoken sentence's loudness, the shape a voice message keeps of itself.
export const MOCK_VOICE_PEAKS = [0.1, 0.3, 0.55, 0.7, 0.45, 0.2, 0.6, 0.85, 0.9, 0.65, 0.4, 0.15, 0.08, 0.35, 0.7, 0.8, 0.55, 0.3, 0.5, 0.75, 0.6, 0.25, 0.1, 0.05, 0.3, 0.6, 0.9, 1, 0.7, 0.45, 0.3, 0.55, 0.65, 0.4, 0.2, 0.1, 0.45, 0.7, 0.5, 0.3, 0.6, 0.4, 0.2, 0.35, 0.25, 0.15, 0.08, 0.05]

const TITLE_WORDS = 5

// Stands in for the hub's title generation: the first words of the first message.
export function mockTitle(text: string): string {
    const words = text
        .replace(/[^\p{L}\p{N}\s’'-]/gu, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, TITLE_WORDS)
    const title = words.join(' ')
    return title ? title[0].toUpperCase() + title.slice(1) : 'Photo'
}
