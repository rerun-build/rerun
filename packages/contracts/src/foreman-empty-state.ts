// The four questions a new conversation with a coworker offers, on every client.
export const COWORKER_STARTER_SUGGESTIONS = ['What can you help me with?', 'Summarize your recent work', 'Review my project files', 'What tools do you have access to?']

export type TeamAgent = { id: string; name: string; handle: string | null; status: string; disabledAt: string | null }

export type TeamEmptyStateAction = { type: 'send' | 'prefill'; text: string }

export type TeamEmptyStateRow = { id: string; title: string; description: string; action: TeamEmptyStateAction } & ({ leading: 'agent'; agentId: string; working: boolean } | { leading: 'build' | 'template' | 'guide' })

export type TeamPulse = {
    agents: { id: string; working: boolean }[]
    working: number
    nextRoutine: { name: string; at: number } | null
}

export type TeamEmptyStateModel = { title: string; subtitle: string | null; pulse: TeamPulse | null; rows: TeamEmptyStateRow[] }

// Every word of the empty state, in one place so a client can hand its own language. The texts sent
// or prefilled are the user's own words to the Foreman, so they follow the same language.
export type TeamEmptyStateCopy = {
    greeting: (firstName: string) => string
    greetingWithTeam: (greeting: string) => string
    emptySubtitle: string
    buildPrompt: string
    buildFirst: { title: string; description: string }
    template: { title: string; description: string; send: string }
    guide: { title: string; description: string; send: string }
    checkWorking: (name: string, mention: string) => { title: string; description: string; send: string }
    checkIdle: (name: string, mention: string) => { title: string; description: string; send: string }
    handOff: (name: string, mention: string) => { title: string; description: string; prefill: string }
    build: { title: string; description: string }
}

export const ENGLISH_TEAM_EMPTY_STATE_COPY: TeamEmptyStateCopy = {
    greeting: firstName => (firstName ? `Hi ${firstName}, I'm Rerun` : "Hi, I'm Rerun"),
    greetingWithTeam: greeting => `${greeting}. Here is your team.`,
    emptySubtitle: "You have no coworkers yet. Tell me a job you would hand off and I'll build the first one.",
    buildPrompt: 'Build me a coworker that ',
    buildFirst: { title: 'Build my first coworker', description: 'Describe the job in a sentence' },
    template: { title: 'Start from a template', description: 'Ready-made coworkers for your kind of business', send: 'Show me templates that fit my business' },
    guide: { title: 'How does this work?', description: 'Coworkers, Boxes, routines, in two minutes', send: 'How does Rerun work?' },
    checkWorking: (name, mention) => ({ title: `What is ${name} doing?`, description: 'Working now', send: `What is ${mention} doing right now?` }),
    checkIdle: (name, mention) => ({ title: `What did ${name} do today?`, description: 'Catch up on its latest runs', send: `What did ${mention} do today?` }),
    handOff: (name, mention) => ({ title: `Give ${name} a task`, description: 'I brief it and follow it through', prefill: `Ask ${mention} to ` }),
    build: { title: 'Build a new coworker', description: 'For a job nobody on the team does yet' },
}

function mentionOf(agent: TeamAgent): string {
    return `@${agent.handle || agent.name}`
}

// What the Foreman opens on when the conversation is empty: a greeting, the team at a glance, and
// three things to ask that send or prefill the composer. `nextRoutine` comes computed: reading cron
// expressions is the caller's business.
export function teamEmptyStateOf({ agents, nextRoutine, firstName, copy = ENGLISH_TEAM_EMPTY_STATE_COPY }: { agents: TeamAgent[]; nextRoutine: TeamPulse['nextRoutine']; firstName: string; copy?: TeamEmptyStateCopy }): TeamEmptyStateModel {
    const greeting = copy.greeting(firstName)
    const team = agents.filter(agent => !agent.disabledAt)

    if (team.length === 0) {
        return {
            title: greeting,
            subtitle: copy.emptySubtitle,
            pulse: null,
            rows: [
                { id: 'build-first', leading: 'build', ...copy.buildFirst, action: { type: 'prefill', text: copy.buildPrompt } },
                { id: 'template', leading: 'template', title: copy.template.title, description: copy.template.description, action: { type: 'send', text: copy.template.send } },
                { id: 'guide', leading: 'guide', title: copy.guide.title, description: copy.guide.description, action: { type: 'send', text: copy.guide.send } },
            ],
        }
    }

    const working = team.filter(agent => agent.status === 'working')
    const featured = working[0] ?? team[0]
    const other = team.find(agent => agent.id !== featured.id) ?? featured
    const featuredWorking = featured.status === 'working'

    const check = (featuredWorking ? copy.checkWorking : copy.checkIdle)(featured.name, mentionOf(featured))
    const handOff = copy.handOff(other.name, mentionOf(other))

    return {
        title: copy.greetingWithTeam(greeting),
        subtitle: null,
        pulse: {
            agents: team.map(agent => ({ id: agent.id, working: agent.status === 'working' })),
            working: working.length,
            nextRoutine,
        },
        rows: [
            { id: 'check', leading: 'agent', agentId: featured.id, working: featuredWorking, title: check.title, description: check.description, action: { type: 'send', text: check.send } },
            { id: 'hand-off', leading: 'agent', agentId: other.id, working: other.status === 'working', title: handOff.title, description: handOff.description, action: { type: 'prefill', text: handOff.prefill } },
            { id: 'build', leading: 'build', ...copy.build, action: { type: 'prefill', text: copy.buildPrompt } },
        ],
    }
}
