import type { UIMessage } from 'ai'

const say = (id: string, text: string): UIMessage => ({ id, role: 'assistant', parts: [{ type: 'text', text }] })
const user = (id: string, text: string): UIMessage => ({ id, role: 'user', parts: [{ type: 'text', text }] })
const tool = (name: string, toolCallId: string, input: unknown, output?: unknown) => (output === undefined ? { type: `tool-${name}`, toolCallId, state: 'input-available', input } : { type: `tool-${name}`, toolCallId, state: 'output-available', input, output })
const ask = (id: string, text: string, part: ReturnType<typeof tool>): UIMessage => ({ id, role: 'assistant', parts: [{ type: 'text', text }, part] } as UIMessage)

const KICKOFF = user('k', '[[foreman:start]]')

const PACK = {
    cards: [
        { slug: 'lead-scout', promise: 'Find me new clients every week', line: 'Spots studios that just opened and drafts the first message.', title: 'Lead Scout', agent: 'Scout', image: null, connectors: ['gmail', 'linkedin'] },
        { slug: 'inbox-keeper', promise: 'Answer every enquiry within the hour', line: 'Reads the shared inbox and drafts the reply with your prices.', title: 'Inbox Keeper', agent: 'Keeper', image: null, connectors: ['gmail'] },
        { slug: 'collections-officer', promise: 'Chase my unpaid invoices', line: 'Follows up politely until it is paid, then tells you.', title: 'Collections Officer', agent: 'Ledger', image: null, connectors: ['stripe'] },
        { slug: 'executive-assistant', promise: 'Brief me every morning', line: 'Your day, your inbox and what moved overnight, in two minutes.', title: 'Executive Assistant', agent: 'Brief', image: null, connectors: ['google-calendar'] },
    ],
    boxes: [{ name: 'Sales' }, { name: 'Operations' }, { name: 'Finance' }],
}

const PLAN = {
    title: 'Your first coworker at Atelier Nord',
    boxes: [{ name: 'Sales' }, { name: 'Operations' }, { name: 'Finance' }],
    items: [{ kind: 'agent', name: 'Lead Scout', role: 'Finds interior designers who just opened a studio and drafts the first message', when: 'Every Monday at 8', gets: ['Ten new studios with their contact', 'A first message written for each', 'The ones worth a call flagged'], box: 'Sales' }],
}

const GREETING = say('a1', 'Nice to meet you, Clément. Atelier Nord makes custom furniture for interior designers, so here is the starter team that takes the most off a studio like yours.')
const PACK_ASKED: UIMessage = { id: 'a2', role: 'assistant', parts: [tool('show_starter_pack', 'pack', PACK)] } as UIMessage
const PACK_ANSWERED: UIMessage = { id: 'a2', role: 'assistant', parts: [tool('show_starter_pack', 'pack', PACK, { answered: true, chosen: ['lead-scout'] })] } as UIMessage
const PLAN_SAID = 'Here is how Lead Scout would work for you. Change anything you like before I build it.'

const BUILD_TASKS = (done: number) => ({
    tasks: [
        { title: 'Lay out your Boxes', status: done > 0 ? 'done' : 'running', steps: 1 },
        { title: 'Build Lead Scout', status: done > 1 ? 'done' : done === 1 ? 'running' : 'queued', steps: 3 },
        { title: 'Write its first skills', status: done > 2 ? 'done' : done === 2 ? 'running' : 'queued', steps: 2 },
    ],
})

const planAsked = ask('a3', PLAN_SAID, tool('show_plan', 'plan', PLAN))
const planConfirmed = ask('a3', PLAN_SAID, tool('show_plan', 'plan', PLAN, { answered: true, confirmed: true }))
const trialAsked: UIMessage = { id: 'a4', role: 'assistant', parts: [tool('open_checkout', 'trial', {})] } as UIMessage
const trialDone: UIMessage = { id: 'a4', role: 'assistant', parts: [tool('open_checkout', 'trial', {}, { ok: true, status: 'entitled' })] } as UIMessage
const building = (done: number, result?: unknown): UIMessage => ({ id: 'a5', role: 'assistant', parts: [tool('build_team', 'build', {}, result), { type: 'data-delegate', id: 'build', data: BUILD_TASKS(done) }] }) as UIMessage

export const ONBOARDING_STEPS = {
    pack: [KICKOFF, { ...GREETING, parts: [...GREETING.parts, ...PACK_ASKED.parts] } as UIMessage],
    choice: [KICKOFF, GREETING, ask('a2', 'Before I suggest anything, one thing.', tool('ask_choice', 'q1', { question: 'Which part of your week eats the most time?', options: ['Finding new clients', 'Answering enquiries', 'Quotes and invoices', 'Planning the workshop'] }))],
    input: [KICKOFF, GREETING, ask('a2', 'One detail so the coworker sounds like you.', tool('ask_input', 'q2', { question: 'Which city is the workshop in?' }))],
    either: [KICKOFF, GREETING, ask('a2', 'Two ways to start.', tool('ask_either', 'q3', { title: 'Who should it write to first?', description: 'It decides whose list it builds this week.', options: ['Interior designers', 'Architects'] }))],
    plan: [KICKOFF, { ...GREETING, parts: [...GREETING.parts, ...PACK_ANSWERED.parts] } as UIMessage, planAsked],
    trial: [KICKOFF, { ...GREETING, parts: [...GREETING.parts, ...PACK_ANSWERED.parts] } as UIMessage, planConfirmed, trialAsked],
    building: [KICKOFF, { ...GREETING, parts: [...GREETING.parts, ...PACK_ANSWERED.parts] } as UIMessage, planConfirmed, trialDone, building(1)],
    built: [KICKOFF, { ...GREETING, parts: [...GREETING.parts, ...PACK_ANSWERED.parts] } as UIMessage, planConfirmed, trialDone, building(3, { boxes: [], agents: [], failed: [], lead: { agentId: 'agent-scout', name: 'Lead Scout' } })],
    typed: [KICKOFF, GREETING, user('u1', 'Mostly quotes, honestly. Every one takes me an hour.'), say('a3', 'Then quotes it is. Give me a second to sketch the coworker for that.')],
} satisfies Record<string, UIMessage[]>

export type OnboardingLabStep = keyof typeof ONBOARDING_STEPS
