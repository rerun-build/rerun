import { FOREMAN_AGENT_ID } from '@rerun/contracts'

export const DEFAULT_CONVERSATION_MESSAGES = 50
export const MAX_CONVERSATION_MESSAGES = 200

// The conversations of the coworkers, read and searched, the cards they leave waiting on a member,
// and the run to stop. send_message, list_runs and get_run sit with the coworker tools.
export const CONVERSATION_TOOL_DEFS = [
    {
        name: 'list_conversations',
        description: `List the conversations of a coworker, newest first: its chats with members, the runs its scheduled tasks and triggers opened, and the ones another coworker opened on it. Each gives its \`conversationId\` (what read_conversation takes, null for one another coworker opened that nobody opened in the app yet), its \`sessionId\` (what send_message takes to continue it), title, status (idle, working, waiting on a person, error…), where it came from and when it last moved. Up to 200 per page: pass \`before\` from the answer for older ones. With agentId "${FOREMAN_AGENT_ID}" it lists your own conversations with the Chief of Staff, never another member's.`,
        inputSchema: {
            type: 'object',
            properties: {
                agentId: { type: 'string' },
                before: { type: 'string', description: 'From the previous answer, to read the next, older page.' },
            },
            required: ['agentId'],
        },
    },
    {
        name: 'read_conversation',
        description: `Read the messages of one conversation, oldest to newest: who wrote each one, when, its text, and the tools the coworker called with a preview of their input and result (each cut at 2,000 characters). The last ${DEFAULT_CONVERSATION_MESSAGES} messages by default; the answer carries \`before\` when older ones remain, to pass back for the page before.`,
        inputSchema: {
            type: 'object',
            properties: {
                conversationId: { type: 'string', description: 'From list_conversations, search_conversations, list_pending_cards or send_message.' },
                before: { type: 'integer', minimum: 0, description: 'Read the messages before this position, from the previous answer.' },
                limit: { type: 'number', description: `Default ${DEFAULT_CONVERSATION_MESSAGES}, max ${MAX_CONVERSATION_MESSAGES}.` },
            },
            required: ['conversationId'],
        },
    },
    {
        name: 'search_conversations',
        description: 'Find conversations by their title, newest first, across every coworker you can reach, or one of them with agentId. It matches the title only, never what was said inside: read a conversation to search its messages. With an agentId and no query it gives that coworker latest conversations.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string' },
                agentId: { type: 'string', description: `Only this coworker, or "${FOREMAN_AGENT_ID}" for your conversations with the Chief of Staff.` },
            },
        },
    },
    {
        name: 'cancel_run',
        description: 'Stop a run that is still working, by its runId from list_runs, get_run, send_message or run_schedule_now: the coworker stops at its next step and the run ends as cancelled. A run that already ended is left as it is. What it did before it stopped stays done.',
        inputSchema: {
            type: 'object',
            properties: { agentId: { type: 'string' }, runId: { type: 'string' } },
            required: ['agentId', 'runId'],
        },
    },
    {
        name: 'list_pending_cards',
        description:
            'List the cards the coworkers left waiting on you, newest first: questions, approvals, spends, apps or credentials to connect, skill proposals. Each card gives its conversation (sessionId) and the card itself (toolCallId), the coworker, what it asks in its own words, the choices it offered, and answeredBy: "answer_card" when it can be answered from here, "user" with why when only the person can, in the Rerun app.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'answer_card',
        description:
            "Answer one card a coworker left waiting, in the name of the member who created this key, as they would from their inbox: the coworker's run resumes and the card leaves the inbox. Read it with list_pending_cards first and pass its sessionId and toolCallId. A question takes action \"reply\", with the answer in text, or one answer per question in answers when the card asks several; an approval or a spend takes \"approve\" or \"decline\"; a skill proposal takes \"approve\" (remember it) or \"decline\" with its proposalId. Answer only what the person decided: when you are not sure, ask them first. Approving a spend of money (paid data, Rerun credit) needs their explicit yes: pass userApproved: true once they gave it. Credentials, apps to connect, server sign-ins, a browser takeover and computer access stay with the person, in the app.",
        inputSchema: {
            type: 'object',
            properties: {
                sessionId: { type: 'string', description: 'The conversation the card waits in, from list_pending_cards.' },
                toolCallId: { type: 'string', description: 'The card, from list_pending_cards. Required for every card but a skill proposal. A card answered meanwhile is refused.' },
                action: { type: 'string', enum: ['reply', 'approve', 'decline'] },
                text: { type: 'string', description: 'The answer to a question card.' },
                answers: {
                    type: 'array',
                    description: 'For a card with several questions: one answer per question, the question copied as list_pending_cards gave it.',
                    items: { type: 'object', properties: { question: { type: 'string' }, answer: { type: 'string' } }, required: ['question', 'answer'] },
                },
                proposalId: { type: 'string', description: 'The skill proposal to decide, from list_pending_cards.' },
                userApproved: { type: 'boolean', description: 'True only once the person approved this spend.' },
            },
            required: ['sessionId', 'action'],
        },
    },
] as const
