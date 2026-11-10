import type { UIMessage } from 'ai'

import type { ThreadItem } from '@/components/chat/threads/ThreadBranch'

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

const message = (id: string, role: 'user' | 'assistant', text: string, minutes: number): UIMessage => ({ id, role, parts: [{ type: 'text', text }], metadata: { createdAt: minutesAgo(minutes) } })

// Pulse's General: a conversation spread over two days, with threads opened between its messages.
export const GENERAL_MESSAGES: UIMessage[] = [
    message('g1', 'user', 'Morning! What did the pricing post do yesterday?', 26 * 60),
    message('g2', 'assistant', '1,204 views and 38 reactions, the best post this month. Most of the comments ask about the free trial.', 26 * 60 - 1),
    message('g3', 'user', 'Great. Can you plan the posts for next week?', 3 * 60),
    message('g4', 'assistant', 'Sure, I opened a thread for it so we keep General clean. I will post the plan there.', 3 * 60 - 1),
    message('g5', 'user', 'Also, what is going on with the newsletter?', 40),
    message('g6', 'assistant', 'The Thursday send failed: the Mailchimp token expired. I need you to reconnect it.', 39),
]

export const GENERAL_THREADS: ThreadItem[] = [
    { id: 'th-digest', title: 'Morning digest', status: 'idle', source: 'schedule', automationName: 'Morning digest', outcome: 'done', originAgentName: null, createdAt: minutesAgo(30 * 60) },
    { id: 'th-competitors', title: 'Competitor pricing pages', status: 'idle', source: 'dashboard', automationName: null, outcome: null, originAgentName: null, createdAt: minutesAgo(25 * 60), firstMessage: 'Look at how Lemlist, Apollo and Clay price their seats and tell me where we stand' },
    { id: 'th-week', title: 'Posts for next week', status: 'working', source: 'dashboard', automationName: null, outcome: null, originAgentName: null, createdAt: minutesAgo(3 * 60 - 2), firstMessage: 'Plan the LinkedIn posts for next week, 3 posts, one on the free trial' },
    { id: 'th-approval', title: 'Reply to the Qonto comment', status: 'awaiting_approval', source: 'dashboard', automationName: null, outcome: null, originAgentName: null, createdAt: minutesAgo(2 * 60), firstMessage: 'Answer the Qonto comment on the pricing post' },
    { id: 'th-scout', title: 'Lyon agencies one-pager', status: 'idle', source: 'agent', automationName: null, outcome: null, originAgentName: 'Scout', createdAt: minutesAgo(90) },
    { id: 'th-newsletter', title: 'Thursday newsletter', status: 'error', source: 'schedule', automationName: 'Weekly newsletter', outcome: 'failed', originAgentName: null, createdAt: minutesAgo(45) },
    { id: 'th-webhook', title: 'No new lead from the form', status: 'idle', source: 'trigger', automationName: 'Typeform lead', outcome: 'nothing', originAgentName: null, createdAt: minutesAgo(12) },
]

// Where each thread hangs in General: under the last message that was there when it opened.
export function placeThreads(messages: UIMessage[], threads: ThreadItem[]) {
    const times = messages.map(item => new Date((item.metadata as { createdAt: string }).createdAt).getTime())
    const leading: ThreadItem[] = []
    const after = new Map<number, ThreadItem[]>()
    for (const thread of [...threads].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
        const opened = new Date(thread.createdAt).getTime()
        const anchor = times.findLastIndex(time => time <= opened)
        if (anchor === -1) leading.push(thread)
        else after.set(anchor, [...(after.get(anchor) ?? []), thread])
    }
    return { leading, after }
}
