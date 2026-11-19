import type { SessionSource, SessionStatus } from '@moldwright/contracts'

export type LabConversation = {
    id: string
    title: string
    status: SessionStatus
    source: SessionSource
    minutesAgo: number
    unseen: boolean
    ask?: string
    steps?: number
}

export const LAB_CONVERSATIONS: LabConversation[] = [
    { id: 'c1', title: 'rappel-payer-freelance-radar', status: 'idle', source: 'schedule', minutesAgo: 12, unseen: false },
    { id: 'c2', title: 'CV en anglais à envoyer', status: 'awaiting_question', source: 'dashboard', minutesAgo: 5, unseen: false, ask: 'Which CV should I send, the 2024 or the 2025 one?' },
    { id: 'c3', title: 'daily-missions-apply', status: 'working', source: 'schedule', minutesAgo: 0, unseen: false, steps: 3 },
    { id: 'c4', title: 'CV à envoyer demandé', status: 'awaiting_approval', source: 'dashboard', minutesAgo: 64, unseen: false, ask: 'Send the email to Malt?' },
    { id: 'c5', title: 'daily-missions-apply', status: 'idle', source: 'schedule', minutesAgo: 60 * 24, unseen: true },
    { id: 'c6', title: 'Candidatures weekends et rappel paiement', status: 'idle', source: 'dashboard', minutesAgo: 60 * 26, unseen: true },
    { id: 'c7', title: "Comment ça va aujourd'hui ?", status: 'idle', source: 'dashboard', minutesAgo: 60 * 50, unseen: false },
    { id: 'c8', title: 'Conversation en français', status: 'error', source: 'dashboard', minutesAgo: 60 * 75, unseen: false, ask: 'The run stopped: Claude refused the request.' },
    { id: 'c9', title: 'daily-missions-apply', status: 'idle', source: 'schedule', minutesAgo: 60 * 48, unseen: false },
    { id: 'c10', title: 'daily-missions-apply', status: 'idle', source: 'schedule', minutesAgo: 60 * 72, unseen: false },
    { id: 'c11', title: 'daily-missions-apply', status: 'idle', source: 'schedule', minutesAgo: 60 * 96, unseen: false },
    { id: 'c12', title: 'Relance Comet pour la mission React', status: 'idle', source: 'dashboard', minutesAgo: 60 * 24 * 6, unseen: false },
]
